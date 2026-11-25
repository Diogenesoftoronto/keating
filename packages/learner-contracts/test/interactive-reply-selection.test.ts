import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { recommendInteraction } from "../src/judgement/interaction-affordances.js";
import { INTERACTIVE_COMPONENTS } from "../src/interactive-replies.js";
import { INTERACTIVE_REPLY_FEATURE_IDS, interactiveReplyCue, isInteractiveReplyFeature } from "../src/judgement/interactive-reply-cues.js";
import { TEACHING_INTERACTION_FEATURES, TEACHING_POLICY_DECISIONS } from "../src/judgement/teaching-policy-catalog.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import { askedInteractionFeatures, teachingPolicyDecisionRequest } from "../src/judgement/teaching-policy.js";
import { judgementRequestProblem, MAX_QUESTIONS_PER_REQUEST } from "../src/judgement/contracts.js";
import { INTERACTION_FEATURE_CASES } from "./fixtures/interaction-features/cases.js";

/**
 * 99 labelled learner questions (80 from web/.keating-mockups/eval/selection.json, 19 for the specialist labs) with
 * hand-written judge answers. The answers are authored, not measured, so this
 * checks the affordance table and the cues, not the judge.
 */
interface SelectionItem {
  id: string; question: string; expected: string; pair?: string;
  judge: { decisions: string[]; features: string[] };
}
const { items } = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/interactive-reply-selection.json"), "utf8")) as { items: SelectionItem[] };
const interactive = new Set<string>(INTERACTIVE_COMPONENTS);

function turnFor(question: string): TeachingPolicyTurn {
  return { learnerMessage: question, conversation: [{ role: "user", content: question }], learnerEvidence: [], availableTools: [],
    toolResults: [], sources: [], assessment: "formative", improvementRuns: "disabled", domain: "unknown" } as unknown as TeachingPolicyTurn;
}

/** The judge's answers as `projectTeachingPolicyDecision` would see them: un-cued gated features stay unknown. */
function flags(item: SelectionItem) {
  const turn = turnFor(item.question);
  const decisions = Object.fromEntries(TEACHING_POLICY_DECISIONS.map(({ id }) => [id, item.judge.decisions.includes(id)]));
  const features = Object.fromEntries(TEACHING_INTERACTION_FEATURES.map(({ id }) => [id,
    isInteractiveReplyFeature(id) && !interactiveReplyCue(turn, id) ? null : item.judge.features.includes(id)]));
  return { decisions, features };
}

function offered(item: SelectionItem): string[] {
  const { decisions, features } = flags(item);
  const recommendation = recommendInteraction(features, decisions, { interactiveRepliesAvailable: true });
  return [...new Set(recommendation.families.flatMap(({ components }) => components).filter((component) => interactive.has(component)))];
}

describe("interactive reply selection over the labelled set", () => {
  test("the fixture covers all 99 questions and only known flags", () => {
    expect(items).toHaveLength(99);
    const known = new Set([...TEACHING_POLICY_DECISIONS, ...TEACHING_INTERACTION_FEATURES].map(({ id }) => id));
    for (const item of items) for (const id of [...item.judge.decisions, ...item.judge.features]) expect(known.has(id)).toBe(true);
  });

  test("each cue opens its feature wherever the judge would set it", () => {
    const missed = items.flatMap((item) => item.judge.features.filter(isInteractiveReplyFeature)
      .filter((id) => !interactiveReplyCue(turnFor(item.question), id)).map((id) => `${item.id}:${id}`));
    expect(missed).toEqual([]);
  });

  test("agreement with the labels", () => {
    const rows = items.map((item) => ({ item, components: offered(item) }));
    const correct = rows.filter(({ item, components }) => item.expected === "prose" ? components.length === 0 : components.includes(item.expected));
    const exact = rows.filter(({ item, components }) => item.expected === "prose" ? components.length === 0 : components.length === 1 && components[0] === item.expected);
    const misses = rows.filter((row) => !correct.includes(row)).map(({ item, components }) => `${item.id} expected ${item.expected}, offered ${components.join("+") || "none"}`);
    const prose = rows.filter(({ item }) => item.expected === "prose");
    const proseKept = prose.filter(({ components }) => components.length === 0).length;
    console.log(`interactive reply selection: ${correct.length}/${items.length} agree (expected component offered, or none for prose); `
      + `${exact.length}/${items.length} offer exactly the expected one; prose kept ${proseKept}/${prose.length}.\n  misses: ${misses.join("; ") || "none"}`);
    // Known miss, recorded so a regression is visible: LinkedModel also needs prediction_opportunity
    // (so a formula request stays prose), and the inflation question was labelled without it.
    expect(misses).toEqual(["s70 expected LinkedModel, offered none"]);
  });

  test("every new feature has a cue and a code-owned purpose", () => {
    for (const id of INTERACTIVE_REPLY_FEATURE_IDS) {
      const entry = TEACHING_INTERACTION_FEATURES.find((feature) => feature.id === id);
      expect(entry?.askWhen).toBe("interactive_reply_cue");
      expect(entry?.purpose.length).toBeGreaterThan(10);
    }
  });

  test("every calibration case asks the interactive features it labels positive", () => {
    const unasked = INTERACTION_FEATURE_CASES.flatMap((row) => {
      const asked = new Set(askedInteractionFeatures(row.turn).map(({ id }) => id));
      return Object.entries(row.expectedDecisions).filter(([id, value]) => value && isInteractiveReplyFeature(id) && !asked.has(id)).map(([id]) => `${row.id}:${id}`);
    });
    expect(unasked).toEqual([]);
  });

  test("a turn that trips every cue stays within the request bounds", () => {
    const turn = { ...turnFor("Plan my week around the exam: solve 2x = 4, compare 3/4 with a compass construction, swap the state machine's data groups and check the article's claim. Then the heart's valves, a loading dose, a confounded cohort and the fringes from two slits."), conversation: [] } as TeachingPolicyTurn;
    const request = teachingPolicyDecisionRequest(turn);
    for (const id of INTERACTIVE_REPLY_FEATURE_IDS) expect(Object.keys(request.questions)).toContain(id);
    expect(Object.keys(request.questions).length).toBeLessThanOrEqual(MAX_QUESTIONS_PER_REQUEST);
    expect(judgementRequestProblem(request)).toBeNull();
  });
});
