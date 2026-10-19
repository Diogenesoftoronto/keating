/** Behavioural boundaries of the diagram contract, written against surviving mutants rather than line coverage. */
import { describe, expect, test } from "bun:test";
import {
  createSystemDesignSubmission, decodeSystemDesignLabel, decodeSystemDesignTextRuns, evaluateSystemDesignChecks, parseSystemDesignSubmission,
  systemDesignMermaid, validateSystemDesignGraph, validateSystemDesignSpec, type SystemDesignGraph, type SystemDesignSpec,
} from "../src/system-design.js";

const empty = { components: [], connections: [] };
const withComponent = (component: unknown) => ({ components: [component], connections: [] });
const specWith = (...checks: unknown[]) => ({ components: [], connections: [], checks });
const chain: SystemDesignGraph = {
  components: [{ id: "a", label: "A", kind: "client" }, { id: "b", label: "B", kind: "service" }, { id: "c", label: "C", kind: "database" }, { id: "d", label: "D", kind: "cache" }],
  connections: [{ id: "ab", from: "a", to: "b" }, { id: "bc", from: "b", to: "c", label: "SQL" }],
};

describe("graph shape rules apply independently of the rest of the graph", () => {
  test("component labels must be present, non-blank and within the bound", () => {
    for (const label of ["", " ", "\n\t ", "x".repeat(161), 5, null, undefined]) {
      expect(validateSystemDesignGraph(withComponent({ id: "n", label, kind: "service" }))).toBe(false);
    }
    expect(validateSystemDesignGraph(withComponent({ id: "n", label: "x".repeat(160), kind: "service" }))).toBe(true);
    expect(validateSystemDesignGraph(withComponent({ id: "n", label: " x ", kind: "service" }))).toBe(true);
  });

  test("components must be closed records with valid ids and kinds", () => {
    for (const component of [
      { id: "n", label: "N", kind: "service", extra: 1 }, { id: "1n", label: "N", kind: "service" }, { id: "n", label: "N", kind: "bad kind" },
      { id: "n", label: "N" }, { label: "N", kind: "service" }, { id: "n", kind: "service" }, "n", 4, null, [],
    ]) expect(validateSystemDesignGraph(withComponent(component))).toBe(false);
  });

  test("check labels cannot be blank but connection labels can", () => {
    expect(validateSystemDesignSpec(specWith({ id: "a", label: "", type: "component", kind: "cache" }))).toBe(false);
    expect(validateSystemDesignSpec(specWith({ id: "a", label: "  ", type: "path", fromKind: "client", toKind: "cache" }))).toBe(false);
    expect(validateSystemDesignSpec(specWith({ id: "a", label: "A", type: "component", kind: "cache" }))).toBe(true);
    const spec = { components: [{ id: "a", label: "A", kind: "client" }, { id: "b", label: "B", kind: "client" }], connections: [{ id: "e", from: "a", to: "b", label: "" }], checks: [] };
    expect(validateSystemDesignSpec(spec)).toBe(true);
  });

  test("a component check is a closed record with a valid kind", () => {
    const base = { id: "a", label: "A", type: "component", kind: "cache" };
    expect(validateSystemDesignSpec(specWith({ ...base, script: "evil" }))).toBe(false);
    expect(validateSystemDesignSpec(specWith({ ...base, fromKind: "client" }))).toBe(false);
    expect(validateSystemDesignSpec(specWith({ ...base, kind: "not valid" }))).toBe(false);
    expect(validateSystemDesignSpec(specWith({ id: "a", label: "A", type: "component" }))).toBe(false);
    expect(validateSystemDesignSpec(specWith(base))).toBe(true);
  });

  test("component minimums accept exactly the integers 1 through 40", () => {
    const check = (minimum: unknown) => specWith({ id: "a", label: "A", type: "component", kind: "cache", minimum });
    for (const minimum of [1, 2, 39, 40]) expect(validateSystemDesignSpec(check(minimum))).toBe(true);
    for (const minimum of [0, -1, 41, 1.5, NaN, Infinity, "2", null, undefined]) expect(validateSystemDesignSpec(check(minimum))).toBe(false);
  });

  test("link checks accept only the connection and path types with link fields", () => {
    const link = (type: string, extra: object = {}) => specWith({ id: "a", label: "A", type, fromKind: "client", toKind: "cache", ...extra });
    expect(validateSystemDesignSpec(link("connection"))).toBe(true);
    expect(validateSystemDesignSpec(link("path"))).toBe(true);
    for (const type of ["script", "component ", "", "Path", "reachability"]) expect(validateSystemDesignSpec(link(type))).toBe(false);
    expect(validateSystemDesignSpec(link("path", { kind: "cache" }))).toBe(false);
    expect(validateSystemDesignSpec(specWith({ id: "a", label: "A", type: "path", fromKind: "client" }))).toBe(false);
    expect(validateSystemDesignSpec(specWith({ id: "a", label: "A", type: "connection", toKind: "cache" }))).toBe(false);
  });

  test("checks must be an array, never an array-like or absent", () => {
    for (const checks of [{ length: 0 }, undefined, null, "", 0, { length: 1, 0: { id: "a", label: "A", type: "component", kind: "cache" } }]) {
      expect(validateSystemDesignSpec({ ...empty, checks })).toBe(false);
    }
    expect(validateSystemDesignSpec(empty)).toBe(false);
    expect(validateSystemDesignSpec({ ...empty, checks: [] })).toBe(true);
  });

  test("every palette entry must be a valid kind, not just one", () => {
    expect(validateSystemDesignSpec({ ...empty, checks: [], kinds: ["good", "1bad"] })).toBe(false);
    expect(validateSystemDesignSpec({ ...empty, checks: [], kinds: ["1bad", "good"] })).toBe(false);
    expect(validateSystemDesignSpec({ ...empty, checks: [], kinds: ["good", "also-good"] })).toBe(true);
    expect(validateSystemDesignSpec({ ...empty, checks: [], kinds: "good" })).toBe(false);
  });
});

