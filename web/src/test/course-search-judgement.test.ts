import { expect, test } from "bun:test";
import { rankingHoldoutAssignment, type JudgementBackendKey, type JudgementOutcome, type JudgementRequest } from "@keating/learner-contracts";
import { courseSchema, type Course } from "../courses/contracts";
import { searchCourse } from "../courses/course-search";
import { prepareCourseSearch, projectCourseSearch, rerankCourseSearch, createCourseSearchJudgementSession, type CourseSearchView } from "../courses/course-search-judgement";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";

function course(): Course {
  return courseSchema.parse({ schemaVersion: 1, id: "course_search", title: "Causal inference", description: "", outcomes: [], ownerAccountId: "teacher", createdAt: "2026-09-19T00:00:00Z", updatedAt: "2026-09-19T00:00:00Z", revision: 1,
    modules: [{ id: "module", title: "Foundations", description: "", lessons: Array.from({ length: 10 }, (_, i) => ({
      id: `lesson_${i}`, title: `Collider ${String(i).padStart(2, "0")}`, summary: "Explain collider effects", reading: `Explain collider effects with evidence from example ${i}.`, objectives: [], materialIds: [], cardIds: [],
    })) }], materials: [], artifacts: [], cards: [], assignments: [], members: [{ accountId: "teacher", displayName: "Teacher", role: "owner", teacherAccess: "full", joinedAt: "2026-09-19T00:00:00Z", progress: { completedLessonIds: [], lastActiveAt: "2026-09-19T00:00:00Z" } }], sharedNotes: [], submissions: [], assignmentSubmissions: [], comments: [], reactions: [], activity: [],
    settings: { teacherAccessPolicy: "request", allowPeerDeckEdits: true, allowPeerComments: true },
  });
}
const hosted: JudgementBackendKey = { backend: "system-one", model: "judgement", calibrationSha256: null };
const concrete = { ...hosted, model: "jev-search-v1" };
const local: JudgementBackendKey = { backend: "local", model: "local-search-v1", calibrationSha256: null };
function runtime(tiers: WebJudgementRuntime["policy"]["tiers"], backend: "off" | "local" | "hosted" = "hosted"): WebJudgementRuntime {
  return { settings: { backend, localModelId: local.model, gatewayPath: "/api/judgement" }, policy: { tiers, calibration: { entries: {} } } };
}
function answer(request: JudgementRequest, backend = concrete, problem?: "bimodal" | "missing" | "support" | "legend"): JudgementOutcome {
  return { ok: true, response: { backend, answers: Object.fromEntries(Object.entries(request.questions).flatMap(([key, question]) => {
    if (question.type !== "score") throw new Error("only per-item Scores");
    if (problem === "missing" && key === "relevance:0") return [];
    const index = Number(key.split(":")[1]); const level = key.startsWith("support:") ? 2 : index === 1 ? 3 : 1;
    return [[key, { type: "score", score: level, confidence: 1,
      probabilities: (problem === "bimodal" && key === "relevance:0") || (problem === "support" && key.startsWith("support:"))
        ? { "0": 0.5, "1": 0, "2": 0, "3": 0.5 } : Object.fromEntries(question.criteria.map((_, i) => [String(i), i === level ? 1 : 0])),
      legend: Object.fromEntries(question.criteria.map((label, index) => [String(index), problem === "legend" && key === "relevance:0" ? "invented level" : label])),
    }]];
  })) } } as JudgementOutcome;
}

