import { describe, expect, test } from "bun:test";
import {
  DIAGRAM_KINDS, createDiagramSubmission, diagramMermaid, diagramSubmissionIsComplete, evaluateDiagramChecks,
  getDiagramKinds, parseDiagramSubmission, validateDiagramGraph, validateDiagramSpec, type DiagramGraph, type DiagramSpec,
} from "../src/diagram.js";
import {
  createSystemDesignSubmission, decodeSystemDesignLabel, decodeSystemDesignTextRuns, evaluateSystemDesignChecks, parseSystemDesignSubmission, systemDesignMermaid,
  validateSystemDesignGraph, validateSystemDesignSpec, systemDesignSubmissionIsComplete, type SystemDesignGraph, type SystemDesignSpec,
} from "../src/system-design.js";

const graph: SystemDesignGraph = {
  components: [
    { id: "client", label: "Browser", kind: "client" },
    { id: "api", label: "API", kind: "service" },
    { id: "db", label: "Database", kind: "database" },
    { id: "cache", label: "Cache", kind: "cache" },
  ],
  connections: [
    { id: "request", from: "client", to: "api", label: "HTTPS" },
    { id: "persist", from: "api", to: "db" },
    { id: "loop", from: "api", to: "client" },
  ],
};
const spec: SystemDesignSpec = {
  components: [], connections: [],
  checks: [
    { id: "storage", label: "Persistent storage", type: "component", kind: "database" },
    { id: "replicas", label: "Service replicas", type: "component", kind: "service", minimum: 2 },
    { id: "direct", label: "Direct client storage connection", type: "connection", fromKind: "client", toKind: "database" },
    { id: "route", label: "Client storage path", type: "path", fromKind: "client", toKind: "database" },
    { id: "reverse", label: "Reverse path", type: "path", fromKind: "database", toKind: "client" },
    { id: "isolated", label: "Cache path", type: "path", fromKind: "client", toKind: "cache" },
    { id: "cycle", label: "Client round trip", type: "path", fromKind: "client", toKind: "client" },
  ],
};

function copy<T>(value: T): T { return structuredClone(value); }

