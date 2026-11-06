import type { SyncCrypto } from "../../../../shared/account-sync/crypto";
import type { AccountSyncKey } from "../../../../shared/account-sync/device-identity";
import { Gunzip, gzipSync } from "fflate";
import { base64UrlFromBytes } from "../notorganic-account/crypto";

export interface NativeSyncBridge {
  beginAsync(): Promise<{ handle: string; x: string; y: string }>;
  unlockAsync(handle: string, did: string, envelope: string): Promise<string>;
  encryptAsync(handle: string, iv: string, aad: string, bytes: string): Promise<string>;
  decryptAsync(handle: string, iv: string, aad: string, bytes: string): Promise<string>;
  hmacAsync(handle: string, bytes: string): Promise<string>;
  releaseAsync(handle: string): Promise<void>;
}

function decode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), value => value.charCodeAt(0));
}

export function boundedGunzip(bytes: Uint8Array, maxBytes: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const stream = new Gunzip(chunk => {
    length += chunk.length;
    if (length > maxBytes) throw new Error("Decompressed chat chunk exceeds its byte limit.");
    chunks.push(chunk);
  });
  // Small input pushes bound fflate's temporary output buffers as well as retained output.
  for (let offset = 0; offset < bytes.length; offset += 128) stream.push(bytes.subarray(offset, offset + 128), offset + 128 >= bytes.length);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export function nativeSyncCrypto(bridge: NativeSyncBridge, expo = require("expo-crypto") as typeof import("expo-crypto")): SyncCrypto {
  const handle = (key: unknown): string => {
    if (typeof key !== "string" || !key) throw new Error("Account sync is locked.");
    return key;
  };
  return {
    randomBytes: length => expo.getRandomBytes(length),
    randomUUID: () => expo.randomUUID(),
    sha256: async bytes => new Uint8Array(await expo.digest(expo.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes))),
    encrypt: async (key, iv, aad, bytes) => decode(await bridge.encryptAsync(handle(key), base64UrlFromBytes(iv), base64UrlFromBytes(aad), base64UrlFromBytes(bytes))),
    decrypt: async (key, iv, aad, bytes) => decode(await bridge.decryptAsync(handle(key), base64UrlFromBytes(iv), base64UrlFromBytes(aad), base64UrlFromBytes(bytes))),
    hmac: async (key, bytes) => decode(await bridge.hmacAsync(handle(key), base64UrlFromBytes(bytes))),
    gzip: async bytes => gzipSync(bytes),
    gunzip: async (bytes, maxBytes) => boundedGunzip(bytes, maxBytes),
  };
}

export function loadNativeSyncBridge(): NativeSyncBridge {
  const { requireNativeModule } = require("expo-modules-core") as typeof import("expo-modules-core");
  try { return requireNativeModule<NativeSyncBridge>("KeatingSyncCrypto"); }
  catch { throw new Error("Update the Keating app to enable encrypted chat sync on this device."); }
}

/** Fresh authenticated unlock on every session: cached keys never bypass revocation. */
export async function unlockNativeSyncKey(
  bridge: NativeSyncBridge, did: string, request: (path: string, init: RequestInit) => Promise<Response>, current: () => boolean,
): Promise<{ key: AccountSyncKey; release(): Promise<void> }> {
  const exchange = await bridge.beginAsync();
  const release = () => bridge.releaseAsync(exchange.handle);
  try {
    if (!current()) throw new Error("The sync account changed.");
    const response = await request("/v1/sync/account-key", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_public_jwk: { kty: "EC", crv: "P-256", x: exchange.x, y: exchange.y } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Reconnect Not Organic to unlock chat sync.");
    const envelope = await response.json();
    if (!current()) throw new Error("The sync account changed.");
    const keyId = await bridge.unlockAsync(exchange.handle, did, JSON.stringify(envelope));
    if (!current()) throw new Error("The sync account changed.");
    return { key: { keyId, key: exchange.handle, indexingKey: exchange.handle, createdAt: new Date().toISOString() }, release };
  } catch (error) { await release().catch(() => undefined); throw error; }
}
