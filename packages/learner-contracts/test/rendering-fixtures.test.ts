import { describe, expect, test } from "bun:test";
import {
  MARKDOWN_PARITY_FIXTURE,
  MERMAID_PARITY_FIXTURES,
  NESTED_RENDERING_DOCUMENT_FIXTURE,
  OPENUI_JSON_PARITY_FIXTURE,
  OPENUI_SOURCE_PARITY_FIXTURE,
  RENDERING_FIXTURE_DOCUMENT_NODE_LIMIT,
  RENDERING_FIXTURE_MARKDOWN_LIMIT,
  RENDERING_FIXTURE_PACK_VERSION,
  RENDERING_LIFECYCLE_FIXTURES,
  RENDERING_LIFECYCLE_STATES,
  RENDERING_NEGATIVE_DOCUMENT_FIXTURES,
  RENDERING_RECOVERY_FIXTURE_MATRIX,
  RENDERING_SOURCE_RECOVERY_FIXTURES,
  RENDERING_THEME_SCENARIOS,
  RENDERING_VALID_DOCUMENT_FIXTURES,
  detectSupportedMermaidGrammar,
  UI_DOCUMENT_NODE_TYPES,
  validateUiDocument,
  WEB_MARKDOWN_FEATURES,
  WEB_MERMAID_GRAMMARS,
  WEB_OPENUI_COMPONENTS,
} from "../src/index.js";
import type { UiDocument, UiQuestion, UiStudyPlanItem } from "../src/index.js";

function collectDocumentIds(document: UiDocument): string[] {
  const ids = [document.id];
  const collectQuestion = (question: UiQuestion, includeQuestionId: boolean) => {
    if (includeQuestionId) ids.push(question.id);
    ids.push(...(question.choices ?? []).map((choice) => choice.id));
  };
  const collectPlanItems = (items: UiStudyPlanItem[]) => {
    for (const item of items) {
      ids.push(item.id);
      if (item.children) collectPlanItems(item.children);
    }
  };

  for (const node of document.nodes) {
    ids.push(node.id);
    switch (node.type) {
      case "question": collectQuestion(node, false); break;
      case "question-group":
      case "quiz": node.questions.forEach((question) => collectQuestion(question, true)); break;
      case "goal": ids.push(...node.steps.map((step) => step.id)); break;
      case "deck": ids.push(...node.cards.map((card) => card.id)); break;
      case "study-plan":
        if (node.items) collectPlanItems(node.items);
        if (node.resource) ids.push(node.resource.id);
        break;
      case "artifact":
      case "image":
      case "media": ids.push(node.resource.id); break;
    }
  }
  return ids;
}

