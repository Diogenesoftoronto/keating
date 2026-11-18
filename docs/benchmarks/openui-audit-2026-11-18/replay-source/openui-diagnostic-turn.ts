import type { UiDocumentNode } from "./ui.js";
import { TEACHING_POLICY_DETERMINISTIC_RULES, TEACHING_POLICY_RULES } from "./judgement/teaching-policy-catalog.js";

export const OPENUI_DIAGNOSTIC_MODES = ["guided", "offer-only", "baseline", "unknown"] as const;
export const OPENUI_DIAGNOSTIC_CUES = ["explicit-interface", "implicit-action", "direct-text", "none", "unknown"] as const;
const REPLIES = ["released", "withheld", "error", "cancelled", "pending", "unknown"] as const;
export type OpenUiDiagnosticMode = typeof OPENUI_DIAGNOSTIC_MODES[number];
export type OpenUiDiagnosticCueKind = typeof OPENUI_DIAGNOSTIC_CUES[number];
export interface OpenUiDiagnosticCue { kind: OpenUiDiagnosticCueKind; targets: string[]; repeat?: boolean }

export interface OpenUiDiagnosticTurn {
  schemaVersion: 1;
  conversationId: string;
  turnId: string;
  /** Physical learner-turn index. Missing positions break exact delay measurement. */
  turnIndex: number;
  model: string | null;
  mode: OpenUiDiagnosticMode;
  cue: OpenUiDiagnosticCue;
  reply: typeof REPLIES[number];
  attempted: boolean | null;
  /** Whether a public assistant tool call requested an interactive_page during this turn. */
  nativePageRequested?: boolean | null;
  /** All observed candidate components, selected response components, and observed mounted components, respectively. */
  compiled: string[] | null;
  selected: string[] | null;
  rendered: string[] | null;
  /** Words outside structured blocks in the selected reply. Zero is an observed count. */
  outsideWords?: number | null;
  guidance: {
    source: "jev" | "other" | "unknown";
    action: "create" | "continue" | "grade-first" | "none" | "unknown";
    delivered: boolean | null;
    targets: string[];
  } | null;
  experiment?: { experimentId: string; caseId: string; pairId: string };
  fit?: { source: string; passed: boolean | null };
  draftAttempts?: number;
  gateIssues?: string[];
  decisionModel?: string | null;
}

// Use independently observable node kinds. SystemDesign and Diagram share a single task representation.
const COMPONENTS = [
  "question", "question-group", "quiz", "exam", "deck", "study-plan", "concept-map", "diagram",
  "notes", "simulation", "coding-challenge", "music-lab", "language-practice", "markdown", "callout",
  "goal", "image", "media", "artifact", "handoff", "task", "assignment", "practice", "draft",
  "fieldwork", "connect", "person", "audio-response", "video-response",
];
const componentMap = new Map(COMPONENTS.map(kind => [kind.replaceAll("-", ""), kind]));
const gateIssues = [...new Set<string>([...TEACHING_POLICY_DETERMINISTIC_RULES, ...TEACHING_POLICY_RULES.map(rule => rule.id)])];
export function isOpenUiDiagnosticGateIssue(id: string): boolean { return gateIssues.includes(id); }
export function isOpenUiDiagnosticInterface(component: string): boolean {
  return COMPONENTS.includes(component) && !["markdown", "callout", "handoff"].includes(component);
}
for (const [alias, kind] of Object.entries({
  flashcard: "deck", flashcards: "deck", explanation: "markdown", learningimage: "image",
  learninganimation: "handoff", sharednotes: "notes", systemdesign: "diagram", personbrief: "person",
})) componentMap.set(alias, kind);

export function normalizeOpenUiComponent(name: string): string | null {
  return componentMap.get(name.toLowerCase().replace(/[-_ ]/g, "")) ?? null;
}

export function openUiDiagnosticComponentForNode(node: UiDocumentNode): string {
  if (node.type === "quiz" && node.mode === "exam") return "exam";
  if (node.type !== "task") return node.type;
  if (node.diagram) return "diagram";
  if (node.submission?.capture) return node.submission.capture.kind + "-response";
  return node.kind;
}

