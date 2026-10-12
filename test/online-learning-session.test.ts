import { expect, spyOn, test } from "bun:test";
import type { PortableLearnerData } from "../packages/learner-contracts/src/portable.js";
import { buildOnlineDecisionBatch } from "../packages/learner-contracts/src/judgement/online-decision-policy.js";
import { OnlineLearningSession, type OnlineLearningState } from "../shared/online-learning-session.js";
const NOW = Date.UTC(2026, 9, 1, 12), DAY = 86_400_000;
function evidence(): PortableLearnerData {
  return { generatedAt: new Date(NOW).toISOString(), sessions: [], artifacts: [], goals: [], quizResults: [], decks: [], cardReviews: [],
    studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [],
    learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 },
    questionChecks: Array.from({ length: 41 }, (_, i) => ({ id: `q${i}`, topic: "Math", question: `Question ${i}`, answer: "answer",
      grading: "auto", score: i % 2, createdAt: new Date(NOW - (42 - i) * DAY).toISOString() })) };
}
function response(data: PortableLearnerData) {
  const batch = buildOnlineDecisionBatch(data, "mastery", NOW);
  return { model: "v3.5_default", predictions: [...batch.validation.map(row => row.label), ...batch.candidates.map(() => .8)] };
}
test("unchanged evidence reuses local receipts and an account change forces fresh inference", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(NOW);
  try {
    const session = new OnlineLearningSession(), data = evidence(), states: OnlineLearningState[] = [];
    let calls = 0, scope = "a";
    const update = () => session.update({ data, scope, asOf: NOW, current: () => ({ data, scope, enabled: true }),
      transport: async () => { calls++; return response(data); }, publish: state => states.push(state) });
    await update(); expect(states.at(-1)?.results.mastery?.receipt.status).toBe("active"); expect(calls).toBe(1);
    await update(); expect(calls).toBe(1); expect(states.at(-1)?.running).toBe(false);
    scope = "b"; await update(); expect(calls).toBe(2); expect(states.at(-1)?.scope).toBe("b");
  } finally { clock.mockRestore(); }
});
test("a response cannot publish after authorization changes or the view is cancelled", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(NOW);
  try {
    for (const revoke of [true, false]) {
      const session = new OnlineLearningSession(), data = evidence(), states: OnlineLearningState[] = [];
      let enabled = true, resolve!: (value: unknown) => void;
      const running = session.update({ data, scope: "a", asOf: NOW, current: () => ({ data, scope: "a", enabled }),
        transport: () => new Promise(done => { resolve = done; }), publish: state => states.push(state) });
      const count = states.length;
      if (revoke) enabled = false; else session.cancel();
      resolve(response(data)); await running;
      expect(states).toHaveLength(count); expect(states.every(state => !state.results.mastery)).toBe(true);
    }
  } finally { clock.mockRestore(); }
});
test("changed evidence waits for the spending cooldown and cancellation prevents another charge", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(NOW);
  try {
    const session = new OnlineLearningSession(), data = evidence(); let calls = 0;
    const update = () => session.update({ data, scope: "a", asOf: NOW, current: () => ({ data, scope: "a", enabled: true }),
      transport: async () => { calls++; return response(data); }, publish: () => {} });
    await update(); data.questionChecks[1]!.score = 0;
    const waiting = update(); expect(calls).toBe(1); session.cancel(); await waiting; expect(calls).toBe(1);
    session.clear(); await update(); expect(calls).toBe(2);
  } finally { clock.mockRestore(); }
});
test("changed history during inference discards old predictions", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(NOW);
  try {
    const session = new OnlineLearningSession(), data = evidence(), states: OnlineLearningState[] = [];
    const good = response(data);
    await session.update({ data, scope: "a", asOf: NOW, current: () => ({ data, scope: "a", enabled: true }),
      transport: async () => { data.questionChecks[1]!.score = 0; return good; }, publish: state => states.push(state) });
    expect(states.at(-1)?.results.mastery?.receipt.status).toBe("stale");
    expect(states.at(-1)?.results.mastery?.predictions).toEqual([]);
  } finally { clock.mockRestore(); }
});