describe("system-design closed graph boundaries", () => {
  test("empty graphs and specs are valid", () => {
    expect(validateSystemDesignGraph({ components: [], connections: [] })).toBe(true);
    expect(validateSystemDesignSpec({ components: [], connections: [], checks: [] })).toBe(true);
    expect(systemDesignMermaid({ components: [], connections: [] })).toBe("flowchart LR");
    expect(evaluateSystemDesignChecks({ components: [], connections: [], checks: [] }, graph)).toEqual([]);
  });

  test("rejects duplicates, dangling edges, invalid ids, kinds and unknown fields", () => {
    const invalid: unknown[] = [
      { ...graph, components: [...graph.components, graph.components[0]] },
      { ...graph, connections: [...graph.connections, graph.connections[0]] },
      { ...graph, connections: [{ id: "missing", from: "client", to: "noSuchNode" }] },
      { ...graph, components: [{ id: "1bad", label: "A", kind: "client" }] },
      { ...graph, components: [{ id: "bad id", label: "A", kind: "client" }] },
      { ...graph, components: [{ id: "a".repeat(65), label: "A", kind: "client" }] },
      { ...graph, components: [{ id: "valid", label: "A", kind: "not a kind" }] },
      { ...graph, components: [{ id: "valid", label: " ", kind: "client" }] },
      { ...graph, components: [{ id: "valid", label: "A", kind: "client", click: "evil" }] },
      { ...graph, connections: [{ ...graph.connections[0], style: "evil" }] },
      { ...graph, extra: true },
      { components: Array(1), connections: [] },
      { components: [], connections: Array(1) },
      [], null,
    ];
    for (const candidate of invalid) expect(validateSystemDesignGraph(candidate)).toBe(false);
    expect(validateSystemDesignGraph(graph)).toBe(true);
  });

  test("enforces graph and label bounds inclusively", () => {
    const components = Array.from({ length: 40 }, (_, index) => ({ id: `node${index}`, label: "x".repeat(160), kind: "service" as const }));
    const connections = Array.from({ length: 80 }, (_, index) => ({ id: `edge${index}`, from: "node0", to: "node1", label: "x".repeat(160) }));
    expect(validateSystemDesignGraph({ components, connections })).toBe(true);
    expect(validateSystemDesignGraph({ components: [...components, { id: "overflow", label: "A", kind: "service" }], connections })).toBe(false);
    expect(validateSystemDesignGraph({ components, connections: [...connections, { id: "overflow", from: "node0", to: "node1" }] })).toBe(false);
    expect(validateSystemDesignGraph({ components: [{ id: "valid", kind: "service", label: "x".repeat(161) }], connections: [] })).toBe(false);
    expect(validateSystemDesignGraph({ components, connections: [{ id: "bad", from: "node0", to: "node1", label: "x".repeat(161) }] })).toBe(false);
    expect(validateSystemDesignGraph({ components, connections: [{ id: "empty", from: "node0", to: "node1", label: "" }] })).toBe(true);
  });

  test("rejects malformed, oversized and duplicate structural checks", () => {
    for (const check of [
      { id: "a", label: "A", type: "component", kind: "cache", minimum: 0 },
      { id: "a", label: "A", type: "component", kind: "cache", minimum: 1.5 },
      { id: "a", label: "A", type: "component", kind: "cache", minimum: 41 },
      { id: "a", label: "A", type: "component", kind: "cache", minimum: NaN },
      { id: "a", label: "A", type: "connection", fromKind: "service", toKind: "cache", minimum: 1 },
      { id: "a", label: "A", type: "path", fromKind: "unknown", toKind: "cache" },
      { id: "a", label: "A", type: "script", script: "evil" },
    ]) expect(validateSystemDesignSpec({ components: [], connections: [], checks: [check] })).toBe(false);
    const checks = Array.from({ length: 24 }, (_, index) => ({ id: `check${index}`, label: "A", type: "component" as const, kind: "cache" as const }));
    expect(validateSystemDesignSpec({ components: [], connections: [], checks })).toBe(true);
    expect(validateSystemDesignSpec({ components: [], connections: [], checks: [...checks, checks[0]] })).toBe(false);
    expect(validateSystemDesignSpec({ components: [], connections: [], checks: [checks[0], checks[0]] })).toBe(false);
    expect(validateSystemDesignSpec({ components: [], connections: [], checks: Array(1) })).toBe(false);
    expect(validateSystemDesignSpec({ ...spec, extra: true })).toBe(false);
  });
});

describe("structural checks and safe source", () => {
  test("distinguishes directed paths, direct edges, disconnected nodes and cycles", () => {
    expect(evaluateSystemDesignChecks(spec, graph).map((result) => result.passed)).toEqual([true, false, false, true, false, false, true]);
    const singleNode: SystemDesignGraph = { components: [{ id: "only", label: "Only client", kind: "client" }], connections: [] };
    expect(evaluateSystemDesignChecks(spec, singleNode).find((result) => result.id === "cycle")?.passed).toBe(false);
    const selfLoop = { ...singleNode, connections: [{ id: "self", from: "only", to: "only" }] };
    expect(evaluateSystemDesignChecks(spec, selfLoop).find((result) => result.id === "cycle")?.passed).toBe(true);
  });

  test("walks cycles without hanging when the destination is absent", () => {
    const noStorage = { ...graph, connections: graph.connections.filter((connection) => connection.to !== "db") };
    expect(evaluateSystemDesignChecks(spec, noStorage).find((result) => result.id === "route")?.passed).toBe(false);
  });

  test("labels cannot produce HTML, directives, click handlers or graph syntax", () => {
    const malicious = '\"]\nclick n0 "javascript:alert(1)"\n%%{init: {"securityLevel":"loose"}}%%\n<script>alert(1)</script>|😀';
    const hostile: SystemDesignGraph = {
      components: [{ id: "click", label: malicious, kind: "client" }, { id: "end", label: "end", kind: "database" }],
      connections: [{ id: "init", from: "click", to: "end", label: malicious }],
    };
    const source = systemDesignMermaid(hostile);
    expect(source.split("\n")).toHaveLength(4);
    expect(source).not.toContain("\nclick ");
    expect(source).not.toContain("%%{init");
    expect(source).not.toContain("<script>");
    expect(source).not.toContain("javascript:");
    expect(source).toContain("#34;");
    expect(source).toContain("#60;");
    expect(source).toContain("#128512;");
    expect(source).toContain('n0 -->|"');
    expect(source.endsWith('"| n1')).toBe(true);
    expect(systemDesignMermaid(hostile)).toBe(source);
  });
});


  test("plain label text stays readable and metacharacters are encoded", () => {
    const label = 'API server 123 [&<>{}()|%#;:"`\\\n\t]';
    const source = systemDesignMermaid({ components: [{ id: "node", label, kind: "service" }], connections: [] });
    const escaped = Array.from(label, (character) => /^[A-Za-z0-9 ]$/.test(character) ? character : `#${character.codePointAt(0)!};`).join("");
    expect(source).toBe(`flowchart LR\n  n0["${escaped}"]`);
    expect(source).toContain("API server 123 ");
    expect(source).toContain("#10;");
    expect(source).toContain("#9;");
  });

