/** Generated checks for inert parsing and stable learner-visible OpenUI meaning. */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { compileOpenUISourceToSharedDocument, tryCompileOpenUISourceToSharedDocument } from "../src/index.js";

const options = { documentId: "property-openui", createdAt: "2026-08-10T00:00:00.000Z" };

describe("OpenUI source properties", () => {
  test("positional and object forms preserve the same learner-visible explanation", () => {
    fc.assert(fc.property(fc.string({ maxLength: 96 }), fc.string({ maxLength: 48 }), (markdown, title) => {
      const literalMarkdown = JSON.stringify(markdown);
      const literalTitle = JSON.stringify(title);
      const positional = [
        `root = LearningSurface([explanation], ${JSON.stringify("Lesson")})`,
        `explanation = Explanation(${literalMarkdown}, ${literalTitle})`,
      ].join("\n");
      const object = [
        `root = LearningSurface({ content: [explanation], title: ${JSON.stringify("Lesson")} })`,
        `explanation = Explanation({ markdown: ${literalMarkdown}, title: ${literalTitle} })`,
      ].join("\n");
      const positionalDocument = compileOpenUISourceToSharedDocument(positional, options);
      const objectDocument = compileOpenUISourceToSharedDocument(object, options);
      expect(positionalDocument.title).toBe("Lesson");
      expect(objectDocument.title).toBe("Lesson");
      expect(positionalDocument.nodes).toEqual(objectDocument.nodes);
      expect(positionalDocument.nodes[0]).toEqual({
        type: "markdown", id: "explanation",
        markdown: title ? `### ${title}\n\n${markdown}` : markdown,
      });
    }), { numRuns: 30 });
  });

  test("authored expressions never execute, regardless of generated operands", () => {
    const marker = "__openUiPropertyExecutionCount";
    const scope = globalThis as typeof globalThis & { __openUiPropertyExecutionCount?: number };
    scope[marker] = 0;
    try {
      fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), (amount) => {
        const source = [
          'root = LearningSurface([explanation], "Inert")',
          `explanation = Explanation(globalThis.${marker} += ${amount})`,
        ].join("\n");
        expect(tryCompileOpenUISourceToSharedDocument(source, options)).toMatchObject({ ok: false });
        expect(scope[marker]).toBe(0);
      }), { numRuns: 24 });
    } finally {
      delete scope[marker];
    }
  });
});
