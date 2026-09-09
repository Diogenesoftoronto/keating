import { describe, expect, test } from "bun:test";
import {
  MemoryStateStore,
  PortableAgentInstance,
  useAgentStart,
  useDataWriter,
  useInstruction,
  useMcpConnection,
  useModel,
  useResponseFinish,
  useSkill,
  useSubagent,
  useTool,
  type DataWriter,
  type JsonValue,
} from "@keating/agent-runtime";
import {
  authorKeatingBrowserAgent,
  BrowserPortableAgentAdapter,
  type BrowserPortableAgentHosts,
  type DelegationRequest,
  type LifecycleInvocation,
} from "../keating/portable-agent";

function toolText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
    .map(({ text }) => text)
    .join("\n");
}

function hosts(overrides: Partial<BrowserPortableAgentHosts> = {}): BrowserPortableAgentHosts {
  return {
    delegate: async () => null,
    resolveMcpConnection: async () => [],
    ...overrides,
  };
}

describe("portable browser tool adapter", () => {
  test("adapts portable tool input/output to Pi's text result contract", async () => {
    const adapter = new BrowserPortableAgentAdapter(hosts());
    const instance = new PortableAgentInstance({ id: "portable-tool" });
    const inspectDefinition = {
      name: "inspect",
      description: "Inspect deterministic values.",
      inputSchema: {
        type: "object",
        properties: { topic: { type: "string" } },
        required: ["topic"],
        additionalProperties: false,
      },
      parseInput(value: unknown) {
        const record = value as Record<string, unknown>;
        if (typeof record.topic !== "string") throw new Error("topic required");
        return { topic: record.topic };
      },
      run: ({ data }: { data: { topic: string } }) => ({ topic: data.topic, b: 2, a: 1 }),
    };
    function Agent() {
      useModel("local/model");
      useTool(inspectDefinition);
      return "Inspect.";
    }

    const resources = await adapter.reconcile(instance.render(Agent));
    const tool = resources.tools.find(({ name }) => name === "inspect")!;
    const result = await tool.execute("call-1", { topic: "DNS" });

    expect(resources.systemPrompt).toBe("Inspect.");
    expect(tool.parameters).toEqual(inspectDefinition.inputSchema);
    expect(tool.parameters).toMatchObject({
      required: ["topic"],
      additionalProperties: false,
    });
    expect(toolText(result)).toBe('{"a":1,"b":2,"topic":"DNS"}');
    expect(result.details).toEqual({ source: "portable-tool", tool: "inspect" });
    await expect(tool.execute("call-2", {})).rejects.toThrow("topic required");
  });

  test("reports deterministic tool reconciliation as resources toggle", async () => {
    let enabled = true;
    const adapter = new BrowserPortableAgentAdapter(hosts());
    const instance = new PortableAgentInstance({ id: "portable-reconcile" });
    function Agent() {
      useModel("local/model");
      useTool({ name: "dynamic", description: "Dynamic.", revision: "v1", run: () => null }, { enabled });
      return "Dynamic.";
    }

    const first = await adapter.reconcile(instance.render(Agent));
    expect(first.reconciliation.addedToolNames).toEqual(["dynamic"]);
    expect(first.reconciliation.frameChanges).toContainEqual({
      kind: "tool",
      name: "dynamic",
      change: "added",
      revision: "v1",
    });

    enabled = false;
    const second = await adapter.reconcile(instance.render(Agent));
    expect(second.reconciliation.activeToolNames).toEqual([]);
    expect(second.reconciliation.removedToolNames).toEqual(["dynamic"]);
  });
});

