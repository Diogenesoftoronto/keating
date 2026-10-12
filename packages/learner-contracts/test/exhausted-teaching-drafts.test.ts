import { describe, expect, test } from "bun:test";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import type { JudgementAnswer, JudgementCaller, JudgementRequest } from "../src/judgement/contracts.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";

const turn: TeachingPolicyTurn = { learnerMessage: "Help me with this code.", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "unknown" };
type Scores = Record<string, string | number>;
function judge(scores: (request: JudgementRequest) => Scores = () => ({})): JudgementCaller {
  return async request => {
    const override = scores(request);
    const answers: Record<string, JudgementAnswer> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      if (question.type === "choice") {
        const choice = typeof override[id] === "string" ? override[id] as string
          : id === "draft_standard" ? "supported" : Object.keys(question.criteria)[0]!;
        answers[id] = { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === choice)])) };
      } else if (question.type === "score") {
        answers[id] = { type: "score", score: 0, legend: Object.fromEntries(question.criteria.map((text, index) => [String(index), text])),
          probabilities: Object.fromEntries(question.criteria.map((_, index) => [String(index), Number(index === 0)])), confidence: 1 };
      } else {
        answers[id] = { type: "noul", noul: typeof override[id] === "number" ? override[id] as number : id.startsWith("quality_") ? .99 : .01 };
      }
    }
    return { ok: true, response: { backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null }, answers } };
  };
}
const generate = async () => ({ reply: { text: "A concrete hint for the learner's next step.", toolCalls: [] }, value: "approved" });

describe("exhausted teaching drafts", () => {
  test("all ten semantic rejections release the best completed prose with honest failed checks", async () => {
    let count = 0;
    const result = await runTeachingDrafts({ turn, judge: judge(request => ({
      retention_overclaimed: .99, quality_progress: count === 4 ? .95 : .3, quality_scope: count === 4 ? .95 : .3,
    })), generate: async () => { count++; return { reply: { text: `Helpful answer ${count}`, toolCalls: [] }, value: count }; } });
    expect(count).toBe(10);
    expect(result.status).toBe("released");
    expect(result.value).toBe(4);
    expect(result.receipt.reason).toBe("best-effort-draft");
    expect(result.receipt.attempts.every(entry => entry.status === "fail")).toBe(true);
    expect(result.receipt.attempts[3]!.checks.find(entry => entry.id === "retention_overclaimed")?.status).toBe("fail");
  });
  test("invalid or unauthorized tool payloads remain blocked and request recovery within budget", async () => {
    let count = 0; let recovery = false;
    const result = await runTeachingDrafts({ turn, judge: judge(), generate: async input => {
      count++; recovery ||= input.textOnlyRecovery === true;
      return { reply: { text: "Proposed operation", toolCalls: [{ name: "unauthorized", arguments: {} }] }, value: count };
    } });
    expect(count).toBe(10); expect(recovery).toBe(true);
    expect(result.status).toBe("withheld"); expect(result.reply).toBeUndefined();
  });
  test("host schema failures remain blocked while semantic execution concerns are recorded", async () => {
    for (const falseSuccess of [false, true]) {
      const result = await runTeachingDrafts({ turn, maxAttempts: 1, judge: judge(() => ({ retention_overclaimed: .99,
        tool_success_invented: falseSuccess ? .99 : .01 })), generate,
        check: () => falseSuccess ? [] : [{ id: "host_schema", source: "deterministic", severity: "critical", status: "fail", probability: 1 }],
      });
      expect(result.status).toBe(falseSuccess ? "released" : "withheld");
    }
  });
  test("all ten critical semantic failures rank the least concerning usable prose", async () => {
    let count = 0;
    const result = await runTeachingDrafts({ turn, judge: judge(() => ({
      tool_success_invented: count === 6 ? .81 : .99, instruction_override: .99,
    })), generate: async () => { count++; return { reply: { text: `Answer ${count}`, toolCalls: [] }, value: count }; } });
    expect(count).toBe(10); expect(result.status).toBe("released"); expect(result.value).toBe(6);
    expect(result.receipt.reason).toBe("best-effort-draft");
    expect(result.receipt.attempts.every(entry => entry.status === "fail")).toBe(true);
    expect(result.receipt.attempts[5]!.checks.find(entry => entry.id === "tool_success_invented"))
      .toMatchObject({ status: "fail", probability: .81 });
  });
  test("cancellation discards retained prose", async () => {
    const controller = new AbortController(); let count = 0;
    const result = await runTeachingDrafts({ turn, signal: controller.signal,
      judge: judge(() => ({ retention_overclaimed: .99 })), generate: async () => {
        count++; if (count === 2) controller.abort(); return generate();
      } });
    expect(result.status).toBe("cancelled"); expect(result.value).toBeUndefined(); expect(result.reply).toBeUndefined();
  });
});
