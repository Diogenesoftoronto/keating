import type { AccountSyncKey } from "../../shared/account-sync/device-identity.js";
import type { webcrypto } from "node:crypto";

function bytes(value: unknown, length: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid account key envelope.");
  const result = Buffer.from(value, "base64url");
  if (result.length !== length || result.toString("base64url") !== value) throw new Error("Invalid account key envelope.");
  return Uint8Array.from(result);
}

/** Account key exists only in memory; durable CLI credentials remain mode 0600. */
export async function unlockCliAccountSyncKey(requester: { did: string; request(path: string, init?: RequestInit): Promise<Response> }): Promise<AccountSyncKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const response = await requester.request("/v1/sync/account-key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_public_jwk: await crypto.subtle.exportKey("jwk", pair.publicKey) }) });
  if (!response.ok) throw new Error(`Account sync key could not be unlocked (HTTP ${response.status}).`);
  const envelope = await response.json() as { version?: unknown; key_id?: unknown; server_public_jwk?: webcrypto.JsonWebKey; salt?: unknown; iv?: unknown; ciphertext?: unknown };
  if (envelope.version !== 1 || typeof envelope.key_id !== "string" || !/^[a-f0-9]{32}$/.test(envelope.key_id)
    || !envelope.server_public_jwk || envelope.server_public_jwk.kty !== "EC" || envelope.server_public_jwk.crv !== "P-256" || envelope.server_public_jwk.d !== undefined) throw new Error("Invalid account key envelope.");
  const server = await crypto.subtle.importKey("jwk", envelope.server_public_jwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: server }, pair.privateKey, 256);
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  const info = new TextEncoder().encode(`notorganic-account-sync-wrap-v1:${requester.did}:keating:${envelope.key_id}`);
  const wrapping = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: bytes(envelope.salt, 32), info }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const raw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(envelope.iv, 12), additionalData: info }, wrapping, bytes(envelope.ciphertext, 48)));
  try {
    if (raw.length !== 32 || Buffer.from(await crypto.subtle.digest("SHA-256", raw)).toString("hex").slice(0, 32) !== envelope.key_id) throw new Error("Account sync key does not match its identity.");
    const indexingBase = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
    return {
      keyId: envelope.key_id,
      key: await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]),
      indexingKey: await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("keating-chat-content-index-v1") }, indexingBase, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]),
      createdAt: new Date().toISOString(),
    };
  } finally { raw.fill(0); }
}
