import { describe, expect, it } from "bun:test";
import { KnowledgeClient, knowledgeOutput, knowledgeSetupUrl, knowledgeAuthorizationConfig, knowledgeTransport, type KnowledgeSource } from "../notorganic-provider/knowledge";
import type { NotOrganicProviderSession } from "../notorganic-provider/public-client";
import { createKnowledgeTools } from "../keating/browser-tools/knowledge";
import { filterAvailableKeatingTools } from "../keating/capabilities";
import { classifyTool } from "../keating/security/policy";
import { NotOrganicPublicClient } from "../notorganic-provider/public-client";
import { IDBFactory } from "fake-indexeddb";

const source: KnowledgeSource = { id: "notes", label: "Course notes", provider: "remote-mcp", resources_allowed: true, tools: [{ name: "search", description: "Search notes", inputSchema: { type: "object", properties: { query: { type: "string" } } } }] };
const config = { issuer: "https://api.test", authorizationUrl: "https://id.test/authorize", clientId: "https://keating.test", redirectUri: "https://keating.test/notorganic/callback", scope: "wallet:read" };
function fixture() {
  let session: NotOrganicProviderSession | null = { id: "learner-one", accessToken: "fixture", expiresAt: Date.now() + 100_000, scope: "knowledge:read knowledge:tools" };
  let sources = structuredClone([source]);
  let posts = 0;
  const bodies: string[] = [];
  let resourceWork: (() => Promise<Response>) | undefined;
  let fail = false;
  const transport = {
    getSession: () => session,
    request: async (path: string, init?: RequestInit) => {
      if (path.endsWith("/sources")) return Response.json({ data: sources });
      if (init?.method === "POST") { posts++; bodies.push(String(init.body)); }
      if (path.endsWith("/resources/read")) return resourceWork ? await resourceWork() : Response.json({ contents: [{ uri: "notes://intro", text: "Evidence", blob: "secret-binary" }] });
      if (path.endsWith("/resources")) return Response.json({ resources: [{ uri: "notes://intro", name: "Introduction" }] });
      return fail ? Response.json({}, { status: 502 }) : Response.json({ content: [{ type: "text", text: "Found notes" }, { type: "image", data: "omit" }] });
    },
  };
  const client = new KnowledgeClient(transport, "https://api.test:https://keating.test");
  return { client, setSession: (value: NotOrganicProviderSession | null) => { session = value; }, getSession: () => session!, setSources: (value: KnowledgeSource[]) => { sources = value; }, posts: () => posts, bodies, deferRead: (work: () => Promise<Response>) => { resourceWork = work; }, failCalls: () => { fail = true; } };
}
async function enable(f: ReturnType<typeof fixture>) { await f.client.refresh(); f.client.selectSource("notes", true); f.client.selectTool("notes", "search", true); }

