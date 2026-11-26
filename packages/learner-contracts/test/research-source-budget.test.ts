import { expect, test } from "bun:test";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import type { JudgementRequest } from "../src/judgement/contracts.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

// 41 long search results, as in the rejected Riemann draft: too large to review whole.
const sources: TeachingPolicyTurn["sources"] = Array.from({ length: 41 }, (_, index) => ({
  id: `web-${index + 1}`, url: `https://example.org/${index}`, text: `Passage ${index}. ${"observed source text ".repeat(200)}`,
}));
const turn = { ...teachingDraftTurn, sources };
const reviewer = { id: "fixture-v1", stateQuestionTokens: 32_000, requestTokens: 64_000 };
const accept = makeTeachingDraftJudge();
const generated = async () => ({ reply: { text: "Division splits a quantity into equal groups.", toolCalls: [] }, value: "answer" });
const sourcesOf = (request: JudgementRequest) => (request.state as { turn: TeachingPolicyTurn }).turn.sources;
/** A host compaction that keeps whole sources until the character budget runs out. */
const compact = (maxChars = 12_000) => {
  const kept: TeachingPolicyTurn["sources"][number][] = [];
  let used = 2;
  for (const source of sources) {
    const size = JSON.stringify(source).length + 1;
    if (used + size > maxChars) break;
    kept.push(source);
    used += size;
  }
  return kept;
};

test("compacted research evidence fills the reviewer's spare room instead of a fixed minimum", async () => {
  const budgets: (number | undefined)[] = [];
  const seen: JudgementRequest[] = [];
  const result = await runTeachingDrafts({ turn, judgementModel: reviewer, maxAttempts: 1, generate: generated,
    judge: async (request, signal) => { seen.push(request); return accept(request, signal); },
    compactResearchSources: (_replies, maxChars) => { budgets.push(maxChars); return compact(maxChars); } });
  expect(result.status).toBe("released");
  // The smallest set is tried first, then larger ones.
  expect(budgets[0]).toBeUndefined();
  expect(budgets.some(budget => budget !== undefined && budget > 12_000)).toBe(true);
  const reviewed = Math.max(...seen.map(request => sourcesOf(request).length));
  expect(reviewed).toBeGreaterThan(compact().length);
  expect(reviewed).toBeLessThan(sources.length);
  // The recorded window still fits the reviewer and keeps the whole conversation.
  const slide = result.receipt.slides?.find(entry => entry.attempt === 1);
  expect(slide?.turnsDropped).toBe(0);
  expect(slide?.after?.fillRatio).toBeLessThanOrEqual(1);
  expect(slide!.after!.fillRatio!).toBeGreaterThan(0.75);
});