/** These independent English-language cues can be replaced by a declared, pre-labelled evaluation cue. */
const NAMED: ReadonlyArray<[string, RegExp]> = [
  ["deck", /\bflash\s?cards?\b/], ["exam", /\b(?:mock |practice )?exam\b/], ["quiz", /\bquiz(?:zes)?\b/],
  ["simulation", /\b(?:simulation|simulator|slider)s?\b/], ["concept-map", /\bconcept maps?\b/],
  ["diagram", /\bdiagram(?:s)?\b/], ["study-plan", /\bstudy plans?\b/],
  ["coding-challenge", /\bcoding (?:challenge|exercise)s?\b/], ["music-lab", /\bmusic lab\b/],
  ["language-practice", /\blanguage practice\b/], ["notes", /\b(?:editable|shared) notes?\b/],
  ["question", /\b(?:openui|interactive|multiple[- ]choice|open[- ]text|on[- ]screen|clickable) (?:text )?questions?\b/],
];
const POSITIVE_REQUEST = /\b(?:give|make|create|build|draw|show|use|generate|set up|start|try|want|would like|could i (?:get|have)|can i (?:get|have)|would help|please)\b/;
const NEGATION = /\b(?:no|without|skip|avoid|stop|don['’]t|do not|not another|no more|rather than|instead of)\b/;
// Declining a quiz can accompany a request for a map or simulation. Text-only controls
// require a direct answer, a prose constraint, or a general opt-out from interfaces.
const DIRECT = /\b(?:plain text|text[- ]only|in (?:a|one) (?:plain |short |single )?sentence|just (?:the )?(?:answer|explain|tell me|show me the answer|give me (?:the )?(?:value|answer|number|definition))|answer (?:me )?directly|direct answer|no (?:ui|interfaces?|interactions?|activities)|without (?:an? |any )?(?:interfaces?|activit(?:y|ies)))\b/;
const PRACTICE = /\b(?:let me (?:try|predict|make a prediction|choose|practice|practise)|(?:can|could|may) (?:we|i) (?:try|do|have) (?:another|one more)|(?:give|show) me (?:another|one more|one different|a different|a new) (?:one|problem|equation|example to try|exercise)|try me|quiz me|test me|ask me (?:a|one|another) question|check my understanding|what should i (?:predict|choose)|can i practice|(?:steps|stages|events).{0,30}(?:scrambled|jumbled|shuffled)|put (?:them|these|the steps) (?:back )?in order)\b/;
const MANIPULATE = /\b(?:what (?:happens|changes|would happen|would change) (?:if|when) i (?:change|increase|decrease|double|vary|adjust)|(?:let me|can i|could i) (?:adjust|vary|change) (?:the |a )?(?:values?|parameters?|rate)|(?:let me|can i|could i|i (?:want|would like) to|i['’]d like to) (?:adjust|vary|change|move)\b.{0,100}\b(?:watch|see|observe)|(?:watch|see) what (?:happens|changes) (?:as|when) i (?:adjust|vary|change))\b/;
const STRUCTURE = /\b(?:arrange|connect|map out|organize|lay out)\b.{0,45}\b(?:connections|relationships|nodes|parts|concepts)\b/;
const CODE = /\b(?:fix|debug|run|test|edit|change)\b.{0,90}\b(?:example inputs?|test cases?|by running|and run)\b|\b(?:broken|incomplete) (?:function|loop|program|snippet|code)\b.{0,60}\b(?:fix|repair|debug|run)\b/;
const RECALL = /\b(?:which (?:ones|words|terms|items) i can (?:recall|remember)|see (?:if|what) i (?:remember|recall)|let me (?:recall|retrieve)|test my (?:memory|recall))\b/;
const REMINDER = /\b(?:still (?:want|need|waiting for|would like)|(?:already|previously) asked for|(?:that |the one )?i asked for|as (?:i )?(?:asked|requested)|i meant (?:with|the|a))\b/;

export function classifyOpenUiCue(text: string | null | undefined): OpenUiDiagnosticCue {
  if (!text?.trim() || text.length > 6000) return { kind: "unknown", targets: [] };
  const value = text.trim().toLowerCase();
  const clauses = value.split(/(?:[.!?;,\n]|\bbut\b)/).map(s => s.trim()).filter(Boolean);
  const positive = clauses.filter(clause => !NEGATION.test(clause));
  const reminder = positive.some(clause => REMINDER.test(clause));
  const cue = (kind: "explicit-interface" | "implicit-action", targets: string[]): OpenUiDiagnosticCue =>
    reminder ? { kind, targets, repeat: true } : { kind, targets };
  const targets = new Set<string>();
  for (const clause of positive) {
    // A mention in a past report or a negated request cannot establish a requested interface.
    if (/\b(?:what (?:is|was)|what does|talk about|explain (?:what|why)|how (?:do|does|did))\b/.test(clause) && !/\b(?:make|create|build|draw|give me)\b/.test(clause)) continue;
    const request = POSITIVE_REQUEST.test(clause) || REMINDER.test(clause);
    for (const [kind, pattern] of NAMED) {
      if (!pattern.test(clause)) continue;
      if (request || /^(?:a |an |some )?(?:flash\s?cards?|quiz|simulation|diagram|study plan|exam)(?: please)?$/i.test(clause)) targets.add(kind);
    }
    if (!targets.size && request && /\b(?:openui|interactive (?:interface|activity|surface)|clickable activity)\b/.test(clause)) targets.add("any");
  }
  if (targets.size) return cue("explicit-interface", [...targets].sort());
  if (DIRECT.test(value)) return { kind: "direct-text", targets: [] };
  if (positive.some(c => MANIPULATE.test(c))) return cue("implicit-action", ["simulation"]);
  if (positive.some(c => STRUCTURE.test(c) && /\b(?:like to|want to|let me|could i|can i|help me)\b/.test(c))) return cue("implicit-action", ["concept-map", "diagram"]);
  if (positive.some(c => CODE.test(c) && /\b(?:give me|let me|could i|can i|i can|want to)\b/.test(c))) return cue("implicit-action", ["coding-challenge"]);
  if (positive.some(c => RECALL.test(c))) return cue("implicit-action", ["question", "quiz", "deck", "language-practice"]);
  if (positive.some(c => PRACTICE.test(c))) return cue("implicit-action", ["question", "quiz"]);
  // Unrecognized scripts and requests too ambiguous to classify remain measurable as unknown.
  if (!/[a-z]/i.test(value)) return { kind: "unknown", targets: [] };
  return { kind: "none", targets: [] };
}

export function openUiMatchesTargets(components: readonly string[], targets: readonly string[]): boolean {
  const actual = new Set(components.filter(isOpenUiDiagnosticInterface).map(kind => kind === "question-group" ? "question" : kind));
  return targets.some(kind => kind === "any" ? actual.size > 0 : actual.has(kind === "question-group" ? "question" : kind));
}

const ROW_KEYS = ["schemaVersion", "conversationId", "turnId", "turnIndex", "model", "mode", "cue", "reply",
  "attempted", "compiled", "selected", "rendered", "guidance", "experiment", "fit", "draftAttempts", "gateIssues", "decisionModel", "outsideWords", "nativePageRequested"];
type RecordValue = Record<string, unknown>;
function fields(value: unknown, allowed: readonly string[]): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
}

const ID_PATTERN = "^[a-zA-Z0-9][a-zA-Z0-9_.:@/+~-]{0,159}$";
const opaqueId = new RegExp(ID_PATTERN);
function identifier(value: unknown): value is string { return typeof value === "string" && opaqueId.test(value); }

function member<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function componentList(value: unknown, targets = false): value is string[] {
  return Array.isArray(value) && value.length <= COMPONENTS.length + 1
    && value.every(kind => typeof kind === "string" && (COMPONENTS.includes(kind) || (targets && kind === "any")))
    && new Set(value).size === value.length;
}

function nullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function validCue(value: unknown): value is OpenUiDiagnosticCue {
  if (!fields(value, ["kind", "targets", "repeat"]) || !member(value.kind, OPENUI_DIAGNOSTIC_CUES) || !componentList(value.targets, true)
    || (value.repeat !== undefined && typeof value.repeat !== "boolean")) return false;
  const opportunity = value.kind === "explicit-interface" || value.kind === "implicit-action";
  return opportunity === (value.targets.length > 0) && (opportunity || value.repeat !== true);
}

function validGuidance(value: unknown): boolean {
  return value === null || (fields(value, ["source", "action", "delivered", "targets"])
    && member(value.source, ["jev", "other", "unknown"]) && member(value.action, ["create", "continue", "grade-first", "none", "unknown"])
    && nullableBoolean(value.delivered) && componentList(value.targets, true));
}

export function isOpenUiDiagnosticTurn(value: unknown): value is OpenUiDiagnosticTurn {
  return fields(value, ROW_KEYS) && value.schemaVersion === 1 && identifier(value.conversationId) && identifier(value.turnId)
    && typeof value.turnIndex === "number" && Number.isSafeInteger(value.turnIndex) && value.turnIndex >= 0
    && (value.model === null || identifier(value.model)) && member(value.mode, OPENUI_DIAGNOSTIC_MODES)
    && validCue(value.cue) && member(value.reply, REPLIES) && nullableBoolean(value.attempted)
    && (value.nativePageRequested === undefined || nullableBoolean(value.nativePageRequested))
    && [value.compiled, value.selected, value.rendered].every(v => v === null || componentList(v))
    && (value.outsideWords == null || (typeof value.outsideWords === "number" && Number.isSafeInteger(value.outsideWords) && value.outsideWords >= 0))
    && validGuidance(value.guidance)
    && (value.draftAttempts === undefined || (Number.isSafeInteger(value.draftAttempts) && (value.draftAttempts as number) >= 0))
    && (value.decisionModel === undefined || value.decisionModel === null || identifier(value.decisionModel))
    && (value.gateIssues === undefined || (Array.isArray(value.gateIssues) && value.gateIssues.length <= gateIssues.length
      && value.gateIssues.every(id => typeof id === "string" && isOpenUiDiagnosticGateIssue(id)) && new Set(value.gateIssues).size === value.gateIssues.length))
    && (value.experiment === undefined || (fields(value.experiment, ["experimentId", "caseId", "pairId"])
      && [value.experiment.experimentId, value.experiment.caseId, value.experiment.pairId].every(identifier)))
    && (value.fit === undefined || (fields(value.fit, ["source", "passed"]) && identifier(value.fit.source) && nullableBoolean(value.fit.passed)));
}

export function parseOpenUiDiagnosticExport(value: unknown): OpenUiDiagnosticTurn[] {
  const rows = fields(value, ["schemaVersion", "turns"]) && value.schemaVersion === 1 ? value.turns : value;
  if (!Array.isArray(rows)) throw new Error("Expected diagnostic turns or a version 1 export with a turns array.");
  for (const [index, row] of rows.entries()) {
    if (!isOpenUiDiagnosticTurn(row)) throw new Error("Invalid OpenUI diagnostic turn at row " + (index + 1) + ". Check version, allowed fields and component names.");
  }
  return rows as OpenUiDiagnosticTurn[];
}

const identifierSchema = { type: "string", pattern: ID_PATTERN };
const measuredBoolean = { type: ["boolean", "null"] };
const stringList = (options: string[]) => ({ type: "array", uniqueItems: true, maxItems: options.length, items: { enum: options } });
const targetsSchema = stringList([...COMPONENTS, "any"]);
const measuredComponents = { anyOf: [stringList(COMPONENTS), { type: "null" }] };
const recordSchema = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) =>
  ({ type: "object", additionalProperties: false, required, properties });
const requiredTurnKeys = ROW_KEYS.filter(k => !["fit", "experiment", "decisionModel", "draftAttempts", "gateIssues", "outsideWords", "nativePageRequested"].includes(k));
const cueSchema = {
  ...recordSchema({ kind: { enum: OPENUI_DIAGNOSTIC_CUES }, targets: targetsSchema, repeat: { type: "boolean" } }, ["kind", "targets"]),
  allOf: [{
    if: { properties: { kind: { enum: ["explicit-interface", "implicit-action"] } } },
    then: { properties: { targets: { minItems: 1 } } }, else: { properties: { targets: { maxItems: 0 }, repeat: { const: false } } },
  }],
};
const turnSchema = recordSchema({
  schemaVersion: { const: 1 }, conversationId: identifierSchema, turnId: identifierSchema,
  turnIndex: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  model: { anyOf: [identifierSchema, { type: "null" }] }, mode: { enum: OPENUI_DIAGNOSTIC_MODES }, cue: cueSchema,
  reply: { enum: REPLIES }, attempted: measuredBoolean, compiled: measuredComponents, selected: measuredComponents, rendered: measuredComponents,
  guidance: { anyOf: [{ type: "null" }, recordSchema({
    source: { enum: ["jev", "other", "unknown"] }, action: { enum: ["create", "continue", "grade-first", "none", "unknown"] },
    delivered: measuredBoolean, targets: targetsSchema,
  })] },
  experiment: recordSchema({ experimentId: identifierSchema, caseId: identifierSchema, pairId: identifierSchema }),
  fit: recordSchema({ source: identifierSchema, passed: measuredBoolean }),
  draftAttempts: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, gateIssues: stringList(gateIssues),
  decisionModel: { anyOf: [identifierSchema, { type: "null" }] },
  outsideWords: { type: ["integer", "null"], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  nativePageRequested: measuredBoolean,
}, requiredTurnKeys);

/** JSON Schema for a portable versioned export or a direct array of final turn observations. */
export const OPENUI_DIAGNOSTIC_EXPORT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Keating OpenUI diagnostic export v1",
  $defs: { turn: turnSchema, turns: { type: "array", items: { $ref: "#/$defs/turn" } } },
  oneOf: [{ $ref: "#/$defs/turns" }, recordSchema({ schemaVersion: { const: 1 }, turns: { $ref: "#/$defs/turns" } })],
};
