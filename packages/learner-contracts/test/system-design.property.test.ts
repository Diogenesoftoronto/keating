/** Generated checks for the diagram graph, spec, Mermaid and submission contracts. */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  DIAGRAM_LIMITS, addDiagramComponent, connectDiagramComponents, createDiagramSubmission, createSystemDesignSubmission,
  decodeSystemDesignLabel, decodeSystemDesignTextRuns, diagramMermaid, disconnectDiagramConnection, evaluateDiagramChecks,
  parseDiagramSubmission, relabelDiagramConnection, removeDiagramComponent, renameDiagramComponent, sequentialDiagramId,
  setDiagramComponentKind, systemDesignMermaid, validateDiagramGraph, validateDiagramSpec,
  type DiagramCheck, type DiagramGraph, type DiagramSpec,
} from "../src/index.js";

const KINDS = ["input", "step", "output", "state"] as const;
const RUNS = { numRuns: 150 };

const idArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,11}$/);
// Hostile text on purpose: Mermaid syntax, HTML, quotes, newlines, emoji and entity look-alikes.
const labelArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 24 }),
  fc.constantFrom('"]\nclick n0 "javascript:alert(1)"', "<script>alert(1)</script>", "%%{init: {}}%%", "a|b[c]{d}(e)", "&#60; #60; &lt;", "😀 é ñ", "end", "A  B"),
).filter((label) => label.trim().length > 0);
const kindArb = fc.constantFrom(...KINDS);

const graphArb: fc.Arbitrary<DiagramGraph> = fc.uniqueArray(idArb, { minLength: 1, maxLength: 8 }).chain((ids) => fc.record({
  components: fc.tuple(...ids.map((id) => fc.record({ id: fc.constant(id), label: labelArb, kind: kindArb }))),
  connections: fc.array(fc.record({ from: fc.constantFrom(...ids), to: fc.constantFrom(...ids), label: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }) }), { maxLength: 12 }),
})).map(({ components, connections }) => ({
  components,
  connections: connections.map(({ label, ...edge }, index) => ({ id: `e${index}`, ...edge, ...(label === undefined ? {} : { label }) })),
}));

const checkArb: fc.Arbitrary<Omit<DiagramCheck, "id">> = fc.oneof(
  fc.record({ label: labelArb, type: fc.constant("component" as const), kind: kindArb, minimum: fc.option(fc.integer({ min: 1, max: DIAGRAM_LIMITS.components }), { nil: undefined }) })
    .map(({ minimum, ...rest }) => ({ ...rest, ...(minimum === undefined ? {} : { minimum }) })),
  fc.record({ label: labelArb, type: fc.constantFrom("connection" as const, "path" as const), fromKind: kindArb, toKind: kindArb }),
);
const specArb: fc.Arbitrary<DiagramSpec> = fc.record({
  graph: graphArb,
  checks: fc.array(checkArb, { maxLength: 8 }),
  withPalette: fc.boolean(),
}).map(({ graph, checks, withPalette }) => ({
  ...graph,
  checks: checks.map((check, index) => ({ id: `k${index}`, ...check }) as DiagramCheck),
  ...(withPalette ? { kinds: [...KINDS] } : {}),
}));

const clone = <T,>(value: T): T => structuredClone(value);
const rejected = (value: unknown) => validateDiagramSpec(value) === false;