describe("trusted system-design submissions", () => {
  test("round-trips all evidence and snapshots the editable graph", () => {
    const draft = copy(graph);
    const submission = createSystemDesignSubmission(spec, draft, "Cache is currently isolated; I would add a read-through path.");
    expect(parseSystemDesignSubmission(JSON.stringify(submission), spec)).toEqual(submission);
    draft.components[0]!.label = "Changed after submitting";
    expect(submission.graph.components[0]!.label).toBe("Browser");
    expect(submission.checks[1]!.passed).toBe(false);
  });

  test("rejects forged check status, labels, details, ids, source, version and extra fields", () => {
    const submission = createSystemDesignSubmission(spec, graph, "Reasoning");
    const forged: unknown[] = [
      { ...submission, schemaVersion: 2 },
      { ...submission, kind: "quiz" },
      { ...submission, mermaid: submission.mermaid + "\nclick n0 callback" },
      { ...submission, grade: 100 },
      { ...submission, graph: { ...submission.graph, secret: true } },
      { ...submission, checks: [] },
    ];
    for (const property of ["passed", "label", "detail", "id"]) {
      const candidate = copy(submission);
      (candidate.checks[1] as unknown as Record<string, unknown>)[property] = property === "passed" ? true : "forged";
      forged.push(candidate);
    }
    const extra = copy(submission);
    Object.assign(extra.checks[0]!, { grade: 100 });
    forged.push(extra);
    for (const candidate of forged) expect(parseSystemDesignSubmission(JSON.stringify(candidate), spec)).toBeUndefined();
    expect(parseSystemDesignSubmission(JSON.stringify(submission), { ...spec, checks: [...spec.checks].reverse() })).toBeUndefined();
    expect(parseSystemDesignSubmission("not JSON", spec)).toBeUndefined();
    expect(parseSystemDesignSubmission("x".repeat(131_073), spec)).toBeUndefined();
  });

  test("accepts empty evidence and bounds explanations", () => {
    const empty = { components: [], connections: [], checks: [] };
    const submission = createSystemDesignSubmission(empty, { components: [], connections: [] }, "");
    expect(parseSystemDesignSubmission(JSON.stringify(submission), empty)).toEqual(submission);
    expect(createSystemDesignSubmission(spec, graph, "x".repeat(8_000)).explanation.length).toBe(8_000);
    expect(() => createSystemDesignSubmission(spec, graph, "x".repeat(8_001))).toThrow();
    expect(parseSystemDesignSubmission(JSON.stringify({ ...submission, explanation: "x".repeat(8_001) }), empty)).toBeUndefined();
    expect(() => systemDesignMermaid({ ...graph, connections: [{ id: "bad", from: "api", to: "missing" }] })).toThrow();
  });
});