describe("evaluation and submission guards", () => {
  const spec: SystemDesignSpec = { components: [], connections: [], checks: [{ id: "storage", label: "Storage", type: "component", kind: "database" }] };

  test("evaluation refuses an invalid spec, an invalid graph and an out-of-palette graph, each on its own", () => {
    const message = "Invalid diagram specification or graph categories.";
    expect(() => evaluateSystemDesignChecks({ ...spec, extra: true } as unknown as SystemDesignSpec, chain)).toThrow(message);
    expect(() => evaluateSystemDesignChecks({ ...spec, checks: [{ id: "bad", label: " ", type: "component", kind: "cache" }] }, chain)).toThrow(message);
    expect(() => evaluateSystemDesignChecks(spec, { ...chain, connections: [{ id: "x", from: "a", to: "ghost" }] })).toThrow(message);
    expect(() => evaluateSystemDesignChecks({ ...spec, kinds: ["client", "database"] }, chain)).toThrow(message);
    expect(evaluateSystemDesignChecks(spec, chain)).toHaveLength(1);
  });

  test("submission creation refuses the same inputs and non-string explanations", () => {
    const message = "Invalid diagram submission.";
    expect(() => createSystemDesignSubmission({ ...spec, extra: true } as unknown as SystemDesignSpec, chain, "x")).toThrow(message);
    expect(() => createSystemDesignSubmission(spec, { ...chain, connections: [{ id: "x", from: "a", to: "ghost" }] }, "x")).toThrow(message);
    expect(() => createSystemDesignSubmission({ ...spec, kinds: ["client", "database"] }, chain, "x")).toThrow(message);
    for (const explanation of [5, null, undefined, {}, ["x"]]) expect(() => createSystemDesignSubmission(spec, chain, explanation as unknown as string)).toThrow(message);
    expect(() => createSystemDesignSubmission(spec, chain, "x".repeat(8001))).toThrow(message);
    expect(createSystemDesignSubmission(spec, chain, "").explanation).toBe("");
  });

  test("an invalid graph cannot produce Mermaid", () => {
    expect(() => systemDesignMermaid({ ...chain, extra: 1 } as unknown as SystemDesignGraph)).toThrow("Invalid diagram graph.");
  });
});