describe("generated diagram specs and graphs", () => {
  test("every generated spec and graph is accepted", () => {
    fc.assert(fc.property(specArb, (spec) => {
      expect(validateDiagramSpec(spec)).toBe(true);
      expect(validateDiagramGraph({ components: spec.components, connections: spec.connections })).toBe(true);
    }), RUNS);
  });

  test("targeted corruptions of an accepted spec are rejected", () => {
    fc.assert(fc.property(specArb, fc.nat(), (spec, pick) => {
      const edge = spec.connections.length ? pick % spec.connections.length : -1;
      const component = pick % spec.components.length;
      const cases: unknown[] = [];
      const corrupt = (mutate: (draft: any) => void) => { const draft = clone(spec) as any; mutate(draft); cases.push(draft); };
      corrupt((d) => { d.connections.push({ id: "dangling", from: d.components[0].id, to: "noSuchNode" }); });
      corrupt((d) => { d.connections.push({ id: "dangling", from: "noSuchNode", to: d.components[0].id }); });
      corrupt((d) => { d.components.push({ ...d.components[component] }); });
      corrupt((d) => { d.components[component].label = " \t"; });
      corrupt((d) => { d.components[component].label = ""; });
      corrupt((d) => { d.components[component].label = "x".repeat(DIAGRAM_LIMITS.label + 1); });
      corrupt((d) => { d.components[component].id = `${d.components[component].id} bad`; d.connections = []; });
      corrupt((d) => { d.components[component].kind = "1bad"; });
      corrupt((d) => { d.components[component].click = "evil"; });
      corrupt((d) => { d.extra = true; });
      corrupt((d) => { d.checks.push({ id: "extra-check", label: "x", type: "component", kind: "input", script: "evil" }); });
      corrupt((d) => { d.checks.push({ id: "bad-min", label: "x", type: "component", kind: "input", minimum: 0 }); });
      corrupt((d) => { d.checks.push({ id: "bad-min", label: "x", type: "component", kind: "input", minimum: 1.5 }); });
      corrupt((d) => { d.checks.push({ id: "bad-min", label: "x", type: "component", kind: "input", minimum: DIAGRAM_LIMITS.components + 1 }); });
      corrupt((d) => { d.checks.push({ id: "bad-min", label: "x", type: "component", kind: "input", minimum: "2" }); });
      corrupt((d) => { d.checks.push({ id: "blank", label: " ", type: "component", kind: "input" }); });
      corrupt((d) => { d.checks.push({ id: "bad-type", label: "x", type: "script", fromKind: "input", toKind: "output" }); });
      corrupt((d) => { d.checks.push({ id: "undeclared", label: "x", type: "path", fromKind: "input", toKind: "not-a-kind-in-any-palette" }); d.kinds = [...KINDS]; });
      corrupt((d) => { d.checks.push(clone(d.checks[0] ?? { id: "dup", label: "x", type: "component", kind: "input" })); if (!d.checks.length || d.checks.length === 1) d.checks.push(clone(d.checks[0])); });
      if (edge >= 0) {
        corrupt((d) => { d.connections.push({ ...d.connections[edge] }); });
        corrupt((d) => { d.connections[edge].label = "x".repeat(DIAGRAM_LIMITS.label + 1); });
        corrupt((d) => { d.connections[edge].style = "evil"; });
      }
      for (const candidate of cases) expect(rejected(candidate)).toBe(true);
      expect(validateDiagramSpec(spec)).toBe(true);
    }), RUNS);
  });

  test("component, connection and check counts are bounded inclusively", () => {
    const components = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `n${index}`, label: "N", kind: "step" }));
    const connections = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `e${index}`, from: "n0", to: "n1" }));
    const checks = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `k${index}`, label: "K", type: "component", kind: "step" }));
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 120 }), fc.integer({ min: 0, max: 40 }), (nodeCount, edgeCount, checkCount) => {
      const spec = { components: components(Math.max(nodeCount, 2)), connections: connections(edgeCount), checks: checks(checkCount) };
      const within = Math.max(nodeCount, 2) <= DIAGRAM_LIMITS.components && edgeCount <= DIAGRAM_LIMITS.connections && checkCount <= 24;
      expect(validateDiagramSpec(spec)).toBe(within);
    }), { numRuns: 300 });
  });

  test("component minimum accepts exactly the integers 1 through the component limit", () => {
    fc.assert(fc.property(fc.oneof(fc.integer({ min: -5, max: 50 }), fc.double({ noNaN: false })), (minimum) => {
      const spec = { components: [], connections: [], checks: [{ id: "a", label: "A", type: "component", kind: "step", minimum }] };
      expect(validateDiagramSpec(spec)).toBe(Number.isInteger(minimum) && minimum >= 1 && minimum <= DIAGRAM_LIMITS.components);
    }), { numRuns: 300 });
  });
});

