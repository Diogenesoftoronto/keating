import {
  HookUsageError,
  ResourceConflictError,
  StructuralInvariantError,
} from "./errors";
import { PORTABLE_TOOL_NAMES } from "./tool-names";
import { assertJsonValue, cloneJson } from "./json";
import type {
  AgentFunction,
  AgentInstanceOptions,
  AgentRenderResult,
  DataEvent,
  DataWriter,
  DataWriterOptions,
  DynamicResourceKind,
  HookKind,
  HookTopologyEntry,
  InstructionOptions,
  JsonValue,
  LifecycleCallback,
  LifecycleKind,
  LifecycleOptions,
  LifecycleRegistrations,
  McpConnectionDefinition,
  PersistentStateStore,
  PortableResponseFinishContext,
  PortableSandboxFactory,
  ResourceChange,
  ResourceOptions,
  SandboxOptions,
  SkillDefinition,
  StateSetter,
  SubagentDefinition,
  ToolDefinition,
} from "./types";

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESERVED_TOOL_NAMES = new Set([
  ...Object.values(PORTABLE_TOOL_NAMES),
  "activate_skill",
  "finish",
  "give_up",
  "read_skill_resource",
  "task",
]);

interface ActiveResource {
  kind: DynamicResourceKind;
  name: string;
  revision?: string;
}

interface CommitGuard {
  committed: boolean;
}

interface LifecycleEntry<Context = unknown> {
  callback: LifecycleCallback<Context>;
  enabled: boolean;
  slot: string;
  revision?: string;
}

let activeFrame: RenderFrame | null = null;

export class MemoryStateStore implements PersistentStateStore {
  private readonly values = new Map<string, JsonValue>();

  constructor(initial: Readonly<Record<string, JsonValue>> = {}) {
    for (const [name, value] of Object.entries(initial)) this.write(name, value);
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  read(name: string): JsonValue | undefined {
    const value = this.values.get(name);
    return value === undefined ? undefined : cloneJson(value);
  }

  write(name: string, value: JsonValue): void {
    assertResourceName(name, "Persistent state");
    this.values.set(name, cloneJson(value));
  }

  snapshot(): Readonly<Record<string, JsonValue>> {
    return Object.freeze(Object.fromEntries(
      [...this.values.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => [name, cloneJson(value)]),
    ));
  }
}

export class PortableAgentInstance {
  readonly id: string;
  readonly state: PersistentStateStore;
  private readonly onData?: (event: DataEvent) => void;
  private topology: readonly HookTopologyEntry[] | null = null;
  private activeResources = new Map<string, ActiveResource>();

  constructor(options: AgentInstanceOptions) {
    assertResourceName(options.id, "Agent instance id");
    this.id = options.id;
    this.state = options.state ?? new MemoryStateStore();
    this.onData = options.onData;
  }

  render(agent: AgentFunction<void>): AgentRenderResult;
  render<Props>(agent: AgentFunction<Props>, props: Props): AgentRenderResult;
  render<Props>(agent: AgentFunction<Props>, props?: Props): AgentRenderResult {
    if (activeFrame) throw new HookUsageError("Agent renders may not nest or overlap.");
    const frame = new RenderFrame(this, this.onData);
    activeFrame = frame;
    try {
      const returned = agent(props as Props);
      if (isPromiseLike(returned)) {
        void Promise.resolve(returned).catch(() => undefined);
        throw new HookUsageError("Agent functions must render synchronously; move async work into tools or lifecycle callbacks.");
      }
      const prepared = frame.prepare(returned);
      assertTopology(this.topology, prepared.topology);
      prepared.commit();
      this.topology ??= prepared.topology;
      const resourceChanges = diffResources(this.activeResources, prepared.activeResources);
      this.activeResources = prepared.activeResources;
      return Object.freeze({ ...prepared.result, resourceChanges: Object.freeze(resourceChanges) });
    } finally {
      activeFrame = null;
    }
  }

