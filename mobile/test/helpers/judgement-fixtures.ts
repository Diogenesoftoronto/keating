/** Deterministic judgement fixtures for mobile teaching and recovery tests. */
import type { JudgementAnswer, JudgementCaller, PortableLearnerData } from "@keating/learner-contracts";

export const EMPTY_LEARNER_DATA: PortableLearnerData = {
  generatedAt: "2026-10-12T00:00:00.000Z",
  sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [],
  studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [],
  learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 },
};

export const acceptingTeachingJudge: JudgementCaller = async request => ({
  ok: true,
  response: {
    backend: { backend: "fixture", model: "judge", calibrationSha256: null },
    answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]): [string, JudgementAnswer] => {
      if (question.type === "choice") {
        const choice = id === "draft_standard" ? "concise" : Object.keys(question.criteria)[0]!;
        return [id, {
          type: "choice",
          choice,
          confidence: 1,
          probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === choice)])),
        }];
      }
      return [id, { type: "noul", noul: id.startsWith("quality_") || id === "identity_invented" ? 1 : 0 }];
    })),
  },
});
