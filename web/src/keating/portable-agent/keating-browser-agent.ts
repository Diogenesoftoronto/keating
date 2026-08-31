import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  PortableAgentInstance,
  useInstruction,
  useModel,
  useSkill,
  useSubagent,
  useTool,
  type AgentRenderResult,
  type JsonValue,
  type ToolDefinition,
} from "@keating/agent-runtime";
import { BrowserPortableAgentAdapter } from "./adapter";
import type {
  BrowserAgentResources,
  BrowserPortableAgentHosts,
} from "./types";

const IMPROVEMENT_SKILL = Object.freeze({
  name: "teaching-improvement",
  description:
    "Evaluate learner evidence before changing prompts, policies, MAP-Elites variables, or self-evolution code.",
  revision: "1",
  instructions: [
    "Treat prompts, policy weights, MAP-Elites descriptors, and evolution code as versioned learning artifacts.",
    "Use learner outcomes and trace evidence, not stylistic preference, to propose a change.",
    "Record the baseline, candidate, evaluation set, objective scores, and activation decision.",
    "Do not silently activate a candidate that regresses a protected objective.",
  ].join("\n"),
});
const LESSON_CRITIC_DESCRIPTION =
  "Review a teaching trace in an isolated context and propose one measurable improvement.";

export function appendKeatingPortableCatalog(systemPrompt: string): string {
  return [
    systemPrompt,
    `Available portable skills (load one with activate_skill only when needed):\n- ${IMPROVEMENT_SKILL.name}: ${IMPROVEMENT_SKILL.description}`,
    `Available fresh-context delegates (invoke through task):\n- lesson-critic: ${LESSON_CRITIC_DESCRIPTION}`,
  ].join("\n\n");
}

export interface KeatingBrowserAgentAuthoringInput {
  instanceId: string;
  modelKey: string;
  systemPrompt: string;
  tools: readonly AgentTool[];
  hosts: BrowserPortableAgentHosts;
}

export interface AuthoredKeatingBrowserAgent extends BrowserAgentResources {
  frame: AgentRenderResult;
  adapter: BrowserPortableAgentAdapter;
}

/**
 * Render the browser teacher through Keating's environment-neutral hook facade.
 *
 * The existing Pi tool objects are deliberately restored after reconciliation:
 * the portable frame owns which capabilities are authored, while the browser
 * host retains Pi's streaming updates, OpenUI details, and authorization wrapper.
 */
export async function authorKeatingBrowserAgent(
  input: KeatingBrowserAgentAuthoringInput,
): Promise<AuthoredKeatingBrowserAgent> {
  const originalTools = new Map(input.tools.map((tool) => [tool.name, tool]));
  const instance = new PortableAgentInstance({ id: input.instanceId });
  const adapter = new BrowserPortableAgentAdapter(input.hosts);

  function LessonCritic() {
    useModel(input.modelKey);
    return [
      "You are a fresh-context Keating lesson critic.",
      "Inspect the supplied teaching trace and identify one evidence-backed improvement.",
      "Return the weakness, supporting evidence, proposed prompt or policy change, and a regression check.",
      "Do not mutate the active learner experience yourself.",
    ].join("\n");
  }

  function KeatingTeacher() {
    useModel(input.modelKey);
    useInstruction(input.systemPrompt, {
      slot: "keating-system",
      revision: fingerprint(input.systemPrompt),
    });
    for (const tool of input.tools) {
      useTool(portableDefinition(tool), { enabled: true });
    }
    useSkill(IMPROVEMENT_SKILL);
    useSubagent({
      name: "lesson-critic",
      description: LESSON_CRITIC_DESCRIPTION,
      agent: LessonCritic,
      model: input.modelKey,
      revision: "1",
    });
  }

  const frame = instance.render(KeatingTeacher);
  const resources = await adapter.reconcile(frame);
  const tools = resources.tools.map(
    (tool) => originalTools.get(tool.name) ?? tool,
  );

  return Object.freeze({
    ...resources,
    tools: Object.freeze(tools),
    frame,
    adapter,
  });
}

function portableDefinition(tool: AgentTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as Readonly<Record<string, JsonValue>>,
    revision: fingerprint(
      JSON.stringify({
        description: tool.description,
        parameters: tool.parameters,
      }),
    ),
    run: () => {
      throw new Error(
        `Portable tool ${tool.name} must be executed by the browser host adapter.`,
      );
    },
  };
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
