/** Fast generated checks for learner-visible contract invariants. */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { validateUiActionAgainstDocument, validateUiDocument } from "../src/index.js";
import { uiActionFixture, uiDocumentFixture } from "./fixtures.js";

describe("learner contract properties", () => {
  test("a valid document and action stay accepted; one invalid field is rejected", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 4 }), (documentCorruption, actionCorruption) => {
      const document = uiDocumentFixture();
      const action = uiActionFixture();
      expect(validateUiDocument(document)).toBe(true);
      expect(validateUiActionAgainstDocument(action, document)).toBe(true);

      const brokenDocument = structuredClone(document) as Record<string, any>;
      const brokenAction = structuredClone(action) as Record<string, any>;
      switch (documentCorruption) {
        case 0: brokenDocument.schemaVersion = 2; break;
        case 1: brokenDocument.id = ""; break;
        case 2: brokenDocument.revision = -1; break;
        case 3: brokenDocument.supportedSurfaces = ["web", "web"]; break;
        case 4: brokenDocument.nodes[0].id = ""; break;
      }
      switch (actionCorruption) {
        case 0: brokenAction.schemaVersion = 2; break;
        case 1: brokenAction.documentRevision += 1; break;
        case 2: brokenAction.nodeId = "missing-node"; break;
        case 3: brokenAction.idempotencyKey = ""; break;
        case 4: brokenAction.unbounded = true; break;
      }
      expect(validateUiDocument(brokenDocument)).toBe(false);
      expect(validateUiActionAgainstDocument(brokenAction, document)).toBe(false);
    }), { numRuns: 30 });
  });
});