describe("submission action boundary", () => {
  function maximumGraph(label: string): SystemDesignGraph {
    const components = Array.from({ length: 40 }, (_, index) => ({
      id: `node${index}`.padEnd(64, "x"), label, kind: "load-balancer" as const,
    }));
    const connections = Array.from({ length: 80 }, (_, index) => ({
      id: `edge${index}`.padEnd(64, "x"), from: components[0]!.id, to: components[1]!.id, label,
    }));
    return { components, connections };
  }
  const maximumSpec: SystemDesignSpec = { components: [], connections: [], checks: Array.from({ length: 24 }, (_, index) => ({
    id: `check${index}`.padEnd(64, "x"), label: "C".repeat(160), type: "component", kind: "load-balancer", minimum: 40,
  })) };

  test("maximal ordinary labels, ids, checks and reasoning fit the submit-task bound", () => {
    const graph = maximumGraph("A".repeat(160));
    const submission = createSystemDesignSubmission(maximumSpec, graph, "R".repeat(8_000));
    const json = JSON.stringify(submission);
    expect(json.length).toBeLessThanOrEqual(131_072);
    expect(parseSystemDesignSubmission(json, maximumSpec)).toEqual(submission);
    expect(systemDesignSubmissionIsComplete(json, maximumSpec)).toBe(true);
  });

  test("legal text with worst-case escaping clearly refuses oversized submissions", () => {
    const graph = maximumGraph("\u0000".repeat(160));
    expect(validateSystemDesignGraph(graph)).toBe(true);
    expect(() => createSystemDesignSubmission(maximumSpec, graph, "\u0000".repeat(8_000))).toThrow("exceeds 131072 characters");
    const oversized = { schemaVersion: 1, kind: "system-design", graph, mermaid: systemDesignMermaid(graph),
      checks: evaluateSystemDesignChecks(maximumSpec, graph), explanation: "\u0000".repeat(8_000) };
    expect(parseSystemDesignSubmission(JSON.stringify(oversized), maximumSpec)).toBeUndefined();
    expect(systemDesignSubmissionIsComplete(JSON.stringify(oversized), maximumSpec)).toBe(false);
  });

  test("completion requires a component and nonblank explanation, not passing checks", () => {
    const source = (graph: SystemDesignGraph, explanation: string) => JSON.stringify(createSystemDesignSubmission(spec, graph, explanation));
    expect(systemDesignSubmissionIsComplete(source(graph, "My reasoning"), spec)).toBe(true);
    expect(systemDesignSubmissionIsComplete(source(graph, "  \n\t"), spec)).toBe(false);
    expect(systemDesignSubmissionIsComplete(source({ components: [], connections: [] }, "Reasoning"), spec)).toBe(false);
    expect(systemDesignSubmissionIsComplete("not JSON", spec)).toBe(false);
  });
});


describe("Mermaid numeric entities in sanitized SVG text", () => {
  test("decodes decimal HTML entities once and leaves source syntax untouched", () => {
    expect(decodeSystemDesignLabel("GET &#47;short&#45;id")).toBe("GET /short-id");
    expect(decodeSystemDesignLabel("#60; &#60; &lt; &#x3c;")).toBe("#60; < &lt; &#x3c;");
    expect(decodeSystemDesignLabel("&#38;#60;")).toBe("&#60;");
    expect(decodeSystemDesignLabel("emoji &#128512; and quote &#34;")).toBe('emoji 😀 and quote "');
  });

  test("HTML-shaped labels remain ordinary string content for textContent", () => {
    const label = decodeSystemDesignLabel('&#60;script&#62;alert&#40;1&#41;&#60;&#47;script&#62;&#10;&#34;onclick&#61;&#34;');
    expect(label).toBe('<script>alert(1)</script>\n"onclick="');
    expect(typeof label).toBe("string");
    expect(decodeSystemDesignLabel("tab&#9;line&#10;return&#13;")).toBe("tab\tline\nreturn\r");
  });

  test("invalid Unicode values and XML-forbidden controls remain inert entities", () => {
    const invalid = "&#0; &#1; &#8; &#11; &#12; &#31; &#55296; &#57343; &#65534; &#65535; &#1114112; &#999999999999999999999999999999;";
    expect(decodeSystemDesignLabel(invalid)).toBe(invalid);
    expect(decodeSystemDesignLabel("valid endpoints &#32; &#55295; &#57344; &#65533; &#1114111;"))
      .toBe(`valid endpoints ${String.fromCodePoint(32)} ${String.fromCodePoint(55295)} ${String.fromCodePoint(57344)} ${String.fromCodePoint(65533)} ${String.fromCodePoint(1114111)}`);
  });
});


