import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { JudgementRequest, JudgementResponse } from "@keating/learner-contracts";
import { courseSchema, type CourseViewerSnapshot } from "../courses/contracts";
import { buildCourseAuthorSnapshot, courseEvidenceQuestions, courseReviewKey, queueCourseReview, clearCourseJudgement, readCourseJudgement, reviewCourseSnapshot } from "../courses/course-judgement";
import { buildCourseSubmissionSnapshot } from "../courses/course-submission-judgement";
import { CourseJudgementDetails, CourseJudgementPanel } from "../components/courses/CourseJudgementPanel";
import { CourseReviewPanel } from "../components/courses/CourseReviewPanel";
import { createCourseTools } from "../keating/browser-tools/courses";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";

const NOW = "2026-09-19T12:00:00.000Z";
const backend = { backend: "system-one" as const, model: "jev-test-version", calibrationSha256: null };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function fixture(): CourseViewerSnapshot {
  const viewer = { accountId: "author", displayName: "PRIVATE NAME", role: "owner" as const, teacherAccess: "full" as const,
    joinedAt: NOW, progress: { completedLessonIds: [], lastActiveAt: NOW } };
  return { viewer, permissions: { canEditCourse: true, canEditDeck: true, canInvite: true, canReview: true, canRequestTeacherAccess: true },
    course: courseSchema.parse({ schemaVersion: 1, id: "course_review", title: "Fractions", description: "For beginners", outcomes: ["Explain one half"], ownerAccountId: viewer.accountId,
      createdAt: NOW, updatedAt: NOW, revision: 1, members: [viewer], settings: {},
      modules: [{ id: "module_one", title: "Equal parts", lessons: [{ id: "lesson_one", title: "Halves", objectives: ["Recognize one half"],
        reading: "One half is one of two equal parts.", exercise: { id: "exercise_one", prompt: "Explain one half.", rubric: ["Specifies two equal parts"] } }] }],
      cards: [{ id: "card_one", front: "What is one half?", back: "One of two equal parts.", tags: [], lessonId: "lesson_one", updatedAt: NOW, updatedBy: viewer.accountId }],
      assignments: [{ id: "assignment_one", title: "Draw halves", brief: "Describe a drawing of one half.", rubric: ["Two equal parts"], deliverables: ["A description"], lessonId: "lesson_one", updatedAt: NOW, updatedBy: viewer.accountId }],
      submissions: [ { id: "submission_one", lessonId: "lesson_one", exerciseId: "exercise_one", answer: "One of two equal parts.", accountId: "learner", version: 1, updatedAt: NOW },
        { id: "submission_other", lessonId: "lesson_one", exerciseId: "exercise_one", answer: "OTHER PRIVATE SUBMISSION", accountId: "other", version: 1, updatedAt: NOW } ],
      assignmentSubmissions: [{ id: "assignment_submission", assignmentId: "assignment_one", accountId: "learner", answer: "Two equal rectangles, one shaded.", status: "submitted", version: 1, updatedAt: NOW }],
      sharedNotes: [{ id: "note_private", lessonId: "lesson_one", title: "Secret", text: "PRIVATE SHARED NOTE", version: 1, updatedAt: NOW, updatedBy: "other" }] }) };
}
function response(request: JudgementRequest, verdict = "attention"): JudgementResponse {
  return { backend, answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type !== "choice") throw Error("Expected a closed vocabulary");
    const labels = Object.keys(question.criteria);
    const selected = labels.includes("supported") ? verdict : labels.find(label => label !== "none")!;
    return [id, { type: "choice", choice: selected, confidence: 1, probabilities: Object.fromEntries(labels.map(label => [label, label === selected ? 1 : 0])) }];
  })) };
}
function runtime(call: (request: JudgementRequest) => Promise<JudgementResponse>, preference: "off" | "local" | "hosted" = "hosted"): WebJudgementRuntime {
  return { settings: { backend: preference, localModelId: "local-test", gatewayPath: "/api/judgement" }, policy: { calibration: { entries: {} }, tiers: [{ key: backend, call: async request => ({ ok: true, response: await call(request) }) }] } };
}