describe("generated Mermaid source", () => {
  const COMPONENT_LINE = /^ {2}n\d+\["[A-Za-z0-9 #;]*"\]$/;
  const EDGE_LINE = /^ {2}n\d+(?: --> | -->\|"[A-Za-z0-9 #;]*"\| )n\d+$/;
  const decodeEntities = (escaped: string) => escaped.replace(/#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)));

  test("is deterministic and every line is one safe statement", () => {
    fc.assert(fc.property(graphArb, (graph) => {
      const source = diagramMermaid(graph);
      expect(diagramMermaid(clone(graph))).toBe(source);
      expect(systemDesignMermaid(graph)).toBe(source);
      const lines = source.split("\n");
      expect(lines).toHaveLength(1 + graph.components.length + graph.connections.length);
      expect(lines[0]).toBe("flowchart LR");
      lines.slice(1, 1 + graph.components.length).forEach((line) => expect(line).toMatch(COMPONENT_LINE));
      lines.slice(1 + graph.components.length).forEach((line) => expect(line).toMatch(EDGE_LINE));
    }), RUNS);
  });

  test("escaping is lossless: decoding entities restores each label exactly", () => {
    fc.assert(fc.property(graphArb, (graph) => {
      const lines = diagramMermaid(graph).split("\n").slice(1);
      graph.components.forEach((component, index) => {
        const escaped = /^ {2}n\d+\["(.*)"\]$/.exec(lines[index]!)![1]!;
        expect(decodeEntities(escaped)).toBe(component.label);
      });
      graph.connections.forEach((connection, index) => {
        const line = lines[graph.components.length + index]!;
        const labelled = /-->\|"(.*)"\|/.exec(line);
        expect(labelled ? decodeEntities(labelled[1]!) : undefined).toBe(connection.label ? connection.label : undefined);
      });
    }), RUNS);
  });
});

describe("generated structural checks", () => {
  const link = (spec: DiagramSpec, type: "connection" | "path"): DiagramSpec => ({
    ...spec, checks: KINDS.flatMap((fromKind) => KINDS.map((toKind, index) => ({ id: `${type}-${fromKind}-${index}`, label: "L", type, fromKind, toKind }))),
    kinds: [...KINDS],
  });

  test("adding an edge never turns a satisfied connection or path check into an unsatisfied one", () => {
    fc.assert(fc.property(specArb, fc.nat(), fc.nat(), (spec, a, b) => {
      for (const type of ["connection", "path"] as const) {
        const checkSpec = link(spec, type);
        const graph: DiagramGraph = { components: spec.components, connections: spec.connections };
        const before = evaluateDiagramChecks(checkSpec, graph);
        const extended: DiagramGraph = { ...graph, connections: [...graph.connections, { id: "added", from: graph.components[a % graph.components.length]!.id, to: graph.components[b % graph.components.length]!.id }] };
        const after = evaluateDiagramChecks(checkSpec, extended);
        before.forEach((result, index) => { if (result.passed) expect(after[index]!.passed).toBe(true); });
      }
    }), RUNS);
  });

  test("a direct connection always satisfies the matching path check", () => {
    fc.assert(fc.property(specArb, (spec) => {
      // Three kinds keep both families within the 24-check bound.
      const pick = (type: "connection" | "path") => link(spec, type).checks.filter((check) => check.type !== "component" && check.fromKind !== "state" && check.toKind !== "state");
      const both = [...pick("connection"), ...pick("path").map((check) => ({ ...check, id: `p${check.id}` }))];
      const results = evaluateDiagramChecks({ ...spec, checks: both, kinds: [...KINDS] }, { components: spec.components, connections: spec.connections });
      const half = both.length / 2;
      for (let index = 0; index < half; index += 1) if (results[index]!.passed) expect(results[half + index]!.passed).toBe(true);
    }), RUNS);
  });

  test("component counts match a direct tally", () => {
    fc.assert(fc.property(specArb, (spec) => {
      const checkSpec: DiagramSpec = { ...spec, kinds: [...KINDS], checks: KINDS.map((kind) => ({ id: kind, label: kind, type: "component", kind, minimum: 2 })) };
      const results = evaluateDiagramChecks(checkSpec, { components: spec.components, connections: spec.connections });
      KINDS.forEach((kind, index) => expect(results[index]!.passed).toBe(spec.components.filter((component) => component.kind === kind).length >= 2));
    }), RUNS);
  });
});

describe("generated submissions", () => {
  const explanationArb = fc.string({ maxLength: 300 });

  test("serialize then parse recovers the identical submission, for both kinds", () => {
    fc.assert(fc.property(specArb, graphArb, explanationArb, (spec, graph, explanation) => {
      const checkSpec: DiagramSpec = { ...spec, kinds: [...KINDS] };
      const diagram = createDiagramSubmission(checkSpec, graph, explanation);
      expect(parseDiagramSubmission(JSON.stringify(diagram), checkSpec)).toEqual(diagram);
      const legacy = createSystemDesignSubmission(checkSpec, graph, explanation);
      expect(legacy.kind).toBe("system-design");
      expect(parseDiagramSubmission(JSON.stringify(legacy), checkSpec)).toEqual(legacy);
      expect(diagram.checks).toEqual(legacy.checks);
      expect(diagram.mermaid).toBe(diagramMermaid(graph));
    }), RUNS);
  });

  test("a tampered derived field is never accepted", () => {
    fc.assert(fc.property(specArb, graphArb, (spec, graph) => {
      const checkSpec: DiagramSpec = { ...spec, kinds: [...KINDS] };
      const submission = createDiagramSubmission(checkSpec, graph, "Reasoning");
      const tamperings = [
        { ...submission, mermaid: `${submission.mermaid}\n  n0 --> n0` },
        { ...submission, schemaVersion: 2 },
        { ...submission, grade: 100 },
        { ...submission, graph: { ...submission.graph, secret: true } },
        ...submission.checks.map((check, index) => ({ ...submission, checks: submission.checks.map((item, at) => at === index ? { ...item, passed: !item.passed } : item) })),
      ];
      for (const candidate of tamperings) expect(parseDiagramSubmission(JSON.stringify(candidate), checkSpec)).toBeUndefined();
    }), RUNS);
  });
});

describe("generated graph edits", () => {
  type Edit = { op: "add" | "rename" | "kind" | "remove" | "connect" | "relabel" | "disconnect"; a: number; b: number; text: string };
  const editArb: fc.Arbitrary<Edit> = fc.record({
    op: fc.constantFrom("add", "rename", "kind", "remove", "connect", "relabel", "disconnect"),
    a: fc.nat(), b: fc.nat(), text: labelArb,
  });

  function apply(graph: DiagramGraph, edit: Edit): DiagramGraph {
    const component = graph.components.length ? graph.components[edit.a % graph.components.length]! : undefined;
    const target = graph.components.length ? graph.components[edit.b % graph.components.length]! : undefined;
    const connection = graph.connections.length ? graph.connections[edit.a % graph.connections.length]! : undefined;
    switch (edit.op) {
      case "add": return addDiagramComponent(graph, { label: edit.text, kind: KINDS[edit.b % KINDS.length]! }, sequentialDiagramId);
      case "rename": return component ? renameDiagramComponent(graph, component.id, edit.text) : graph;
      case "kind": return component ? setDiagramComponentKind(graph, component.id, KINDS[edit.b % KINDS.length]!) : graph;
      case "remove": return component ? removeDiagramComponent(graph, component.id) : graph;
      case "connect": return component && target ? connectDiagramComponents(graph, { from: component.id, to: target.id, label: edit.text }, sequentialDiagramId) : graph;
      case "relabel": return connection ? relabelDiagramConnection(graph, connection.id, edit.text) : graph;
      case "disconnect": return connection ? disconnectDiagramConnection(graph, connection.id) : graph;
    }
  }

  test("any sequence of valid edits keeps the graph valid and within bounds", () => {
    fc.assert(fc.property(graphArb, fc.array(editArb, { maxLength: 40 }), (start, edits) => {
      let graph = start;
      for (const edit of edits) {
        const before = clone(graph);
        graph = apply(graph, edit);
        expect(validateDiagramGraph(graph)).toBe(true);
        expect(graph.components.length).toBeLessThanOrEqual(DIAGRAM_LIMITS.components);
        expect(graph.connections.length).toBeLessThanOrEqual(DIAGRAM_LIMITS.connections);
        expect(before).toEqual(clone(before));
      }
    }), RUNS);
  });

  test("removing a component leaves no incident connection and no other component", () => {
    fc.assert(fc.property(graphArb, fc.nat(), (graph, pick) => {
      const id = graph.components[pick % graph.components.length]!.id;
      const next = removeDiagramComponent(graph, id);
      expect(next.components.map((item) => item.id)).toEqual(graph.components.filter((item) => item.id !== id).map((item) => item.id));
      expect(next.connections.some((edge) => edge.from === id || edge.to === id)).toBe(false);
      expect(next.connections).toEqual(graph.connections.filter((edge) => edge.from !== id && edge.to !== id));
    }), RUNS);
  });
});

describe("generated SVG text runs", () => {
  const fragmentArb = fc.constantFrom("&", "#", "6", "0", ";", "&#60;", "&#38;", "&#0;", "&#128512;", "x", " ", "&lt;", "&#55296;", "&#");

  test("splitting text into runs never changes the decoded text or the run count", () => {
    fc.assert(fc.property(fc.array(fragmentArb, { maxLength: 12 }), fc.array(fc.nat(), { maxLength: 6 }), (fragments, cuts) => {
      const text = fragments.join("");
      const points = [...new Set(cuts.map((cut) => cut % (text.length + 1)))].sort((a, b) => a - b);
      const runs = points.length ? [text.slice(0, points[0]!), ...points.map((point, index) => text.slice(point, points[index + 1] ?? text.length))] : [text];
      const decoded = decodeSystemDesignTextRuns(runs);
      expect(decoded).toHaveLength(runs.length);
      expect(decoded.join("")).toBe(decodeSystemDesignLabel(text));
    }), { numRuns: 300 });
  });
});
