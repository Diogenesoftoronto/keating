/**
 * Interactive replies: draggable reply components (state machines,
 * constructions, equation workbenches, sort boards, ...) and four specialist
 * labs (anatomy, pharmacology, research methods, physics).
 *
 * They share one contract node (`interactive`) and differ by `kind`. The
 * contract guarantees only bounded, JSON-safe structure for `config`; each
 * component's semantic validator runs in the web renderer, which shows a calm
 * fallback when a config does not fit. A learner who works the component sends
 * one `share-interactive` action carrying a bounded text summary.
 *
 * Everything here is plain data and bounds. Nothing is evaluated.
 */
import { hasOnlyKeys, isContractId, isRecord } from "./validation.js";

export const INTERACTIVE_KINDS = [
  "state-machine", "construction", "fraction-line", "equation", "permutation",
  "linked-model", "sort-board", "data-explorer", "plan-timeline", "evidence-board",
  "anatomy", "pharmacology", "methods", "physics",
] as const;
export type InteractiveKind = typeof INTERACTIVE_KINDS[number];

/** Kind → OpenUI Lang component name. */
export const INTERACTIVE_COMPONENT_NAMES: Readonly<Record<InteractiveKind, string>> = {
  "state-machine": "StateMachine",
  construction: "Construction",
  "fraction-line": "FractionLine",
  equation: "EquationWorkbench",
  permutation: "PermutationLab",
  "linked-model": "LinkedModel",
  "sort-board": "SortBoard",
  "data-explorer": "DataExplorer",
  "plan-timeline": "PlanTimeline",
  "evidence-board": "EvidenceBoard",
  anatomy: "Anatomy3D",
  pharmacology: "PharmLab",
  methods: "MethodsLab",
  physics: "PhysicsLab",
};

/** The OpenUI component names, in `INTERACTIVE_KINDS` order. */
export const INTERACTIVE_COMPONENTS = [
  "StateMachine", "Construction", "FractionLine", "EquationWorkbench", "PermutationLab",
  "LinkedModel", "SortBoard", "DataExplorer", "PlanTimeline", "EvidenceBoard",
  "Anatomy3D", "PharmLab", "MethodsLab", "PhysicsLab",
] as const;
export type InteractiveComponentName = typeof INTERACTIVE_COMPONENTS[number];

/** Learner-facing names, used by text fallbacks and material lists. */
export const INTERACTIVE_TITLES: Readonly<Record<InteractiveKind, string>> = {
  "state-machine": "State machine",
  construction: "Construction",
  "fraction-line": "Fraction line",
  equation: "Equation workbench",
  permutation: "Permutation lab",
  "linked-model": "Linked model",
  "sort-board": "Sort board",
  "data-explorer": "Data explorer",
  "plan-timeline": "Plan timeline",
  "evidence-board": "Evidence board",
  anatomy: "Anatomy model",
  pharmacology: "Pharmacology lab",
  methods: "Methods lab",
  physics: "Physics lab",
};

const KIND_SET = new Set<string>(INTERACTIVE_KINDS);
const KIND_BY_COMPONENT = new Map<string, InteractiveKind>(
  INTERACTIVE_KINDS.map((kind) => [INTERACTIVE_COMPONENT_NAMES[kind], kind]),
);

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface UiInteractiveNode {
  type: "interactive";
  id: string;
  title: string;
  kind: InteractiveKind;
  /** Markdown framing, bounded. Surfaces render it beside `interactiveTextLines`. */
  brief?: string;
  /** Component config. Structural bounds only: JSON-safe, at most 12 levels deep, at most 48 KB serialised. */
  config: JsonObject;
}

/** What the learner shares: their own words, the component's data summary, and its advisory analysis. */
export interface UiInteractiveShare {
  learner: string;
  data: string;
  analysis: string;
}

export const INTERACTIVE_LIMITS = {
  title: 512,
  brief: 4096,
  /** UTF-8 bytes of `JSON.stringify(config)`. */
  configBytes: 48 * 1024,
  /** Container nesting; the config object itself is level 1. */
  configDepth: 12,
  shareLearner: 600,
  shareData: 600,
  shareAnalysis: 2000,
} as const;

const NODE_KEYS = new Set(["type", "id", "title", "kind", "brief", "config"]);
const SHARE_KEYS = new Set(["learner", "data", "analysis"]);
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isInteractiveKind(value: unknown): value is InteractiveKind {
  return typeof value === "string" && KIND_SET.has(value);
}

export function interactiveKindForComponent(component: string): InteractiveKind | undefined {
  return KIND_BY_COMPONENT.get(component);
}

function text(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maximum && (allowEmpty || value.trim().length > 0);
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) { bytes += 4; index += 1; }
    else bytes += 3;
  }
  return bytes;
}

/**
 * True for a plain JSON object tree: plain objects and arrays of finite
 * numbers, strings, booleans and null, with no cycles, accessors, symbol keys,
 * prototype-shaped keys or sparse arrays, no deeper than `configDepth`, and no
 * larger than `configBytes` once serialised.
 */
