import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  AgentFunction,
  AgentRenderResult,
  DataEvent,
  JsonValue,
  LifecycleKind,
  LifecycleRegistrations,
  McpConnectionDefinition,
  PortableLifecycleContext,
  PortableResponseFinishContext,
  ResourceChange,
} from "@keating/agent-runtime";

export interface DelegationRequest {
  isolation: "fresh-context";
  messages: readonly [];
  subagent: {
    name: string;
    description: string;
    agent: AgentFunction;
    model?: string;
    thinkingLevel?: string;
    revision?: string;
  };
  task: string;
}

export interface ResolvedMcpTool {
  name: string;
  description: string;
  parameters?: Readonly<Record<string, unknown>>;
  revision?: string;
  execute(input: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<JsonValue>;
}

export interface LifecycleInvocation<Context = PortableLifecycleContext> {
  kind: LifecycleKind;
  index: number;
  context: Context;
  run(): Promise<JsonValue | void>;
}

export interface BrowserPortableAgentHosts {
  delegate(request: DelegationRequest, signal?: AbortSignal): Promise<JsonValue>;
  resolveMcpConnection(connection: Readonly<McpConnectionDefinition>): Promise<readonly ResolvedMcpTool[]>;
  invokeLifecycle?<Context>(invocation: LifecycleInvocation<Context>): Promise<JsonValue | void>;
  onData?(event: Readonly<DataEvent>): void;
}

export interface BrowserMcpConnectionMetadata {
  name: string;
  description?: string;
  tools: readonly string[];
  revision?: string;
}

export interface BrowserResourceReconciliation {
  frameChanges: readonly ResourceChange[];
  activeToolNames: readonly string[];
  addedToolNames: readonly string[];
  removedToolNames: readonly string[];
  changedToolNames: readonly string[];
  activatedSkillNames: readonly string[];
  clearedSkillNames: readonly string[];
  mcpConnections: readonly BrowserMcpConnectionMetadata[];
}

export interface BrowserAgentResources {
  model: string;
  systemPrompt: string;
  tools: readonly AgentTool[];
  reconciliation: BrowserResourceReconciliation;
}

export type BrowserLifecycleContext = PortableLifecycleContext | PortableResponseFinishContext;

export type PortableLifecycleFrame = LifecycleRegistrations;

export interface BrowserFrameSnapshot {
  render: AgentRenderResult;
  lifecycle: PortableLifecycleFrame;
}
