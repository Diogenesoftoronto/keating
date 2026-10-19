import { describe, expect, test } from "bun:test";
import {
  DIAGRAM_LIMITS, addDiagramComponent, canSubmitDiagram, connectDiagramComponents, copyDiagramGraph, diagramDraftKey,
  disconnectDiagramConnection, parseDiagramDraftContent, prepareDiagramSubmission, relabelDiagramConnection, removeDiagramComponent,
  renameDiagramComponent, sequentialDiagramId, setDiagramComponentKind, parseDiagramSubmission, validateDiagramGraph,
  type DiagramGraph, type DiagramSpec,
} from "../src/index.js";

const spec: DiagramSpec = {
  kinds: ["client", "service", "database"],
  components: [{ id: "web", label: "Web", kind: "client" }],
  connections: [],
  checks: [{ id: "store", label: "Has storage", type: "component", kind: "database" }],
};
const graph: DiagramGraph = {
  components: [{ id: "web", label: "Web", kind: "client" }, { id: "api", label: "API", kind: "service" }, { id: "db", label: "Store", kind: "database" }],
  connections: [{ id: "c1", from: "web", to: "api", label: "HTTPS" }, { id: "c2", from: "api", to: "db" }, { id: "c3", from: "api", to: "api" }],
};
const fixedId = (value: string) => () => value;

describe("diagram graph transitions", () => {
  test("never mutate their input", () => {
    const before = structuredClone(graph);
    addDiagramComponent(graph, { label: "Cache", kind: "service" }, sequentialDiagramId);
    renameDiagramComponent(graph, "web", "Browser");
    setDiagramComponentKind(graph, "web", "service");
    removeDiagramComponent(graph, "api");
    connectDiagramComponents(graph, { from: "web", to: "db" }, sequentialDiagramId);
    relabelDiagramConnection(graph, "c2", "SQL");
    disconnectDiagramConnection(graph, "c1");
    expect(graph).toEqual(before);
  });

  test("copyDiagramGraph returns an independent snapshot", () => {
    const copy = copyDiagramGraph(spec);
    copy.components[0]!.label = "Changed";
    expect(spec.components[0]!.label).toBe("Web");
    expect(copy.connections).toEqual([]);
  });

  test("adds a component with the injected id, in order, and respects the bound", () => {
    const next = addDiagramComponent(graph, { label: "Cache", kind: "service" }, fixedId("cache_1"));
    expect(next.components.map((component) => component.id)).toEqual(["web", "api", "db", "cache_1"]);
    expect(next.components[3]).toEqual({ id: "cache_1", label: "Cache", kind: "service" });
    expect(next.connections).toBe(graph.connections);
    const full: DiagramGraph = { components: Array.from({ length: DIAGRAM_LIMITS.components }, (_, index) => ({ id: `n${index}`, label: "N", kind: "service" })), connections: [] };
    expect(addDiagramComponent(full, { label: "Extra", kind: "service" }, sequentialDiagramId)).toBe(full);
    const almost: DiagramGraph = { ...full, components: full.components.slice(1) };
    expect(addDiagramComponent(almost, { label: "Extra", kind: "service" }, fixedId("extra")).components).toHaveLength(DIAGRAM_LIMITS.components);
  });

  test("passes the existing ids to the generator and refuses unusable or colliding ids", () => {
    const seen: Array<[string, readonly string[]]> = [];
    addDiagramComponent(graph, { label: "A", kind: "service" }, (prefix, existing) => { seen.push([prefix, existing]); return "fresh"; });
    connectDiagramComponents(graph, { from: "web", to: "db" }, (prefix, existing) => { seen.push([prefix, existing]); return "fresh2"; });
    expect(seen).toEqual([["component", ["web", "api", "db"]], ["connection", ["c1", "c2", "c3"]]]);
    for (const id of ["web", "1bad", "has space", "", "x".repeat(65)]) {
      expect(addDiagramComponent(graph, { label: "A", kind: "service" }, fixedId(id))).toBe(graph);
    }
    for (const id of ["c1", "1bad", ""]) {
      expect(connectDiagramComponents(graph, { from: "web", to: "db" }, fixedId(id))).toBe(graph);
    }
  });

  test("sequential ids skip ids already in use", () => {
    expect(sequentialDiagramId("component", [])).toBe("component-1");
    expect(sequentialDiagramId("component", ["component-1", "component-3"])).toBe("component-2");
    expect(sequentialDiagramId("connection", ["component-1"])).toBe("connection-1");
  });

  test("renames and recategorizes only the addressed component", () => {
    expect(renameDiagramComponent(graph, "api", "Gateway").components.map((component) => component.label)).toEqual(["Web", "Gateway", "Store"]);
    expect(setDiagramComponentKind(graph, "api", "database").components.map((component) => component.kind)).toEqual(["client", "database", "database"]);
    expect(renameDiagramComponent(graph, "missing", "X")).toEqual(graph);
  });

  test("removing a component removes incoming, outgoing and self-loop connections only", () => {
    const next = removeDiagramComponent(graph, "api");
    expect(next.components.map((component) => component.id)).toEqual(["web", "db"]);
    expect(next.connections).toEqual([]);
    const other = removeDiagramComponent({ ...graph, connections: [...graph.connections, { id: "keep", from: "web", to: "db" }] }, "api");
    expect(other.connections).toEqual([{ id: "keep", from: "web", to: "db" }]);
    expect(validateDiagramGraph(next)).toBe(true);
  });

  test("connects existing components, trims labels, omits blank ones and respects the bound", () => {
    const labelled = connectDiagramComponents(graph, { from: "web", to: "db", label: "  reads  " }, fixedId("c4"));
    expect(labelled.connections.at(-1)).toEqual({ id: "c4", from: "web", to: "db", label: "reads" });
    const blank = connectDiagramComponents(graph, { from: "web", to: "db", label: "   " }, fixedId("c4"));
    expect(blank.connections.at(-1)).toEqual({ id: "c4", from: "web", to: "db" });
    expect(Object.hasOwn(blank.connections.at(-1)!, "label")).toBe(false);
    expect(connectDiagramComponents(graph, { from: "web", to: "ghost" }, fixedId("c4"))).toBe(graph);
    expect(connectDiagramComponents(graph, { from: "ghost", to: "web" }, fixedId("c4"))).toBe(graph);
    const full: DiagramGraph = { ...graph, connections: Array.from({ length: DIAGRAM_LIMITS.connections }, (_, index) => ({ id: `e${index}`, from: "web", to: "api" })) };
    expect(connectDiagramComponents(full, { from: "web", to: "api" }, sequentialDiagramId)).toBe(full);
    expect(connectDiagramComponents({ ...full, connections: full.connections.slice(1) }, { from: "web", to: "api" }, fixedId("last")).connections).toHaveLength(DIAGRAM_LIMITS.connections);
  });

  test("relabels without trimming and disconnects by id", () => {
    expect(relabelDiagramConnection(graph, "c2", "SQL ").connections[1]).toEqual({ id: "c2", from: "api", to: "db", label: "SQL " });
    expect(relabelDiagramConnection(graph, "c1", "").connections[0]!.label).toBe("");
    expect(validateDiagramGraph(relabelDiagramConnection(graph, "c1", ""))).toBe(true);
    expect(disconnectDiagramConnection(graph, "c2").connections.map((connection) => connection.id)).toEqual(["c1", "c3"]);
  });
});

