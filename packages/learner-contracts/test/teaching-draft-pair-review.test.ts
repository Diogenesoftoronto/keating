import { describe, expect, test } from "bun:test";
import type { JudgementOutcome, JudgementRequest } from "../src/judgement/contracts.js";
import { nominateTeachingDraftPairs, reviewTeachingDraftPair } from "../src/judgement/teaching-drafts/pair-review.js";
import type { TeachingDraftPair, TeachingDraftPairReview } from "../src/judgement/teaching-drafts/pair-review.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

const drafts = [1, 2, 3, 4].map(attempt => ({
  attempt, reply: { text: `Private response ${attempt}`, toolCalls: [] },
}));
const judge = makeTeachingDraftJudge(request => ({
  draft_pair_choice: Object.keys((request.state as { candidates: object }).candidates).at(-1)!,
}));

describe("private teaching reply pairs", () => {
  test("two outstanding requests carry disjoint complete answers and report their own preference", async () => {
    const sent: JudgementRequest[] = [];
    const finish: (() => Promise<void>)[] = [];
    const comparisons = ([1, 2] as const).map(pair => reviewTeachingDraftPair(pair, [...drafts].reverse(), "concise", build => {
      const request = build(teachingDraftTurn);
      sent.push(request);
      return new Promise<JudgementOutcome>(resolve => {
        finish.push(async () => { resolve(await judge(request)); });
      });
    }));
    expect(sent).toHaveLength(2);
    for (const [i, request] of sent.entries()) {
      const current = drafts.slice(i * 2, i * 2 + 2);
      expect(Object.keys(request.questions)).toEqual(["draft_pair_choice"]);
      expect(request.state).toMatchObject({
        turn: { learnerMessage: teachingDraftTurn.learnerMessage },
        candidates: Object.fromEntries(current.map(c => [`draft_${c.attempt}`, c.reply])),
      });
      expect(Object.keys((request.state as { candidates: object }).candidates)).toEqual(current.map(c => `draft_${c.attempt}`));
      const choice = request.questions.draft_pair_choice!;
      expect(choice.type).toBe("choice");
      expect(Object.keys(choice.criteria!)).toEqual(current.map(c => `draft_${c.attempt}`));
    }
    await finish[1]!();
    await finish[0]!();
    const reviews = await Promise.all(comparisons);
    expect(reviews).toEqual([
      { pair: 1, candidateAttempts: [1, 2], status: "compared", model: "fixture-v1", preferredAttempt: 2, probabilities: { draft_1: 0, draft_2: 1 } },
      { pair: 2, candidateAttempts: [3, 4], status: "compared", model: "fixture-v1", preferredAttempt: 4, probabilities: { draft_3: 0, draft_4: 1 } },
    ]);
    expect(JSON.stringify(reviews)).not.toContain("Private response");

    // The favorite from pair one is blocked. Pair two advances its favorite even
    // though the independent quality ranking put the other approved draft first.
    const ranked = [drafts[2]!, drafts[0]!, drafts[3]!];
    const selected = nominateTeachingDraftPairs(ranked, [...reviews].reverse());
    expect(selected.finalists).toEqual([drafts[0]!, drafts[3]!]);
    expect(selected.reviews).toMatchObject([
      { pair: 1, preferredAttempt: 2, eligibleAttempts: [1], finalistAttempt: 1 },
      { pair: 2, preferredAttempt: 4, eligibleAttempts: [3, 4], finalistAttempt: 4 },
    ]);
    expect(nominateTeachingDraftPairs([], reviews).reviews.map(r => r.finalistAttempt)).toEqual([null, null]);
  });

  test("an incomplete pair only records completed members and never asks a one-option question", async () => {
    for (const [pair, completed, expected] of [[1, [drafts[1]!, drafts[2]!], [2]], [2, [drafts[0]!], []]] as const) {
      let calls = 0;
      const review = await reviewTeachingDraftPair(pair, completed, "deep", async () => {
        calls++;
        throw new Error("unreachable");
      });
      expect(calls).toBe(0);
      expect(review).toEqual({ pair, candidateAttempts: expected, status: "incomplete", preferredAttempt: null, model: null });
    }
  });

  test("a failed or malformed check cannot create a preference or expose provider text", async () => {
    const backend = { backend: "fixture" as const, model: "fixture-v1", calibrationSha256: null };
    const malformed: JudgementOutcome = { ok: true, response: { backend, answers: {
      draft_pair_choice: { type: "choice", choice: "draft_1", confidence: 0.9, probabilities: { draft_1: 0.9, "private unexpected key": 0.1 } },
    } } };
    const received = await Promise.all([
      reviewTeachingDraftPair(1, drafts, "deep", async () => malformed),
      reviewTeachingDraftPair(2, drafts, "deep", async () => ({ ok: false, error: { code: "request-invalid", retryable: false } })),
      reviewTeachingDraftPair(1, drafts, "deep", async () => { throw new Error("private transport error"); }),
    ]);
    expect(received.map(result => [result.status, result.preferredAttempt, result.error, result.model])).toEqual([
      ["unavailable", null, "response-malformed", "fixture-v1"], ["unavailable", null, "request-invalid", null], ["unavailable", null, "backend-unavailable", null],
    ]);
    expect(JSON.stringify(received)).not.toContain("private");
    const fallback = nominateTeachingDraftPairs([drafts[3]!, drafts[2]!, drafts[0]!], received.slice(0, 2));
    expect(fallback.finalists).toEqual([drafts[3]!, drafts[0]!]);
    expect(fallback.reviews.map(r => r.finalistAttempt)).toEqual([1, 4]);
  });

  test("an aborted request cannot retain a late response, and an unobserved review is never invented", async () => {
    const controller = new AbortController();
    const pending = reviewTeachingDraftPair(1, drafts, "supported", async build => {
      const request = build(teachingDraftTurn);
      controller.abort();
      return judge(request);
    }, controller.signal);
    await expect(pending).rejects.toThrow("draft-interrupted");
    await expect(reviewTeachingDraftPair(2, [], "supported", async () => {
      throw new Error("unreachable");
    }, controller.signal)).rejects.toThrow("draft-interrupted");
    const fallback = nominateTeachingDraftPairs([drafts[3]!, drafts[2]!], []);
    expect(fallback).toEqual({ finalists: [drafts[3]!], reviews: [] });
  });

  test("only a normalized distribution whose reported choice is most probable can name a preference", async () => {
    const possible = [
      { draft_1: 0, draft_2: 0 }, { draft_1: 0.85, draft_2: 0.8 }, { draft_1: 0.2, draft_2: 0.8 },
      { draft_1: 0.5, draft_2: 0.5 },
    ];
    for (const probabilities of possible) {
      const result = await reviewTeachingDraftPair(1, drafts, "supported", async () => ({
        ok: true, response: {
          backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null },
          answers: { draft_pair_choice: { type: "choice", choice: "draft_1", confidence: 0.5, probabilities } },
        },
      }));
      const tie = probabilities.draft_1 === 0.5;
      expect(result.status).toBe(tie ? "compared" : "unavailable");
      expect(result.preferredAttempt).toBe(tie ? 1 : null);
    }
  });

  test("a choice can only nominate a member of its own eligible pair", () => {
    const manipulated: TeachingDraftPairReview[] = ([1, 2] as TeachingDraftPair[]).map(pair => ({
      pair, status: "compared", candidateAttempts: pair === 1 ? [1, 2] : [3, 4],
      preferredAttempt: pair === 1 ? 4 : 2, model: "fixture-v1",
    }));
    const result = nominateTeachingDraftPairs(drafts, manipulated);
    expect(result.finalists).toEqual([drafts[0]!, drafts[2]!]);
  });
});
