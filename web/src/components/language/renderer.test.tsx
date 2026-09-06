import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LANGUAGE_PRACTICE_ROUNDS_FIXTURE, type UiActionReceipt, type UiLanguagePracticeNode } from "@keating/learner-contracts";
import { LanguagePractice } from "../LanguagePractice";

const node: UiLanguagePracticeNode = { type: "language-practice", id: "language", title: "Spanish practice", language: "Spanish", rounds: LANGUAGE_PRACTICE_ROUNDS_FIXTURE };
describe("language practice rendering", () => {
  it("shows one task and keeps future answers out of the initial surface", () => {
    const html = renderToStaticMarkup(<LanguagePractice node={node} />);
    expect(html).toContain("Good morning");
    expect(html).not.toContain("Buenos días");
    expect(html).not.toContain("Gracias");
  });
  it("keeps the listening transcript hidden until the learner checks an answer", () => {
    const html = renderToStaticMarkup(<LanguagePractice node={{ ...node, rounds: [node.rounds[2]!] }} />);
    expect(html).toContain("Listen to reference");
    expect(html).not.toContain("Hola");
    expect(html).toContain("Audio credit");
  });
  it("offers real recording and comparison without exposing a pronunciation score", () => {
    const html = renderToStaticMarkup(<LanguagePractice node={{ ...node, rounds: [node.rounds[3]!] }} />);
    expect(html).toContain("Record yourself");
    expect(html).toContain("Your recording stays here");
    expect(html).not.toContain("accuracy");
    expect(html).not.toContain("speechSynthesis");
  });
  it("restores exact timing and attempts separately from unscored pronunciation practice", () => {
    const receipt: UiActionReceipt = { schemaVersion: 1, state: "completed", createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z", actionFingerprint: "language-result", action: { schemaVersion: 1, type: "complete-language-practice", documentId: "language-doc", documentRevision: 0, nodeId: node.id, idempotencyKey: "language-result", rounds: [{ roundId: "thanks", outcome: "practiced", attempts: 2, timeMs: 4_238 }], correct: 0, objectiveTotal: 0, pronunciationPracticed: 1, totalMs: 7_901 } };
    const html = renderToStaticMarkup(<LanguagePractice node={{ ...node, rounds: [node.rounds[3]!] }} receipt={receipt} />);
    expect(html).toContain("Practice complete");
    expect(html).toContain("4.238s");
    expect(html).toContain("7.901s");
    expect(html).toContain("Practiced · not scored");
    expect(html).not.toContain("answers correct");
  });
});
