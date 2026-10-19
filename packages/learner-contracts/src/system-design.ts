/** Bounded, dependency-free diagrams and structural feedback, with legacy system-design compatibility. */
import { hasOnlyKeys, isRecord } from "./validation.js";

export const SYSTEM_DESIGN_KINDS = ["client", "service", "database", "cache", "queue", "load-balancer", "external"] as const;
export const DIAGRAM_KINDS = ["concept", "step", "decision", "input", "output", "actor", "state", ...SYSTEM_DESIGN_KINDS] as const;
export type SystemDesignKind = string;
export interface SystemDesignComponent { id: string; label: string; kind: SystemDesignKind }
export interface SystemDesignConnection { id: string; from: string; to: string; label?: string }
export interface SystemDesignGraph { components: SystemDesignComponent[]; connections: SystemDesignConnection[] }
export type SystemDesignCheck =
  | { id: string; label: string; type: "component"; kind: SystemDesignKind; minimum?: number }
  | { id: string; label: string; type: "connection" | "path"; fromKind: SystemDesignKind; toKind: SystemDesignKind };
export interface SystemDesignSpec extends SystemDesignGraph { checks: SystemDesignCheck[]; kinds?: string[] }
export interface SystemDesignCheckResult { id: string; label: string; passed: boolean; detail: string }
export interface SystemDesignSubmission {
  schemaVersion: 1;
  kind: "system-design" | "diagram";
  graph: SystemDesignGraph;
  mermaid: string;
  checks: SystemDesignCheckResult[];
  explanation: string;
}

const MAX_COMPONENTS = 40;
const MAX_CONNECTIONS = 80;
const MAX_CHECKS = 24;
const MAX_LABEL = 160;
const MAX_EXPLANATION = 8_000;
// Keep canonical submit-task content inside the shared UI action boundary.
const MAX_SUBMISSION_JSON = 131_072;
const GRAPH_KEYS = new Set(["components", "connections"]);
const SPEC_KEYS = new Set([...GRAPH_KEYS, "checks", "kinds"]);
const COMPONENT_KEYS = new Set(["id", "label", "kind"]);
const CONNECTION_KEYS = new Set(["id", "from", "to", "label"]);
const COMPONENT_CHECK_KEYS = new Set(["id", "label", "type", "kind", "minimum"]);
const LINK_CHECK_KEYS = new Set(["id", "label", "type", "fromKind", "toKind"]);
const RESULT_KEYS = new Set(["id", "label", "passed", "detail"]);
const SUBMISSION_KEYS = new Set(["schemaVersion", "kind", "graph", "mermaid", "checks", "explanation"]);

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
}
function isLabel(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= MAX_LABEL && (allowEmpty || value.trim().length > 0);
}
function isKind(value: unknown): value is SystemDesignKind {
  return isId(value);
}
function isComponent(value: unknown): value is SystemDesignComponent {
  return isRecord(value) && hasOnlyKeys(value, COMPONENT_KEYS) && isId(value.id) && isLabel(value.label) && isKind(value.kind);
}
function isConnection(value: unknown): value is SystemDesignConnection {
  return isRecord(value) && hasOnlyKeys(value, CONNECTION_KEYS) && isId(value.id) && isId(value.from) && isId(value.to)
    && (!Object.hasOwn(value, "label") || isLabel(value.label, true));
}
function isCheck(value: unknown): value is SystemDesignCheck {
  if (!isRecord(value) || !isId(value.id) || !isLabel(value.label)) return false;
  if (value.type === "component") {
    return hasOnlyKeys(value, COMPONENT_CHECK_KEYS) && isKind(value.kind)
      && (!Object.hasOwn(value, "minimum") || (typeof value.minimum === "number" && Number.isInteger(value.minimum)
        && value.minimum >= 1 && value.minimum <= MAX_COMPONENTS));
  }
  return (value.type === "connection" || value.type === "path") && hasOnlyKeys(value, LINK_CHECK_KEYS)
    && isKind(value.fromKind) && isKind(value.toKind);
}
function hasValidGraphFields(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.components) || value.components.length > MAX_COMPONENTS || !Array.from(value.components).every(isComponent)
    || !Array.isArray(value.connections) || value.connections.length > MAX_CONNECTIONS || !Array.from(value.connections).every(isConnection)) return false;
  const components = value.components as SystemDesignComponent[];
  const connections = value.connections as SystemDesignConnection[];
  const ids = new Set(components.map((component) => component.id));
  return ids.size === components.length && new Set(connections.map((connection) => connection.id)).size === connections.length
    && connections.every((connection) => ids.has(connection.from) && ids.has(connection.to));
}

