import { describe, expect, test } from "bun:test";
import {
  HookUsageError,
  MemoryStateStore,
  PortableAgentInstance,
  ResourceConflictError,
  StateValidationError,
  StructuralInvariantError,
  useAgentFinish,
  useAgentStart,
  useDataWriter,
  useInstruction,
  useMcpConnection,
  useModel,
  usePersistentState,
  useResponseFinish,
  useResponseStart,
  useSandbox,
  useSkill,
  useSubagent,
  useTool,
  type AgentFunction,
  type DataEvent,
  type DataWriter,
  type JsonValue,
  type McpConnectionDefinition,
  type PortableSandboxFactory,
  type StateSetter,
} from "../src";

const sandboxFactory: PortableSandboxFactory = {
  revision: "sandbox-v1",
  async createSandbox() {
    throw new Error("The collector never provisions a sandbox.");
  },
};

function childAgent() {
  return "Review the candidate independently.";
}

describe("portable hook collection", () => {
  test("preserves canonical JSON tool schemas without sharing mutable input", () => {
    const schema = {
      type: "object",
      properties: { topic: { type: "string" } },
      required: ["topic"],
      additionalProperties: false,
    };
    function SchemaAgent() {
      useModel("test/model");
      useTool({
        name: "quiz",
        description: "Create a retrieval quiz.",
        inputSchema: schema,
        run: () => "ok",
      });
    }
    const result = new PortableAgentInstance({ id: "schema-agent" }).render(SchemaAgent);
    schema.required.push("mutated-after-render");
    expect(result.tools[0]?.inputSchema).toEqual({
      type: "object",
      properties: { topic: { type: "string" } },
      required: ["topic"],
      additionalProperties: false,
    });
  });

  test("collects one deterministic frame without executing resources", () => {
    const events: DataEvent[] = [];
    const instance = new PortableAgentInstance({ id: "agent-1", onData: (event) => events.push(event) });
    let writer: DataWriter<{ status: string }> | undefined;

    function Agent() {
      useModel("notorganic/balanced");
      useInstruction("Use retrieval practice.", { slot: "pedagogy", revision: "prompt-v1" });
      useTool({
        name: "quiz",
        description: "Create a bounded retrieval check.",
        revision: "tool-v1",
        run: ({ data }) => data,
      });
      useSkill({
        name: "diagnosis",
        description: "Diagnose before explaining.",
        instructions: "Ask one discriminating question.",
        revision: "skill-v1",
        resources: [{ path: "rubric.md", content: "Do not infer mastery." }],
      });
      useSubagent({
        name: "reviewer",
        description: "Reviews candidate pedagogy.",
        agent: childAgent,
        revision: "delegate-v1",
      });
      useMcpConnection({
        name: "learner-store",
        description: "Reads account-relative learner evidence.",
        transport: "streamable-http",
        endpoint: "https://api.notorganic.info/mcp",
        tools: ["evidence_read"],
        authRef: "notorganic:mcp/learner-read",
        revision: "mcp-v1",
      });
      usePersistentState("phase", "diagnose");
      useSandbox(sandboxFactory, { slot: "workspace" });
      writer = useDataWriter<{ status: string }>("openui");
      useAgentStart(() => undefined, { slot: "load-revision" });
      useAgentFinish(() => undefined, { slot: "record-turn" });
      useResponseStart(() => ({ started: true }), { slot: "response-metadata" });
      useResponseFinish(() => ({ finished: true }), { slot: "response-metadata" });
      return "Teach the learner.";
    }

    const result = instance.render(Agent);
    expect(result.model).toBe("notorganic/balanced");
    expect(result.instructions).toEqual(["Teach the learner.", "Use retrieval practice."]);
    expect(result.system).toBe("Teach the learner.\n\nUse retrieval practice.");
    expect(result.tools.map(({ name }) => name)).toEqual(["quiz"]);
    expect(result.skills.map(({ name }) => name)).toEqual(["diagnosis"]);
    expect(result.subagents.map(({ name }) => name)).toEqual(["reviewer"]);
    expect(result.mcpConnections.map(({ name }) => name)).toEqual(["learner-store"]);
    expect(result.sandbox).toBe(sandboxFactory);
    expect(result.state).toEqual({ phase: "diagnose" });
    expect(result.lifecycle.agentStart).toHaveLength(1);
    expect(result.lifecycle.agentFinish).toHaveLength(1);
    expect(result.lifecycle.responseStart).toHaveLength(1);
    expect(result.lifecycle.responseFinish).toHaveLength(1);
    expect(result.topology.map(({ kind, key }) => `${kind}:${key}`)).toEqual([
      "model:model",
      "instruction:pedagogy",
      "tool:quiz",
      "skill:diagnosis",
      "subagent:reviewer",
      "mcp:learner-store",
      "persistent-state:phase",
      "sandbox:workspace",
      "data-writer:openui",
      "agent-start:load-revision",
      "agent-finish:record-turn",
      "response-start:response-metadata",
      "response-finish:response-metadata",
    ]);
    expect(result.resourceChanges.map(({ kind, name, change }) => `${kind}:${name}:${change}`)).toEqual([
      "agent-finish:record-turn:added",
      "agent-start:load-revision:added",
      "instruction:pedagogy:added",
      "mcp:learner-store:added",
      "response-finish:response-metadata:added",
      "response-start:response-metadata:added",
      "sandbox:workspace:added",
      "skill:diagnosis:added",
      "subagent:reviewer:added",
      "tool:quiz:added",
    ]);

    const payload = { status: "ready" };
    writer!.write(payload);
    payload.status = "mutated";
    expect(events).toEqual([{ name: "openui", value: { status: "ready" } }]);
  });

  test("persists cloned JSON state and exposes updates on the next render", () => {
    const instance = new PortableAgentInstance({ id: "agent-state" });
    let setCount: StateSetter<number> | undefined;

    function Agent() {
      useModel("local/model");
      const [count, setter] = usePersistentState("count", 1);
      setCount = setter;
      return `Count ${count}`;
    }

    expect(instance.render(Agent).system).toBe("Count 1");
    setCount!((current) => current + 1);
    const second = instance.render(Agent);
    expect(second.system).toBe("Count 2");
    expect(second.state).toEqual({ count: 2 });
    expect(second.resourceChanges).toEqual([]);
  });

  test("keeps hook slots stable while resources toggle and revisions change", () => {
    const instance = new PortableAgentInstance({ id: "agent-dynamic" });
    let enabled = true;
    let revision = "v1";

    function Agent() {
      useModel("local/model");
      useInstruction("Dynamic instruction", { slot: "dynamic", enabled, revision });
      useTool({ name: "dynamic-tool", description: "Dynamic tool.", revision, run: () => null }, { enabled });
      useSkill({ name: "dynamic-skill", description: "Dynamic skill.", instructions: "Act.", revision }, { enabled });
      useSubagent({ name: "dynamic-child", description: "Dynamic child.", agent: childAgent, revision }, { enabled });
      useMcpConnection({
        name: "dynamic-mcp",
        transport: "sse",
        endpoint: "https://example.test/mcp",
        revision,
      }, { enabled });
      useSandbox(enabled ? { ...sandboxFactory, revision } : null, { slot: "workspace", enabled, revision });
      useAgentStart(() => undefined, { slot: "dynamic-start", enabled, revision });
      return "Base";
    }

    const first = instance.render(Agent);
    expect(first.resourceChanges.every(({ change }) => change === "added")).toBe(true);

    enabled = false;
    const second = instance.render(Agent);
    expect(second.system).toBe("Base");
    expect(second.tools).toEqual([]);
    expect(second.skills).toEqual([]);
    expect(second.subagents).toEqual([]);
    expect(second.mcpConnections).toEqual([]);
    expect(second.sandbox).toBeNull();
    expect(second.lifecycle.agentStart).toEqual([]);
    expect(second.resourceChanges).toHaveLength(7);
    expect(second.resourceChanges.every(({ change }) => change === "removed")).toBe(true);

    enabled = true;
    revision = "v2";
    const third = instance.render(Agent);
    expect(third.resourceChanges).toHaveLength(7);
    expect(third.resourceChanges.every(({ change, revision: next }) => change === "added" && next === "v2")).toBe(true);

    revision = "v3";
    const fourth = instance.render(Agent);
    expect(fourth.resourceChanges).toHaveLength(7);
    expect(fourth.resourceChanges.every(({ change, previousRevision, revision: next }) =>
      change === "changed" && previousRevision === "v2" && next === "v3")).toBe(true);
  });

  test("rejects conditional hook topology changes without committing staged state", () => {
    const instance = new PortableAgentInstance({ id: "agent-topology" });

    function Agent({ extra }: { extra: boolean }) {
      useModel("local/model");
      usePersistentState("stable", 1);
      if (extra) usePersistentState("should-not-commit", 2);
      return "Stable";
    }

    instance.render(Agent, { extra: false });
    expect(() => instance.render(Agent, { extra: true })).toThrow(StructuralInvariantError);
    expect(instance.state.has("should-not-commit")).toBe(false);
    expect(instance.state.snapshot()).toEqual({ stable: 1 });
  });

  test("rejects reordered hooks even when the active resources are identical", () => {
    const instance = new PortableAgentInstance({ id: "agent-order" });
    let reverse = false;
    const tool = { name: "a", description: "A.", run: () => null } as const;
    const skill = { name: "b", description: "B.", instructions: "B." } as const;

    function Agent() {
      useModel("local/model");
      if (reverse) {
        useSkill(skill);
        useTool(tool);
      } else {
        useTool(tool);
        useSkill(skill);
      }
      return "Order";
    }

    instance.render(Agent);
    reverse = true;
    expect(() => instance.render(Agent)).toThrow(StructuralInvariantError);
  });
});