describe("portable browser resources", () => {
  test("authors the live browser teacher while preserving host Pi tools", async () => {
    const nativeTool = {
      name: "quiz",
      label: "Quiz",
      description: "Render a quiz.",
      parameters: {
        type: "object",
        properties: { topic: { type: "string" } },
        required: ["topic"],
        additionalProperties: false,
      },
      execute: async () => ({
        content: [{ type: "text", text: "<keating-quiz />" }],
        details: { openui: true },
      }),
    } as any;

    const authored = await authorKeatingBrowserAgent({
      instanceId: "live-browser-teacher",
      modelKey: "browser/local",
      systemPrompt: "Teach from learner evidence.",
      tools: [nativeTool],
      hosts: hosts(),
    });

    expect(authored.tools.find(({ name }) => name === "quiz")).toBe(nativeTool);
    expect(authored.tools.map(({ name }) => name)).toEqual([
      "quiz",
      "keating_activate_skill",
      "keating_task",
    ]);
    expect(authored.systemPrompt).toContain("Teach from learner evidence.");
    expect(authored.systemPrompt).toContain("teaching-improvement");
    expect(authored.systemPrompt).toContain("lesson-critic");
    expect(authored.frame.model).toBe("browser/local");
  });

  test("progressively activates skills and clears activation on revision change", async () => {
    let revision = "skill-v1";
    const adapter = new BrowserPortableAgentAdapter(hosts());
    const instance = new PortableAgentInstance({ id: "portable-skill" });
    function Agent() {
      useModel("local/model");
      useSkill({
        name: "retrieval",
        description: "Designs retrieval checks.",
        instructions: "PRIVATE SKILL INSTRUCTIONS: ask before explaining.",
        resources: [{ path: "rubric.md", content: "Observed evidence outranks synthetic evidence." }],
        revision,
      });
      return "Teach.";
    }

    const first = await adapter.reconcile(instance.render(Agent));
    expect(first.systemPrompt).toContain("retrieval: Designs retrieval checks.");
    expect(first.systemPrompt).not.toContain("PRIVATE SKILL INSTRUCTIONS");
    const activate = first.tools.find(({ name }) => name === "keating_activate_skill")!;
    const read = first.tools.find(({ name }) => name === "keating_read_skill_resource")!;
    await expect(read.execute("read-before", { skill: "retrieval", path: "rubric.md" }))
      .rejects.toThrow("Activate portable skill retrieval");

    const activation = await activate.execute("activate", { name: "retrieval" });
    expect(toolText(activation)).toContain("PRIVATE SKILL INSTRUCTIONS");
    const resource = await read.execute("read-after", { skill: "retrieval", path: "rubric.md" });
    expect(toolText(resource)).toBe("Observed evidence outranks synthetic evidence.");

    revision = "skill-v2";
    const second = await adapter.reconcile(instance.render(Agent));
    expect(second.reconciliation.clearedSkillNames).toEqual(["retrieval"]);
    const nextRead = second.tools.find(({ name }) => name === "keating_read_skill_resource")!;
    await expect(nextRead.execute("read-stale", { skill: "retrieval", path: "rubric.md" }))
      .rejects.toThrow("Activate portable skill retrieval");
  });

  test("delegates only an explicit task and an empty fresh context", async () => {
    let request: DelegationRequest | null = null;
    function Reviewer() {
      useModel("local/reviewer");
      return "Review independently.";
    }
    const adapter = new BrowserPortableAgentAdapter(hosts({
      delegate: async (next) => {
        request = next;
        return { verdict: "pass" };
      },
    }));
    const instance = new PortableAgentInstance({ id: "portable-delegate", state: new MemoryStateStore({ private: "parent-state" }) });
    function Agent() {
      useModel("local/model");
      useSubagent({
        name: "reviewer",
        description: "Reviews a lesson candidate.",
        agent: Reviewer,
        model: "local/reviewer",
      });
      return "Teach.";
    }

    const resources = await adapter.reconcile(instance.render(Agent));
    const task = resources.tools.find(({ name }) => name === "keating_task")!;
    const result = await task.execute("delegate", { subagent: "reviewer", task: "Check retrieval quality." });

    expect(toolText(result)).toBe('{"verdict":"pass"}');
    expect(request).not.toBeNull();
    expect(request!.isolation).toBe("fresh-context");
    expect(request!.messages).toEqual([]);
    expect(request!.task).toBe("Check retrieval quality.");
    expect(request).not.toHaveProperty("state");
    expect(request).not.toHaveProperty("systemPrompt");
    expect(Object.keys(request!).sort()).toEqual(["isolation", "messages", "subagent", "task"]);
  });

  test("resolves declarative MCP tools without exposing auth refs", async () => {
    const seenAuthRefs: Array<string | undefined> = [];
    const adapter = new BrowserPortableAgentAdapter(hosts({
      resolveMcpConnection: async (connection) => {
        seenAuthRefs.push(connection.authRef);
        return [{
          name: "evidence_read",
          description: "Read minimized learner evidence.",
          execute: async ({ topic }) => ({ topic: String(topic), exposures: 3 }),
        }, {
          name: "not_allowed",
          description: "Must not be mounted.",
          execute: async () => null,
        }];
      },
    }));
    const instance = new PortableAgentInstance({ id: "portable-mcp" });
    function Agent() {
      useModel("local/model");
      useMcpConnection({
        name: "learner",
        description: "Learner evidence.",
        transport: "streamable-http",
        endpoint: "https://api.notorganic.info/private/mcp",
        tools: ["evidence_read"],
        authRef: "notorganic:mcp/account-evidence",
      });
      return "Teach.";
    }

    const resources = await adapter.reconcile(instance.render(Agent));
    expect(seenAuthRefs).toEqual(["notorganic:mcp/account-evidence"]);
    expect(resources.systemPrompt).toContain("learner: Learner evidence. [evidence_read]");
    expect(resources.systemPrompt).not.toContain("notorganic:mcp/account-evidence");
    expect(resources.systemPrompt).not.toContain("https://api.notorganic.info/private/mcp");
    expect(resources.tools.map(({ name }) => name)).toEqual(["mcp__learner__evidence_read"]);

    const result = await resources.tools[0]!.execute("mcp-call", { topic: "DNS" });
    expect(toolText(result)).toBe('{"exposures":3,"topic":"DNS"}');
    expect(JSON.stringify(result)).not.toContain("account-evidence");
    expect(result.details).toEqual({ source: "portable-mcp", connection: "learner", tool: "evidence_read" });
  });
});

