import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initialSrsState, thresholdKey, type JudgementCaller, type JudgementQuestion, type PortableLearnerData, type UiDocument, type UiStudyPlanItem } from "@keating/learner-contracts";
import { initializeRepositorySchema, LearnerRecordStore, type AsyncSqlDatabase, type AsyncSqlExecutor, type SqlBindValue } from "../src/lib/learner-repository";
import { buildMobileReadinessCandidates, mobileReadinessSourceKey, reviewMobileStudyReadiness, type MobileReadinessSnapshot } from "../src/lib/judgement/readiness";
import type { MobileJudgementRuntime } from "../src/lib/judgement/runtime";

const AT = "2026-09-19T00:00:00.000Z";
function document(items: UiStudyPlanItem[]): UiDocument { return { schemaVersion: 1, id: "plan", revision: 1, lifecycle: "ready", supportedSurfaces: ["mobile"], createdAt: AT, updatedAt: AT, nodes: [{ type: "study-plan", id: "plan-node", title: "Fractions curriculum", items }] }; }
function fixture(): PortableLearnerData {
  return { generatedAt: AT, sessions: [], artifacts: [{ id: "plan-artifact", kind: "study-plan", format: "json", title: "Saved curriculum", content: JSON.stringify(document([
    { id: "parts", title: "Equal parts", dependsOn: [], outcomes: ["Recognize equal parts"] },
    { id: "fractions", title: "Fractions", dependsOn: ["parts"], outcomes: ["Compare two fractions"] },
  ])), createdAt: AT, updatedAt: AT }], goals: [],
    questionChecks: [{ id: "parts-check", topic: "Equal parts", question: "What makes parts equal?", answer: "The parts have equal size.", grading: "auto", score: 1, createdAt: AT },
      { id: "fraction-check", topic: "Fractions", question: "What is one half?", answer: "One of two equal parts.", grading: "pending", createdAt: AT }],
    quizResults: [], decks: [{ id: "fractions-deck", topic: "Fractions", title: "Fractions practice", createdAt: AT, updatedAt: AT, cards: [{ id: "half", front: "One half?", back: "One of two equal parts", tags: [], srs: initialSrsState(AT) }] }],
    cardReviews: [], studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [], learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 } };
}
function snapshot(data = fixture()): MobileReadinessSnapshot { return { data, nowIso: AT, hostedEnabled: true }; }
const backend = { backend: "system-one" as const, model: "jev-1.13.0", calibrationSha256: "a".repeat(64) };
function runtime(call: JudgementCaller, entries: Record<string, { deferBelow: number; actAtOrAbove: number }> = {}): MobileJudgementRuntime { return { hostedEnabled: true, call, policy: { tiers: [], calibration: { entries } } }; }
const answer: JudgementCaller = async request => ({ ok: true, response: { backend, answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [id,
  question.type === "noul" ? { type: "noul", noul: 0.95 } : { type: "choice", choice: "candidate_0", confidence: 0.98, probabilities: { candidate_0: 0.99, none: 0.01 } }])), elapsedMs: 1 } });

class Sqlite implements AsyncSqlDatabase {
  db = new Database(":memory:");
  async execAsync(sql: string) { this.db.exec(sql); }
  async runAsync(sql: string, ...params: SqlBindValue[]) { const result = this.db.query(sql).run(...params); return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }; }
  async getFirstAsync<T>(sql: string, ...params: SqlBindValue[]) { return this.db.query(sql).get(...params) as T | null; }
  async getAllAsync<T>(sql: string, ...params: SqlBindValue[]) { return this.db.query(sql).all(...params) as T[]; }
  async withExclusiveTransactionAsync(work: (transaction: AsyncSqlExecutor) => Promise<void>) { this.db.exec("BEGIN"); try { await work(this); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; } }
  async closeAsync() { this.db.close(); }
}

