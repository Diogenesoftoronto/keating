import { generateLearningArtifact } from "./learning-artifacts";
import type { GeneratedArtifactKind, StudyArtifact } from "./types";

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface MobileToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface MobileToolExecutionContext {
  /** Stable semantic key derived by the coordinator, not the provider call id. */
  idempotencyKey: string;
  createdAt: number;
  sessionId?: string;
  messageId?: string;
  signal?: AbortSignal;
  deadlineAt?: number;
  now?: () => number;
}

export interface ProposedArtifactEffect {
  type: "upsert-artifact";
  artifact: StudyArtifact;
}

export type MobileToolExecutionResult =
  | {
      ok: true;
      toolName: string;
      idempotencyKey: string;
      output: Readonly<Record<string, unknown>>;
      effects: readonly ProposedArtifactEffect[];
    }
  | {
      ok: false;
      toolName: string;
      idempotencyKey: string;
      code: "unknown_tool" | "malformed_json" | "invalid_arguments" | "aborted" | "timeout" | "execution_failed";
      message: string;
      retryable: boolean;
      effects: readonly [];
    };

export interface UnavailableMobileCapability {
  category: "animation" | "image" | "voice" | "course" | "workspace" | "improvement";
  reason: string;
  recovery: string;
}

const TOPIC_SCHEMA: JsonSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    topic: Object.freeze({ type: "string", minLength: 1, maxLength: 240 }),
  }),
  required: Object.freeze(["topic"]),
  additionalProperties: false,
});

const TOOL_KINDS = Object.freeze({
  generate_study_plan: "study-plan",
  generate_concept_map: "concept-map",
  generate_practice_quiz: "quiz",
} satisfies Record<string, GeneratedArtifactKind>);

export type MobileToolName = keyof typeof TOOL_KINDS;

const WORKSPACE_INSPECT_SCHEMA: JsonSchema = Object.freeze({
  type: "object", properties: Object.freeze({}), additionalProperties: false,
});
const WORKSPACE_PROPOSE_SCHEMA: JsonSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    intent: Object.freeze({ type: "string", minLength: 1, maxLength: 4096 }),
    path: Object.freeze({ type: "string", enum: Object.freeze(["screens/home.json"]) }),
    source: Object.freeze({ type: "string", maxLength: 65536 }),
  }),
  required: Object.freeze(["intent", "path", "source"]), additionalProperties: false,
});

export const MOBILE_TOOL_DEFINITIONS: readonly MobileToolDefinition[] = Object.freeze([
  Object.freeze({
    name: "generate_study_plan",
    description: "Generate a deterministic, domain-aware Keating study plan for a topic on this device.",
    inputSchema: TOPIC_SCHEMA,
  }),
  Object.freeze({
    name: "generate_concept_map",
    description: "Generate a deterministic Mermaid concept map for a topic on this device.",
    inputSchema: TOPIC_SCHEMA,
  }),
  Object.freeze({
    name: "generate_practice_quiz",
    description: "Generate a deterministic Keating practice quiz and answer key for a topic on this device.",
    inputSchema: TOPIC_SCHEMA,
  }),
  Object.freeze({
    name: "inspect_mobile_workspace",
    description: "Inspect the complete, user-visible source and active version of the bounded mobile workspace.",
    inputSchema: WORKSPACE_INSPECT_SCHEMA,
  }),
  Object.freeze({
    name: "propose_mobile_workspace_change",
    description: "Save a reviewable mobile workspace source proposal. This never activates the change; the learner must activate it explicitly.",
    inputSchema: WORKSPACE_PROPOSE_SCHEMA,
  }),
]);

/** These are recovery notices, never provider-advertised tool definitions. */
export const UNAVAILABLE_MOBILE_CAPABILITIES: readonly UnavailableMobileCapability[] = Object.freeze([
  Object.freeze({ category: "animation", reason: "Native animation generation is not connected.", recovery: "Use Keating web or the TUI animation command." }),
  Object.freeze({ category: "image", reason: "No native image-generation transport is connected.", recovery: "Choose an image model on Keating web." }),
  Object.freeze({ category: "voice", reason: "The local tool loop does not expose a voice synthesis tool.", recovery: "Use the mobile Live or speech controls when available." }),
  Object.freeze({ category: "course", reason: "Course authoring tools are not available to the native agent.", recovery: "Open the course workspace on Keating web." }),
  Object.freeze({ category: "improvement", reason: "Benchmark and policy mutation tools are not available to the native agent.", recovery: "Run improvement workflows on Keating web or TUI." }),
]);

export function unavailableMobileCapabilityPrompt(): string {
  return UNAVAILABLE_MOBILE_CAPABILITIES
    .map((entry) => `- ${entry.category}: ${entry.reason} Recovery: ${entry.recovery}`)
    .join("\n");
}