describe("portable lifecycle and data bridges", () => {
  test("routes data events and lifecycle callbacks through injected hosts", async () => {
    const dataEvents: Array<{ name: string; value: JsonValue }> = [];
    const lifecycle: Array<{ kind: string; index: number }> = [];
    const adapter = new BrowserPortableAgentAdapter(hosts({
      onData: (event) => dataEvents.push({ name: event.name, value: event.value }),
      invokeLifecycle: async (invocation: LifecycleInvocation<unknown>) => {
        lifecycle.push({ kind: invocation.kind, index: invocation.index });
        return invocation.run();
      },
    }));
    let writer: DataWriter<{ document: string }> | undefined;
    const instance = new PortableAgentInstance({ id: "portable-events", onData: adapter.handleData });
    function Agent() {
      useModel("local/model");
      writer = useDataWriter<{ document: string }>("openui");
      useAgentStart(() => ({ loaded: true }), { slot: "load" });
      useResponseFinish(({ response }) => ({ response }), { slot: "finish" });
      return "Teach.";
    }

    await adapter.reconcile(instance.render(Agent));
    const event = { document: "quiz" };
    writer!.write(event);
    event.document = "mutated";
    expect(dataEvents).toEqual([{ name: "openui", value: { document: "quiz" } }]);

    const context = { instanceId: "portable-events", state: instance.state, metadata: {} };
    expect(await adapter.runLifecycle("agent-start", context)).toEqual([{ loaded: true }]);
    expect(await adapter.runLifecycle("response-finish", { ...context, response: { text: "done" } })).toEqual([
      { response: { text: "done" } },
    ]);
    expect(lifecycle).toEqual([
      { kind: "agent-start", index: 0 },
      { kind: "response-finish", index: 0 },
    ]);
  });
});

describe("portable browser source boundary", () => {
  test("contains no Node, Flue, or direct network imports", async () => {
    const sourceRoot = `${import.meta.dir}/../keating/portable-agent`;
    const files: string[] = [];
    const glob = new Bun.Glob("*.ts");
    for await (const path of glob.scan({ cwd: sourceRoot })) files.push(path);
    const source = (await Promise.all(files.sort().map((path) => Bun.file(`${sourceRoot}/${path}`).text()))).join("\n");

    expect(files.length).toBeGreaterThan(0);
    expect(source).not.toMatch(/from\s+["']node:/);
    expect(source).not.toMatch(/@flue\//);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});