describe("structural check results", () => {
  const spec: SystemDesignSpec = {
    components: [], connections: [],
    checks: [
      { id: "count", label: "Count", type: "component", kind: "service", minimum: 2 },
      { id: "default", label: "Default", type: "component", kind: "service" },
      { id: "edge", label: "Edge", type: "connection", fromKind: "service", toKind: "database" },
      { id: "missing-edge", label: "Missing edge", type: "connection", fromKind: "client", toKind: "database" },
      { id: "reach", label: "Reach", type: "path", fromKind: "client", toKind: "database" },
      { id: "unreachable", label: "Unreachable", type: "path", fromKind: "client", toKind: "cache" },
    ],
  };

  test("reports exact human-readable details for every check type and outcome", () => {
    const results = evaluateSystemDesignChecks(spec, chain);
    expect(results.map((result) => [result.id, result.label, result.passed, result.detail])).toEqual([
      ["count", "Count", false, "Found 1 service component(s); requires at least 2."],
      ["default", "Default", true, "Found 1 service component(s); requires at least 1."],
      ["edge", "Edge", true, "Found a directed connection from service to database."],
      ["missing-edge", "Missing edge", false, "Missing a directed connection from client to database."],
      ["reach", "Reach", true, "Found a directed path from client to database."],
      ["unreachable", "Unreachable", false, "Missing a directed path from client to cache."],
    ]);
  });

  test("a connection check passes when any one connection matches, not only when all do", () => {
    const mixed: SystemDesignGraph = { ...chain, connections: [...chain.connections, { id: "cd", from: "c", to: "d" }, { id: "da", from: "d", to: "a" }] };
    const results = evaluateSystemDesignChecks(spec, mixed);
    expect(results.find((result) => result.id === "edge")?.passed).toBe(true);
    expect(results.find((result) => result.id === "missing-edge")?.passed).toBe(false);
    const none = evaluateSystemDesignChecks(spec, { ...chain, connections: [{ id: "da", from: "d", to: "a" }] });
    expect(none.find((result) => result.id === "edge")?.passed).toBe(false);
  });

  test("paths follow direction and may traverse several hops", () => {
    const longPath: SystemDesignGraph = { components: [
      { id: "a", label: "A", kind: "client" }, { id: "b", label: "B", kind: "service" }, { id: "c", label: "C", kind: "queue" }, { id: "d", label: "D", kind: "database" },
    ], connections: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "c" }, { id: "e3", from: "c", to: "d" }] };
    const pathSpec: SystemDesignSpec = { components: [], connections: [], checks: [
      { id: "forward", label: "F", type: "path", fromKind: "client", toKind: "database" },
      { id: "backward", label: "B", type: "path", fromKind: "database", toKind: "client" },
    ] };
    expect(evaluateSystemDesignChecks(pathSpec, longPath).map((result) => result.passed)).toEqual([true, false]);
    const reversed = { ...longPath, connections: longPath.connections.map((edge) => ({ ...edge, from: edge.to, to: edge.from })) };
    expect(evaluateSystemDesignChecks(pathSpec, reversed).map((result) => result.passed)).toEqual([false, true]);
  });

  test("labelled and unlabelled edges render their exact arrows, aliased by position", () => {
    expect(systemDesignMermaid(chain)).toBe('flowchart LR\n  n0["A"]\n  n1["B"]\n  n2["C"]\n  n3["D"]\n  n0 --> n1\n  n1 -->|"SQL"| n2');
    expect(systemDesignMermaid({ ...chain, connections: [{ id: "x", from: "a", to: "b", label: "" }] })).toContain("  n0 --> n1");
  });
});

