import { expect, test } from "bun:test";
import type { JudgementAnswer, JudgementCaller, PortableLearnerData } from "@keating/learner-contracts";
import { createMobileTeachingDraftRound } from "../src/lib/judgement/teaching-drafts";

const evidence: PortableLearnerData = { generatedAt: new Date().toISOString(), sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [], studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [], learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 } };
const judge: JudgementCaller = async request => ({ ok: true, response: { backend: { backend: "fixture", model: "judge", calibrationSha256: null },
  answers: Object.fromEntries(Object.entries(request.questions).map(([id, q]): [string, JudgementAnswer] => {
    if (q.type === "choice") {
      const choice = id === "draft_standard" ? "concise" : Object.keys(q.criteria)[0]!;
      return [id, { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, Number(key === choice)])) }];
    }
    return [id, { type: "noul", noul: id.startsWith("quality_") ? 1 : id === "identity_invented" ? 1 : 0 }];
  })) } });

test("native final recovery disables tools while preserving selected model and answers the learner", async () => {
  let calls = 0;
  const request = createMobileTeachingDraftRound({ judge, current: () => true, evidence: async () => evidence, onReleased: () => {},
    request: async (settings, _key, messages, options) => {
      calls++; expect(settings.model).toBe("selected-teacher"); expect(messages[0]!.content).toBe("What is four factorial?");
      if (options?.tools?.length === 0) {
        expect(options.systemPrompt).toContain("Do not claim actions");
        return { text: "Four factorial is 24.", calls: [], assistantTurn: null, usage: null };
      }
      return { text: "", calls: [{ id: "invalid", name: "unknown_tool", arguments: {} }], assistantTurn: null, usage: null };
    } });
  const result = await request({ provider: "openai", model: "selected-teacher", customBaseUrl: "" }, "key",
    [{ id: "user", role: "user", content: "What is four factorial?", createdAt: 1 }],
    { tools: [{ name: "workspace_inspect", description: "Read", parameters: { type: "object", properties: {} } }] });
  expect(calls).toBe(3); expect(result.text).toBe("Four factorial is 24."); expect(result.calls).toEqual([]);
});