test("author review uses five atomic criteria, exact source blocks and no learner/social data", async () => {
  const view = fixture(), before = JSON.stringify(view);
  const source = await buildCourseAuthorSnapshot(view);
  expect(source.unavailable).toBeNull(); expect(Object.keys(source.questions)).toEqual(["alignment", "sequence", "coverage", "clarity", "support"]);
  expect(JSON.stringify(source.state)).toContain(view.course.cards[0].back);
  for (const privateText of ["PRIVATE NAME", "OTHER PRIVATE SUBMISSION", "PRIVATE SHARED NOTE", "Two equal rectangles"]) expect(JSON.stringify(source.state)).not.toContain(privateText);
  let calls = 0;
  const result = await reviewCourseSnapshot({ source, reload: () => buildCourseAuthorSnapshot(view), runtime: runtime(async request => {
    calls++;
    if (calls === 2) {
      expect(request.questions.alignment.instructions).toContain("Verdict: attention");
      expect(Object.keys(request.questions.alignment.type === "choice" ? request.questions.alignment.criteria : {})).toContain(source.blocks[0].id);
    }
    return response(request);
  }) });
  expect(calls).toBe(2); expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.receipt.findings.every(finding => finding.verdict === "attention" && finding.evidenceBlockId === source.blocks[0].id)).toBe(true);
    expect(result.receipt.backend).toEqual(backend); expect(result.receipt.calibration).toBe("unvalidated");
    expect(result.receipt.verdictQuestionsDigest).toMatch(/^[a-f0-9]{64}$/); expect(result.receipt.evidenceQuestionsDigest).not.toBe(result.receipt.verdictQuestionsDigest);
    expect(Object.isFrozen(result.receipt.verdictResponse.answers)).toBe(true);
    expect(JSON.stringify(result.receipt)).not.toContain("One half is one of two equal parts.");
    const html = renderToStaticMarkup(<CourseJudgementDetails source={source} receipt={result.receipt} />);
    expect(html).toContain("Uncalibrated reviewer suggestions"); expect(html).toContain("jev-test-version"); expect(html).toContain(source.blocks[0].id);
    expect(html).toContain("Connect lesson content"); expect(html).toContain("Edit and publish decisions remain yours");
  }
  expect(JSON.stringify(view)).toBe(before);
});

test("selected visible submission is scoped to answer/task/rubric/reference; evidence can only be submitted blocks", async () => {
  for (const target of [{ kind: "lesson" as const, submissionId: "submission_one" }, { kind: "assignment" as const, submissionId: "assignment_submission" }]) {
    const view = fixture(), before = JSON.stringify(view);
    const source = await buildCourseSubmissionSnapshot(view, target);
    expect(source.unavailable).toBeNull(); expect(Object.keys(source.questions)).toEqual(["instructions", "rubric", "support"]);
    const text = JSON.stringify(source.state);
    expect(text).toContain("One half is one of two equal parts."); expect(text.toLowerCase()).toContain("two equal parts");
    for (const privateText of ["PRIVATE NAME", "OTHER PRIVATE SUBMISSION", "PRIVATE SHARED NOTE", "learner"]) expect(text).not.toContain(privateText);
    const questions = courseEvidenceQuestions(source, response({ state: source.state, questions: source.questions }));
    for (const question of Object.values(questions)) {
      if (question.type !== "choice") throw Error("Expected Choice");
      expect(Object.keys(question.criteria).filter(id => id !== "none").every(id => id.startsWith(`submission/${target.submissionId}/answer:`))).toBe(true);
    }
    const result = await reviewCourseSnapshot({ source, runtime: runtime(async request => response(request)), reload: () => buildCourseSubmissionSnapshot(view, target) });
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(renderToStaticMarkup(<CourseJudgementDetails source={source} receipt={result.receipt} />)).toContain("Marking work reviewed remains a separate action");
    expect(JSON.stringify(view)).toBe(before);
  }
});

