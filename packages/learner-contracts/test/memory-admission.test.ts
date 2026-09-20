import { describe, expect, test } from "bun:test";
import { isAcceptedMemoryAdmissionDecision, isConsistentMemoryAdmissionDecision, memoryAdmissionQuestions, reviewMemoryCandidates, type MemoryAdmissionCandidate } from "../src/judgement/memory-admission.js";
import { questionDigest, type JudgementBackendKey, type JudgementCaller, type JudgementOutcome } from "../src/judgement/contracts.js";
import { thresholdKey, type CalibrationTable } from "../src/judgement/projections.js";

const backend: JudgementBackendKey = { backend: "system-one", model: "jev-1.13.0", calibrationSha256: "a".repeat(64) };
function candidate(id = "c1"): MemoryAdmissionCandidate {
  const evidence = "I enjoy astronomy.";
  return { id, evidence, message: `For context: ${evidence}`, sessionId: "s1", messageId: "m1", start: 13, end: 13 + evidence.length };
}
function outcome(worth = 0.95, confidence = 0.96, category = "interest"): JudgementOutcome {
  const probabilities = Object.fromEntries(Object.keys(memoryAdmissionQuestions().category.criteria).map(key => [key, key === category ? 1 : 0]));
  return { ok: true, response: { backend: { ...backend }, answers: {
    worth: { type: "noul", noul: worth }, category: { type: "choice", choice: category, confidence, probabilities },
  } } };
}
function calibration(): CalibrationTable {
  return { entries: Object.fromEntries(Object.values(memoryAdmissionQuestions()).map(question => [thresholdKey(backend, questionDigest(question)), { deferBelow: 0.9, actAtOrAbove: 0.9 }])) };
}

