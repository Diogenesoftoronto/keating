import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { topicContentHash, extractClaims, buildVerificationChecklist, buildPendingVerificationResult } from "../src/core/verification.js";
import { arbTopicDefinition } from "./helpers.js";

// ─── topicContentHash properties ────────────────────────────────────────────

test("ALWAYS: topicContentHash is deterministic", () => {
  fc.assert(fc.property(arbTopicDefinition, (topic) => {
    const a = topicContentHash(topic);
    const b = topicContentHash(topic);
    expect(a).toBe(b);
  }));
});

test("ALWAYS: topicContentHash produces different hashes for different topics", () => {
  fc.assert(fc.property(arbTopicDefinition, arbTopicDefinition, (a, b) => {
    if (a.slug === b.slug && a.summary === b.summary) return;
    const hashA = topicContentHash(a);
    const hashB = topicContentHash(b);
    expect(hashA).not.toBe(hashB);
  }));
});

test("ALWAYS: topicContentHash is 16 characters (hex prefix of sha256)", () => {
  fc.assert(fc.property(arbTopicDefinition, (topic) => {
    const hash = topicContentHash(topic);
    expect(hash.length).toBe(16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  }));
});

// ─── extractClaims properties ───────────────────────────────────────────────

test("ALWAYS: extractClaims produces non-empty output for topics with content", () => {
  fc.assert(fc.property(
    arbTopicDefinition.filter(t => t.summary.length > 0 || t.formalCore.length > 0),
    (topic) => {
      const claims = extractClaims(topic);
      expect(claims.length).toBeGreaterThan(0);
    }
  ));
});

test("ALWAYS: all extracted claims are non-empty strings", () => {
  fc.assert(fc.property(arbTopicDefinition, (topic) => {
    const claims = extractClaims(topic);
    for (const claim of claims) {
      expect(claim.length).toBeGreaterThan(0);
    }
  }));
});

// ─── buildVerificationChecklist properties ──────────────────────────────────

test("ALWAYS: buildVerificationChecklist is non-empty and contains topic title", () => {
  fc.assert(fc.property(arbTopicDefinition, (topic) => {
    const checklist = buildVerificationChecklist(topic);
    expect(checklist.length).toBeGreaterThan(0);
    expect(checklist.includes("Verification Checklist")).toBe(true);
  }));
});

// ─── buildPendingVerificationResult properties ──────────────────────────────

test("ALWAYS: buildPendingVerificationResult has unconfirmed claims", () => {
  fc.assert(fc.property(arbTopicDefinition, (topic) => {
    const result = buildPendingVerificationResult(topic);
    expect(result.claims.length).toBeGreaterThan(0);
    for (const claim of result.claims) {
      expect(claim.status).toBe("unconfirmed");
    }
    expect(result.overallConfidence).toBe(0);
    expect(result.contentHash).toBe(topicContentHash(topic));
    expect(result.topic).toBe(topic.slug);
  }));
});
