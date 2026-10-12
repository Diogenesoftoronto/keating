import { afterEach, expect, test } from "bun:test";
import { executeMobileKnowledgeTool, type MobileKnowledgeRuntime } from "../src/lib/knowledge-tools";
import { mobileKnowledgeAccountConfig, mobileKnowledgeContent, mobileKnowledgePortalUrl, mobileKnowledgeRequest, type MobileKnowledgeSource } from "../src/lib/notorganic-account/knowledge";
import { clearDeviceSession, saveDeviceSession, setAccountCredentialStoreForTests } from "../src/lib/notorganic-account/credentials";
import { setAccountFetchForTests } from "../src/lib/notorganic-account/client";
import { setDeviceKeyAdapterForTests } from "../src/lib/notorganic-account/dpop";
import { setAccountCryptoAdapterForTests } from "../src/lib/notorganic-account/crypto";
import { runMobileToolLoop } from "../src/lib/provider-tool-loop";
import { mobileKnowledgeAttemptReceipt } from "../src/lib/knowledge-receipts";
const config = { issuer: "https://gateway.test", authorizationUrl: "https://identity.test/authorize", clientId: "https://keating.help/mobile", redirectUri: "keating:///notorganic/callback", scope: "infer:balanced evolution:read" };
const context = { idempotencyKey: "semantic-key", createdAt: Date.now() };
const source: MobileKnowledgeSource = { id: "notes", label: "Course notes", provider: "remote-mcp", resources_allowed: true, tools: [{ name: "search", inputSchema: { type: "object" } }] };
function runtime(): MobileKnowledgeRuntime {
  return { current: () => true, sources: async () => [source], selected: () => true, approved: () => true, attempted: new Set(), request: async <T,>() => ({ content: [{ type: "text", text: "external result" }] } as T) };
}
async function account(scope = "knowledge:read knowledge:tools") {
  const map = new Map<string, string>();
  setAccountCredentialStoreForTests({ getItem: async key => map.get(key) ?? null, setItem: async (key, value) => { map.set(key, value); }, deleteItem: async key => { map.delete(key); } });
  setAccountCryptoAdapterForTests({ randomBytes: async length => new Uint8Array(length).fill(7), sha256Base64: async value => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64") });
  setDeviceKeyAdapterForTests({ getOrCreatePublicJwkAsync: async () => ({ kty: "EC", crv: "P-256", x: "x", y: "y" }), signAsync: async () => "signature", deleteKeyAsync: async () => {} });
  await saveDeviceSession({ issuer: config.issuer, accountId: "did:plc:alice", accessToken: "access", refreshToken: "refresh", scope, accessExpiresAt: Date.now() + 60000, refreshExpiresAt: Date.now() + 600000 });
}
afterEach(() => { setAccountCredentialStoreForTests(null); setAccountCryptoAdapterForTests(null); setDeviceKeyAdapterForTests(null); setAccountFetchForTests(null); });

test("mobile scope approval preserves old capabilities and handoff names the native app without a customscheme redirect", () => {
  const upgraded = mobileKnowledgeAccountConfig(config, true, "judgement:evaluate tabular:predict");
  expect(upgraded.scope.split(" ")).toEqual(expect.arrayContaining(["infer:balanced", "evolution:read", "knowledge:read", "knowledge:tools", "judgement:evaluate", "tabular:predict"]));
  expect(config.scope).not.toContain("knowledge:");
  const url = new URL(mobileKnowledgePortalUrl(config)); expect(url.searchParams.get("app_client")).toBe("https://keating.help/mobile"); expect(url.searchParams.has("return_to")).toBe(false);
});
test("knowledge requests bind DPoP and reject missing scopes before dispatch", async () => {
  await account("knowledge:read"); let sent = 0;
  setAccountFetchForTests((async (url, init) => { sent++; expect(String(url)).toBe("https://gateway.test/v1/knowledge/sources"); const headers = new Headers(init?.headers); expect(headers.get("authorization")).toBe("DPoP access"); expect(headers.get("dpop")).toContain("signature"); return Response.json({ data: [] }); }) as typeof fetch);
  await mobileKnowledgeRequest("sources", {}, () => true, config); expect(sent).toBe(1);
  await expect(mobileKnowledgeRequest("sources/notes/tools/search/call", { method: "POST" }, () => true, config)).rejects.toThrow("Approve knowledge"); expect(sent).toBe(1);
});
test("signout during proof creation stops dispatch; account changes during response discard content", async () => {
  await account(); let sent = 0;
  setDeviceKeyAdapterForTests({ getOrCreatePublicJwkAsync: async () => ({ kty: "EC", crv: "P-256", x: "x", y: "y" }), signAsync: async () => { await clearDeviceSession(); return "signature"; }, deleteKeyAsync: async () => {} });
  setAccountFetchForTests((async () => { sent++; return Response.json({ data: [source] }); }) as typeof fetch);
  await expect(mobileKnowledgeRequest("sources", {}, () => true, config)).rejects.toThrow("changed"); expect(sent).toBe(0);
  await account(); setAccountFetchForTests((async () => { await clearDeviceSession(); return Response.json({ data: [source] }); }) as typeof fetch);
  await expect(mobileKnowledgeRequest("sources", {}, () => true, config)).rejects.toThrow("discarded");
});
test("selection and tool approval gate calls; a failed remote call is attempted only once", async () => {
  const rt = runtime(); let sent = 0; rt.request = async () => { sent++; throw Error("uncertain side effect"); };
  rt.selected = () => false; expect((await executeMobileKnowledgeTool("call_knowledge_tool", { source_id: "notes", tool: "search", arguments: {} }, context, rt)).ok).toBe(false); expect(sent).toBe(0);
  rt.selected = () => true; rt.approved = () => false; expect((await executeMobileKnowledgeTool("call_knowledge_tool", { source_id: "notes", tool: "search", arguments: {} }, context, rt)).ok).toBe(false); expect(sent).toBe(0);
  rt.approved = () => true;
  for (let i = 0; i < 2; i++) { const result = await executeMobileKnowledgeTool("call_knowledge_tool", { source_id: "notes", tool: "search", arguments: {} }, context, rt); expect(result.ok).toBe(false); if (!result.ok) expect(result.retryable).toBe(false); }
  expect(sent).toBe(1);
});
test("resource reads require a listed URI and selection loss withholds returned content", async () => {
  const rt = runtime(); let sent = 0;
  rt.request = async <T,>() => { sent++; return { resources: [{ uri: "notes://division", name: "Division" }] } as T; };
  const denied = await executeMobileKnowledgeTool("read_knowledge_resource", { source_id: "notes", uri: "notes://invented" }, context, rt); expect(denied.ok).toBe(false); expect(sent).toBe(1);
  let selected = true; rt.selected = () => selected;
  rt.request = async <T,>() => { selected = false; return { resources: [{ uri: "notes://division", name: "Division" }] } as T; };
  expect((await executeMobileKnowledgeTool("read_knowledge_resource", { source_id: "notes", uri: "notes://division" }, context, rt)).ok).toBe(false);
  const bounded = mobileKnowledgeContent(source, "x".repeat(30000), "notes://division"); expect(String(bounded.content)).toHaveLength(24000); expect(bounded).toMatchObject({ truncated: true, trust: "untrusted-external-content", source: { id: "notes", uri: "notes://division" } });
});
test("the provider-native loop advertises and executes a knowledge wrapper then continues with attributed data", async () => {
  let round = 0, executed = 0;
  let intentPersisted = false;
  const rt = runtime(); const result = await runMobileToolLoop({ provider: "openai", model: "fixture", customBaseUrl: "" }, "key", [{ id: "user", role: "user", content: "Look in my notes", createdAt: Date.now() }], {
    sessionId: "session", triggeringMessageId: "user", createdAt: Date.now(), commitToolCall: async receipt => { executed++; expect(receipt.execution.ok).toBe(true); },
    beforeToolExecution: async () => { intentPersisted = true; },
    executeTool: (name, args, ctx) => { expect(intentPersisted).toBe(true); return executeMobileKnowledgeTool(name, args, ctx, rt); },
    requestRound: async (_settings, _key, _messages, options) => {
      expect(options?.tools?.some(tool => tool.name === "call_knowledge_tool")).toBe(true);
      return round++ === 0 ? { text: "", calls: [{ id: "call", name: "call_knowledge_tool", arguments: { source_id: "notes", tool: "search", arguments: { query: "division" } } }], assistantTurn: { provider: "openai", previousResponseId: "turn" }, usage: null }
        : { text: "Your Course notes describe division.", calls: [], assistantTurn: null, usage: null };
    },
  }); expect(executed).toBe(1); expect(result.text).toContain("Course notes");
});

test("durable remote-call intents cannot execute again after app restart or expose cached revoked content", () => {
  const events = [{ id: "event", turnId: "turn", occurredAt: new Date().toISOString(), sequence: 0, type: "tool-call" as const, call: { id: "call", name: "call_knowledge_tool", arguments: { source_id: "notes", tool: "search", arguments: {} }, idempotencyKey: "semantic" } }];
  expect(mobileKnowledgeAttemptReceipt(events, "semantic")).toMatchObject({ ok: false, retryable: false, effects: [] });
  expect(mobileKnowledgeAttemptReceipt(events, "new-request")).toBeNull();
});