test("recall remains lexical and immediate; a suggestion reorders eligible positions in the eight-item shortlist", async () => {
  const source = course(); const input = prepareCourseSearch(source, "collider");
  expect(input.results).toEqual(searchCourse(source, "collider", { limit: 24 }));
  expect(input.cohort.assignments).toHaveLength(8);
  expect(input.candidates.length).toBe(input.cohort.assignments.filter(row => !row.heldOut).length);
  expect(Object.keys(input.request!.questions)).toHaveLength(input.candidates.length);
  let calls = 0;
  const review = await rerankCourseSearch(input, runtime([{ key: hosted, call: async request => { calls++; return answer(request); } }]));
  expect(calls).toBe(1); expect(review.status).toBe("suggested"); expect(review.backend).toEqual(concrete);
  expect(review.calibration).toBe("uncalibrated"); expect(review.results[input.cohort.assignments.find(row => !row.heldOut)!.index]!.key).toBe(input.candidates[1]!.key);
  expect(review.results.slice(8)).toEqual(input.results.slice(8));
  expect(review.results.map(result => result.key).sort()).toEqual(input.results.map(result => result.key).sort());
  expect(review.results.every(result => result === input.results.find(original => original.key === result.key))).toBe(true);
  expect(review.dimensions.every(value => value.support === null)).toBe(true);
  expect(review.attempts).toHaveLength(1);
});

test("answer support concerns supplied information and may stay unknown without blocking navigation or relevance", async () => {
  const input = prepareCourseSearch(course(), "explain collider");
  expect(Object.keys(input.request!.questions)).toHaveLength(input.candidates.length * 2);
  expect(input.request!.questions["support:0"]!.instructions).toContain("sourceExcerpt");
  const review = await rerankCourseSearch(input, runtime([{ key: hosted, call: async request => answer(request, concrete, "support") }]));
  expect(review.status).toBe("suggested"); expect(review.dimensions.every(value => value.support === null)).toBe(true);
  expect(review.results[input.cohort.assignments.find(row => !row.heldOut)!.index]!.key).toBe(input.candidates[1]!.key);
});

for (const problem of ["bimodal", "missing", "legend"] as const) test(`${problem} relevance retains all lexical results and raw attempt`, async () => {
  const input = prepareCourseSearch(course(), "collider");
  const review = await rerankCourseSearch(input, runtime([{ key: hosted, call: async request => answer(request, concrete, problem) }]));
  expect(review.status).toBe("baseline"); expect(review.results).toEqual(input.results); expect(review.dimensions).toEqual([]);
  expect(review.attempts).toHaveLength(1);
});

test("off, local-only, budget and unresolved identity cannot dispatch or apply hosted suggestions", async () => {
  let hostedCalls = 0;
  const tiers: WebJudgementRuntime["policy"]["tiers"] = [{ key: hosted, call: async request => { hostedCalls++; return answer(request); } }];
  const input = prepareCourseSearch(course(), "collider");
  for (const backend of ["off", "local"] as const) expect((await rerankCourseSearch(input, runtime(tiers, backend))).results).toEqual(input.results);
  expect((await rerankCourseSearch(prepareCourseSearch(course(), `collider${" ".repeat(1_000)}`), runtime(tiers))).reason).toBe("input-budget");
  expect(hostedCalls).toBe(0);
  const alias = await rerankCourseSearch(input, runtime([{ key: hosted, call: async request => answer(request, hosted) }]));
  expect(alias.status).toBe("baseline");
});

test("local uncertainty escalates only when hosted is explicitly allowed", async () => {
  let hostedCalls = 0;
  const tiers: WebJudgementRuntime["policy"]["tiers"] = [
    { key: local, call: async request => answer(request, local, "bimodal") },
    { key: hosted, call: async request => { hostedCalls++; return answer(request); } },
  ];
  const input = prepareCourseSearch(course(), "collider");
  expect((await rerankCourseSearch(input, runtime(tiers, "local"))).status).toBe("baseline"); expect(hostedCalls).toBe(0);
  const review = await rerankCourseSearch(input, runtime(tiers));
  expect(review.status).toBe("suggested"); expect(hostedCalls).toBe(1); expect(review.attempts).toHaveLength(2);
});

test("supplied excerpts include the query match and expose truncation without fetching link contents", () => {
  const source = course();
  const eligible = source.modules[0]!.lessons.find(lesson => !rankingHoldoutAssignment(JSON.stringify(["course-search-v1", source.id]), `lesson:${lesson.id}`, 1000).heldOut)!;
  eligible.reading = `${"prefix ".repeat(300)}needle source tail`;
  const input = prepareCourseSearch(source, "needle");
  expect(input.candidates[0]!.sourceExcerpt).toContain("needle"); expect(input.candidates[0]!.sourceTruncated).toBe(true);
  expect(input.candidates[0]!.sourceStart).toBeGreaterThan(0);
  expect(input.candidates[0]!.sourceExcerpt.length).toBeLessThanOrEqual(1_600);
});