describe("memory admission", () => {
  test("only exact calibration permits admission; receipts and requests are detached and frozen", async () => {
    const input = candidate(), raw = outcome();
    const [result] = await reviewMemoryCandidates([input], async request => {
      expect((request.state as { candidate: MemoryAdmissionCandidate }).candidate).toEqual(input);
      expect(Object.isFrozen(request.questions)).toBe(true);
      return raw;
    }, calibration());
    expect(result?.accepted).toBe(true);
    expect(result?.source).toBe("proxy");
    expect(result?.probability).toBe(0.95);
    expect(isAcceptedMemoryAdmissionDecision(result, calibration())).toBe(true);
    expect(Object.isFrozen(result?.answers?.category.probabilities)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    if (raw.ok) (raw.response.answers.worth as { noul: number }).noul = 0;
    expect(result?.answers?.worth.noul).toBe(0.95);
    for (const table of [undefined, { entries: {} }, { entries: Object.fromEntries(Object.entries(calibration().entries).map(([key, value]) => [key.replace("jev-1.13.0", "jev-1.12.0"), value])) }]) {
      const [unfitted] = await reviewMemoryCandidates([candidate()], async () => outcome(), table);
      expect(unfitted?.reason).toBe("uncalibrated");
      expect(unfitted?.answers?.worth.noul).toBe(0.95);
    }
  });

  test("uses fitted positive Noul and Choice confidence thresholds, never a symmetric cutoff", async () => {
    for (const [raw, expected] of [[outcome(0.9, 0.9), "accepted"], [outcome(0.89), "below-threshold"], [outcome(0.99, 0.89), "below-threshold"], [outcome(0.99, 0.99, "not-memory"), "not-memory"]] as const) {
      const [result] = await reviewMemoryCandidates([candidate()], async () => raw, calibration());
      expect(result?.reason).toBe(expected);
    }
    const table = calibration(), key = thresholdKey(backend, questionDigest(memoryAdmissionQuestions().worth));
    const changedQuestion = { ...memoryAdmissionQuestions().worth, instructions: "Different task" };
    const wrongQuestionTable = { entries: { ...table.entries, [thresholdKey(backend, questionDigest(changedQuestion))]: table.entries[key]! } };
    delete wrongQuestionTable.entries[key];
    expect((await reviewMemoryCandidates([candidate()], async () => outcome(), wrongQuestionTable))[0]?.reason).toBe("uncalibrated");
  });

  test("rejects incomplete distributions, extra answers, aliases and fixture backends", async () => {
    const mutations: ((raw: any) => void)[] = [
      raw => delete raw.response.answers.category.probabilities["not-memory"],
      raw => { raw.response.answers.category.probabilities.other = 0; },
      raw => { raw.response.answers.category.probabilities.motivation = 1; },
      raw => { raw.response.answers.category.choice = "unknown"; },
      raw => { raw.response.answers.category.confidence = NaN; },
      raw => { raw.response.answers.worth.confidence = 1; },
      raw => { raw.response.answers.extra = { type: "noul", noul: 1 }; },
      raw => { raw.response.backend.model = "jev-latest"; },
      raw => { raw.response.backend.model = "fixture-model"; },
      raw => { raw.response.backend.backend = "fixture"; },
    ];
    for (const mutate of mutations) {
      const raw = outcome(); mutate(raw);
      expect((await reviewMemoryCandidates([candidate()], async () => raw, calibration()))[0]?.reason).toBe("invalid-response");
    }
    const raw = outcome();
    if (raw.ok) (raw.response.backend as { calibrationSha256: null }).calibrationSha256 = null;
    expect((await reviewMemoryCandidates([candidate()], async () => raw, calibration()))[0]?.reason).toBe("uncalibrated");
  });

  test("revalidates receipts against questions, source coordinates and independently supplied thresholds", async () => {
    const [result] = await reviewMemoryCandidates([candidate()], async () => outcome(), calibration());
    for (const mutate of [
      (value: any) => { value.probability = 1; },
      (value: any) => { value.questions.worth.instructions += " altered"; },
      (value: any) => { value.candidate.start++; },
      (value: any) => { value.thresholds.worth.actAtOrAbove = 0; },
      (value: any) => { value.answers.worth.noul = 0.1; },
      (value: any) => { value.category = "motivation"; },
    ]) {
      const forged = structuredClone(result); mutate(forged);
      expect(isAcceptedMemoryAdmissionDecision(forged, calibration())).toBe(false);
    }
    expect(isAcceptedMemoryAdmissionDecision(result, { entries: {} })).toBe(false);
  });

  test("validates full quote coordinates and bounds before inference", async () => {
    let calls = 0;
    const call: JudgementCaller = async () => { calls++; return outcome(); };
    for (const change of [{ evidence: "no" }, { evidence: "x".repeat(241) }, { message: "x".repeat(4001) }, { start: 1.5 }, { end: 1 }, { message: "Someone else's message" }]) {
      const [result] = await reviewMemoryCandidates([{ ...candidate(), ...change }], call, calibration());
      expect(result?.reason).toBe("invalid-candidate");
    }
    expect(calls).toBe(0);
    await expect(reviewMemoryCandidates(Array.from({ length: 5 }, (_, i) => candidate(String(i))), call)).rejects.toBeInstanceOf(RangeError);
    await expect(reviewMemoryCandidates([candidate(), candidate()], call)).rejects.toBeInstanceOf(RangeError);
    expect(await reviewMemoryCandidates([], call)).toEqual([]);
  });

  test("historical rubric receipts remain readable without authorizing new admission", async () => {
    const [result] = await reviewMemoryCandidates([candidate()], async () => outcome(), calibration());
    const historical = structuredClone(result) as any;
    historical.questions.worth.instructions = "Earlier captured worth rubric for state.candidate.evidence.";
    historical.questions.category.criteria.interest = "Earlier interest category description.";
    expect(isConsistentMemoryAdmissionDecision(historical)).toBe(true);
    expect(isAcceptedMemoryAdmissionDecision(historical, calibration())).toBe(false);
    for (const mutate of [
      (value: any) => { value.questions.worth.instructions = ""; },
      (value: any) => { delete value.questions.category.criteria["not-memory"]; },
      (value: any) => { value.questions.category.criteria.invented = "new vocabulary"; },
      (value: any) => { value.questions.worth.type = "choice"; },
      (value: any) => { value.thresholds.worth.actAtOrAbove = -1; },
      (value: any) => { value.thresholds.category.actAtOrAbove = 1; },
      (value: any) => { value.backend.calibrationSha256 = null; },
      (value: any) => { value.candidate.evidence = "unrelated text"; },
      (value: any) => { value.probability = 0.1; },
      (value: any) => { value.source = "observed"; },
    ]) {
      const corrupted = structuredClone(historical); mutate(corrupted);
      expect(isConsistentMemoryAdmissionDecision(corrupted)).toBe(false);
    }
  });

  test("bounds concurrency at two, preserves order and identical questions across positions", async () => {
    let active = 0, peak = 0;
    const questions: string[] = [];
    const results = await reviewMemoryCandidates(Array.from({ length: 4 }, (_, i) => candidate(String(i))), async request => {
      peak = Math.max(peak, ++active); questions.push(JSON.stringify(request.questions));
      await Promise.resolve(); active--; return outcome();
    }, calibration());
    expect(peak).toBe(2);
    expect(results.map(result => result.candidate.id)).toEqual(["0", "1", "2", "3"]);
    expect(new Set(questions).size).toBe(1);
    expect(Object.isFrozen(results)).toBe(true);
  });

  test("backend drift across a batch preserves raw receipts but prevents every admission", async () => {
    const table = calibration();
    for (const question of Object.values(memoryAdmissionQuestions())) {
      (table.entries as Record<string, unknown>)[thresholdKey({ ...backend, model: "jev-1.12.0" }, questionDigest(question))] = { deferBelow: 0.9, actAtOrAbove: 0.9 };
    }
    let calls = 0;
    const results = await reviewMemoryCandidates([candidate("1"), candidate("2")], async () => {
      const raw = outcome();
      if (calls++ && raw.ok) (raw.response.backend as { model: string }).model = "jev-1.12.0";
      return raw;
    }, table);
    expect(results.every(result => result.reason === "invalid-response" && !result.accepted)).toBe(true);
    expect(results.every(result => result.answers?.worth.noul === 0.95)).toBe(true);
  });

  test("abort settles uncooperative calls and never starts remaining candidates", async () => {
    const controller = new AbortController(); let calls = 0;
    const pending = reviewMemoryCandidates([candidate("1"), candidate("2"), candidate("3")], () => {
      calls++; return new Promise(() => {});
    }, calibration(), controller.signal);
    await Promise.resolve(); controller.abort();
    const results = await pending;
    expect(calls).toBe(2);
    expect(results.every(result => result.reason === "aborted" && !result.accepted)).toBe(true);
    const failure = await reviewMemoryCandidates([candidate()], async () => { throw new Error("offline"); });
    expect(failure[0]?.reason).toBe("unavailable");
  });
});