  topologySnapshot(): readonly HookTopologyEntry[] | null {
    return this.topology?.map((entry) => ({ ...entry })) ?? null;
  }
}

class RenderFrame {
  private readonly topology: HookTopologyEntry[] = [];
  private readonly seen = new Map<HookKind, Set<string>>();
  private readonly occurrence = new Map<HookKind, number>();
  private readonly stagedState = new Map<string, JsonValue>();
  private readonly guards: CommitGuard[] = [];
  private readonly instructions: Array<{ text: string; enabled: boolean; slot: string; revision?: string }> = [];
  private readonly tools: ToolDefinition[] = [];
  private readonly skills: SkillDefinition[] = [];
  private readonly subagents: SubagentDefinition[] = [];
  private readonly mcpConnections: McpConnectionDefinition[] = [];
  private readonly writers = new Map<string, DataWriter>();
  private readonly lifecycle: {
    agentStart: Array<LifecycleEntry>;
    agentFinish: Array<LifecycleEntry>;
    responseStart: Array<LifecycleEntry>;
    responseFinish: Array<LifecycleEntry<PortableResponseFinishContext>>;
  } = { agentStart: [], agentFinish: [], responseStart: [], responseFinish: [] };
  private model: string | null = null;
  private sandbox: PortableSandboxFactory | null = null;
  private sandboxEnabled = false;
  private sandboxSlot = "default";
  private sandboxRevision: string | undefined;

  constructor(
    readonly instance: PortableAgentInstance,
    private readonly onData?: (event: DataEvent) => void,
  ) {}

  addModel(model: string): void {
    this.addSlot("model", "model", false);
    if (this.model !== null) throw new ResourceConflictError("An agent may declare exactly one model.");
    this.model = nonEmpty(model, "Model");
  }

  addInstruction(text: string, options: InstructionOptions = {}): void {
    const slot = options.slot === undefined ? this.nextOccurrence("instruction") : assertResourceName(options.slot, "Instruction slot");
    this.addSlot("instruction", slot, true);
    this.instructions.push({
      text: nonEmpty(text, "Instruction"),
      enabled: options.enabled !== false,
      slot,
      ...(options.revision === undefined ? {} : { revision: assertRevision(options.revision) }),
    });
  }

  addTool(definition: ToolDefinition, options: ResourceOptions = {}): void {
    const name = assertResourceName(definition.name, "Tool");
    if (RESERVED_TOOL_NAMES.has(name)) throw new ResourceConflictError(`Tool name ${name} is reserved by the agent harness.`);
    this.addSlot("tool", name, true);
    nonEmpty(definition.description, `Tool ${name} description`);
    if (typeof definition.run !== "function") throw new HookUsageError(`Tool ${name} must provide run().`);
    if (definition.inputSchema !== undefined) assertJsonValue(definition.inputSchema, `Tool ${name} input schema`);
    if (definition.outputSchema !== undefined) assertJsonValue(definition.outputSchema, `Tool ${name} output schema`);
    if (options.enabled !== false) {
      this.tools.push(Object.freeze({
        ...definition,
        ...(definition.inputSchema === undefined ? {} : { inputSchema: cloneJson(definition.inputSchema) }),
        ...(definition.outputSchema === undefined ? {} : { outputSchema: cloneJson(definition.outputSchema) }),
      }));
    }
  }

  addSkill(definition: SkillDefinition, options: ResourceOptions = {}): void {
    const name = assertResourceName(definition.name, "Skill");
    this.addSlot("skill", name, true);
    nonEmpty(definition.description, `Skill ${name} description`);
    nonEmpty(definition.instructions, `Skill ${name} instructions`);
    validateSkillResources(name, definition.resources);
    if (options.enabled !== false) {
      this.skills.push(Object.freeze({
        ...definition,
        ...(definition.resources ? {
          resources: Object.freeze(definition.resources.map((resource) => Object.freeze({
            path: resource.path,
            content: typeof resource.content === "string" ? resource.content : new Uint8Array(resource.content),
          }))),
        } : {}),
      }));
    }
  }