/** Closed graph boundary: duplicates, dangling connections and excess fields fail. */
export function validateSystemDesignGraph(value: unknown): value is SystemDesignGraph {
  return isRecord(value) && hasOnlyKeys(value, GRAPH_KEYS) && hasValidGraphFields(value);
}
/** The chosen palette scopes component and check categories for this activity. */
export function getDiagramKinds(spec: SystemDesignSpec): readonly string[] {
  return spec.kinds ?? DIAGRAM_KINDS;
}

function graphUsesPalette(spec: SystemDesignSpec, graph: SystemDesignGraph): boolean {
  const kinds = new Set(getDiagramKinds(spec));
  return graph.components.every((component) => kinds.has(component.kind));
}

export function validateSystemDesignSpec(value: unknown): value is SystemDesignSpec {
  if (!isRecord(value) || !hasOnlyKeys(value, SPEC_KEYS) || !hasValidGraphFields(value)
    || !Array.isArray(value.checks) || value.checks.length > MAX_CHECKS || !Array.from(value.checks).every(isCheck)
    || new Set(value.checks.map((check) => check.id)).size !== value.checks.length) return false;
  if (Object.hasOwn(value, "kinds") && (!Array.isArray(value.kinds) || value.kinds.length < 1 || value.kinds.length > 32
    || !Array.from(value.kinds).every(isKind) || new Set(value.kinds).size !== value.kinds.length)) return false;
  const spec = value as unknown as SystemDesignSpec;
  const kinds = new Set(getDiagramKinds(spec));
  return graphUsesPalette(spec, spec) && spec.checks.every((check) => check.type === "component"
    ? kinds.has(check.kind) : kinds.has(check.fromKind) && kinds.has(check.toKind));
}

/** Mermaid's numeric entities keep all user text inside quoted labels. Render with strict security and htmlLabels disabled. */
function mermaidLabel(label: string): string {
  return Array.from(label, (character) => /^[A-Za-z0-9 ]$/.test(character)
    ? character : `#${character.codePointAt(0)!};`).join("");
}
export function systemDesignMermaid(graph: SystemDesignGraph): string {
  if (!validateSystemDesignGraph(graph)) throw new Error("Invalid diagram graph.");
  const aliases = new Map(graph.components.map((component, index) => [component.id, `n${index}`]));
  const lines = ["flowchart LR"];
  for (const component of graph.components) {
    lines.push(`  ${aliases.get(component.id)!}["${mermaidLabel(component.label)}"]`);
  }
  for (const connection of graph.connections) {
    const arrow = connection.label ? ` -->|"${mermaidLabel(connection.label)}"| ` : " --> ";
    lines.push(`  ${aliases.get(connection.from)!}${arrow}${aliases.get(connection.to)!}`);
  }
  return lines.join("\n");
}

/** These checks describe graph structure only; they never grade a design's quality. */
export function evaluateSystemDesignChecks(spec: SystemDesignSpec, graph: SystemDesignGraph): SystemDesignCheckResult[] {
  if (!validateSystemDesignSpec(spec) || !validateSystemDesignGraph(graph) || !graphUsesPalette(spec, graph)) throw new Error("Invalid diagram specification or graph categories.");
  const kinds = new Map(graph.components.map((component) => [component.id, component.kind]));
  const adjacency = new Map<string, string[]>();
  for (const connection of graph.connections) {
    const neighbors = adjacency.get(connection.from) ?? [];
    neighbors.push(connection.to);
    adjacency.set(connection.from, neighbors);
  }
  const hasPath = (fromKind: SystemDesignKind, toKind: SystemDesignKind): boolean => {
    for (const component of graph.components) {
      if (component.kind !== fromKind) continue;
      // Start with neighbors: a path requires at least one directed connection.
      const pending = [...(adjacency.get(component.id) ?? [])];
      const visited = new Set<string>();
      for (let index = 0; index < pending.length; index += 1) {
        const id = pending[index]!;
        if (visited.has(id)) continue;
        visited.add(id);
        if (kinds.get(id) === toKind) return true;
        pending.push(...(adjacency.get(id) ?? []));
      }
    }
    return false;
  };
  return spec.checks.map((check) => {
    if (check.type === "component") {
      const count = graph.components.filter((component) => component.kind === check.kind).length;
      const minimum = check.minimum ?? 1;
      return { id: check.id, label: check.label, passed: count >= minimum,
        detail: `Found ${count} ${check.kind} component(s); requires at least ${minimum}.` };
    }
    const passed = check.type === "connection"
      ? graph.connections.some((connection) => kinds.get(connection.from) === check.fromKind && kinds.get(connection.to) === check.toKind)
      : hasPath(check.fromKind, check.toKind);
    return { id: check.id, label: check.label, passed,
      detail: `${passed ? "Found" : "Missing"} a directed ${check.type} from ${check.fromKind} to ${check.toKind}.` };
  });
}