test("production palette session never dispatches on query update, only the explicit suggestion action", async () => {
  const views: CourseSearchView[] = []; let calls = 0;
  const configured = runtime([{ key: hosted, call: async request => { calls++; return answer(request); } }]);
  const session = createCourseSearchJudgementSession(view => views.push(view), () => configured);
  const input = prepareCourseSearch(course(), "collider"); session.update(input, configured.settings);
  expect(calls).toBe(0); expect(views.at(-1)!.pending).toBe(false);
  await session.suggest(); expect(calls).toBe(1); expect(views.at(-1)!.review!.status).toBe("suggested");
  session.update(input, configured.settings); expect(calls).toBe(1); expect(views.at(-1)!.review).toBeNull(); session.cancel();
});

for (const change of ["query", "source", "settings", "close"] as const) test(`${change} cancels stale search suggestions, including a noncooperative caller`, async () => {
  let resolve!: (value: JudgementOutcome) => void; let started!: () => void; let request!: JudgementRequest; let signal: AbortSignal | undefined;
  const dispatched = new Promise<void>(done => { started = done; });
  const configured = runtime([{ key: hosted, call: async (input, abort) => { request = input; signal = abort; started(); return new Promise(done => { resolve = done; }); } }]);
  const views: CourseSearchView[] = []; const session = createCourseSearchJudgementSession(view => views.push(view), () => configured);
  const source = course(); const input = prepareCourseSearch(source, "collider");
  session.update(input, configured.settings); const pending = session.suggest(); await dispatched;
  if (change === "close") session.cancel();
  else if (change === "settings") session.update(input, { ...configured.settings, backend: "off" });
  else {
    if (change === "source") { source.modules[0]!.lessons[0]!.reading = "changed collider source"; source.revision++; }
    session.update(prepareCourseSearch(source, change === "query" ? "explain collider" : "collider"), configured.settings);
  }
  const count = views.length; expect(signal?.aborted).toBe(true);
  resolve(answer(request)); await pending;
  expect(views).toHaveLength(count); expect(views.at(-1)!.review).toBeNull();
});


/** Select deterministic IDs for a deliberate control layout without overriding production policy. */
function courseWithCohort(heldOut: readonly boolean[]): Course {
  const source = course();
  const template = source.modules[0]!.lessons[0]!;
  const namespace = JSON.stringify(["course-search-v1", source.id]);
  let next = 0;
  source.modules[0]!.lessons = heldOut.map((control, index) => {
    let id: string;
    do { id = `stable_item_${next++}`; } while (rankingHoldoutAssignment(namespace, `lesson:${id}`, 1000).heldOut !== control);
    return { ...template, id, title: `Collider ${String(index).padStart(2, "0")}`, reading: `Unique authored evidence for ${id}. Explain collider effects.` };
  });
  return source;
}

test("actual rerank request excludes every held-out key and excerpt, without tail backfill", async () => {
  const input = prepareCourseSearch(courseWithCohort([false, true, false, false, true, false, false, false, false, false]), "collider");
  expect(input.cohort.assignments.filter(row => row.heldOut).map(row => row.index)).toEqual([1, 4]);
  const eligible = input.cohort.assignments.filter(row => !row.heldOut);
  let captured: JudgementRequest | undefined;
  const review = await rerankCourseSearch(input, runtime([{ key: hosted, call: async request => { captured = request; return answer(request); } }]));
  expect(review.status).toBe("suggested"); expect(captured).toBeDefined();
  expect((captured!.state as { candidates: { key: string }[] }).candidates.map(candidate => candidate.key)).toEqual(eligible.map(row => row.key));
  expect(Object.keys(captured!.questions)).toHaveLength(6);
  for (const row of input.cohort.assignments.filter(row => row.heldOut)) {
    expect(JSON.stringify(captured)).not.toContain(row.key);
    expect(JSON.stringify(captured)).not.toContain(`Unique authored evidence for ${input.results[row.index]!.id}`);
    expect(review.results[row.index]).toBe(input.results[row.index]);
  }
  expect(review.results.slice(8)).toEqual(input.results.slice(8));
  expect(review.cohort).toEqual(input.cohort); expect(review.cohort).not.toBe(input.cohort);
});