describe("mobile saved-work readiness", () => {
  test("binds actual SQLite saved work to due cards and explicit plan dependencies without writing learner records", async () => {
    const db = new Sqlite(); await initializeRepositorySchema(db); const records = new LearnerRecordStore(db);
    try {
      await records.replace(fixture());
      const data = await records.snapshot(); const source = snapshot(data); let sent: unknown;
      const result = await reviewMobileStudyReadiness(source, { current: () => source, runtime: runtime(async request => { sent = request.state; return answer(request); }) });
      expect(result.review.status).toBe("uncalibrated");
      expect(result.review.selectedId).toBeNull();
      expect(result.review.estimates[0]?.probability).toBe(0.95);
      expect(result.candidates[0]).toMatchObject({ due: true, covered: true, prerequisiteGraphKnown: true, prerequisites: [{ id: "Equal parts", covered: true }] });
      expect(result.candidates[0]!.work).toContainEqual({ question: "What is one half?", answer: "One of two equal parts.", result: "pending" });
      expect(JSON.stringify(sent)).toContain("The parts have equal size.");
      expect(JSON.stringify(sent)).not.toContain("learnerProfile");
      const after = await records.snapshot(); expect({ ...after, generatedAt: data.generatedAt }).toEqual(data);
    } finally { await db.closeAsync(); }
  });

  test("never invents a graph from a title or a mastery score, and gates unmet prerequisites before dispatch", async () => {
    for (const variant of ["missing-graph", "unmet", "not-due", "model-grade"] as const) {
      const data = fixture();
      if (variant === "missing-graph") data.artifacts = [];
      if (variant === "unmet") data.questionChecks = data.questionChecks.filter(check => check.topic !== "Equal parts");
      if (variant === "not-due") data.decks[0]!.cards[0]!.srs.dueAt = "2026-09-20T00:00:00.000Z";
      if (variant === "model-grade") { data.questionChecks[1]!.grading = "model"; data.questionChecks[1]!.score = 1; }
      const source = snapshot(data); let calls = 0;
      const result = await reviewMobileStudyReadiness(source, { current: () => source, runtime: runtime(async request => { calls++; return answer(request); }) });
      expect(calls).toBe(variant === "model-grade" ? 1 : 0);
      if (variant === "model-grade") expect(result.candidates[0]!.work.find(work => work.question === "What is one half?")?.result).toBe("pending");
      else expect(result.review.selectedId).toBeNull();
    }
  });

  test("rejects cyclic, missing and ambiguous canonical plan dependencies and uses known built-in topic graphs", () => {
    for (const items of [
      [{ id: "fractions", title: "Fractions", dependsOn: ["fractions"] }],
      [{ id: "fractions", title: "Fractions", dependsOn: ["missing"] }],
      [{ id: "first", title: "Fractions", dependsOn: [] }, { id: "second", title: "Fractions", dependsOn: [] }],
    ]) { const data = fixture(); data.artifacts[0]!.content = JSON.stringify(document(items)); expect(buildMobileReadinessCandidates(data, AT)[0]!.prerequisiteGraphKnown).toBe(false); }
    const data = fixture(); data.artifacts = []; data.decks[0]!.topic = "Derivative";
    expect(buildMobileReadinessCandidates(data, AT)[0]).toMatchObject({ prerequisiteGraphKnown: true, prerequisites: [{ id: "functions", covered: false }, { id: "limits", covered: false }, { id: "slope", covered: false }] });
    const canonical = fixture(); canonical.artifacts[0]!.content = JSON.stringify(document([{ id: "fractions", title: "Fractions" }]));
    expect(buildMobileReadinessCandidates(canonical, AT)[0]).toMatchObject({ prerequisiteGraphKnown: true, prerequisites: [] });
  });

  test("uses the latest saved native session plan revision and excludes an unfinished replacement", () => {
    const data = fixture(), original = JSON.parse(data.artifacts[0]!.content!) as UiDocument;
    data.artifacts = [];
    const replacement = document([{ id: "fractions", title: "Fractions", outcomes: ["Explain a new saved requirement"] }]); replacement.revision = 2;
    data.sessions = [{ id: "session", title: "Fractions", createdAt: AT, updatedAt: AT, activeBranchId: "branch", branches: [{ id: "branch", sessionId: "session", createdAt: AT, updatedAt: AT }], messages: [{ id: "assistant", role: "assistant", content: "Saved plan", createdAt: AT, agentEvents: [
      { id: "first-plan", type: "ui-document", turnId: "turn", sequence: 0, occurredAt: AT, document: original },
      { id: "latest-plan", type: "ui-document", turnId: "turn", sequence: 1, occurredAt: AT, document: replacement },
    ] }] }];
    const [candidate] = buildMobileReadinessCandidates(data, AT);
    expect(candidate!.prerequisites).toEqual([]);
    expect(candidate!.requirements).toContain("Explain a new saved requirement");
    replacement.lifecycle = "streaming";
    expect(buildMobileReadinessCandidates(data, AT)[0]!.prerequisiteGraphKnown).toBe(false);
  });

  test("selects only after exact Noul and Choice calibrations exist, with a separate none option", async () => {
    const source = snapshot(), entries: Record<string, { deferBelow: number; actAtOrAbove: number }> = {};
    const selectedRuntime = runtime(answer, entries);
    const first = await reviewMobileStudyReadiness(source, { current: () => source, runtime: selectedRuntime });
    for (const digest of Object.values(first.review.questionDigests)) entries[thresholdKey(backend, digest)] = { deferBelow: 0.8, actAtOrAbove: 0.9 };
    const second = await reviewMobileStudyReadiness(source, { current: () => source, runtime: selectedRuntime });
    expect(second.review.status).toBe("uncalibrated");
    const selection = second.review.questionDigests.selection!;
    expect((JSON.parse(selection) as JudgementQuestion).type).toBe("choice");
    entries[thresholdKey(backend, selection)] = { deferBelow: 0.8, actAtOrAbove: 0.9 };
    const final = await reviewMobileStudyReadiness(source, { current: () => source, runtime: selectedRuntime });
    expect(final.review.status).toBe("selected");
    expect(final.review.selectedId).toBe("deck:fractions-deck");
    expect(final.review.attempts).toHaveLength(2);
    let stageCalls = 0;
    const changedSource = structuredClone(source);
    const staleRuntime = runtime(async request => { stageCalls++; changedSource.data.questionChecks[0]!.answer = "New answer"; return answer(request); }, entries);
    const stale = await reviewMobileStudyReadiness(changedSource, { current: () => changedSource, runtime: staleRuntime });
    expect(stale.review.status).toBe("cancelled"); expect(stageCalls).toBe(1);
    const none = runtime(async request => {
      if (request.questions.selection) return { ok: true, response: { backend, answers: { selection: { type: "choice", choice: "none", confidence: 0.99, probabilities: { candidate_0: 0.01, none: 0.99 } } }, elapsedMs: 1 } };
      return answer(request);
    }, entries);
    expect((await reviewMobileStudyReadiness(source, { current: () => source, runtime: none })).review.selectedId).toBeNull();
  });

  test("settings off or fully blocked work never resolves account runtime", async () => {
    let calls = 0;
    for (const enabled of [false, true]) {
      const source = snapshot(); source.hostedEnabled = enabled; if (enabled) source.data.artifacts = [];
      await reviewMobileStudyReadiness(source, { current: () => source, runtimeFactory: async () => { calls++; return runtime(answer); } });
    }
    expect(calls).toBe(0);
  });

  test("due fronts, canonical aliases and complete candidate sets remain exact while oversized inputs abstain", async () => {
    const data = fixture();
    data.decks[0]!.cards.push({ id: "later", front: "FUTURE CARD DO NOT SEND", back: "Future answer", tags: [], srs: { ...initialSrsState(AT), dueAt: "2026-09-20T00:00:00.000Z" } });
    const [candidate] = buildMobileReadinessCandidates(data, AT);
    expect(candidate!.requirements).toContain("One half?");
    expect(candidate!.requirements).not.toContain("FUTURE CARD DO NOT SEND");
    data.artifacts = []; data.decks[0]!.topic = "bayes-rule";
    data.questionChecks = ["Bayes' Rule", "conditional probability", "fractions", "base rates"].map((topic, index) => ({ id: `check-${index}`, topic, question: `Explain ${topic}`, answer: "A saved learner response", grading: "auto", score: 0.5, createdAt: AT }));
    const [known] = buildMobileReadinessCandidates(data, AT);
    expect(known!.covered).toBe(true); expect(known!.prerequisites.every(item => item.covered)).toBe(true);
    expect(known!.work.some(work => work.question === "Explain Bayes' Rule")).toBe(true);
    expect(known!.work.every(work => work.result === "pending")).toBe(true);
    const source = snapshot(); source.data.decks.push(...Array.from({ length: 25 }, (_, i) => ({ ...structuredClone(source.data.decks[0]!), id: `future-${i}`, cards: [{ ...structuredClone(source.data.decks[0]!.cards[0]!), id: `future-card-${i}`, srs: { ...initialSrsState(AT), dueAt: "2026-09-20T00:00:00.000Z" } }] })));
    expect(buildMobileReadinessCandidates(source.data, AT)).toHaveLength(1);
    let calls = 0;
    const oversized = snapshot(); oversized.data.questionChecks[0]!.answer = "x".repeat(250_001);
    expect(mobileReadinessSourceKey(oversized)).toBeNull();
    expect((await reviewMobileStudyReadiness(oversized, { current: () => oversized, runtimeFactory: async () => { calls++; return runtime(answer); } })).review.status).toBe("unavailable");
    expect(calls).toBe(0);
    const manyCards = snapshot(); manyCards.data.decks[0]!.cards = Array.from({ length: 101 }, (_, i) => ({ ...structuredClone(manyCards.data.decks[0]!.cards[0]!), id: `card-${i}` }));
    expect((await reviewMobileStudyReadiness(manyCards, { current: () => manyCards, runtimeFactory: async () => { calls++; return runtime(answer); } })).review.status).toBe("unavailable");
    expect(calls).toBe(0);
    const reused = snapshot(); reused.data.learnerProfile.strengths = reused.data.learnerProfile.weaknesses;
    expect(mobileReadinessSourceKey(reused)).not.toBeNull();
    const cyclic = snapshot(); (cyclic.data as unknown as Record<string, unknown>).cycle = cyclic;
    expect(mobileReadinessSourceKey(cyclic)).toBeNull();
  });

  test("edited work, profile, settings, schedules or page exit discard a pending result", async () => {
    const mutations: ((source: MobileReadinessSnapshot) => MobileReadinessSnapshot | null)[] = [
      source => { source.data.questionChecks[0]!.answer = "Changed answer"; return source; },
      source => { source.data.learnerProfile.strengths.push("Changed profile"); return source; },
      source => { source.hostedEnabled = false; return source; },
      source => { source.data.decks[0]!.cards[0]!.srs.dueAt = "2026-09-20T00:00:00.000Z"; return source; },
      () => null,
    ];
    for (const mutate of mutations) {
      const source = snapshot(); let latest: MobileReadinessSnapshot | null = source;
      const result = await reviewMobileStudyReadiness(source, { current: () => latest, runtime: runtime(async request => { latest = mutate(source); return answer(request); }) });
      expect(result.review.status).toBe("cancelled"); expect(result.review.estimates).toEqual([]); expect(result.review.selectedId).toBeNull();
    }
  });

  test("cancellation and deadline settle even when inference or runtime setup ignores abort", async () => {
    const source = snapshot(), controller = new AbortController();
    const promise = reviewMobileStudyReadiness(source, { current: () => source, signal: controller.signal, runtime: runtime(async () => { controller.abort(); return new Promise(() => {}); }) });
    expect((await promise).review.status).toBe("cancelled");
    const timeout = await reviewMobileStudyReadiness(source, { current: () => source, timeoutMs: 5, runtimeFactory: () => new Promise(() => {}) });
    expect(timeout.review.status).toBe("cancelled");
  });
});
