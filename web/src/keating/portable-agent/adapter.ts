import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  assertJsonValue,
  cloneJson,
  PORTABLE_TOOL_NAMES,
  type AgentRenderResult,
  type DataEvent,
  type JsonValue,
  type LifecycleCallback,
  type LifecycleKind,
  type McpConnectionDefinition,
  type PortableLifecycleContext,
  type PortableResponseFinishContext,
  type SkillDefinition,
  type ToolDefinition,
  type VersionedResource,
} from "@keating/agent-runtime";
import type {
  BrowserAgentResources,
  BrowserMcpConnectionMetadata,
  BrowserPortableAgentHosts,
  BrowserResourceReconciliation,
  LifecycleInvocation,
  ResolvedMcpTool,
} from "./types";

const PORTABLE_PARAMETERS = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: true,
});
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type ToolRevision = Required<VersionedResource>;

interface ResolvedConnection {
  declaration: McpConnectionDefinition;
  tools: readonly ResolvedMcpTool[];
}

export class BrowserPortableAgentAdapter {
  private currentFrame: AgentRenderResult | null = null;
  private readonly activatedSkills = new Map<string, string>();
  private toolRevisions = new Map<string, ToolRevision>();

  constructor(private readonly hosts: BrowserPortableAgentHosts) {}

  /** Pass this function to PortableAgentInstance.onData. */
  readonly handleData = (event: DataEvent): void => {
    assertJsonValue(event.value, `Portable data event ${event.name}`);
    this.hosts.onData?.(Object.freeze({ name: event.name, value: cloneJson(event.value) }));
  };

  async reconcile(frame: AgentRenderResult): Promise<BrowserAgentResources> {
    const clearedSkillNames = this.reconcileActivatedSkills(frame.skills);
    const resolvedConnections = await this.resolveMcpConnections(frame.mcpConnections);
    const tools: AgentTool[] = [];
    const revisions = new Map<string, ToolRevision>();
    const names = new Set<string>();
    const add = (tool: AgentTool, revision: string) => {
      if (names.has(tool.name)) throw new Error(`Portable browser tool name conflict: ${tool.name}.`);
      names.add(tool.name);
      tools.push(tool);
      revisions.set(tool.name, { revision });
    };

    for (const definition of frame.tools) {
      add(adaptPortableTool(definition), `portable:${definition.revision ?? "unversioned"}`);
    }

    if (frame.skills.length > 0) {
      const skillRevision = resourceSetRevision(frame.skills);
      add(this.createActivateSkillTool(frame.skills), `skills:${skillRevision}`);
      if (frame.skills.some((skill) => (skill.resources?.length ?? 0) > 0)) {
        add(this.createReadSkillResourceTool(frame.skills), `skill-resources:${skillRevision}`);
      }
    }

    if (frame.subagents.length > 0) {
      add(this.createDelegationTool(frame), `subagents:${resourceSetRevision(frame.subagents)}`);
    }

    for (const connection of resolvedConnections) {
      for (const tool of connection.tools) {
        const adapted = adaptMcpTool(connection.declaration, tool);
        add(adapted, `mcp:${connection.declaration.revision ?? "unversioned"}:${tool.revision ?? "unversioned"}`);
      }
    }

    const reconciliation = buildReconciliation(
      frame,
      this.toolRevisions,
      revisions,
      [...this.activatedSkills.keys()].sort(),
      clearedSkillNames,
      resolvedConnections,
    );
    this.currentFrame = frame;
    this.toolRevisions = revisions;
    return Object.freeze({
      model: frame.model,
      systemPrompt: composeSystemPrompt(frame, resolvedConnections),
      tools: Object.freeze(tools),
      reconciliation,
    });
  }