describe("Mermaid entities split across SVG text runs", () => {
  test("maps decoded entities to their starting runs and preserves empty runs", () => {
    const runs = ["before &", "", "#", "6", "0", ";after", ""];
    expect(decodeSystemDesignTextRuns(runs)).toEqual(["before <", "", "", "", "", "after", ""]);
    expect(decodeSystemDesignTextRuns(Array.from("&#60;"))).toEqual(["<", "", "", "", ""]);
    expect(decodeSystemDesignTextRuns([])).toEqual([]);
    expect(decodeSystemDesignTextRuns(["", "", ""])).toEqual(["", "", ""]);
  });

  test("handles several entities, adjacent boundaries and Unicode scalar text", () => {
    const runs = ["&", "#60;script&#", "62;alert(1&#4", "1;&#60;/script&#62;&#34;API&", "#34;&#38; cache ", "&#128", "512;"];
    const decoded = decodeSystemDesignTextRuns(runs);
    expect(decoded).toHaveLength(runs.length);
    expect(decoded.join("")).toBe('<script>alert(1)</script>"API"& cache 😀');
    expect(decoded[0]).toBe("<");
    expect(decoded[5]).toBe("😀");
    expect(decoded[6]).toBe("");
  });

  test("invalid, named and source entities remain literal with no recursive decoding", () => {
    const runs = ["&#", "0; &#55", "296; &#111411", "2; &lt; #60; &", "#38;#60; &#38;&#", "35;60&#59;"];
    const original = runs.join("");
    const decoded = decodeSystemDesignTextRuns(runs);
    expect(decoded.join("")).toBe("&#0; &#55296; &#1114112; &lt; #60; &#60; &#60;");
    expect(decoded.join("")).toBe(decodeSystemDesignLabel(original));
    expect(decodeSystemDesignTextRuns(["#", "60;", " &l", "t;"])).toEqual(["#", "60;", " &l", "t;"]);
  });

  test("every possible two-run split has the same joined text as one-pass decoding", () => {
    const text = 'A&#60;script&#62;B&#34;C&#38;#60;D&#128512;E&#0;F';
    const expected = decodeSystemDesignLabel(text);
    for (let split = 0; split <= text.length; split += 1) {
      const runs = [text.slice(0, split), "", text.slice(split)];
      const decoded = decodeSystemDesignTextRuns(runs);
      expect(decoded).toHaveLength(3);
      expect(decoded.join("")).toBe(expected);
    }
    expect(decodeSystemDesignTextRuns(Array.from(text)).join("")).toBe(expected);
  });
});


