import { test, expect } from "bun:test";
import { reviewStudyCandidates, type StudyCandidate } from "../shared/pedagogy/readiness-review.js";
import type { JudgementBackendKey, JudgementCaller, JudgementOutcome, JudgementRequest } from "../packages/learner-contracts/src/judgement/contracts.js";
import { thresholdKey, type CalibrationTable } from "../packages/learner-contracts/src/judgement/projections.js";
const key: JudgementBackendKey = { backend: "system-one", model: "fixture-readiness", calibrationSha256: "a".repeat(64) };
const candidate = (id: string): StudyCandidate => ({ id, title: id, requirements: ["Explain equivalent fractions"], due: true, covered: true,
  prerequisites: [{ id: "parts", covered: true }], prerequisiteGraphKnown: true,
  work: [{ question: "What is one half?", answer: "One of two equal parts", result: "correct" }] });
function caller(options: { probability?: number; secondKey?: JudgementBackendKey; choice?: string } = {}) {
  const requests: JudgementRequest[] = [];
  const call: JudgementCaller = async request => {
    requests.push(request);
    return { ok: true, response: { backend: request.questions.selection ? options.secondKey ?? key : key,
      answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, id === "selection"
        ? { type: "choice", choice: options.choice ?? "candidate_1", confidence: .95, probabilities: { candidate_0: .02, candidate_1: .95, none: .03 } }
        : { type: "noul", noul: options.probability ?? .95 }])) } };
  };
  return { call, requests };
}
async function calibrated(candidates: StudyCandidate[], call: JudgementCaller): Promise<CalibrationTable> {
  const first = await reviewStudyCandidates(candidates, call);
  const entries = Object.fromEntries(Object.values(first.questionDigests).map(digest => [thresholdKey(key, digest), { deferBelow: .5, actAtOrAbove: .8 }]));
  const second = await reviewStudyCandidates(candidates, call, { entries });
  if (second.questionDigests.selection) entries[thresholdKey(key, second.questionDigests.selection)] = { deferBelow: .5, actAtOrAbove: .8 };
  return { entries };
}

test("failed deterministic prerequisite, due, coverage and evidence gates never dispatch", async () => {
  const c = caller();
  const inputs = [ { ...candidate("a"), due: false }, { ...candidate("b"), covered: false },
    { ...candidate("c"), prerequisiteGraphKnown: false }, { ...candidate("d"), prerequisites: [{ id: "parts", covered: false }] }, { ...candidate("e"), work: [] } ];
  const result = await reviewStudyCandidates(inputs, c.call);
  expect(result.status).toBe("no-ready-candidate"); expect(result.blocked.map(item => item.reason)).toEqual(["not-due", "not-covered", "unknown-prerequisites", "unmet-prerequisite", "no-work"]);
  expect(c.requests).toHaveLength(0);
});
test("uncalibrated estimates never select or ask forced-choice", async () => {
  const c = caller(); const result = await reviewStudyCandidates([candidate("a"), candidate("b")], c.call);
  expect(result.status).toBe("uncalibrated"); expect(result.selectedId).toBeNull(); expect(result.estimates).toHaveLength(2); expect(c.requests).toHaveLength(1);
  expect(result.source).toBe("proxy"); expect(result.attempts).toHaveLength(1);
});
test("only calibrated readiness survivors enter separately calibrated selection", async () => {
  const inputs = [candidate("a"), candidate("b")]; const c = caller(); const table = await calibrated(inputs, c.call);
  c.requests.length = 0; const result = await reviewStudyCandidates(inputs, c.call, table);
  expect(result.status).toBe("selected"); expect(result.selectedId).toBe("b"); expect(c.requests).toHaveLength(2);
  expect(c.requests[1]!.questions.selection?.type).toBe("choice"); expect(result.attempts).toHaveLength(2);
});
test("all low readiness retains keep-teaching outcome without forcing a winner", async () => {
  const inputs = [candidate("a"), candidate("b")]; const high = caller(); const table = await calibrated(inputs, high.call); const low = caller({ probability: .1 });
  const result = await reviewStudyCandidates(inputs, low.call, table);
  expect(result.status).toBe("no-ready-candidate"); expect(result.selectedId).toBeNull(); expect(low.requests).toHaveLength(1);
});
test("thresholds from another model cannot authorize selection", async () => {
  const c = caller(); const inputs = [candidate("a"), candidate("b")]; const table = await calibrated(inputs, c.call);
  const other = { entries: Object.fromEntries(Object.entries(table.entries).map(([id, value]) => [id.replace("fixture-readiness", "other-model"), value])) };
  const result = await reviewStudyCandidates(inputs, c.call, other); expect(result.status).toBe("uncalibrated"); expect(result.selectedId).toBeNull();
});
test("model drift and malformed choice cannot yield a selected candidate", async () => {
  const inputs = [candidate("a"), candidate("b")]; const base = caller(); const table = await calibrated(inputs, base.call);
  for (const c of [caller({ secondKey: { ...key, model: "changed" } }), caller({ choice: "candidate_0" }), caller({ choice: "not-a-candidate" })]) {
    expect((await reviewStudyCandidates(inputs, c.call, table)).selectedId).toBeNull();
  }
});
test("late abort discards decision and source limits do not silently truncate", async () => {
  const controller = new AbortController(); let calls = 0;
  const result = await reviewStudyCandidates([candidate("a")], async () => { calls++; controller.abort(); return { ok: true, response: { backend: key, answers: { candidate_0: { type: "noul", noul: .99 } } } }; }, undefined, controller.signal);
  expect(result.status).toBe("cancelled"); expect(result.selectedId).toBeNull(); expect(calls).toBe(1);
  const c = caller(); const large = candidate("large"); large.work = [{ question: "Explain", answer: "x".repeat(60_001), result: "pending" }];
  expect((await reviewStudyCandidates([large], c.call)).status).toBe("unavailable"); expect(c.requests).toHaveLength(0);
});
test("missing result stays unavailable and never becomes zero readiness", async () => {
  const result = await reviewStudyCandidates([candidate("a")], async () => ({ ok: true, response: { backend: key, answers: {} } }));
  expect(result.status).toBe("unavailable"); expect(result.estimates).toHaveLength(0); expect(result.selectedId).toBeNull();
});