  addSubagent(definition: SubagentDefinition, options: ResourceOptions = {}): void {
    const name = assertResourceName(definition.name, "Subagent");
    this.addSlot("subagent", name, true);
    nonEmpty(definition.description, `Subagent ${name} description`);
    if (typeof definition.agent !== "function") throw new HookUsageError(`Subagent ${name} must provide an agent function.`);
    if (options.enabled !== false) this.subagents.push(Object.freeze({ ...definition }));
  }

  addMcp(definition: McpConnectionDefinition, options: ResourceOptions = {}): void {
    validateMcpDefinition(definition);
    this.addSlot("mcp", definition.name, true);
    if (options.enabled !== false) {
      this.mcpConnections.push(Object.freeze({
        ...definition,
        ...(definition.tools ? { tools: Object.freeze([...definition.tools]) } : {}),
      }));
    }
  }

  addState<T extends JsonValue>(name: string, initial: T): readonly [T, StateSetter<T>] {
    assertResourceName(name, "Persistent state");
    this.addSlot("persistent-state", name, true);
    assertJsonValue(initial, `Initial state ${name}`);
    const existing = this.instance.state.read(name);
    const current = existing === undefined ? cloneJson(initial) : existing;
    if (existing === undefined) this.stagedState.set(name, cloneJson(initial));
    const guard: CommitGuard = { committed: false };
    this.guards.push(guard);
    const setter: StateSetter<T> = (next) => {
      if (!guard.committed) throw new HookUsageError(`State setter ${name} belongs to a render that did not commit.`);
      if (activeFrame) throw new HookUsageError(`Persistent state ${name} may not be changed during agent render.`);
      const stored = this.instance.state.read(name);
      if (stored === undefined) throw new HookUsageError(`Persistent state ${name} is unavailable.`);
      const candidate = typeof next === "function"
        ? (next as (value: T) => T)(cloneJson(stored as T))
        : next;
      assertJsonValue(candidate, `Persistent state ${name}`);
      this.instance.state.write(name, candidate);
    };
    return Object.freeze([cloneJson(current as T), setter] as const);
  }

  addSandbox(factory: PortableSandboxFactory | null, options: SandboxOptions = {}): void {
    const slot = assertResourceName(options.slot ?? "default", "Sandbox slot");
    this.addSlot("sandbox", slot, true);
    if (factory !== null && typeof factory.createSandbox !== "function") {
      throw new HookUsageError("Sandbox factories must provide createSandbox().");
    }
    this.sandbox = factory;
    this.sandboxEnabled = factory !== null && options.enabled !== false;
    this.sandboxSlot = slot;
    this.sandboxRevision = options.revision ?? factory?.revision;
    if (this.sandboxRevision !== undefined) assertRevision(this.sandboxRevision);
  }

  addDataWriter<T extends JsonValue>(name: string, options: DataWriterOptions = {}): DataWriter<T> {
    const writerName = assertResourceName(name, "Data writer");
    const slot = assertResourceName(options.slot ?? writerName, "Data writer slot");
    this.addSlot("data-writer", slot, true);
    if (this.writers.has(writerName)) throw new ResourceConflictError(`Duplicate data writer ${writerName}.`);
    const guard: CommitGuard = { committed: false };
    this.guards.push(guard);
    const writer: DataWriter<T> = Object.freeze({
      name: writerName,
      write: (value: T) => {
        if (!guard.committed) throw new HookUsageError(`Data writer ${writerName} belongs to a render that did not commit.`);
        if (activeFrame) throw new HookUsageError(`Data writer ${writerName} may not emit during agent render.`);
        assertJsonValue(value, `Data writer ${writerName}`);
        this.onData?.(Object.freeze({ name: writerName, value: cloneJson(value) }));
      },
    });
    this.writers.set(writerName, writer as DataWriter);
    return writer;
  }

