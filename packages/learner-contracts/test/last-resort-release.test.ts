import { expect, test } from "bun:test";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import type { JudgementRequest } from "../src/judgement/contracts.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

const rejectAll = makeTeachingDraftJudge();
// A failed host check is what keeps a draft out of today's best-effort release (for example broken component syntax).
const hostRejects = () => [{ id: "openui_valid", source: "deterministic" as const, severity: "major" as const, status: "fail" as const, probability: 1 }];
const draft = (text: string, toolCalls: { name: string; arguments: Record<string, unknown> }[] = []) =>
  async () => ({ reply: { text, toolCalls }, value: text });

test("without the host setting, a fully rejected turn is still withheld (evaluation hosts)", async () => {
  const result = await runTeachingDrafts({ turn: teachingDraftTurn, judge: rejectAll, check: hostRejects, maxAttempts: 2, generate: draft("Division splits a quantity.") });
  expect(result.status).toBe("withheld");
  expect(result.receipt.lastResortDraft).toBeUndefined();
});

test("a learner-facing host releases the best finished draft instead of withholding", async () => {
  const result = await runTeachingDrafts({ turn: teachingDraftTurn, judge: rejectAll, check: hostRejects, maxAttempts: 2, releaseLastResortDraft: true,
    generate: draft("Division splits a quantity.") });
  expect(result.status).toBe("released");
  expect(result.reply?.text).toBe("Division splits a quantity.");
  // The host marks this unverified; the receipt records that review never approved it.
  expect(result.receipt.reason).toBe("best-effort-draft");
  expect(result.receipt.lastResortDraft).toBe(true);
});

test("a last-resort release never carries unreviewed tool calls", async () => {
  const result = await runTeachingDrafts({ turn: { ...teachingDraftTurn, availableTools: ["save_note"] }, judge: rejectAll, check: hostRejects, maxAttempts: 1,
    releaseLastResortDraft: true, generate: draft("Here is the idea.", [{ name: "save_note", arguments: { text: "x" } }]) });
  expect(result.status).toBe("released");
  expect(result.reply?.toolCalls).toEqual([]);
  expect(result.reply?.text).toBe("Here is the idea.");
});

test("a draft whose review failed is still released, and a turn with no draft at all has nothing to release", async () => {
  const reviewDown = async (request: JudgementRequest) => "reply" in (request.state as object)
    ? { ok: false as const, error: { code: "backend-unavailable" as const, retryable: false } }
    : makeTeachingDraftJudge()(request, new AbortController().signal);
  const reviewed = await runTeachingDrafts({ turn: teachingDraftTurn, judge: reviewDown, maxAttempts: 1, releaseLastResortDraft: true,
    generate: draft("Division splits a quantity.") });
  expect(reviewed.status).toBe("released");
  const nothing = await runTeachingDrafts({ turn: teachingDraftTurn, judge: rejectAll, maxAttempts: 1, releaseLastResortDraft: true,
    generate: async () => { throw new Error("socket closed"); } });
  expect(nothing.status).toBe("withheld");
});