export function isInteractiveConfig(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  const ancestors = new Set<object>();
  // Counts serialised bytes as it walks so an oversize config fails before stringifying.
  let bytes = 0;
  const budget = INTERACTIVE_LIMITS.configBytes;
  const visit = (candidate: unknown, depth: number): boolean => {
    if (bytes > budget) return false;
    if (candidate === null) { bytes += 4; return true; }
    switch (typeof candidate) {
      case "boolean": bytes += candidate ? 4 : 5; return true;
      case "number": if (!Number.isFinite(candidate)) return false; bytes += String(candidate).length; return true;
      case "string": bytes += utf8Length(JSON.stringify(candidate)); return true;
      case "object": break;
      default: return false;
    }
    const container = candidate as object;
    if (depth > INTERACTIVE_LIMITS.configDepth || ancestors.has(container)) return false;
    ancestors.add(container);
    let ok: boolean;
    if (Array.isArray(container)) {
      if (Object.getPrototypeOf(container) !== Array.prototype) return false;
      const keys = Reflect.ownKeys(container);
      // Only indices plus `length`: no extra properties and no holes.
      ok = keys.length === container.length + 1;
      bytes += 2 + Math.max(0, container.length - 1);
      for (let index = 0; ok && index < container.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(container, index);
        ok = !!descriptor && "value" in descriptor && visit(descriptor.value, depth + 1);
      }
    } else if (isRecord(container)) {
      const keys = Reflect.ownKeys(container);
      ok = true;
      bytes += 2 + Math.max(0, keys.length - 1);
      for (const key of keys) {
        if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) { ok = false; break; }
        const descriptor = Object.getOwnPropertyDescriptor(container, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) { ok = false; break; }
        bytes += utf8Length(JSON.stringify(key)) + 1;
        if (!visit(descriptor.value, depth + 1)) { ok = false; break; }
      }
    } else {
      ok = false;
    }
    ancestors.delete(container);
    return ok && bytes <= budget;
  };
  // The running count is an early exit; the exact serialised size decides.
  return visit(value, 1) && utf8Length(JSON.stringify(value)) <= budget;
}

/** Structural check used by `validateUiDocument`. */
export function validateInteractiveNode(value: unknown): value is UiInteractiveNode {
  return isRecord(value) && hasOnlyKeys(value, NODE_KEYS) && value.type === "interactive" && isContractId(value.id)
    && text(value.title, INTERACTIVE_LIMITS.title) && isInteractiveKind(value.kind)
    && (value.brief === undefined || text(value.brief, INTERACTIVE_LIMITS.brief, true))
    && isInteractiveConfig(value.config);
}

/** Shape check of a learner share; `analysis` may be empty when the component has none. */
export function validateInteractiveShare(value: unknown): value is UiInteractiveShare {
  return isRecord(value) && hasOnlyKeys(value, SHARE_KEYS)
    && text(value.learner, INTERACTIVE_LIMITS.shareLearner)
    && text(value.data, INTERACTIVE_LIMITS.shareData)
    && text(value.analysis, INTERACTIVE_LIMITS.shareAnalysis, true);
}

function sentence(value: unknown, maximum = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = value.replace(/\s+/g, " ").trim();
  if (!line) return undefined;
  return line.length > maximum ? `${line.slice(0, maximum - 1).trimEnd()}…` : line;
}

function humanKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
}

/**
 * Plain-text fallback for surfaces without the interactive component (mobile,
 * terminal): what the activity is and roughly what it holds. Never raw JSON.
 * `brief` is not included; surfaces render it as markdown beside these lines,
 * and add their own pointer to the web in their own style.
 */
export function interactiveTextLines(node: UiInteractiveNode): string[] {
  const config = isRecord(node.config) ? node.config : {};
  // One-word values (`mode: "fix"`, `goal: "factor"`, `construction: "copy-angle"`) name the task's variant.
  const variants = [config.mode, config.goal, config.construction]
    .flatMap((value) => typeof value === "string" && /^[\w-]{1,40}$/.test(value.trim()) ? [humanKey(value.trim())] : []);
  const lines = [[INTERACTIVE_TITLES[node.kind] ?? "Interactive activity", ...new Set(variants)].join(" · ")];
  const heading = sentence(config.title);
  if (heading && heading !== node.title.trim()) lines.push(heading);
  const goal = [config.goal, config.prompt, config.question]
    .map((value) => sentence(value))
    .find((value) => value !== undefined && /\s/.test(value));
  if (goal) lines.push(goal);
  // Plural collections only (`states`, `rows`); singular arrays are usually orderings or references.
  const counts = Object.entries(config)
    .filter(([key, entry]) => Array.isArray(entry) && entry.length > 0 && /[a-z]s$/i.test(key))
    .slice(0, 3)
    .map(([key, entry]) => {
      const count = (entry as unknown[]).length;
      const name = humanKey(key);
      return `${count} ${count === 1 ? name.replace(/(?:ie)?s$/, (end) => end === "ies" ? "y" : "") : name}`;
    });
  if (counts.length) lines.push(`Holds ${counts.join(", ")}.`);
  return lines;
}