describe("diagram submission preparation", () => {
  test("requires a valid non-empty graph and a written explanation", () => {
    expect(canSubmitDiagram(graph, "Because")).toBe(true);
    expect(canSubmitDiagram(graph, "  \n")).toBe(false);
    expect(canSubmitDiagram({ components: [], connections: [] }, "Because")).toBe(false);
    expect(canSubmitDiagram(renameDiagramComponent(graph, "web", " "), "Because")).toBe(false);
  });

  test("prepares a parseable diagram submission whose source round-trips", () => {
    const prepared = prepareDiagramSubmission(spec, graph, "I would add a cache.");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.submission.kind).toBe("diagram");
    expect(prepared.source).toBe(JSON.stringify(prepared.submission));
    expect(parseDiagramSubmission(prepared.source, spec)).toEqual(prepared.submission);
  });

  test("separates unfinished work from contract rejections", () => {
    expect(prepareDiagramSubmission(spec, graph, "")).toMatchObject({ ok: false, reason: "incomplete" });
    expect(prepareDiagramSubmission(spec, { components: [], connections: [] }, "x")).toMatchObject({ ok: false, reason: "incomplete" });
    const outsidePalette = addDiagramComponent(graph, { label: "Queue", kind: "queue" }, fixedId("q"));
    expect(prepareDiagramSubmission(spec, outsidePalette, "x")).toMatchObject({ ok: false, reason: "rejected", message: "Invalid diagram submission." });
    const tooLong = prepareDiagramSubmission(spec, graph, "x".repeat(DIAGRAM_LIMITS.explanation + 1));
    expect(tooLong.ok).toBe(false);
  });
});

describe("diagram drafts", () => {
  test("keys are scoped by document, revision and node with the established web format", () => {
    expect(diagramDraftKey("doc", 2, "node")).toBe('["system-design","doc",2,"node"]');
    expect(diagramDraftKey("a:b", 1, "c")).not.toBe(diagramDraftKey("a", 1, "b:c"));
  });

  test("restores graph and explanation only, rejecting stale or tampered records", () => {
    const record = { version: 1, graph, explanation: "Because" };
    const outside = { ...graph, components: [...graph.components, { id: "q", label: "Queue", kind: "queue" }] };
    expect(parseDiagramDraftContent(record, spec)).toEqual({ graph, explanation: "Because" });
    expect(parseDiagramDraftContent({ ...record, version: 2 }, spec)).toBeUndefined();
    expect(parseDiagramDraftContent({ ...record, extra: 1 }, spec)).toBeUndefined();
    expect(parseDiagramDraftContent({ ...record, pending: {} }, spec)).toBeUndefined();
    expect(parseDiagramDraftContent({ ...record, pending: {} }, spec, ["pending"])).toEqual({ graph, explanation: "Because" });
    expect(parseDiagramDraftContent({ ...record, graph: outside }, spec)).toBeUndefined();
    expect(parseDiagramDraftContent({ ...record, graph: { components: [], connections: [{ id: "x", from: "a", to: "b" }] } }, spec)).toBeUndefined();
    expect(parseDiagramDraftContent({ ...record, explanation: "x".repeat(8001) }, spec)).toBeUndefined();
    expect(parseDiagramDraftContent({ ...record, explanation: "x".repeat(8000) }, spec)?.explanation).toHaveLength(8000);
    expect(parseDiagramDraftContent({ ...record, explanation: 3 }, spec)).toBeUndefined();
    for (const bad of [null, [], "x", 3]) expect(parseDiagramDraftContent(bad, spec)).toBeUndefined();
  });
});