export function createSystemDesignSubmission(spec: SystemDesignSpec, graph: SystemDesignGraph, explanation: string): SystemDesignSubmission {
  if (!validateSystemDesignSpec(spec) || !validateSystemDesignGraph(graph) || !graphUsesPalette(spec, graph)
    || typeof explanation !== "string" || explanation.length > MAX_EXPLANATION) throw new Error("Invalid diagram submission.");
  const snapshot: SystemDesignGraph = {
    components: graph.components.map((component) => ({ ...component })),
    connections: graph.connections.map((connection) => ({ ...connection })),
  };
  const submission: SystemDesignSubmission = { schemaVersion: 1, kind: "system-design", graph: snapshot, mermaid: systemDesignMermaid(snapshot),
    checks: evaluateSystemDesignChecks(spec, snapshot), explanation };
  if (JSON.stringify(submission).length > MAX_SUBMISSION_JSON) {
    throw new Error("Diagram submission exceeds 131072 characters. Shorten component labels, connection labels, or the explanation.");
  }
  return submission;
}

/** Recompute every derived field against the trusted spec; a client cannot assert its own checks or Mermaid source. */
export function parseSystemDesignSubmission(source: string, spec: SystemDesignSpec): SystemDesignSubmission | undefined {
  if (typeof source !== "string" || source.length > MAX_SUBMISSION_JSON || !validateSystemDesignSpec(spec)) return undefined;
  let value: unknown;
  try { value = JSON.parse(source); } catch { return undefined; }
  if (!isRecord(value) || !hasOnlyKeys(value, SUBMISSION_KEYS) || value.schemaVersion !== 1 || (value.kind !== "system-design" && value.kind !== "diagram")
    || !validateSystemDesignGraph(value.graph) || typeof value.explanation !== "string" || value.explanation.length > MAX_EXPLANATION
    || typeof value.mermaid !== "string" || !Array.isArray(value.checks) || value.checks.length !== spec.checks.length) return undefined;
  let expected: SystemDesignSubmission;
  try { expected = createSystemDesignSubmission(spec, value.graph, value.explanation); } catch { return undefined; }
  if (value.mermaid !== expected.mermaid || !value.checks.every((check, index) => {
    const result = expected.checks[index]!;
    return isRecord(check) && hasOnlyKeys(check, RESULT_KEYS) && check.id === result.id && check.label === result.label
      && check.passed === result.passed && check.detail === result.detail;
  })) return undefined;
  expected.kind = value.kind;
  return expected;
}

/** Completion requires learner work and reasoning; it does not require every structural check to pass. */
export function systemDesignSubmissionIsComplete(source: string, spec: SystemDesignSpec): boolean {
  const submission = parseSystemDesignSubmission(source, spec);
  return !!submission && submission.graph.components.length > 0 && submission.explanation.trim().length > 0;
}

/**
 * Mermaid's SVG text renderer may leave numeric HTML entities as literal text.
 * Apply this once to sanitized SVG text nodes via textContent, never to markup
 * or Mermaid source. Source entities (#60;) and named entities stay unchanged.
 */
export function decodeSystemDesignLabel(text: string): string {
  return text.replace(/&#(\d+);/g, (entity: string, digits: string) => {
    const codePoint = Number(digits);
    // XML text accepts tab, LF, CR and scalar values in these ranges. Keep
    // forbidden controls, surrogates and out-of-range entities visibly inert.
    const validXmlText = codePoint === 9 || codePoint === 10 || codePoint === 13
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    return Number.isInteger(codePoint) && validXmlText ? String.fromCodePoint(codePoint) : entity;
  });
}

/**
 * Decode sanitized SVG label text when Mermaid splits an entity across tspans.
 * The decoded character stays in the run containing the entity's first '&';
 * consumed text is removed from later runs without changing their count.
 * Apply the returned strings once through the corresponding nodes' textContent.
 */
export function decodeSystemDesignTextRuns(runs: readonly string[]): string[] {
  const source = runs.join("");
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  for (const match of source.matchAll(/&#\d+;/g)) {
    const replacement = decodeSystemDesignLabel(match[0]);
    if (replacement !== match[0]) edits.push({ start: match.index, end: match.index + match[0].length, replacement });
  }
  let runStart = 0;
  let firstEdit = 0;
  return runs.map((run) => {
    const runEnd = runStart + run.length;
    while (firstEdit < edits.length && edits[firstEdit]!.end <= runStart) firstEdit += 1;
    let cursor = 0;
    let text = "";
    for (let index = firstEdit; index < edits.length; index += 1) {
      const edit = edits[index]!;
      if (edit.start >= runEnd) break;
      text += run.slice(cursor, Math.max(0, edit.start - runStart));
      if (edit.start >= runStart) text += edit.replacement;
      cursor = Math.min(run.length, edit.end - runStart);
    }
    text += run.slice(cursor);
    runStart = runEnd;
    return text;
  });
}