describe("domain-neutral diagrams and category palettes", () => {
  const biology: DiagramSpec = {
    kinds: ["organelle", "molecule", "reaction"],
    components: [], connections: [],
    checks: [
      { id: "reaction", label: "Include a reaction", type: "component", kind: "reaction" },
      { id: "flow", label: "Trace an organelle to a molecule", type: "path", fromKind: "organelle", toKind: "molecule" },
      { id: "direct", label: "Direct organelle molecule edge", type: "connection", fromKind: "organelle", toKind: "molecule" },
    ],
  };
  const graph: DiagramGraph = {
    components: [
      { id: "chloroplast", label: "Chloroplast", kind: "organelle" },
      { id: "photosynthesis", label: "Photosynthesis", kind: "reaction" },
      { id: "glucose", label: "Glucose", kind: "molecule" },
    ],
    connections: [
      { id: "site", from: "chloroplast", to: "photosynthesis", label: "site of" },
      { id: "product", from: "photosynthesis", to: "glucose", label: "produces" },
    ],
  };

  test("supports custom biology categories, directed paths and neutral submission readback", () => {
    expect(validateDiagramSpec(biology)).toBe(true);
    expect(validateDiagramGraph(graph)).toBe(true);
    expect(getDiagramKinds(biology)).toEqual(["organelle", "molecule", "reaction"]);
    expect(evaluateDiagramChecks(biology, graph).map((check) => check.passed)).toEqual([true, true, false]);
    const submission = createDiagramSubmission(biology, graph, "The process runs in the organelle and produces glucose.");
    expect(submission.kind).toBe("diagram");
    expect(submission.mermaid).toBe(diagramMermaid(graph));
    expect(parseDiagramSubmission(JSON.stringify(submission), biology)).toEqual(submission);
    expect(parseSystemDesignSubmission(JSON.stringify(submission), biology)).toEqual(submission);
    expect(diagramSubmissionIsComplete(JSON.stringify(submission), biology)).toBe(true);
    expect(evaluateDiagramChecks(biology, { ...graph, connections: graph.connections.map((edge) => ({ ...edge, from: edge.to, to: edge.from })) })[1]!.passed).toBe(false);
  });

  test("defaults cover generic learning and legacy system-design diagrams", () => {
    expect(getDiagramKinds(spec)).toBe(DIAGRAM_KINDS);
    for (const kind of ["concept", "step", "decision", "input", "output", "actor", "state", "service", "database"]) expect(DIAGRAM_KINDS).toContain(kind);
    const processSpec: DiagramSpec = { components: [], connections: [], checks: [
      { id: "route", label: "Input to output", type: "path", fromKind: "input", toKind: "output" },
    ] };
    const process: DiagramGraph = { components: [
      { id: "input", label: "Question", kind: "input" },
      { id: "step", label: "Reason through evidence", kind: "step" },
      { id: "output", label: "Answer", kind: "output" },
    ], connections: [
      { id: "a", from: "input", to: "step" }, { id: "b", from: "step", to: "output" },
    ] };
    expect(validateDiagramSpec(processSpec)).toBe(true);
    expect(evaluateDiagramChecks(processSpec, process)[0]!.passed).toBe(true);
    const legacy = createSystemDesignSubmission(spec, { components: [{ id: "a", label: "Client", kind: "client" }], connections: [] }, "Legacy reasoning");
    expect(legacy.kind).toBe("system-design");
    expect(parseDiagramSubmission(JSON.stringify(legacy), spec)).toEqual(legacy);
    expect(JSON.stringify(parseSystemDesignSubmission(JSON.stringify(legacy), spec))).toBe(JSON.stringify(legacy));
  });

  test("closed spec palettes reject undeclared graph and check categories", () => {
    const undeclared = { ...graph, components: [...graph.components, { id: "service", label: "Service", kind: "service" }] };
    expect(validateDiagramGraph(undeclared)).toBe(true);
    expect(() => createDiagramSubmission(biology, undeclared, "Reasoning")).toThrow();
    expect(() => evaluateDiagramChecks(biology, undeclared)).toThrow();
    expect(validateDiagramSpec({ ...biology, components: undeclared.components, connections: undeclared.connections })).toBe(false);
    expect(validateDiagramSpec({ ...biology, checks: [{ id: "a", label: "A", type: "component", kind: "service" }] })).toBe(false);
    expect(validateDiagramSpec({ ...biology, checks: [{ id: "a", label: "A", type: "path", fromKind: "organelle", toKind: "service" }] })).toBe(false);
    const forged = { schemaVersion: 1, kind: "diagram", graph: undeclared, mermaid: diagramMermaid(undeclared), checks: [], explanation: "Reasoning" };
    expect(parseDiagramSubmission(JSON.stringify(forged), { ...biology, checks: [] })).toBeUndefined();
    expect(validateDiagramSpec({ components: [{ id: "custom", label: "Custom", kind: "organelle" }], connections: [], checks: [] })).toBe(false);
  });

  test("palette names are bounded unique ids and empty starters need a nonempty palette", () => {
    const empty = { components: [], connections: [], checks: [] };
    expect(validateDiagramSpec({ ...empty, kinds: ["cell"] })).toBe(true);
    expect(createDiagramSubmission({ ...empty, kinds: ["cell"] }, { components: [], connections: [] }, "").graph.components).toEqual([]);
    const maximum = Array.from({ length: 32 }, (_, index) => `kind${index}`.padEnd(64, "x"));
    expect(validateDiagramSpec({ ...empty, kinds: maximum })).toBe(true);
    for (const kinds of [[], ["same", "same"], ["1bad"], ["bad kind"], ["x".repeat(65)], [...maximum, "overflow"], Array(1)]) {
      expect(validateDiagramSpec({ ...empty, kinds })).toBe(false);
    }
    expect(validateDiagramGraph({ components: [{ id: "valid", label: "Valid", kind: "x".repeat(65) }], connections: [] })).toBe(false);
    expect(validateDiagramGraph({ components: [{ id: "valid", label: "Valid", kind: "a".repeat(64) }], connections: [] })).toBe(true);
  });
});