  addLifecycle<Context>(
    kind: LifecycleKind,
    callback: LifecycleCallback<Context>,
    options: LifecycleOptions,
    target: Array<LifecycleEntry<Context>>,
  ): void {
    if (typeof callback !== "function") throw new HookUsageError(`${kind} lifecycle hook must be a function.`);
    const slot = options.slot === undefined ? this.nextOccurrence(kind) : assertResourceName(options.slot, `${kind} slot`);
    this.addSlot(kind, slot, true);
    target.push({
      callback,
      enabled: options.enabled !== false,
      slot,
      ...(options.revision === undefined ? {} : { revision: assertRevision(options.revision) }),
    });
  }

  prepare(returned: string | undefined | void): {
    topology: readonly HookTopologyEntry[];
    activeResources: Map<string, ActiveResource>;
    result: Omit<AgentRenderResult, "resourceChanges">;
    commit(): void;
  } {
    if (this.model === null) throw new HookUsageError("An agent must call useModel() exactly once.");
    if (returned !== undefined && typeof returned !== "string") {
      throw new HookUsageError("An agent function must return a string or undefined.");
    }
    const activeInstructions = this.instructions.filter((entry) => entry.enabled);
    const instructions = [
      ...(typeof returned === "string" && returned.length > 0 ? [returned] : []),
      ...activeInstructions.map((entry) => entry.text),
    ];
    const activeResources = this.collectActiveResources(activeInstructions);
    const lifecycle: LifecycleRegistrations = Object.freeze({
      agentStart: Object.freeze(this.lifecycle.agentStart.filter(active).map((entry) => entry.callback)),
      agentFinish: Object.freeze(this.lifecycle.agentFinish.filter(active).map((entry) => entry.callback)),
      responseStart: Object.freeze(this.lifecycle.responseStart.filter(active).map((entry) => entry.callback)),
      responseFinish: Object.freeze(this.lifecycle.responseFinish.filter(active).map((entry) => entry.callback)),
    });
    const topology = Object.freeze(this.topology.map((entry) => Object.freeze({ ...entry })));
    let committed = false;
    const commit = () => {
      if (committed) return;
      for (const [name, value] of this.stagedState) this.instance.state.write(name, value);
      for (const guard of this.guards) guard.committed = true;
      committed = true;
    };
    return {
      topology,
      activeResources,
      commit,
      result: {
        model: this.model,
        instructions: Object.freeze(instructions),
        system: instructions.join("\n\n"),
        tools: Object.freeze([...this.tools]),
        skills: Object.freeze([...this.skills]),
        subagents: Object.freeze([...this.subagents]),
        mcpConnections: Object.freeze([...this.mcpConnections]),
        sandbox: this.sandboxEnabled ? this.sandbox : null,
        dataWriters: Object.freeze(Object.fromEntries(this.writers)),
        lifecycle,
        topology,
        state: Object.freeze({
          ...this.instance.state.snapshot(),
          ...Object.fromEntries([...this.stagedState].map(([name, value]) => [name, cloneJson(value)])),
        }),
      },
    };
  }

  private collectActiveResources(
    activeInstructions: Array<{ slot: string; revision?: string }>,
  ): Map<string, ActiveResource> {
    const resources = new Map<string, ActiveResource>();
    const add = (kind: DynamicResourceKind, name: string, revision?: string) => {
      resources.set(`${kind}:${name}`, { kind, name, ...(revision === undefined ? {} : { revision }) });
    };
    activeInstructions.forEach((entry) => add("instruction", entry.slot, entry.revision));
    this.tools.forEach((entry) => add("tool", entry.name, entry.revision));
    this.skills.forEach((entry) => add("skill", entry.name, entry.revision));
    this.subagents.forEach((entry) => add("subagent", entry.name, entry.revision));
    this.mcpConnections.forEach((entry) => add("mcp", entry.name, entry.revision));
    if (this.sandboxEnabled) add("sandbox", this.sandboxSlot, this.sandboxRevision);
    this.lifecycle.agentStart.filter(active).forEach((entry) => add("agent-start", entry.slot, entry.revision));
    this.lifecycle.agentFinish.filter(active).forEach((entry) => add("agent-finish", entry.slot, entry.revision));
    this.lifecycle.responseStart.filter(active).forEach((entry) => add("response-start", entry.slot, entry.revision));
    this.lifecycle.responseFinish.filter(active).forEach((entry) => add("response-finish", entry.slot, entry.revision));
    return resources;
  }

