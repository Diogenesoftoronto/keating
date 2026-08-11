import { describe, expect, test } from "bun:test";
import { MERMAID_PARITY_FIXTURES, WEB_MERMAID_GRAMMARS } from "@keating/learner-contracts";
import { MAX_MERMAID_SOURCE_LENGTH, validateLocalMermaidSource } from "../src/lib/local-rich-renderer";
import { parseMermaidFlowchart } from "../src/lib/mermaid-native";

describe("native Mermaid flowchart boundary", () => {
  test("parses common Keating graph syntax into deterministic levels", () => {
    expect(parseMermaidFlowchart("graph TD; A[Known idea] --> B[Bridge]; B -->|test| C{Transfer}")) .toEqual({
      direction: "TD",
      nodes: [
        { id: "A", label: "Known idea", level: 0 },
        { id: "B", label: "Bridge", level: 1 },
        { id: "C", label: "Transfer", level: 2 },
      ],
      edges: [{ from: "A", to: "B" }, { from: "B", to: "C", label: "test" }],
    });
  });

  test("fails closed for executable or unsupported Mermaid directives", () => {
    expect(parseMermaidFlowchart("graph TD; click A javascript:alert(1)")).toBeNull();
    expect(parseMermaidFlowchart("sequenceDiagram\nA->>B: hello")).toBeNull();
  });

  test("renders Keating visual directives and subgraphs without executing them", () => {
    const graph = parseMermaidFlowchart(`graph RL
      classDef concept fill:#047857,color:#fff
      subgraph meaning["Meaning Map"]
        learner(("Learner state")) --> core["Core<br/>concept"]
      end
      style core fill:#047857,color:#fff`);
    expect(graph?.direction).toBe("RL");
    expect(graph?.nodes).toEqual([
      { id: "learner", label: "Learner state", level: 0 },
      { id: "core", label: "Core concept", level: 1 },
    ]);
    expect(graph?.edges).toEqual([{ from: "learner", to: "core" }]);
    expect(parseMermaidFlowchart("flowchart BT; A --> B")?.direction).toBe("BT");
  });

  test("accepts Keating's generated graph alias and harmless leading comments", () => {
    expect(validateLocalMermaidSource("graph TD; A --> B")).toMatchObject({ ok: true, kind: "flowchart" });
    expect(validateLocalMermaidSource("%% learner map\nflowchart LR\nA --> B")).toMatchObject({ ok: true, kind: "flowchart" });
  });

  for (const fixture of MERMAID_PARITY_FIXTURES) {
    test(`prevalidates the ${fixture.grammar} parity fixture for local rendering`, () => {
      expect(validateLocalMermaidSource(fixture.source)).toEqual({ ok: true, source: fixture.source, kind: fixture.grammar });
    });
  }

  test("covers every registered web grammar exactly once", () => {
    expect(MERMAID_PARITY_FIXTURES.map((fixture) => fixture.grammar)).toEqual([...WEB_MERMAID_GRAMMARS]);
  });

  test("rejects navigation, directives, HTML, imports, controls, and oversized work", () => {
    const malicious = [
      "flowchart LR\n  A --> B\n  click B https://example.com",
      "sequenceDiagram\n%%{init: {securityLevel: 'loose'}}%%\nA->>B: unsafe",
      "classDiagram\n  class A<script>alert(1)</script>",
      "stateDiagram-v2\n  import remote",
      "erDiagram\n  A ||--|| B : href",
      "pie title unsafe\n  \"A\u0000B\" : 1",
    ];
    for (const source of malicious) expect(validateLocalMermaidSource(source).ok).toBe(false);
    expect(validateLocalMermaidSource(`flowchart LR\n${"A --> B\n".repeat(800)}`).ok).toBe(false);
    expect(validateLocalMermaidSource(`flowchart LR\n${"A".repeat(MAX_MERMAID_SOURCE_LENGTH)}`).ok).toBe(false);
    expect(validateLocalMermaidSource("sankey-beta\nA,B,1").ok).toBe(false);
  });
});
