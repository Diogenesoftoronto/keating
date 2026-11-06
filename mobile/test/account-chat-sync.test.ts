import { afterEach, expect, test } from "bun:test";
import { gzipSync } from "fflate";
import { boundedGunzip, nativeSyncCrypto, unlockNativeSyncKey, type NativeSyncBridge } from "../src/lib/account-sync/native-crypto";
import { decodeChatSyncManifest, encodeChatSyncEntry } from "../../shared/account-sync/chat-sync-records";
import { webSyncCrypto } from "../../shared/account-sync/crypto";
import { nativeSessionToSync, projectSyncedSession } from "../src/lib/account-sync/chat-projection";
import { createNativeChatReconciler } from "../src/lib/account-sync/reconcile";
import { NativeChatSyncStorage } from "../src/lib/account-sync/storage";
import { emptyChatSyncState } from "../../shared/account-sync/chat-sync-state";
import { SqliteTestDatabase } from "./helpers/sqlite";
import { initializeRepositorySchema, LearnerRecordStore, convertLegacyPersistedState } from "../src/lib/learner-repository";
import { replaceSyncedLearnerData } from "../src/lib/account-sync/guarded-write";
import type { ChatSession, PersistedAppState } from "../src/lib/types";
import { notOrganicSyncRequest, setAccountFetchForTests } from "../src/lib/notorganic-account/client";
import { clearDeviceSession, saveDeviceSession, setAccountCredentialStoreForTests } from "../src/lib/notorganic-account/credentials";
import { setAccountCryptoAdapterForTests } from "../src/lib/notorganic-account/crypto";
import { setDeviceKeyAdapterForTests } from "../src/lib/notorganic-account/dpop";
import type { NotOrganicAccountConfig } from "../src/lib/notorganic-account/contracts";

const settings = { provider: "openai" as const, model: "test-model", baseUrl: "https://model.test", temperature: 0.5 };
const chat = (): ChatSession => ({ id: "chat-one", title: "Lesson", createdAt: 1000, updatedAt: 2000, messages: [{ id: "message-one", role: "user", content: "Teach me", createdAt: 1000 }] });
const state = (sessions: ChatSession[]): PersistedAppState => ({ schemaVersion: 4, sessions, activeSessionId: sessions[0]?.id ?? "", providerSettings: settings, artifacts: [], learnerFeedback: { helpful: 0, missed: 0 } });
const namespace = `account-${"a".repeat(64)}`;

test("native chat projection preserves hidden tool events and the CLI session tree when appending", () => {
  const original = nativeSessionToSync(chat(), settings);
  original.data.messages.push({ role: "toolResult", content: [{ type: "text", text: "tool result" }], timestamp: 1500 });
  original.data.messages.push({ role: "assistant", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "A lesson" }], timestamp: 2000 });
  original.data.nativeSession = { header: { type: "session", id: "chat-one" }, entries: [{ type: "message", id: "pi-one" }], leafId: "pi-one" };
  const visible = projectSyncedSession(original);
  expect(visible.messages.map(message => message.content)).toEqual(["Teach me", "A lesson"]);
  expect(nativeSessionToSync(visible, settings, original)).toEqual(original);
  visible.messages.push({ id: "next", role: "user", content: "Continue", createdAt: 3000 });
  visible.updatedAt = 3000;
  const appended = nativeSessionToSync(visible, settings, original);
  expect(appended.data.messages.slice(0, 3)).toEqual(original.data.messages);
  expect(appended.data.nativeSession).toEqual(original.data.nativeSession);
  expect(appended.data.messages).toHaveLength(4);
  visible.messages[1]!.feedback = "helpful";
  const feedback = nativeSessionToSync(visible, settings, appended);
  expect(feedback.data.messages[2]!.content).toEqual(original.data.messages[2]!.content);
  expect((feedback.data.messages[2] as { keatingNative: { feedback: string } }).keatingNative.feedback).toBe("helpful");
});

test("native attachment device paths and transient bytes never enter the wire format", () => {
  const session = chat();
  session.messages[0]!.attachments = [{ id: "a", name: "Page", kind: "image", mimeType: "image/png", size: 1, uri: "file:///private/page", data: "privatebytes" }];
  const wire = nativeSessionToSync(session, settings);
  expect(JSON.stringify(wire)).not.toContain("file:");
  expect(JSON.stringify(wire)).not.toContain("privatebytes");
  expect(projectSyncedSession(wire).messages[0]!.attachments?.[0]?.localState).toBe("missing");
});