test("in-flight source and threshold mutation cannot change the captured review", async () => {
  const inputs = [candidate("a"), candidate("b")]; const base = caller(); const table = await calibrated(inputs, base.call);
  const requests: JudgementRequest[] = [];
  const result = await reviewStudyCandidates(inputs, async request => {
    requests.push(request);
    inputs[0]!.work = [{ question: "changed", answer: "changed", result: "incorrect" }];
    for (const key of Object.keys(table.entries)) delete (table.entries as Record<string, unknown>)[key];
    return base.call(request);
  }, table);
  expect(result.status).toBe("selected");
  expect(JSON.stringify(requests)).not.toContain("changed");
});

test("malformed saved candidates fail before dispatch instead of becoming permissive gates", async () => {
  for (const input of [null, [null], [{ ...candidate("a"), due: "yes" }],
    [{ ...candidate("a"), prerequisites: [{ id: "parts", covered: "true" }] }],
    [{ ...candidate("a"), prerequisites: [{ id: "a", covered: true }] }],
    [{ ...candidate("a"), work: [{ question: "Explain", answer: "   ", result: "correct" }] }],
    [{ ...candidate("a"), work: [{ question: "Explain", answer: "A half", result: "inferred-correct" }] }],
    [candidate("same"), candidate("same")], Array.from({ length: 21 }, (_, i) => candidate(String(i)))]) {
    const c = caller();
    const result = await reviewStudyCandidates(input as StudyCandidate[], c.call);
    expect(result.status).toBe("unavailable"); expect(result.selectedId).toBeNull(); expect(c.requests).toHaveLength(0);
  }
});

test("cancellation settles a noncooperative caller and late completion cannot alter its receipt", async () => {
  const controller = new AbortController(); let finish!: (value: JudgementOutcome) => void;
  const pending = reviewStudyCandidates([candidate("a")], () => new Promise(resolve => { finish = resolve; }), undefined, controller.signal);
  controller.abort();
  const result = await pending;
  expect(result.status).toBe("cancelled"); expect(result.attempts).toHaveLength(1);
  const captured = JSON.stringify(result);
  finish({ ok: true, response: { backend: key, answers: { candidate_0: { type: "noul", noul: .99 } } } });
  await Promise.resolve(); await Promise.resolve();
  expect(JSON.stringify(result)).toBe(captured); expect(result.selectedId).toBeNull();
}, 1000);

test("provider-owned request and response mutations cannot rewrite source or receipt", async () => {
  const inputs = [candidate("a"), candidate("b")], base = caller();
  const table = await calibrated(inputs, base.call);
  let first: JudgementOutcome | undefined;
  let secondRequest: JudgementRequest | undefined;
  const result = await reviewStudyCandidates(inputs, async request => {
    if (!request.questions.selection) {
      (request.state as any).candidates.candidate_0.work[0].answer = "INJECTED";
      first = structuredClone(await base.call(request)); return first;
    }
    secondRequest = request;
    if (first?.ok) (first.response.backend as { model: string }).model = "changed-after-return";
    return structuredClone(await base.call(request));
  }, table);
  expect(result.status).toBe("selected"); expect(result.selectedId).toBe("b");
  expect(JSON.stringify(secondRequest)).not.toContain("INJECTED");
  expect(JSON.stringify(result)).not.toContain("changed-after-return");
});

test("malformed or oversized provider replies abstain with bounded structured attempts", async () => {
  for (const raw of [null, { ok: false }, { ok: true }, { ok: true, response: { backend: key, answers: [] } },
    { ok: true, response: { backend: key, answers: {}, extra: "x".repeat(100_000) } }]) {
    const result = await reviewStudyCandidates([candidate("a")], async () => raw as JudgementOutcome);
    expect(result.status).toBe("unavailable"); expect(result.estimates).toHaveLength(0);
    expect(result.attempts).toEqual([{ ok: false, error: { code: "response-malformed", retryable: false } }]);
  }
});