  async runLifecycle(
    kind: Exclude<LifecycleKind, "response-finish">,
    context: PortableLifecycleContext,
  ): Promise<readonly (JsonValue | undefined)[]>;
  async runLifecycle(
    kind: "response-finish",
    context: PortableResponseFinishContext,
  ): Promise<readonly (JsonValue | undefined)[]>;
  async runLifecycle(
    kind: LifecycleKind,
    context: PortableLifecycleContext | PortableResponseFinishContext,
  ): Promise<readonly (JsonValue | undefined)[]> {
    if (!this.currentFrame) throw new Error("Reconcile a portable frame before running lifecycle callbacks.");
    const callbacks = lifecycleCallbacks(this.currentFrame, kind);
    const results: Array<JsonValue | undefined> = [];
    for (let index = 0; index < callbacks.length; index += 1) {
      const callback = callbacks[index]!;
      const run = async (): Promise<JsonValue | void> => {
        const result = await callback(context as never);
        if (result !== undefined) assertJsonValue(result, `${kind} lifecycle result`);
        return result === undefined ? undefined : cloneJson(result);
      };
      const invocation: LifecycleInvocation = { kind, index, context, run };
      const result = this.hosts.invokeLifecycle
        ? await this.hosts.invokeLifecycle(invocation)
        : await run();
      if (result !== undefined) assertJsonValue(result, `${kind} lifecycle host result`);
      results.push(result === undefined ? undefined : cloneJson(result));
    }
    return Object.freeze(results);
  }

  private reconcileActivatedSkills(skills: readonly SkillDefinition[]): string[] {
    const active = new Map(skills.map((skill) => [skill.name, skill.revision ?? "unversioned"]));
    const cleared: string[] = [];
    for (const [name, activatedRevision] of this.activatedSkills) {
      if (active.get(name) !== activatedRevision) {
        this.activatedSkills.delete(name);
        cleared.push(name);
      }
    }
    return cleared.sort();
  }

  private createActivateSkillTool(skills: readonly SkillDefinition[]): AgentTool {
    const byName = new Map(skills.map((skill) => [skill.name, skill]));
    return createPiTool(
      PORTABLE_TOOL_NAMES.activateSkill,
      "Load one available skill's complete instructions before using it.",
      {
        type: "object",
        properties: { name: { type: "string", enum: [...byName.keys()] } },
        required: ["name"],
        additionalProperties: false,
      },
      async (params) => {
        const name = requiredString(params.name, "Skill name");
        const skill = byName.get(name);
        if (!skill) throw new Error(`Unknown portable skill ${name}.`);
        this.activatedSkills.set(name, skill.revision ?? "unversioned");
        const resources = skill.resources?.map(({ path }) => path).sort() ?? [];
        return {
          output: [
            `# Skill: ${skill.name}`,
            skill.instructions,
            ...(resources.length ? [`Resources:\n${resources.map((path) => `- ${path}`).join("\n")}`] : []),
          ].join("\n\n"),
          details: { source: "portable-skill", skill: skill.name },
        };
      },
    );
  }

  private createReadSkillResourceTool(skills: readonly SkillDefinition[]): AgentTool {
    const byName = new Map(skills.map((skill) => [skill.name, skill]));
    return createPiTool(
      PORTABLE_TOOL_NAMES.readSkillResource,
      "Read one resource from an already activated portable skill.",
      {
        type: "object",
        properties: { skill: { type: "string" }, path: { type: "string" } },
        required: ["skill", "path"],
        additionalProperties: false,
      },
      async (params) => {
        const skillName = requiredString(params.skill, "Skill name");
        const path = requiredString(params.path, "Skill resource path");
        const skill = byName.get(skillName);
        if (!skill || !this.activatedSkills.has(skillName)) {
          throw new Error(`Activate portable skill ${skillName} before reading its resources.`);
        }
        const resource = skill.resources?.find((entry) => entry.path === path);
        if (!resource) throw new Error(`Portable skill ${skillName} has no resource ${path}.`);
        return {
          output: typeof resource.content === "string" ? resource.content : encodeBytes(resource.content),
          details: { source: "portable-skill-resource", skill: skillName, path },
        };
      },
    );
  }