describe("submission size boundary", () => {
  const spec: SystemDesignSpec = { components: [], connections: [], checks: Array.from({ length: 24 }, (_, index) => ({
    id: `check${index}`.padEnd(64, "x"), label: "C".repeat(160), type: "component", kind: "load-balancer", minimum: 40,
  })) };
  /** `!` costs 3 extra characters once Mermaid escapes it; a quote costs 1 extra in the JSON explanation. */
  function build(bang: number, quotes: number): { graph: SystemDesignGraph; explanation: string } {
    let left = bang;
    const label = () => { const count = Math.min(left, 160); left -= count; return "!".repeat(count) + "A".repeat(160 - count); };
    const components = Array.from({ length: 40 }, (_, index) => ({ id: `node${index}`.padEnd(64, "x"), label: label(), kind: "load-balancer" as const }));
    const connections = Array.from({ length: 80 }, (_, index) => ({ id: `edge${index}`.padEnd(64, "x"), from: components[0]!.id, to: components[1]!.id, label: label() }));
    return { graph: { components, connections }, explanation: "A".repeat(8000 - quotes) + '"'.repeat(quotes) };
  }
  const measure = (bang: number, quotes: number) => {
    const { graph, explanation } = build(bang, quotes);
    return JSON.stringify({ schemaVersion: 1, kind: "system-design", graph, mermaid: systemDesignMermaid(graph), checks: evaluateSystemDesignChecks(spec, graph), explanation }).length;
  };

  test("a submission of exactly 131072 characters is accepted and 131073 is refused", () => {
    const base = measure(0, 0);
    const room = 131_072 - base;
    expect(room).toBeGreaterThan(0);
    const bang = Math.floor(room / 3);
    const quotes = room - bang * 3;
    expect(measure(bang, quotes)).toBe(131_072);
    const exact = build(bang, quotes);
    const submission = createSystemDesignSubmission(spec, exact.graph, exact.explanation);
    expect(JSON.stringify(submission)).toHaveLength(131_072);
    expect(parseSystemDesignSubmission(JSON.stringify(submission), spec)).toEqual(submission);
    const over = build(bang, quotes + 1);
    expect(measure(bang, quotes + 1)).toBe(131_073);
    expect(() => createSystemDesignSubmission(spec, over.graph, over.explanation)).toThrow("exceeds 131072 characters");
    expect(() => createSystemDesignSubmission(spec, over.graph, over.explanation)).toThrow("Shorten component labels");
  });
});

describe("submission parsing is defensive", () => {
  const spec: SystemDesignSpec = { components: [], connections: [], checks: [{ id: "storage", label: "Storage", type: "component", kind: "database" }] };
  const submission = createSystemDesignSubmission(spec, chain, "Reasoning");
  const json = JSON.stringify(submission);

  test("accepts whitespace-padded JSON up to the size bound and no further", () => {
    expect(parseSystemDesignSubmission(json + " ".repeat(131_072 - json.length), spec)).toEqual(submission);
    expect(parseSystemDesignSubmission(json + " ".repeat(131_073 - json.length), spec)).toBeUndefined();
  });

  test("rejects non-string sources and unusable specs without throwing", () => {
    expect(parseSystemDesignSubmission(new String(json) as unknown as string, spec)).toBeUndefined();
    expect(parseSystemDesignSubmission({ toString: () => json } as unknown as string, spec)).toBeUndefined();
    expect(parseSystemDesignSubmission(json, {} as unknown as SystemDesignSpec)).toBeUndefined();
    expect(parseSystemDesignSubmission(json, { ...spec, extra: true } as unknown as SystemDesignSpec)).toBeUndefined();
    expect(parseSystemDesignSubmission(json, spec)).toEqual(submission);
  });

  test("rejects a non-array checks field without throwing", () => {
    const candidate = (checks: unknown) => JSON.stringify({ ...submission, checks });
    expect(parseSystemDesignSubmission(candidate({ length: 1, 0: submission.checks[0] }), spec)).toBeUndefined();
    expect(parseSystemDesignSubmission(candidate({ length: 1 }), spec)).toBeUndefined();
    expect(parseSystemDesignSubmission(candidate(undefined), spec)).toBeUndefined();
    expect(parseSystemDesignSubmission(candidate(null), spec)).toBeUndefined();
    expect(parseSystemDesignSubmission(candidate("x"), spec)).toBeUndefined();
    expect(parseSystemDesignSubmission(JSON.stringify({ ...submission, mermaid: 7 }), spec)).toBeUndefined();
  });
});

describe("numeric entity decoding boundaries", () => {
  test("decodes the first supplementary code point and the last scalar value", () => {
    expect(decodeSystemDesignLabel("&#65535;")).toBe("&#65535;");
    expect(decodeSystemDesignLabel("&#65536;")).toBe("\u{10000}");
    expect(decodeSystemDesignLabel("&#65533;")).toBe("\u{FFFD}");
    expect(decodeSystemDesignLabel("&#1114111;")).toBe("\u{10FFFF}");
    expect(decodeSystemDesignLabel("&#1114112;")).toBe("&#1114112;");
  });

  test("an entity that stays literal keeps its original run boundaries", () => {
    expect(decodeSystemDesignTextRuns(["&#0", ";"])).toEqual(["&#0", ";"]);
    expect(decodeSystemDesignTextRuns(["&#5", "5296;", "x"])).toEqual(["&#5", "5296;", "x"]);
    expect(decodeSystemDesignTextRuns(["&#6", "0;"])).toEqual(["<", ""]);
  });
});