function shortHash(value: string): string {
  const hashes = [2166136261, 2246822507, 3266489909, 668265263];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    for (let lane = 0; lane < hashes.length; lane += 1) {
      hashes[lane] = Math.imul((hashes[lane]! ^ code ^ (lane * 97)), 16777619 + lane * 2);
    }
  }
  // Four independently seeded 32-bit lanes avoid using a collision-prone
  // single word while staying synchronous in Hermes and deterministic in Bun.
  return hashes.map((hash) => (hash! >>> 0).toString(36).padStart(7, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A provider retry with a new native call id still resolves to this semantic key. */
export function mobileToolIdempotencyKey(
  sessionId: string,
  triggeringMessageId: string,
  toolName: string,
  argumentsValue: Readonly<Record<string, unknown>>,
): string {
  const canonicalArguments = Object.prototype.hasOwnProperty.call(TOOL_KINDS, toolName)
    && typeof argumentsValue.topic === "string"
    ? { topic: argumentsValue.topic.trim() }
    : argumentsValue;
  return `tool-${shortHash(canonicalJson({ sessionId, triggeringMessageId, toolName, argumentsValue: canonicalArguments }))}`;
}

function failure(
  toolName: string,
  context: MobileToolExecutionContext,
  code: Extract<MobileToolExecutionResult, { ok: false }>["code"],
  message: string,
  retryable = false,
): MobileToolExecutionResult {
  return { ok: false, toolName, idempotencyKey: context.idempotencyKey, code, message, retryable, effects: [] };
}

function parseArguments(
  toolName: string,
  rawArguments: string | Readonly<Record<string, unknown>>,
  context: MobileToolExecutionContext,
): { topic: string } | MobileToolExecutionResult {
  let value: unknown = rawArguments;
  if (typeof rawArguments === "string") {
    try {
      value = JSON.parse(rawArguments);
    } catch {
      return failure(toolName, context, "malformed_json", "Tool arguments are not valid JSON.");
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failure(toolName, context, "invalid_arguments", "Tool arguments must be an object containing topic.");
  }
  const keys = Object.keys(value);
  const topic = (value as Record<string, unknown>).topic;
  if (keys.length !== 1 || keys[0] !== "topic" || typeof topic !== "string") {
    return failure(toolName, context, "invalid_arguments", "Only a string topic argument is allowed.");
  }
  const normalized = topic.trim();
  if (normalized.length < 1 || normalized.length > 240) {
    return failure(toolName, context, "invalid_arguments", "Topic must contain between 1 and 240 characters.");
  }
  return { topic: normalized };
}

function stableGeneratedContent(content: string, createdAt: number): string {
  return content.replace(/^> Generated: .*$/m, `> Generated: ${new Date(createdAt).toISOString()}`);
}

export function executeMobileTool(
  toolName: string,
  rawArguments: string | Readonly<Record<string, unknown>>,
  context: MobileToolExecutionContext,
): MobileToolExecutionResult {
  if (!context.idempotencyKey.trim()) {
    return failure(toolName, context, "invalid_arguments", "A non-empty idempotency key is required.");
  }
  if (context.signal?.aborted) return failure(toolName, context, "aborted", "Tool execution was cancelled.", true);
  const now = context.now ?? Date.now;
  if (context.deadlineAt !== undefined && now() >= context.deadlineAt) {
    return failure(toolName, context, "timeout", "Tool execution exceeded its deadline.", true);
  }
  if (!Object.prototype.hasOwnProperty.call(TOOL_KINDS, toolName)) {
    const category = UNAVAILABLE_MOBILE_CAPABILITIES.find((entry) => toolName.toLowerCase().includes(entry.category));
    return failure(
      toolName,
      context,
      "unknown_tool",
      category
        ? `Tool ${toolName} is not available on mobile. ${category.reason} ${category.recovery}`
        : `Tool ${toolName} is not available on mobile. Use a declared native tool or continue without it.`,
    );
  }
  const parsed = parseArguments(toolName, rawArguments, context);
  if ("ok" in parsed) return parsed;

  try {
    const kind = TOOL_KINDS[toolName as MobileToolName];
    const generated = generateLearningArtifact(parsed.topic, kind);
    if (context.signal?.aborted) return failure(toolName, context, "aborted", "Tool execution was cancelled.", true);
    if (context.deadlineAt !== undefined && now() >= context.deadlineAt) {
      return failure(toolName, context, "timeout", "Tool execution exceeded its deadline.", true);
    }
    const artifact: StudyArtifact = {
      id: `tool-artifact-${shortHash(context.idempotencyKey)}`,
      sessionId: context.sessionId,
      messageId: context.messageId,
      kind: generated.kind,
      source: "keating-core",
      topic: generated.topic,
      title: generated.title,
      content: stableGeneratedContent(generated.content, context.createdAt),
      createdAt: context.createdAt,
    };
    return {
      ok: true,
      toolName,
      idempotencyKey: context.idempotencyKey,
      output: Object.freeze({ artifactId: artifact.id, kind: artifact.kind, title: artifact.title, topic: artifact.topic }),
      effects: Object.freeze([Object.freeze({ type: "upsert-artifact", artifact: Object.freeze(artifact) })]),
    };
  } catch (error) {
    return failure(toolName, context, "execution_failed", error instanceof Error ? error.message : "Tool execution failed.", true);
  }
}
