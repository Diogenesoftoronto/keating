import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, appendFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountSyncAuthPath, writeAccountSyncJson } from "../src/core/account-sync-auth.js";
import { accountSyncSessionPath } from "../src/core/account-sync-local.js";
import { currentCliAccountSyncLocal, syncCliAccount } from "../src/core/account-sync.js";
import type { ChatSyncRemoteRecord } from "../shared/account-sync/chat-sync-records.js";

test("two terminal workspaces exchange encrypted incremental native trees and preserve branches", async () => {
  const first = await mkdtemp(join(tmpdir(), "keating-sync-device-a-"));
  const second = await mkdtemp(join(tmpdir(), "keating-sync-device-b-"));
  try {
    const did = "did:plc:terminal-sync-integration", issuer = "https://provider.example";
    const dpop = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    for (const cwd of [first, second]) await writeAccountSyncJson(accountSyncAuthPath(cwd), {
      version: 1, did, issuer, accessToken: "synthetic-access-token", refreshToken: "synthetic-refresh-token",
      privateJwk: JSON.stringify(await crypto.subtle.exportKey("jwk", dpop.privateKey)), expiresAt: Date.now() + 300_000, refreshExpiresAt: Date.now() + 86400_000,
    });
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const keyId = Buffer.from(await crypto.subtle.digest("SHA-256", raw)).toString("hex").slice(0, 32);
    const remote = new Map<string, ChatSyncRemoteRecord>();
    let sequence = 0, writes = 0;
    const fetcher = (async (input, init) => {
      const url = new URL(String(input));
      expect(new Headers(init?.headers).get("Authorization")).toBe("DPoP synthetic-access-token");
      if (url.pathname === "/v1/sync/account-key") {
        const body = JSON.parse(init!.body as string);
        const client = await crypto.subtle.importKey("jwk", body.client_public_jwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
        const server = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
        const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: client }, server.privateKey, 256);
        const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
        const salt = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
        const info = new TextEncoder().encode(`notorganic-account-sync-wrap-v1:${did}:keating:${keyId}`);
        const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: info }, key, raw);
        return Response.json({ version: 1, key_id: keyId, server_public_jwk: await crypto.subtle.exportKey("jwk", server.publicKey), salt: Buffer.from(salt).toString("base64url"), iv: Buffer.from(iv).toString("base64url"), ciphertext: Buffer.from(ciphertext).toString("base64url") });
      }
      if (init?.method === "PUT") {
        writes++;
        const id = url.pathname.split("/").at(-1)!;
        const body = JSON.parse(init.body as string);
        const previous = remote.get(id);
        if (body.expected_revision !== (previous?.revision ?? 0)) return Response.json({ error: { code: "sync_revision_conflict" }, record: previous ?? null }, { status: 409 });
        const record = { id, revision: (previous?.revision ?? 0) + 1, sequence: ++sequence, mutation_id: body.mutation_id, encrypted: body.encrypted };
        remote.set(id, record);
        return Response.json({ record });
      }
      const after = Number(url.searchParams.get("after"));
      const records = [...remote.values()].filter(row => row.sequence > after).sort((a, b) => a.sequence - b.sequence).slice(0, 50);
      return Response.json({ records, cursor: String(records.at(-1)?.sequence ?? after), has_more: false });
    }) as typeof fetch;
    const source = join(first, "local.jsonl");
    const at = new Date().toISOString();
    const rows = [
      { type: "session", version: 3, id: "cross-device-native", timestamp: at, cwd: first },
      { type: "message", id: "start", parentId: null, timestamp: at, message: { role: "user", content: "private first question", timestamp: 1 } },
      { type: "custom", id: "custom", parentId: "start", timestamp: at, customType: "learner-state", data: { preserved: true } },
      { type: "message", id: "alternate", parentId: "start", timestamp: at, message: { role: "user", content: "another branch", timestamp: 2 } },
    ];
    await writeFile(source, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    const a = await currentCliAccountSyncLocal(first); await a.adopt(source);
    await syncCliAccount(first, () => {}, { fetch: fetcher });
    const firstWrites = writes;
    expect(firstWrites).toBeGreaterThan(1);
    expect(JSON.stringify([...remote.values()])).not.toContain("private first question");
    await syncCliAccount(second, () => {}, { fetch: fetcher });
    const b = await currentCliAccountSyncLocal(second);
    expect((await b.list())[0]!.data.nativeSession!.entries).toEqual(rows.slice(1));
    expect(writes).toBe(firstWrites);
    const file = accountSyncSessionPath(b.directory, "cross-device-native");
    await appendFile(file, JSON.stringify({ type: "message", id: "device-b", parentId: "alternate", timestamp: at, message: { role: "user", content: "second device append", timestamp: 3 } }) + "\n");
    await syncCliAccount(second, () => {}, { fetch: fetcher });
    expect(writes - firstWrites).toBe(3); // One portable message, one native entry, one mutable head.
    await syncCliAccount(first, () => {}, { fetch: fetcher });
    const synced = await readFile(accountSyncSessionPath(a.directory, "cross-device-native"), "utf8");
    expect(synced).toContain("second device append"); expect(synced).toContain("learner-state"); expect(synced).toContain("another branch");
    expect(writes - firstWrites).toBe(3);
  } finally { await rm(first, { recursive: true, force: true }); await rm(second, { recursive: true, force: true }); }
});