test("missing, hidden, link-only and attachment-only submissions never call inference", async () => {
  let calls = 0;
  for (const variation of ["permission", "missing", "link", "attachment", "exercise"] as const) {
    const view = fixture(); const target = { kind: "assignment" as const, submissionId: "assignment_submission" };
    if (variation === "permission") view.permissions.canReview = false;
    if (variation === "missing") target.submissionId = "not-visible";
    if (variation === "link") view.course.assignmentSubmissions[0].answer = "https://example.com/private-document";
    if (variation === "attachment") { view.course.assignmentSubmissions[0].answer = ""; view.course.assignmentSubmissions[0].attachments = [{ id: `attachment_${"a".repeat(32)}`, name: "private.pdf", mimeType: "application/pdf", sizeBytes: 5 }]; }
    if (variation === "exercise") view.course.assignments.length = 0;
    const source = await buildCourseSubmissionSnapshot(view, target);
    expect(source.unavailable).not.toBeNull();
    expect((await reviewCourseSnapshot({ source, runtime: runtime(async request => { calls++; return response(request); }), reload: async () => source })).status).toBe("unavailable");
  }
  expect(calls).toBe(0);
});

test("off/local-only do not dispatch to hosted; overlarge Unicode or block counts abstain without silent truncation", async () => {
  let calls = 0;
  const view = fixture(), source = await buildCourseAuthorSnapshot(view);
  for (const preference of ["off", "local"] as const) expect(await reviewCourseSnapshot({ source, runtime: runtime(async request => { calls++; return response(request); }, preference), reload: async () => source })).toEqual({ status: "unavailable", reason: "unavailable" });
  for (const kind of ["bytes", "blocks"] as const) {
    const large = fixture();
    if (kind === "bytes") large.course.modules[0].lessons[0].reading = "🧠".repeat(20000);
    else large.course.cards = Array.from({ length: 40 }, (_, i) => ({ ...large.course.cards[0], id: `card_${i}` }));
    const snapshot = await buildCourseAuthorSnapshot(large);
    expect(snapshot.unavailable).toBe("too-large");
    if (kind === "blocks") expect(snapshot.blocks.filter(block => block.id.startsWith("card/"))).toHaveLength(80);
    await reviewCourseSnapshot({ source: snapshot, runtime: runtime(async request => { calls++; return response(request); }), reload: async () => snapshot });
  }
  expect(calls).toBe(0);
});

test("source changes, access changes, viewer changes and abort during freshness read reject review", async () => {
  for (const variation of ["text", "access", "viewer", "abort"] as const) {
    const view = fixture(), source = await buildCourseAuthorSnapshot(view), controller = new AbortController();
    const result = await reviewCourseSnapshot({ source, signal: controller.signal, runtime: runtime(async request => response(request)), reload: async () => {
      if (variation === "text") view.course.modules[0].lessons[0].reading += " Changed.";
      if (variation === "access") view.permissions.canEditCourse = false;
      if (variation === "viewer") view.viewer.accountId = "different";
      const fresh = await buildCourseAuthorSnapshot(view);
      if (variation === "abort") controller.abort();
      return fresh;
    } });
    expect(result).toEqual({ status: "unavailable", reason: variation === "abort" ? "cancelled" : "stale" });
  }
  const view = fixture(), target = { kind: "lesson" as const, submissionId: "submission_one" };
  const source = await buildCourseSubmissionSnapshot(view, target);
  const result = await reviewCourseSnapshot({ source, runtime: runtime(async request => response(request)), reload: async () => {
    view.course.submissions[0].version++; return buildCourseSubmissionSnapshot(view, target);
  } });
  expect(result).toEqual({ status: "unavailable", reason: "stale" });
});

