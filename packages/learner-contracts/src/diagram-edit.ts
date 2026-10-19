/**
 * Pure graph transitions and submission preparation shared by the web and mobile diagram workbenches.
 * Every function returns a new graph and never mutates its input; a transition that cannot apply
 * (unknown id, bound reached, unusable generated id) returns the input graph unchanged.
 */
import {
  DIAGRAM_LIMITS, createSystemDesignSubmission, diagramGraphUsesPalette, validateSystemDesignGraph,
  type SystemDesignGraph, type SystemDesignKind, type SystemDesignSpec, type SystemDesignSubmission,
} from "./system-design.js";
import { hasOnlyKeys, isRecord } from "./validation.js";

export type DiagramIdPrefix = "component" | "connection";
/** Supplies a fresh id for a new component or connection. `existing` lists the ids already in use for that prefix. */
export type DiagramIdGenerator = (prefix: DiagramIdPrefix, existing: readonly string[]) => string;

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** Deterministic ids `component-1`, `component-2`, … that skip any id already used. */
export const sequentialDiagramId: DiagramIdGenerator = (prefix, existing) => {
  let sequence = 1;
  while (existing.includes(`${prefix}-${sequence}`)) sequence += 1;
  return `${prefix}-${sequence}`;
};

function freshId(prefix: DiagramIdPrefix, existing: readonly string[], generate: DiagramIdGenerator): string | undefined {
  const id = generate(prefix, existing);
  return ID_PATTERN.test(id) && !existing.includes(id) ? id : undefined;
}

/** Independent copy of a spec's starter graph, so editing never touches the trusted spec. */
export function copyDiagramGraph(source: SystemDesignGraph): SystemDesignGraph {
  return {
    components: source.components.map((component) => ({ ...component })),
    connections: source.connections.map((connection) => ({ ...connection })),
  };
}

export function addDiagramComponent(graph: SystemDesignGraph, input: { label: string; kind: SystemDesignKind }, generate: DiagramIdGenerator): SystemDesignGraph {
  if (graph.components.length >= DIAGRAM_LIMITS.components) return graph;
  const id = freshId("component", graph.components.map((component) => component.id), generate);
  if (id === undefined) return graph;
  return { ...graph, components: [...graph.components, { id, label: input.label, kind: input.kind }] };
}

export function renameDiagramComponent(graph: SystemDesignGraph, id: string, label: string): SystemDesignGraph {
  return { ...graph, components: graph.components.map((component) => component.id === id ? { ...component, label } : component) };
}

export function setDiagramComponentKind(graph: SystemDesignGraph, id: string, kind: SystemDesignKind): SystemDesignGraph {
  return { ...graph, components: graph.components.map((component) => component.id === id ? { ...component, kind } : component) };
}

/** Removing a component also removes every connection that starts or ends at it, including self-loops. */
export function removeDiagramComponent(graph: SystemDesignGraph, id: string): SystemDesignGraph {
  return {
    components: graph.components.filter((component) => component.id !== id),
    connections: graph.connections.filter((connection) => connection.from !== id && connection.to !== id),
  };
}

/** A blank label is omitted rather than stored; both endpoints must already exist. */
export function connectDiagramComponents(graph: SystemDesignGraph, input: { from: string; to: string; label?: string }, generate: DiagramIdGenerator): SystemDesignGraph {
  if (graph.connections.length >= DIAGRAM_LIMITS.connections) return graph;
  if (!graph.components.some((component) => component.id === input.from) || !graph.components.some((component) => component.id === input.to)) return graph;
  const id = freshId("connection", graph.connections.map((connection) => connection.id), generate);
  if (id === undefined) return graph;
  const label = input.label?.trim();
  return { ...graph, connections: [...graph.connections, { id, from: input.from, to: input.to, ...(label ? { label } : {}) }] };
}

/** Keeps the label exactly as typed (including empty) so editing in place never drops the learner's spaces. */
export function relabelDiagramConnection(graph: SystemDesignGraph, id: string, label: string): SystemDesignGraph {
  return { ...graph, connections: graph.connections.map((connection) => connection.id === id ? { ...connection, label } : connection) };
}

export function disconnectDiagramConnection(graph: SystemDesignGraph, id: string): SystemDesignGraph {
  return { ...graph, connections: graph.connections.filter((connection) => connection.id !== id) };
}

/** Submission needs a valid, non-empty graph and a written explanation; failed structural checks never block it. */
export function canSubmitDiagram(graph: SystemDesignGraph, explanation: string): boolean {
  return validateSystemDesignGraph(graph) && graph.components.length > 0 && explanation.trim().length > 0;
}

export type DiagramSubmissionPreparation =
  | { ok: true; submission: SystemDesignSubmission; source: string }
  | { ok: false; reason: "incomplete" | "rejected"; message: string };

/**
 * Build the canonical submit-task payload. `incomplete` means the learner has more to do;
 * `rejected` carries the contract's own message (for example an over-long submission).
 */
export function prepareDiagramSubmission(spec: SystemDesignSpec, graph: SystemDesignGraph, explanation: string): DiagramSubmissionPreparation {
  if (!canSubmitDiagram(graph, explanation)) {
    return { ok: false, reason: "incomplete", message: "Give every component a name and explain your diagram before submitting." };
  }
  try {
    const submission = { ...createSystemDesignSubmission(spec, graph, explanation), kind: "diagram" as const };
    return { ok: true, submission, source: JSON.stringify(submission) };
  } catch (cause) {
    return { ok: false, reason: "rejected", message: cause instanceof Error ? cause.message : "This diagram could not be submitted. Shorten your labels or explanation and retry." };
  }
}

/** Draft records are stored per document, revision and node; the key format is the web storage format. */
export function diagramDraftKey(documentId: string, revision: number, nodeId: string): string {
  return JSON.stringify(["system-design", documentId, revision, nodeId]);
}

export interface DiagramDraftContent { graph: SystemDesignGraph; explanation: string }

/**
 * Restore graph data only; derived checks and Mermaid never come from a saved draft.
 * `extraKeys` lets a platform keep its own fields (the web draft also stores a pending submit intent).
 */
export function parseDiagramDraftContent(value: unknown, spec: SystemDesignSpec, extraKeys: readonly string[] = []): DiagramDraftContent | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, new Set(["version", "graph", "explanation", ...extraKeys])) || value.version !== 1) return undefined;
  const { graph, explanation } = value;
  if (!validateSystemDesignGraph(graph) || !diagramGraphUsesPalette(spec, graph)
    || typeof explanation !== "string" || explanation.length > DIAGRAM_LIMITS.explanation) return undefined;
  return { graph, explanation };
}