describe("failure boundaries", () => {
  test("requires hooks to run inside one synchronous, non-reentrant render", () => {
    expect(() => useModel("outside/model")).toThrow(HookUsageError);

    const instance = new PortableAgentInstance({ id: "agent-sync" });
    const asyncAgent = (async () => {
      useModel("local/model");
      return "No";
    }) as unknown as AgentFunction<void>;
    expect(() => instance.render(asyncAgent)).toThrow("must render synchronously");

    function Inner() {
      useModel("local/model");
      return "Inner";
    }
    function Outer() {
      useModel("local/model");
      instance.render(Inner);
      return "Outer";
    }
    expect(() => instance.render(Outer)).toThrow("may not nest");
  });

  test("does not activate setters or writers from failed renders", () => {
    const instance = new PortableAgentInstance({ id: "agent-failed" });
    let setter: StateSetter<number> | undefined;
    let writer: DataWriter | undefined;

    function Agent() {
      useModel("local/model");
      [, setter] = usePersistentState("count", 0);
      writer = useDataWriter("events");
      throw new Error("render failed");
    }

    expect(() => instance.render(Agent)).toThrow("render failed");
    expect(instance.state.has("count")).toBe(false);
    expect(() => setter!(1)).toThrow("did not commit");
    expect(() => writer!.write(null)).toThrow("did not commit");
  });

  test("rejects duplicate, reserved, malformed, and credential-bearing resources", () => {
    const duplicate = new PortableAgentInstance({ id: "agent-duplicate" });
    function DuplicateAgent() {
      useModel("local/model");
      const tool = { name: "same", description: "Same.", run: () => null };
      useTool(tool);
      useTool(tool);
      return "No";
    }
    expect(() => duplicate.render(DuplicateAgent)).toThrow(ResourceConflictError);

    const reserved = new PortableAgentInstance({ id: "agent-reserved" });
    function ReservedAgent() {
      useModel("local/model");
      useTool({ name: "task", description: "Collision.", run: () => null });
      return "No";
    }
    expect(() => reserved.render(ReservedAgent)).toThrow("reserved");

    const credential = new PortableAgentInstance({ id: "agent-credential" });
    function CredentialAgent() {
      useModel("local/model");
      useMcpConnection({
        name: "unsafe",
        transport: "streamable-http",
        endpoint: "https://example.test/mcp",
        token: "secret",
      } as unknown as McpConnectionDefinition);
      return "No";
    }
    expect(() => credential.render(CredentialAgent)).toThrow("credentials are not portable declarations");
  });

  test("accepts only acyclic finite JSON state and data", () => {
    const store = new MemoryStateStore();
    expect(() => store.write("bad", Number.NaN)).toThrow(StateValidationError);
    expect(() => store.write("bad", { value: undefined } as unknown as JsonValue)).toThrow(StateValidationError);
    const cyclic: Record<string, JsonValue> = {};
    cyclic.self = cyclic;
    expect(() => store.write("bad", cyclic)).toThrow("cycle");

    const original = { nested: { value: 1 } };
    store.write("safe", original);
    original.nested.value = 2;
    expect(store.read("safe")).toEqual({ nested: { value: 1 } });
  });
});

describe("browser boundary", () => {
  test("ships no Flue, Pi, or Node runtime import in source", async () => {
    const packageRoot = `${import.meta.dir}/..`;
    const files: string[] = [];
    const glob = new Bun.Glob("src/*.ts");
    for await (const path of glob.scan({ cwd: packageRoot })) files.push(path);
    expect(files.length).toBeGreaterThan(0);
    const source = (await Promise.all(files.sort().map((path) => Bun.file(`${packageRoot}/${path}`).text()))).join("\n");
    expect(source).not.toMatch(/from\s+["']node:/);
    expect(source).not.toContain("@flue/runtime");
    expect(source).not.toContain("@earendil-works/pi-");

    const packageJson = await Bun.file(`${packageRoot}/package.json`).json() as Record<string, unknown>;
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.peerDependencies).toBeUndefined();
  });
});