test("SQLite reconciliation downloads to an empty device, resumes unchanged, appends and deletes", async () => {
  const database = new SqliteTestDatabase();
  const storage = new NativeChatSyncStorage(database, namespace, () => true);
  await storage.initialize();
  let current = state([]);
  const reconcile = createNativeChatReconciler({ storage, randomUUID: () => "native-writer", sha256: webSyncCrypto.sha256, current: () => true, state: () => current,
    apply: async next => { current = next; return true; } });
  const remote = { ...emptyChatSyncState(), entries: [{ id: "chat-one", version: 1, writer: "web", session: nativeSessionToSync(chat(), settings) }] };
  const initial = await reconcile(remote);
  expect(current.sessions[0]?.messages[0]?.content).toBe("Teach me");
  expect(await reconcile(null)).toEqual(initial);
  current = structuredClone(current);
  current.sessions[0]!.messages.push({ id: "two", role: "user", content: "More", createdAt: 3000 });
  current.sessions[0]!.updatedAt = 3000;
  const appended = await reconcile(null);
  expect(appended.entries[0]?.session?.data.messages).toHaveLength(2);
  expect(appended.entries[0]?.version).toBe(2);
  current = state([]);
  expect((await reconcile(null)).entries[0]?.session).toBeNull();
  await database.closeAsync();
});

test("switching accounts cannot adopt owned local chats or their checkpoint", async () => {
  const database = new SqliteTestDatabase();
  let current = state([chat()]);
  const a = new NativeChatSyncStorage(database, namespace, () => true);
  await a.initialize();
  const make = (storage: NativeChatSyncStorage) => createNativeChatReconciler({ storage, randomUUID: () => "device", sha256: webSyncCrypto.sha256, current: () => true, state: () => current, apply: async next => { current = next; return true; } });
  expect((await make(a)(null)).entries).toHaveLength(1);
  await a.saveCheckpoint({ schemaVersion: 1, cursor: "42", records: {}, outbox: [] });
  const b = new NativeChatSyncStorage(database, `account-${"b".repeat(64)}`, () => true);
  expect((await make(b)(null)).entries).toHaveLength(0);
  expect(await b.loadCheckpoint()).toBeNull();
  expect((await a.loadCheckpoint())?.cursor).toBe("42");
  await database.closeAsync();
});

test("fork and long wire ids map to native contract ids without changing sync identity on edits/deletes", async () => {
  const database = new SqliteTestDatabase();
  await initializeRepositorySchema(database);
  const storage = new NativeChatSyncStorage(database, namespace, () => true);
  await storage.initialize();
  let current = state([]);
  const reconcile = createNativeChatReconciler({ storage, randomUUID: () => "native", sha256: webSyncCrypto.sha256, current: () => true,
    state: () => current, apply: async next => {
      // Exercise the actual native portable repository boundary, not just an in-memory view.
      const converted = convertLegacyPersistedState(next);
      await new LearnerRecordStore(database).replaceWithLocalAttachments(converted.data, converted.localAttachments);
      current = next; return true;
    } });
  const rawIds = ["chat~sync-other-2", `long-${"x".repeat(180)}`, "z".repeat(128)];
  const entries = rawIds.map((id, index) => {
    const session = nativeSessionToSync(chat(), settings);
    session.data.id = id; session.metadata.id = id;
    session.data.messages = [{ role: "user", content: `hello ${index}`, timestamp: 1000 }];
    if (index) { session.data.parentSessionId = rawIds[0]; session.metadata.parentSessionId = rawIds[0]; }
    return { id, version: 1, writer: "web", session };
  });
  const initial = await reconcile({ ...emptyChatSyncState(), entries });
  expect(initial.entries.map(entry => entry.id).sort()).toEqual([...rawIds].sort());
  expect(current.sessions.filter(session => /^sync-[a-f0-9]{64}$/.test(session.id))).toHaveLength(2);
  expect(await reconcile(null)).toEqual(initial);
  const first = current.sessions.find(session => session.messages[0]?.content === "hello 0")!;
  current = structuredClone(current);
  const edited = current.sessions.find(session => session.id === first.id)!;
  edited.title = "Renamed on phone";
  edited.messages.push({ id: "native-new", role: "user", content: "continue", createdAt: 3000 });
  edited.updatedAt = 3000;
  const updated = await reconcile(null);
  expect(updated.entries.find(entry => entry.id === rawIds[0])?.session?.data.title).toBe("Renamed on phone");
  expect(updated.entries.find(entry => entry.id === rawIds[0])?.session?.data.messages).toHaveLength(2);
  expect(updated.entries.find(entry => entry.id === rawIds[1])?.session?.data.parentSessionId).toBe(rawIds[0]);
  current = { ...current, sessions: current.sessions.filter(session => session.id !== first.id) };
  expect((await reconcile(null)).entries.find(entry => entry.id === rawIds[0])?.session).toBeNull();
  await database.closeAsync();
});