test("pure score projection is a permutation inside eligible slots and preserves original objects", () => {
  const input = prepareCourseSearch(courseWithCohort([true, false, true, false, false, false, false, false, false, false]), "collider");
  const baseline = [...input.results];
  const outcome = answer(input.request!); if (!outcome.ok) throw new Error("fixture");
  const projected = projectCourseSearch(input, outcome.response)!;
  const slots = input.cohort.assignments.filter(row => !row.heldOut).map(row => row.index);
  expect(projected.results[slots[0]!]!.key).toBe(input.candidates[1]!.key);
  for (let index = 0; index < baseline.length; index++) {
    if (!slots.includes(index)) expect(projected.results[index]).toBe(baseline[index]);
  }
  expect(projected.results.map(result => result.key).sort()).toEqual(baseline.map(result => result.key).sort());
  expect(projected.results.every(result => baseline.includes(result))).toBe(true);
  expect(input.results).toEqual(baseline);
});

test("cohort membership is independent of query, revision and baseline ordering", () => {
  const source = courseWithCohort([false, true, false, true, false, false, false, false]);
  const baseline = prepareCourseSearch(source, "collider");
  const membership = new Map(baseline.cohort.assignments.map(row => [row.key, { bucket: row.bucket, heldOut: row.heldOut }]));
  source.revision++;
  source.modules[0]!.lessons.reverse().forEach((lesson, index) => { lesson.title = `Collider ${String(index).padStart(2, "0")}`; });
  const next = prepareCourseSearch(source, "explain collider");
  expect(next.results.map(row => row.key)).not.toEqual(baseline.results.map(row => row.key));
  expect(next.cohort.namespace).toBe(baseline.cohort.namespace);
  for (const row of next.cohort.assignments) expect({ bucket: row.bucket, heldOut: row.heldOut }).toEqual(membership.get(row.key)!);
  expect(next.cohort.policyVersion).toBe("stable-item-v1"); expect(next.cohort.holdoutBasisPoints).toBe(1000);
});

for (const eligibleCount of [0, 1]) test(`${eligibleCount} eligible shortlist items makes no model call through the real session`, async () => {
  const input = prepareCourseSearch(courseWithCohort([...Array.from({ length: 8 }, (_, index) => index >= eligibleCount), false, false]), "collider");
  expect(input.candidates).toHaveLength(eligibleCount); expect(input.request).toBeNull();
  let calls = 0; const views: CourseSearchView[] = [];
  const configured = runtime([{ key: hosted, call: async request => { calls++; return answer(request); } }]);
  const session = createCourseSearchJudgementSession(view => views.push(view), () => configured);
  session.update(input, configured.settings); await session.suggest();
  expect(calls).toBe(0); expect(views.at(-1)!.review!.status).toBe("baseline");
  expect(views.at(-1)!.review!.results).toEqual(input.results);
  expect(views.at(-1)!.review!.cohort).toEqual(input.cohort);
});


test("projection cannot substitute a same-key tail object for an eligible shortlist object", () => {
  const input = prepareCourseSearch(courseWithCohort([false, true, false, false, false, false, false, false, false]), "collider");
  const firstEligible = input.cohort.assignments.find(row => !row.heldOut)!;
  const original = input.results[firstEligible.index]!;
  const sameKeyTail = { ...original, title: "Different tail object" };
  input.results[8] = sameKeyTail;
  const outcome = answer(input.request!); if (!outcome.ok) throw new Error("fixture");
  const projected = projectCourseSearch(input, outcome.response)!;
  expect(projected.results[8]).toBe(sameKeyTail);
  expect(projected.results.slice(0, 8)).toContain(original);
  expect(projected.results.slice(0, 8)).not.toContain(sameKeyTail);
});