  private addSlot(kind: HookKind, key: string, unique: boolean): void {
    if (unique) {
      const names = this.seen.get(kind) ?? new Set<string>();
      if (names.has(key)) throw new ResourceConflictError(`Duplicate ${kind} hook slot ${key}.`);
      names.add(key);
      this.seen.set(kind, names);
    }
    this.topology.push({ kind, key });
  }

  private nextOccurrence(kind: HookKind): string {
    const value = this.occurrence.get(kind) ?? 0;
    this.occurrence.set(kind, value + 1);
    return String(value);
  }
}

function frame(): RenderFrame {
  if (!activeFrame) throw new HookUsageError("Agent hooks may only be called during a synchronous agent render.");
  return activeFrame;
}

export function useModel(model: string): void {
  frame().addModel(model);
}

export function useInstruction(instruction: string, options: InstructionOptions = {}): void {
  frame().addInstruction(instruction, options);
}

export function useTool(definition: ToolDefinition, options: ResourceOptions = {}): void {
  frame().addTool(definition, options);
}

export function useSkill(definition: SkillDefinition, options: ResourceOptions = {}): void {
  frame().addSkill(definition, options);
}

export function useSubagent(definition: SubagentDefinition, options: ResourceOptions = {}): void {
  frame().addSubagent(definition, options);
}

export function useMcpConnection(definition: McpConnectionDefinition, options: ResourceOptions = {}): void {
  frame().addMcp(definition, options);
}

export function usePersistentState<T extends JsonValue>(name: string, initial: T): readonly [T, StateSetter<T>] {
  return frame().addState(name, initial);
}

export function useSandbox(factory: PortableSandboxFactory | null, options: SandboxOptions = {}): void {
  frame().addSandbox(factory, options);
}

export function useDataWriter<T extends JsonValue>(name: string, options: DataWriterOptions = {}): DataWriter<T> {
  return frame().addDataWriter(name, options);
}

export function useAgentStart(callback: LifecycleCallback, options: LifecycleOptions = {}): void {
  const current = frame();
  current.addLifecycle("agent-start", callback, options, current["lifecycle"].agentStart);
}

export function useAgentFinish(callback: LifecycleCallback, options: LifecycleOptions = {}): void {
  const current = frame();
  current.addLifecycle("agent-finish", callback, options, current["lifecycle"].agentFinish);
}

export function useResponseStart(callback: LifecycleCallback, options: LifecycleOptions = {}): void {
  const current = frame();
  current.addLifecycle("response-start", callback, options, current["lifecycle"].responseStart);
}

export function useResponseFinish(
  callback: LifecycleCallback<PortableResponseFinishContext>,
  options: LifecycleOptions = {},
): void {
  const current = frame();
  current.addLifecycle("response-finish", callback, options, current["lifecycle"].responseFinish);
}

function active<Context>(entry: LifecycleEntry<Context>): boolean {
  return entry.enabled;
}

function assertTopology(expected: readonly HookTopologyEntry[] | null, actual: readonly HookTopologyEntry[]): void {
  if (expected === null) return;
  const maximum = Math.max(expected.length, actual.length);
  for (let index = 0; index < maximum; index += 1) {
    const left = expected[index];
    const right = actual[index];
    if (left?.kind !== right?.kind || left?.key !== right?.key) {
      throw new StructuralInvariantError(
        `Hook topology changed at slot ${index}: expected ${formatSlot(left)}, received ${formatSlot(right)}. `
        + "Keep the hook call and toggle its enabled option instead.",
      );
    }
  }
}

function diffResources(
  previous: ReadonlyMap<string, ActiveResource>,
  next: ReadonlyMap<string, ActiveResource>,
): ResourceChange[] {
  const changes: ResourceChange[] = [];
  const keys = [...new Set([...previous.keys(), ...next.keys()])].sort();
  for (const key of keys) {
    const before = previous.get(key);
    const after = next.get(key);
    if (!before && after) changes.push({ kind: after.kind, name: after.name, change: "added", ...(after.revision ? { revision: after.revision } : {}) });
    else if (before && !after) changes.push({ kind: before.kind, name: before.name, change: "removed", ...(before.revision ? { previousRevision: before.revision } : {}) });
    else if (before && after && before.revision !== after.revision) {
      changes.push({
        kind: after.kind,
        name: after.name,
        change: "changed",
        ...(before.revision ? { previousRevision: before.revision } : {}),
        ...(after.revision ? { revision: after.revision } : {}),
      });
    }
  }
  return changes;
}

function assertResourceName(value: string, label: string): string {
  if (typeof value !== "string" || !NAME_PATTERN.test(value)) {
    throw new HookUsageError(`${label} name must match ${NAME_PATTERN}.`);
  }
  return value;
}

function assertRevision(value: string): string {
  return nonEmpty(value, "Resource revision");
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new HookUsageError(`${label} must be a non-empty string.`);
  return value;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value && (typeof value === "object" || typeof value === "function")
    && typeof (value as { then?: unknown }).then === "function";
}

function formatSlot(entry: HookTopologyEntry | undefined): string {
  return entry ? `${entry.kind}:${entry.key}` : "<end>";
}

function validateSkillResources(name: string, resources: readonly { path: string; content: string | Uint8Array }[] | undefined): void {
  if (!resources) return;
  const paths = new Set<string>();
  for (const resource of resources) {
    if (!resource.path || resource.path.startsWith("/") || resource.path.split("/").some((part) => part === "" || part === "." || part === "..")) {
      throw new HookUsageError(`Skill ${name} has unsafe resource path ${resource.path}.`);
    }
    if (paths.has(resource.path)) throw new ResourceConflictError(`Skill ${name} has duplicate resource path ${resource.path}.`);
    if (typeof resource.content !== "string" && !(resource.content instanceof Uint8Array)) {
      throw new HookUsageError(`Skill ${name} resource ${resource.path} must contain text or bytes.`);
    }
    paths.add(resource.path);
  }
}

function validateMcpDefinition(definition: McpConnectionDefinition): void {
  const allowedKeys = new Set(["name", "description", "transport", "endpoint", "tools", "authRef", "revision"]);
  for (const key of Object.keys(definition)) {
    if (!allowedKeys.has(key)) throw new HookUsageError(`MCP connection ${definition.name || "<unknown>"} contains unsupported field ${key}; credentials are not portable declarations.`);
  }
  assertResourceName(definition.name, "MCP connection");
  if (!["streamable-http", "sse", "stdio"].includes(definition.transport)) throw new HookUsageError(`MCP connection ${definition.name} has an unsupported transport.`);
  nonEmpty(definition.endpoint, `MCP connection ${definition.name} endpoint`);
  if (definition.authRef !== undefined) assertReference(definition.authRef, `MCP connection ${definition.name} authRef`);
  if (definition.tools) {
    const tools = definition.tools.map((tool) => assertResourceName(tool, `MCP connection ${definition.name} tool`));
    if (new Set(tools).size !== tools.length) throw new ResourceConflictError(`MCP connection ${definition.name} has duplicate tool allowlist entries.`);
  }
  if (definition.revision !== undefined) assertRevision(definition.revision);
}

function assertReference(value: string, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)
    || value.includes("..") || value.includes("//")) {
    throw new HookUsageError(`${label} must be a safe opaque reference.`);
  }
  return value;
}