describe("Shared account knowledge", () => {
  it("starts with no automatic access and exposes only selected resources and tools", async () => {
    const f = fixture();
    await f.client.refresh();
    expect(await f.client.catalog()).toEqual([]);
    await expect(f.client.read("notes", "notes://intro")).rejects.toThrow("Choose this source");
    f.client.selectSource("notes", true);
    expect((await f.client.catalog())[0].tools).toEqual([]);
    await expect(f.client.call("notes", "search", {}, async () => true)).rejects.toThrow("Enable this permitted tool");
    expect(f.posts()).toBe(0);
    const read = await f.client.read("notes", "notes://intro");
    expect(read).toContain("UNTRUSTED"); expect(read).toContain("Course notes"); expect(read).toContain("notes://intro"); expect(read).not.toContain("secret-binary");
    await expect(f.client.read("notes", "notes://private")).rejects.toThrow("current resource list");
  });
  it("prunes revoked sources and changed schemas without enabling new catalog entries", async () => {
    const f = fixture(); await enable(f);
    f.setSources([{ ...source, tools: [{ ...source.tools[0], inputSchema: { type: "object", properties: { changed: { type: "string" } } } }] }]);
    await f.client.refresh();
    expect(f.client.snapshot().selected.notes.tools).toEqual({});
    await expect(f.client.call("notes", "search", {}, async () => true)).rejects.toThrow("Enable this permitted tool");
    f.setSources([]); await f.client.refresh();
    expect(f.client.snapshot().selected).toEqual({});
    expect(f.posts()).toBe(0);
  });
  it("withholds reads across sign-out/account change and preserves selections through device refresh", async () => {
    const f = fixture(); await enable(f);
    f.setSession({ ...f.getSession(), accessToken: "rotated" });
    await f.client.refresh(); expect(Object.keys(f.client.snapshot().selected)).toEqual(["notes"]);
    let finish!: (response: Response) => void;
    f.deferRead(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.client.read("notes", "notes://intro");
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    f.setSession({ ...f.getSession(), id: "learner-two" });
    finish(Response.json({ contents: [{ text: "Previous account secret" }] }));
    await expect(pending).rejects.toThrow("account changed");
    expect(f.client.snapshot().selected).toEqual({});
    f.setSession(null); expect(f.client.snapshot().status).toBe("signed-out");
  });
  it("requires each call review, binds exact arguments, and rechecks selection after review", async () => {
    const f = fixture(); await enable(f);
    await expect(f.client.call("notes", "search", {}, async () => false)).rejects.toThrow("cancelled");
    expect(f.posts()).toBe(0);
    const args = { query: "Original" };
    await f.client.call("notes", "search", args, async (_source, _tool, reviewed) => { expect(reviewed).toEqual({ query: "Original" }); args.query = "Changed while waiting"; return true; });
    expect(JSON.parse(f.bodies[0]).arguments).toEqual({ query: "Original" });
    await expect(f.client.call("notes", "search", {}, async () => { f.client.selectSource("notes", false); return true; })).rejects.toThrow("Choose this source");
    expect(f.posts()).toBe(1);
  });
  it("blocks oversized hidden arguments and never retries a failed remote action", async () => {
    const f = fixture(); await enable(f);
    let approvals = 0;
    await expect(f.client.call("notes", "search", { query: "x".repeat(33_000) }, async () => { approvals++; return true; })).rejects.toThrow("too large");
    expect(approvals).toBe(0); expect(f.posts()).toBe(0);
    f.failCalls();
    await expect(f.client.call("notes", "search", {}, async () => true)).rejects.toThrow("not retried");
    expect(f.posts()).toBe(1);
  });
  it("fails closed on missing scopes, malformed catalog and storage errors", async () => {
    const f = fixture(); f.setSession({ ...f.getSession(), scope: "wallet:read" });
    expect(f.client.snapshot().status).toBe("permission");
    await expect(f.client.refresh()).rejects.toThrow("Allow knowledge access");
    f.setSession({ ...f.getSession(), scope: "knowledge:read" }); await enable(f);
    await expect(f.client.call("notes", "search", {}, async () => true)).rejects.toThrow("Enable this permitted tool");
    f.setSources([{ ...source, tools: [{ name: "bad", inputSchema: [] as unknown as Record<string, unknown> }] }]);
    await expect(f.client.refresh()).rejects.toThrow("catalog is invalid");
    expect(f.client.snapshot().selected).toEqual({});
    const blocked = new KnowledgeClient({ getSession: f.getSession, request: async () => Response.json({ data: [source] }) }, "blocked", { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); }, removeItem: () => { throw Error("blocked"); } } as unknown as Storage);
    await blocked.refresh(); blocked.selectSource("notes", true); expect(blocked.snapshot().selected.notes).toBeDefined();
  });
  it("keeps the portal handoff on the exact public client and source output bounded", () => {
    const url = new URL(knowledgeSetupUrl(config, "https://keating.test/chat?course=one")!);
    expect(url.origin).toBe("https://id.test"); expect(url.searchParams.get("app_client")).toBe(config.clientId); expect(url.searchParams.get("return_to")).toBe("https://keating.test/chat?course=one");
    expect(knowledgeSetupUrl(config, "https://evil.test/")).toBeNull();
    expect(knowledgeOutput(source, { content: "x".repeat(30_000) })).toContain("[Content truncated]");
    const extended = knowledgeAuthorizationConfig(config, { id: "account", accessToken: "credential", expiresAt: Date.now() + 100_000, scope: "usage:read infer:balanced wallet:read" });
    expect(new Set(extended.scope.split(" "))).toEqual(new Set(["wallet:read", "usage:read", "infer:balanced", "knowledge:read", "knowledge:tools"]));
    expect(config.scope).toBe("wallet:read");
  });
  it("keeps stable knowledge tools visible with sensitive-read and side-effect policies", () => {
    const tools = createKnowledgeTools(fixture().client);
    expect(filterAvailableKeatingTools(tools).map(tool => tool.name)).toEqual(["knowledge_sources", "knowledge_read_resource", "knowledge_call_tool"]);
    expect(classifyTool("knowledge_sources").risk).toBe("sensitive-read"); expect(classifyTool("knowledge_read_resource").risk).toBe("sensitive-read"); expect(classifyTool("knowledge_call_tool").risk).toBe("external-side-effect");
    expect(createKnowledgeTools(null)).toEqual([]);
  });
  it("sends a failed action only once through the real public DPoP transport", async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
    storage.setItem("keating.notorganic.session", JSON.stringify({ id: "dpop-learner", accessToken: "fixture", expiresAt: Date.now() + 100_000, scope: "knowledge:read knowledge:tools" }));
    let posts = 0;
    const fetcher = Object.assign(async (_url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("DPoP fixture");
      expect(new Headers(init?.headers).get("dpop")?.split(".").length).toBe(3);
      if (init?.method === "POST") { posts++; return Response.json({}, { status: 401 }); }
      return Response.json({ data: [source] });
    }, { preconnect: fetch.preconnect }) as typeof fetch;
    const client = new KnowledgeClient(knowledgeTransport(new NotOrganicPublicClient(config, fetcher), fetcher), "dpop");
    await client.refresh(); client.selectSource("notes", true); client.selectTool("notes", "search", true);
    await expect(client.call("notes", "search", {}, async () => true)).rejects.toThrow("Reconnect");
    expect(posts).toBe(1);
  });
  it("rechecks account and source selection after asynchronous DPoP headers before dispatch", async () => {
    for (const change of ["account", "selection"] as const) {
      let session: NotOrganicProviderSession = { id: "one", accessToken: "fixture", expiresAt: Date.now() + 100_000, scope: "knowledge:read knowledge:tools" };
      let release!: () => void;
      let posts = 0;
      const fetcher = Object.assign(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === "POST") { posts++; return Response.json({ content: [] }); }
        return Response.json({ data: [source] });
      }, { preconnect: fetch.preconnect }) as typeof fetch;
      const transport = knowledgeTransport({ config, getSession: () => session, headersFor: async method => { if (method === "POST") await new Promise<void>(resolve => { release = resolve; }); return new Headers(); } }, fetcher);
      const client = new KnowledgeClient(transport, "last-dispatch");
      await client.refresh(); client.selectSource("notes", true); client.selectTool("notes", "search", true);
      const call = client.call("notes", "search", {}, async () => true);
      while (!release) await new Promise(resolve => setTimeout(resolve, 1));
      if (change === "account") session = { ...session, id: "two" }; else client.selectSource("notes", false);
      release();
      await expect(call).rejects.toThrow(change === "account" ? "account changed" : "Tool access changed");
      expect(posts).toBe(0);
    }
  });
  it("reports uncertain execution on a lost network response without replay", async () => {
    const f = fixture();
    let posts = 0;
    const client = new KnowledgeClient({ getSession: f.getSession, request: async (_path, init) => {
      if (init?.method === "POST") { posts++; throw new TypeError("Network response was lost"); }
      return Response.json({ data: [source] });
    } }, "network-loss");
    await client.refresh(); client.selectSource("notes", true); client.selectTool("notes", "search", true);
    await expect(client.call("notes", "search", {}, async () => true)).rejects.toThrow("may already have acted");
    expect(posts).toBe(1);
  });
});