test("missing/invalid verdicts and invented evidence remain unknown; no evidence hallucination appears in UI", async () => {
  const view = fixture(), source = await buildCourseAuthorSnapshot(view); let calls = 0;
  const result = await reviewCourseSnapshot({ source, reload: async () => source, runtime: runtime(async request => {
    const result = response(request), answers = { ...result.answers }; calls++;
    if (calls === 1) delete answers.sequence;
    else answers.alignment = { type: "choice", choice: "invented source and feedback", probabilities: { "invented source and feedback": 1 }, confidence: 1 };
    return { ...result, answers };
  }) });
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.receipt.findings.find(row => row.criterionId === "alignment")).toMatchObject({ verdict: "unknown", probability: null, evidenceBlockId: null });
    expect(result.receipt.findings.find(row => row.criterionId === "sequence")?.verdict).toBe("unknown");
    const html = renderToStaticMarkup(<CourseJudgementDetails source={source} receipt={result.receipt} />);
    expect(html).not.toContain("invented source and feedback"); expect(html).toContain("Insufficient evidence");
    expect(renderToStaticMarkup(<CourseJudgementDetails source={{ ...source, sourceDigest: "changed" }} receipt={result.receipt} />)).toBe("");
  }
});

test("backend aliases, invalid calibration and switching concrete model between batches fail closed", async () => {
  const source = await buildCourseAuthorSnapshot(fixture());
  for (const variation of ["alias", "calibration", "switch"] as const) {
    let calls = 0;
    const result = await reviewCourseSnapshot({ source, reload: async () => source, runtime: runtime(async request => {
      calls++; const value = response(request);
      if (variation === "alias") return { ...value, backend: { ...backend, model: "jev-latest" } };
      if (variation === "calibration") return { ...value, backend: { ...backend, calibrationSha256: "bad" } };
      if (variation === "switch" && calls === 2) return { ...value, backend: { ...backend, model: "other-model-version" } };
      return value;
    }) });
    expect(result.status).toBe("unavailable");
  }
});

test("unknown results skip evidence inference and retain raw unknown responses", async () => {
  const source = await buildCourseAuthorSnapshot(fixture()); let calls = 0;
  const result = await reviewCourseSnapshot({ source, reload: async () => source, runtime: runtime(async request => { calls++; return response(request, "unknown"); }) });
  expect(calls).toBe(1); expect(result.status).toBe("ready");
  if (result.status === "ready") { expect(result.receipt.findings.every(row => row.verdict === "unknown")).toBe(true); expect(result.receipt.evidenceResponse).toBeNull(); expect(result.receipt.verdictResponse.answers.alignment).toMatchObject({ choice: "unknown" }); }
});

test("actual course_create saves first, defaults to no inference and queues review only after explicit opt-in", async () => {
  const view = fixture(), key = courseReviewKey(view, { kind: "author" });
  clearCourseJudgement(key);
  const tool = createCourseTools().find(tool => tool.name === "course_create")!;
  let resolve!: (response: Response) => void; let requests = 0;
  globalThis.fetch = (async () => { requests++; return new Promise<Response>(done => { resolve = done; }); }) as unknown as typeof fetch;
  const saving = tool.execute!("create", { title: "Fractions", review_draft: true });
  expect(readCourseJudgement(key)).toBeUndefined(); expect(requests).toBe(1);
  resolve(Response.json(view));
  const result = await saving;
  expect(JSON.stringify(result)).toContain("saved draft is ready now"); expect(readCourseJudgement(key)?.status).toBe("pending");
  clearCourseJudgement(key);
  globalThis.fetch = (async () => { requests++; return Response.json(view); }) as unknown as typeof fetch;
  await tool.execute!("create-default", { title: "Fractions" });
  expect(readCourseJudgement(key)).toBeUndefined(); expect(requests).toBe(2);
});

test("review UI is passive, keeps manual review buttons and hides judgement action without permission", () => {
  const view = fixture(); let calls = 0;
  globalThis.fetch = (async () => { calls++; throw Error("Unexpected fetch"); }) as unknown as typeof fetch;
  const html = renderToStaticMarkup(<CourseReviewPanel snapshot={view} saving="" onReview={() => { throw Error("Not clicked"); }} onAssignmentReview={() => { throw Error("Not clicked"); }} onRequestAccess={() => {}} />);
  expect(html).toContain("Review this submission"); expect(html).toContain("Mark reviewed"); expect(html).toContain("Attachments are not opened"); expect(calls).toBe(0);
  view.permissions.canReview = false;
  expect(renderToStaticMarkup(<CourseJudgementPanel snapshot={view} target={{ kind: "lesson", submissionId: "submission_one" }} />)).toBe("");
});