describe("cross-surface rendering fixture contract", () => {
  test("is versioned, unique, and contains every declared family", () => {
    expect(RENDERING_FIXTURE_PACK_VERSION).toBe(2);
    expect(new Set(WEB_MARKDOWN_FEATURES).size).toBe(WEB_MARKDOWN_FEATURES.length);
    expect(new Set(WEB_MERMAID_GRAMMARS).size).toBe(WEB_MERMAID_GRAMMARS.length);
    expect(new Set(WEB_OPENUI_COMPONENTS).size).toBe(WEB_OPENUI_COMPONENTS.length);
    expect(new Set(MERMAID_PARITY_FIXTURES.map((fixture) => fixture.id)).size).toBe(MERMAID_PARITY_FIXTURES.length);
    expect(MERMAID_PARITY_FIXTURES.map((fixture) => fixture.grammar)).toEqual([...WEB_MERMAID_GRAMMARS]);
  });

  test("recognizes only the portable Mermaid grammar allowlist", () => {
    for (const fixture of MERMAID_PARITY_FIXTURES) {
      expect(detectSupportedMermaidGrammar(fixture.source)).toBe(fixture.grammar);
    }
    expect(detectSupportedMermaidGrammar("sankey-beta\nA,B,1")).toBeNull();
    expect(detectSupportedMermaidGrammar("graph TD\n  A --> B")).toBe("flowchart");
    expect(detectSupportedMermaidGrammar("graph LR; A --> B")).toBe("flowchart");
    expect(detectSupportedMermaidGrammar("%% learner map\nflowchart TB\n  A --> B")).toBe("flowchart");
    expect(detectSupportedMermaidGrammar("%%{init: { 'theme': 'forest' }}%%\nflowchart LR\n  A --> B")).toBeNull();
  });

  test("keeps the reference Markdown and browser OpenUI source explicit", () => {
    for (const marker of ["# Rendering parity", "[x]", "| Construct", "$$", "```typescript", "```mermaid", "||a hidden retrieval cue||"]) {
      expect(MARKDOWN_PARITY_FIXTURE).toContain(marker);
    }
    for (const component of WEB_OPENUI_COMPONENTS) {
      expect(OPENUI_SOURCE_PARITY_FIXTURE).toContain(`${component}(`);
    }
  });

  test("validates a canonical JSON document with every shared node kind", () => {
    expect(validateUiDocument(OPENUI_JSON_PARITY_FIXTURE)).toBe(true);
    expect(new Set(OPENUI_JSON_PARITY_FIXTURE.nodes.map((node) => node.type))).toEqual(new Set(UI_DOCUMENT_NODE_TYPES));
    expect(OPENUI_JSON_PARITY_FIXTURE.nodes.filter((node) => node.type === "media").map((node) => node.kind)).toEqual(["audio", "video", "animation"]);
    expect(collectDocumentIds(OPENUI_JSON_PARITY_FIXTURE)).toHaveLength(new Set(collectDocumentIds(OPENUI_JSON_PARITY_FIXTURE)).size);
  });

  test("keeps every positive document valid, nested, and globally id-distinct", () => {
    for (const fixture of RENDERING_VALID_DOCUMENT_FIXTURES) {
      expect(validateUiDocument(fixture.payload)).toBe(true);
      const document = fixture.payload as UiDocument;
      const ids = collectDocumentIds(document);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(validateUiDocument(NESTED_RENDERING_DOCUMENT_FIXTURE)).toBe(true);
    expect(NESTED_RENDERING_DOCUMENT_FIXTURE.nodes.map((node) => node.type)).toEqual(["question-group", "study-plan", "artifact"]);
  });

  test("keeps bounded recovery cases valid and rejects declared invalid wire documents", () => {
    expect(RENDERING_FIXTURE_MARKDOWN_LIMIT).toBe(65_536);
    expect(RENDERING_FIXTURE_DOCUMENT_NODE_LIMIT).toBe(64);
    for (const fixture of RENDERING_NEGATIVE_DOCUMENT_FIXTURES) {
      expect(validateUiDocument(fixture.payload)).toBe(false);
    }
    expect(RENDERING_VALID_DOCUMENT_FIXTURES.find((fixture) => fixture.id === "max-sized-markdown")?.expectation).toBe("accepted");
    expect(RENDERING_VALID_DOCUMENT_FIXTURES.find((fixture) => fixture.id === "max-sized-node-count")?.expectation).toBe("accepted");
  });

  test("declares source recovery, lifecycle, and theme scenarios without runtime dependencies", () => {
    expect(RENDERING_SOURCE_RECOVERY_FIXTURES.map((fixture) => fixture.expectation)).toEqual(["partial", "rejected", "rejected"]);
    expect(RENDERING_SOURCE_RECOVERY_FIXTURES.every((fixture) => typeof fixture.payload === "string")).toBe(true);
    expect(RENDERING_SOURCE_RECOVERY_FIXTURES.find((fixture) => fixture.id === "unsafe-openui-directive")?.payload).toContain("file:///");
    expect(RENDERING_LIFECYCLE_FIXTURES.map((fixture) => (fixture.payload as UiDocument).lifecycle)).toEqual([...RENDERING_LIFECYCLE_STATES]);
    expect(RENDERING_LIFECYCLE_FIXTURES.every((fixture) => validateUiDocument(fixture.payload))).toBe(true);
    expect(RENDERING_THEME_SCENARIOS.map((scenario) => scenario.theme)).toEqual(["light", "dark"]);
    expect(JSON.parse(JSON.stringify(RENDERING_RECOVERY_FIXTURE_MATRIX))).toHaveLength(RENDERING_RECOVERY_FIXTURE_MATRIX.length);
  });
});