test("logout during a native SQLite write rolls back the entire downloaded projection", async () => {
  const database = new SqliteTestDatabase();
  await initializeRepositorySchema(database);
  const records = new LearnerRecordStore(database);
  const before = convertLegacyPersistedState(state([chat()])).data;
  await records.replace(before);
  const modified = structuredClone(before);
  modified.sessions[0]!.title = "Downloaded change";
  let current = true;
  database.beforeRun = sql => { if (sql.startsWith("DELETE")) current = false; };
  expect(await replaceSyncedLearnerData(database, modified, [], () => current)).toBe(false);
  database.beforeRun = undefined;
  expect((await records.snapshot()).sessions[0]!.title).toBe("Lesson");
  await database.closeAsync();
});

test("native gzip decoder rejects decompression beyond the chunk limit", () => {
  const raw = new TextEncoder().encode("hello".repeat(100));
  expect(boundedGunzip(gzipSync(raw), raw.length)).toEqual(raw);
  expect(() => boundedGunzip(gzipSync(new Uint8Array(1024 * 1024)), 24 * 1024)).toThrow("byte limit");
});

test("native bridge adapter interoperates with browser ciphertext, compression and private chunk ids", async () => {
  const raw = new Uint8Array(32).fill(19);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  const base = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  const indexingKey = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("keating-chat-content-index-v1") }, base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  const keyId = Buffer.from(await crypto.subtle.digest("SHA-256", raw)).toString("hex").slice(0, 32);
  const decode = (value: string) => new Uint8Array(Buffer.from(value, "base64url"));
  const encode = (value: Uint8Array) => Buffer.from(value).toString("base64url");
  const bridge = {
    encryptAsync: async (handle: string, iv: string, aad: string, bytes: string) => {
      expect(handle).toBe("native-key"); return encode(await webSyncCrypto.encrypt(key, decode(iv), decode(aad), decode(bytes)));
    },
    decryptAsync: async (handle: string, iv: string, aad: string, bytes: string) => {
      expect(handle).toBe("native-key"); return encode(await webSyncCrypto.decrypt(key, decode(iv), decode(aad), decode(bytes)));
    },
    hmacAsync: async (_handle: string, bytes: string) => encode(await webSyncCrypto.hmac(indexingKey, decode(bytes))),
  } as NativeSyncBridge;
  const adapter = nativeSyncCrypto(bridge, {
    getRandomBytes: (length: number) => crypto.getRandomValues(new Uint8Array(length)), randomUUID: () => crypto.randomUUID(),
    CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digest: (algorithm: string, bytes: BufferSource) => crypto.subtle.digest(algorithm, bytes),
  } as unknown as typeof import("expo-crypto"));
  const browserKey = { keyId, key, indexingKey, createdAt: "2026-01-01T00:00:00.000Z" };
  const nativeKey = { ...browserKey, key: "native-key", indexingKey: "native-key" };
  const session = chat();
  session.messages[0]!.content = "A repeated lesson. ".repeat(4000);
  const entry = { id: session.id, version: 1, writer: "browser", session: nativeSessionToSync(session, settings) };
  const web = await encodeChatSyncEntry(entry, browserKey, namespace);
  const mobile = await encodeChatSyncEntry(entry, nativeKey, namespace, adapter);
  expect(mobile.records.map(record => record.id)).toEqual(web.records.map(record => record.id));
  const records = new Map(web.records.map(record => [record.id, record]));
  expect(await decodeChatSyncManifest(web.records.at(-1)!, id => records.get(id) ?? null, { get: async () => nativeKey }, namespace, adapter)).toEqual(entry);
});