  private createDelegationTool(frame: AgentRenderResult): AgentTool {
    const byName = new Map(frame.subagents.map((subagent) => [subagent.name, subagent]));
    return createPiTool(
      PORTABLE_TOOL_NAMES.task,
      "Delegate a focused task to a portable subagent running in a fresh context.",
      {
        type: "object",
        properties: {
          subagent: { type: "string", enum: [...byName.keys()] },
          task: { type: "string" },
        },
        required: ["subagent", "task"],
        additionalProperties: false,
      },
      async (params, signal) => {
        const name = requiredString(params.subagent, "Subagent name");
        const task = requiredString(params.task, "Delegated task");
        const subagent = byName.get(name);
        if (!subagent) throw new Error(`Unknown portable subagent ${name}.`);
        const result = await this.hosts.delegate({
          isolation: "fresh-context",
          messages: Object.freeze([]),
          subagent: Object.freeze({
            name: subagent.name,
            description: subagent.description,
            agent: subagent.agent,
            ...(subagent.model ? { model: subagent.model } : {}),
            ...(subagent.thinkingLevel ? { thinkingLevel: subagent.thinkingLevel } : {}),
            ...(subagent.revision ? { revision: subagent.revision } : {}),
          }),
          task,
        }, signal);
        assertJsonValue(result, `Subagent ${name} result`);
        return {
          output: result,
          details: { source: "portable-subagent", subagent: name, isolation: "fresh-context" },
        };
      },
    );
  }

  private async resolveMcpConnections(
    declarations: readonly McpConnectionDefinition[],
  ): Promise<ResolvedConnection[]> {
    const resolved = await Promise.all(declarations.map(async (declaration): Promise<ResolvedConnection> => {
      const available = await this.hosts.resolveMcpConnection(Object.freeze({
        ...declaration,
        ...(declaration.tools ? { tools: Object.freeze([...declaration.tools]) } : {}),
      }));
      const seen = new Set<string>();
      const allowlist = declaration.tools ? new Set(declaration.tools) : null;
      const selected: ResolvedMcpTool[] = [];
      for (const tool of available) {
        validateName(tool.name, `MCP tool from ${declaration.name}`);
        if (seen.has(tool.name)) throw new Error(`MCP connection ${declaration.name} resolved duplicate tool ${tool.name}.`);
        seen.add(tool.name);
        if (allowlist && !allowlist.has(tool.name)) continue;
        selected.push(tool);
      }
      if (allowlist) {
        const missing = [...allowlist].filter((name) => !selected.some((tool) => tool.name === name));
        if (missing.length) throw new Error(`MCP connection ${declaration.name} did not resolve allowed tools: ${missing.join(", ")}.`);
      }
      return { declaration, tools: Object.freeze(selected) };
    }));
    return resolved;
  }
}

export function adaptPortableTool(definition: ToolDefinition): AgentTool {
  return createPiTool(
    definition.name,
    definition.description,
    definition.inputSchema ?? PORTABLE_PARAMETERS,
    async (params, signal) => {
      const input = definition.parseInput ? definition.parseInput(params) : params;
      const raw = await definition.run({ data: input as never, signal });
      const output = definition.parseOutput ? definition.parseOutput(raw) : raw;
      if (output !== undefined) assertJsonValue(output, `Portable tool ${definition.name} output`);
      return {
        output,
        details: { source: "portable-tool", tool: definition.name },
      };
    },
  );
}

function adaptMcpTool(connection: McpConnectionDefinition, tool: ResolvedMcpTool): AgentTool {
  return createPiTool(
    `mcp__${connection.name}__${tool.name}`,
    tool.description,
    tool.parameters ?? PORTABLE_PARAMETERS,
    async (params, signal) => {
      const output = await tool.execute(Object.freeze({ ...params }), signal);
      assertJsonValue(output, `MCP tool ${connection.name}/${tool.name} output`);
      return {
        output,
        details: { source: "portable-mcp", connection: connection.name, tool: tool.name },
      };
    },
  );
}

