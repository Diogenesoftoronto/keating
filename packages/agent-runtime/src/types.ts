export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type MaybePromise<T> = T | Promise<T>;

export interface AgentFunction<Props = void> {
  (props: Props): string | undefined | void;
  agentName?: string;
}

export interface ResourceOptions {
  enabled?: boolean;
}

export interface InstructionOptions extends ResourceOptions {
  /** Stable slot identity. Omit only when call order itself is the identity. */
  slot?: string;
  revision?: string;
}

export interface VersionedResource {
  /** Content/runtime revision used to report an active-resource change. */
  revision?: string;
}

export interface ToolRunContext<Input> {
  data: Input;
  signal?: AbortSignal;
}

export interface ToolDefinition<Input = JsonValue, Output extends JsonValue | void = JsonValue | void>
  extends VersionedResource {
  name: string;
  description: string;
  /** Canonical JSON Schema advertised to model runtimes and validated by host adapters. */
  inputSchema?: Readonly<Record<string, JsonValue>>;
  /** Optional JSON Schema metadata for structured tool results. */
  outputSchema?: Readonly<Record<string, JsonValue>>;
  parseInput?: (value: unknown) => Input;
  parseOutput?: (value: unknown) => Output;
  run(context: ToolRunContext<Input>): MaybePromise<Output>;
}

export interface SkillResource {
  path: string;
  content: string | Uint8Array;
}

export interface SkillDefinition extends VersionedResource {
  name: string;
  description: string;
  instructions: string;
  resources?: readonly SkillResource[];
}

export interface SubagentDefinition extends VersionedResource {
  name: string;
  description: string;
  agent: AgentFunction;
  model?: string;
  thinkingLevel?: string;
}

export type McpTransport = "streamable-http" | "sse" | "stdio";

/** Declarative only. Authentication material is resolved by a host adapter from authRef. */
export interface McpConnectionDefinition extends VersionedResource {
  name: string;
  description?: string;
  transport: McpTransport;
  endpoint: string;
  tools?: readonly string[];
  authRef?: string;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink?: boolean;
  size?: number;
  mtime?: Date;
}

export interface PortableSandbox {
  exec(
    command: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<ShellResult>;
  readFile(path: string): Promise<string>;
  readFileBuffer(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  stat(path: string): Promise<FileStat>;
  readdir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  cwd: string;
  resolvePath(path: string): string;
}

export interface PortableSandboxFactory extends VersionedResource {
  createSandbox(options: { id: string }): Promise<PortableSandbox>;
}

export interface SandboxOptions extends ResourceOptions {
  slot?: string;
  revision?: string;
}

export interface PersistentStateStore {
  has(name: string): boolean;
  read(name: string): JsonValue | undefined;
  write(name: string, value: JsonValue): void;
  snapshot(): Readonly<Record<string, JsonValue>>;
}

export type StateUpdater<T extends JsonValue> = T | ((current: T) => T);
export type StateSetter<T extends JsonValue> = (next: StateUpdater<T>) => void;

export interface DataEvent<T extends JsonValue = JsonValue> {
  name: string;
  value: T;
}

export interface DataWriter<T extends JsonValue = JsonValue> {
  readonly name: string;
  write(value: T): void;
}

export interface DataWriterOptions {
  slot?: string;
}

export interface PortableLifecycleContext {
  instanceId: string;
  state: PersistentStateStore;
  metadata: Readonly<Record<string, JsonValue>>;
}

export interface PortableResponseFinishContext extends PortableLifecycleContext {
  response: JsonValue;
}

export type LifecycleCallback<Context = PortableLifecycleContext> =
  (context: Context) => MaybePromise<JsonValue | void>;

export type LifecycleKind = "agent-start" | "agent-finish" | "response-start" | "response-finish";

export interface LifecycleOptions extends ResourceOptions {
  slot?: string;
  revision?: string;
}

export interface LifecycleRegistrations {
  agentStart: readonly LifecycleCallback[];
  agentFinish: readonly LifecycleCallback[];
  responseStart: readonly LifecycleCallback[];
  responseFinish: readonly LifecycleCallback<PortableResponseFinishContext>[];
}

export type HookKind =
  | "model"
  | "instruction"
  | "tool"
  | "skill"
  | "subagent"
  | "mcp"
  | "persistent-state"
  | "sandbox"
  | "data-writer"
  | LifecycleKind;

export interface HookTopologyEntry {
  kind: HookKind;
  key: string;
}

export type DynamicResourceKind = "instruction" | "tool" | "skill" | "subagent" | "mcp" | "sandbox" | LifecycleKind;

export interface ResourceChange {
  kind: DynamicResourceKind;
  name: string;
  change: "added" | "removed" | "changed";
  previousRevision?: string;
  revision?: string;
}

export interface AgentRenderResult {
  model: string;
  instructions: readonly string[];
  system: string;
  tools: readonly ToolDefinition[];
  skills: readonly SkillDefinition[];
  subagents: readonly SubagentDefinition[];
  mcpConnections: readonly McpConnectionDefinition[];
  sandbox: PortableSandboxFactory | null;
  dataWriters: Readonly<Record<string, DataWriter>>;
  lifecycle: LifecycleRegistrations;
  topology: readonly HookTopologyEntry[];
  resourceChanges: readonly ResourceChange[];
  state: Readonly<Record<string, JsonValue>>;
}

export interface AgentInstanceOptions {
  id: string;
  state?: PersistentStateStore;
  onData?: (event: DataEvent) => void;
}