test("native key unwrap releases opaque handles after account change", async () => {
  let current = true;
  const released: string[] = [];
  const bridge = { beginAsync: async () => ({ handle: "native-handle", x: "x", y: "y" }),
    releaseAsync: async (handle: string) => { released.push(handle); }, unlockAsync: async () => "a".repeat(32) } as unknown as NativeSyncBridge;
  await expect(unlockNativeSyncKey(bridge, "did:plc:alice", async (_path, init) => {
    expect(JSON.parse(String(init.body)).client_public_jwk.d).toBeUndefined();
    current = false; return Response.json({});
  }, () => current)).rejects.toThrow("account changed");
  expect(released).toEqual(["native-handle"]);
});

const config: NotOrganicAccountConfig = { issuer: "https://gateway.test", authorizationUrl: "https://identity.test/authorize", clientId: "mobile", redirectUri: "keating:///notorganic/callback", scope: "sync:key:read" };
async function credentials() {
  const values = new Map<string, string>();
  setAccountCredentialStoreForTests({ getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }, deleteItem: async key => { values.delete(key); } });
  setAccountCryptoAdapterForTests({ randomBytes: async size => new Uint8Array(size), sha256Base64: async () => "hash" });
  setDeviceKeyAdapterForTests({ getOrCreatePublicJwkAsync: async () => ({ kty: "EC", crv: "P-256", x: "x", y: "y" }), signAsync: async () => "sig", deleteKeyAsync: async () => {} });
  await saveDeviceSession({ issuer: config.issuer, accountId: "did:plc:alice", accessToken: "access", accessExpiresAt: Date.now() + 100000, refreshToken: "refresh", refreshExpiresAt: Date.now() + 200000, scope: config.scope });
}
afterEach(() => { setAccountCredentialStoreForTests(null); setAccountCryptoAdapterForTests(null); setDeviceKeyAdapterForTests(null); setAccountFetchForTests(null); });

test("mobile sync transport preserves HTTP409 revision receipts and sends DPoP", async () => {
  await credentials();
  setAccountFetchForTests((async (url, init) => {
    expect(String(url)).toBe("https://gateway.test/v1/sync/records/c-one");
    expect(new Headers(init?.headers).get("authorization")).toBe("DPoP access");
    expect(new Headers(init?.headers).get("dpop")).toEndWith(".sig");
    expect(init?.redirect).toBe("error");
    return Response.json({ record: { revision: 2 } }, { status: 409 });
  }) as typeof fetch);
  const response = await notOrganicSyncRequest("/v1/sync/records/c-one", { method: "PUT" }, "did:plc:alice", () => true, config);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ record: { revision: 2 } });
});

test("mobile sync rejects account/issuer mismatch and discards responses after logout", async () => {
  await credentials();
  let sent = 0;
  setAccountFetchForTests((async () => { sent++; await clearDeviceSession(); return Response.json({ records: [] }); }) as typeof fetch);
  await expect(notOrganicSyncRequest("/v1/sync/records", {}, "did:plc:bob", () => true, config)).rejects.toThrow("Reconnect");
  await expect(notOrganicSyncRequest("https://evil.test/v1/account", {}, "did:plc:alice", () => true, config)).rejects.toThrow("endpoint");
  expect(sent).toBe(0);
  await expect(notOrganicSyncRequest("/v1/sync/records", {}, "did:plc:alice", () => true, config)).rejects.toThrow("discarded");
});

test("mobile sync signs the RFC9449 query-free target while retaining the pull cursor", async () => {
  await credentials();
  setAccountFetchForTests((async (url, init) => {
    expect(String(url)).toBe("https://gateway.test/v1/sync/records?after=23&limit=50");
    const proof = new Headers(init?.headers).get("dpop")!;
    const payload = JSON.parse(Buffer.from(proof.split(".")[1]!, "base64url").toString());
    expect(payload.htu).toBe("https://gateway.test/v1/sync/records");
    expect(payload.htm).toBe("GET");
    return Response.json({ records: [], cursor: "23", has_more: false });
  }) as typeof fetch);
  expect((await notOrganicSyncRequest("/v1/sync/records?after=23&limit=50", {}, "did:plc:alice", () => true, config)).status).toBe(200);
});