function createPiTool(
  name: string,
  description: string,
  parameters: Readonly<Record<string, unknown>>,
  execute: (
    params: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ) => Promise<{ output: JsonValue | void; details: Record<string, JsonValue> }>,
): AgentTool {
  validateName(name, "Pi tool");
  return {
    name,
    label: name,
    description,
    parameters,
    execute: async (_toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => {
      const { output, details } = await execute(Object.freeze({ ...params }), signal);
      return {
        content: [{ type: "text", text: outputText(output) }],
        details,
      };
    },
  } as unknown as AgentTool;
}

function composeSystemPrompt(frame: AgentRenderResult, connections: readonly ResolvedConnection[]): string {
  const sections = [frame.system];
  if (frame.skills.length) {
    sections.push([
      `Available portable skills (load one with ${PORTABLE_TOOL_NAMES.activateSkill} only when needed):`,
      ...frame.skills.map((skill) => `- ${skill.name}: ${skill.description}`),
    ].join("\n"));
  }
  if (frame.subagents.length) {
    sections.push([
      `Available fresh-context delegates (invoke through ${PORTABLE_TOOL_NAMES.task}):`,
      ...frame.subagents.map((subagent) => `- ${subagent.name}: ${subagent.description}`),
    ].join("\n"));
  }
  if (connections.length) {
    sections.push([
      "Connected MCP capabilities:",
      ...connections.map(({ declaration, tools }) =>
        `- ${declaration.name}${declaration.description ? `: ${declaration.description}` : ""} [${tools.map(({ name }) => name).join(", ")}]`),
    ].join("\n"));
  }
  return sections.filter(Boolean).join("\n\n");
}

function buildReconciliation(
  frame: AgentRenderResult,
  previous: ReadonlyMap<string, ToolRevision>,
  next: ReadonlyMap<string, ToolRevision>,
  activatedSkillNames: readonly string[],
  clearedSkillNames: readonly string[],
  connections: readonly ResolvedConnection[],
): BrowserResourceReconciliation {
  const addedToolNames: string[] = [];
  const removedToolNames: string[] = [];
  const changedToolNames: string[] = [];
  const names = [...new Set([...previous.keys(), ...next.keys()])].sort();
  for (const name of names) {
    const before = previous.get(name);
    const after = next.get(name);
    if (!before && after) addedToolNames.push(name);
    else if (before && !after) removedToolNames.push(name);
    else if (before?.revision !== after?.revision) changedToolNames.push(name);
  }
  const mcpConnections: BrowserMcpConnectionMetadata[] = connections.map(({ declaration, tools }) => Object.freeze({
    name: declaration.name,
    ...(declaration.description ? { description: declaration.description } : {}),
    tools: Object.freeze(tools.map(({ name }) => name)),
    ...(declaration.revision ? { revision: declaration.revision } : {}),
  }));
  return Object.freeze({
    frameChanges: Object.freeze(frame.resourceChanges.map((change) => Object.freeze({ ...change }))),
    activeToolNames: Object.freeze([...next.keys()]),
    addedToolNames: Object.freeze(addedToolNames),
    removedToolNames: Object.freeze(removedToolNames),
    changedToolNames: Object.freeze(changedToolNames),
    activatedSkillNames: Object.freeze([...activatedSkillNames]),
    clearedSkillNames: Object.freeze([...clearedSkillNames]),
    mcpConnections: Object.freeze(mcpConnections),
  });
}

function lifecycleCallbacks(
  frame: AgentRenderResult,
  kind: LifecycleKind,
): readonly LifecycleCallback<any>[] {
  if (kind === "agent-start") return frame.lifecycle.agentStart;
  if (kind === "agent-finish") return frame.lifecycle.agentFinish;
  if (kind === "response-start") return frame.lifecycle.responseStart;
  return frame.lifecycle.responseFinish;
}

function resourceSetRevision(resources: readonly { name: string; revision?: string }[]): string {
  return resources.map(({ name, revision }) => `${name}@${revision ?? "unversioned"}`).sort().join("|");
}

function outputText(value: JsonValue | void): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "null";
  return JSON.stringify(sortJson(value));
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, sortJson(entry)]));
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required.`);
  return value;
}

function validateName(value: string, label: string): string {
  if (!NAME_PATTERN.test(value)) throw new Error(`${label} name is invalid: ${value}.`);
  return value;
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `base64:${btoa(binary)}`;
}
