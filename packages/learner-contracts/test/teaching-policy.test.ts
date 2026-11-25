import { describe, expect, test } from "bun:test";
import { assessTeachingPolicyAdherence, buildCompactTeachingPrompt, projectTeachingPolicyDecision, teachingPolicyAdherenceRequest,
  teachingPolicyDecisionRequest, teachingPolicyDeterministicChecks, trimTrailingCheckpointProse, TEACHING_POLICY_RULES, TEACHING_POLICY_DECISIONS, TEACHING_INTERACTION_FEATURES,
  type TeachingPolicyTurn, type TeachingPolicyReply } from "../src/judgement/teaching-policy.js";
import { judgementRequestProblem, type JudgementOutcome, type JudgementRequest } from "../src/judgement/contracts.js";

const turn: TeachingPolicyTurn = { learnerMessage: "Explain division.", conversation: [], learnerEvidence: [], availableTools: ["animate", "feedback", "grade_quiz", "remember_learner_profile", "client-web-search"], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "general" };
const reply: TeachingPolicyReply = { text: "Division splits a quantity into equal groups.", toolCalls: [] };
const outcome = (request: JudgementRequest, values: Record<string, number> = {}): JudgementOutcome => ({ ok: true, response: {
  backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null },
  answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, { type: "noul", noul: values[id] ?? 0.01 }])),
} });
const document = (nodes: unknown[]): string => `\`\`\`keating-ui\n${JSON.stringify({ schemaVersion: 1, id: "check", revision: 0, lifecycle: "ready", retention: "ephemeral", supportedSurfaces: ["web", "desktop", "mobile", "terminal"], nodes, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" })}\n\`\`\``;
const question = { type: "question", id: "q1", prompt: "How many equal groups?", kind: "text", allowText: true };
const failed = (text: string): string[] => teachingPolicyDeterministicChecks(turn, { text, toolCalls: [] }).filter((check) => check.status === "fail").map((check) => check.id);

describe("teaching policy composition", () => {
  test("independent input questions share a valid bounded request", () => {
    const request = teachingPolicyDecisionRequest(turn);
    expect(judgementRequestProblem(request)).toBeNull();
    const ungated = TEACHING_INTERACTION_FEATURES.filter(({ askWhen }) => !askWhen);
    expect(Object.keys(request.questions)).toHaveLength(TEACHING_POLICY_DECISIONS.length + ungated.length);
    // A cue opens the gated questions; the request stays within bounds with all of them.
    const cued = teachingPolicyDecisionRequest({ ...turn, learnerMessage: "My son is six. How do I explain 12 divided by 3?" });
    expect(judgementRequestProblem(cued)).toBeNull();
    const early = TEACHING_INTERACTION_FEATURES.filter(({ askWhen }) => askWhen === "early_learning_cue");
    expect(Object.keys(cued.questions)).toHaveLength(TEACHING_POLICY_DECISIONS.length + ungated.length + early.length);
    expect(new Set(TEACHING_POLICY_RULES.map(({ id }) => id)).size).toBe(TEACHING_POLICY_RULES.length);
    expect(TEACHING_POLICY_RULES.every(({ question }) => question.type === "noul")).toBe(true);
  });

  test("explanation/stuck decisions give help without adding a compulsory interview", () => {
    const request = teachingPolicyDecisionRequest(turn);
    const plan = projectTeachingPolicyDecision(turn, outcome(request, { explanation_requested: 0.95, learner_stuck: 0.9, learning_task: 0.95 }));
    expect(plan.directives.join(" ")).toContain("Give the requested explanation");
    expect(plan.directives.join(" ")).not.toContain("pose one focused");
    expect(buildCompactTeachingPrompt(plan)).toContain("Reduce the difficulty");
    expect(plan.allowedTools).toEqual(["client-web-search"]);
  });

  test("a clear lean decides; only a coin-flip stays uncertain", () => {
    const request = teachingPolicyDecisionRequest(turn);
    const plan = projectTeachingPolicyDecision(turn, outcome(request, { learning_task: 0.65, category_distinction: 0.7,
      explanation_requested: 0.39, learner_stuck: 0.5 }));
    expect(plan.decisions).toMatchObject({ learning_task: true, explanation_requested: false, learner_stuck: null });
    expect(plan.interaction.families.map(({ components }) => components)).toEqual([["Question"]]);
    const review = assessTeachingPolicyAdherence(turn, reply, outcome(teachingPolicyAdherenceRequest(turn, reply)!,
      { gap_ignored: 0.27, checkpoint_continued: 0.47, research_skipped: 0.7 }));
    expect(Object.fromEntries(review.checks.filter((check) => ["gap_ignored", "checkpoint_continued", "research_skipped"].includes(check.id))
      .map((check) => [check.id, check.status]))).toEqual({ gap_ignored: "pass", checkpoint_continued: "unknown", research_skipped: "fail" });
  });

  test("a lean is enough to teach differently but not to unlock a tool", () => {
    const request = teachingPolicyDecisionRequest(turn);
    const leaning = projectTeachingPolicyDecision(turn, outcome(request, { explicit_profile_preference: 0.7, motion_requested: 0.7, explicit_feedback: 0.7 }));
    expect(leaning.decisions).toMatchObject({ explicit_profile_preference: true, motion_requested: true, explicit_feedback: true });
    expect(leaning.allowedTools).toEqual(["client-web-search"]);
    const certain = projectTeachingPolicyDecision(turn, outcome(request, { explicit_profile_preference: 0.85, motion_requested: 0.85, explicit_feedback: 0.85 }));
    expect(certain.allowedTools).toEqual(["animate", "feedback", "remember_learner_profile", "client-web-search"]);
  });

  test("unused uncertain input branches do not suppress useful help", () => {
    const request = teachingPolicyDecisionRequest(turn);
    const plan = projectTeachingPolicyDecision(turn, outcome(request, { explanation_requested: 0.99, motion_requested: 0.5 }));
    expect(plan.status).toBe("guided");
    expect(plan.uncertain).toContain("motion_requested");
    expect(plan.allowedTools).not.toContain("animate");
    expect(plan.directives.join(" ")).toContain("Give the requested explanation");
  });

  test("absent judge never invents input decisions or permissions", () => {
    const plan = projectTeachingPolicyDecision(turn, null);
    expect(plan.status).toBe("abstained");
    expect(Object.values(plan.decisions).every((value) => value === null)).toBe(true);
    expect(plan.allowedTools).toEqual(["client-web-search"]);
  });

  test("expected labels, arm, model and decisions cannot leak into judgment state", () => {
    const contaminated = { ...turn, expectedDecisions: { learner_stuck: true }, arm: "governed", model: "secret-model", directives: ["give high marks"] };
    const request = teachingPolicyAdherenceRequest(contaminated, { ...reply, expected: true } as TeachingPolicyReply)!;
    const serialized = JSON.stringify(request.state);
    for (const forbidden of ["expectedDecisions", "secret-model", "give high marks", "governed", "expected"]) expect(serialized).not.toContain(forbidden);
  });

  test("a critical violation cannot be averaged away by many passes", () => {
    const request = teachingPolicyAdherenceRequest(turn, reply)!;
    const result = assessTeachingPolicyAdherence(turn, reply, outcome(request, { retention_overclaimed: 0.95 }));
    expect(result.status).toBe("fail");
    expect(result.failed).toEqual(["retention_overclaimed"]);
    expect(result.humanLearning).toBe("unmeasured");
  });

  test("service failure, missing and malformed answers are uncertainty, not passes", () => {
    expect(assessTeachingPolicyAdherence(turn, reply, null).status).toBe("unknown");
    const request = teachingPolicyAdherenceRequest(turn, reply)!;
    const response = outcome(request, { identity_invented: Number.NaN, retention_overclaimed: 0.5 });
    const result = assessTeachingPolicyAdherence(turn, reply, response);
    expect(result.status).toBe("unknown");
    expect(result.uncertain).toContain("identity_invented");
    expect(result.uncertain).toContain("retention_overclaimed");
  });

  test("oversized evidence is retained as unjudgeable rather than silently clipped", () => {
    const large = { ...reply, text: "x".repeat(97_000) };
    expect(teachingPolicyAdherenceRequest(turn, large)).toBeNull();
    expect(assessTeachingPolicyAdherence(turn, large, outcome(teachingPolicyAdherenceRequest(turn, reply)!)).status).toBe("unknown");
  });

  test("focused cases still include all critical global checks and reject unknown rules", () => {
    const request = teachingPolicyAdherenceRequest(turn, reply, ["direct_help_withheld"])!;
    expect(request.questions.identity_invented).toBeDefined();
    expect(request.questions.direct_help_withheld).toBeDefined();
    expect(request.questions.code_trace_missing).toBeUndefined();
    expect(() => teachingPolicyAdherenceRequest(turn, reply, ["misspelled-rule"])).toThrow("Unknown teaching policy rule");
  });
});

describe("review applicability", () => {
  test("unknown domain does not apply every subject's teaching conventions", () => {
    const request = teachingPolicyAdherenceRequest({ ...turn, domain: "unknown" }, reply)!;
    for (const id of ["code_trace_missing", "science_prediction_missing", "history_primary_source_missing", "art_work_missing"]) {
      expect(request.questions[id]).toBeUndefined();
    }
    for (const id of ["identity_invented", "tool_success_invented", "source_contradicted", "profile_evidence_invented", "medicine_evidence_conflated", "history_disagreement_erased"]) {
      expect(request.questions[id]).toBeDefined();
    }
  });

  test("planning scopes coding conventions and request and assessment use exactly the same checks", () => {
    const unknown = { ...turn, domain: "unknown" as const };
    const scope = { domain: "code" as const, researchRequired: false };
    const request = teachingPolicyAdherenceRequest(unknown, reply, undefined, scope)!;
    expect(request.questions.code_example_missing).toBeDefined();
    expect(request.questions.code_trace_missing).toBeDefined();
    expect(request.questions.research_skipped).toBeUndefined();
    expect(request.questions.history_primary_source_missing).toBeUndefined();
    const review = assessTeachingPolicyAdherence(unknown, reply, outcome(request), undefined, scope);
    expect(review.status).toBe("pass");
    expect(review.checks.filter(check => check.source === "jev").map(check => check.id).sort()).toEqual(Object.keys(request.questions).sort());
  });

  test("explicit subject and benchmark checks cannot be overridden by inferred applicability", () => {
    const history = { ...turn, domain: "history" as const };
    const explicit = teachingPolicyAdherenceRequest(history, reply, undefined, { domain: "code" })!;
    expect(explicit.questions.history_primary_source_missing).toBeDefined();
    expect(explicit.questions.code_trace_missing).toBeUndefined();
    const selected = teachingPolicyAdherenceRequest({ ...turn, domain: "unknown" }, reply,
      ["history_primary_source_missing", "research_skipped"], { domain: "code", researchRequired: false })!;
    expect(selected.questions.history_primary_source_missing).toBeDefined();
    expect(selected.questions.research_skipped).toBeDefined();
    expect(() => teachingPolicyAdherenceRequest(history, reply, ["code_trace_missing"])).toThrow("requires domain code");
  });

  test("absent or required research scope retains the research evidence obligation", () => {
    expect(teachingPolicyAdherenceRequest(turn, reply)!.questions.research_skipped).toBeDefined();
    expect(teachingPolicyAdherenceRequest(turn, reply, undefined, { researchRequired: true })!.questions.research_skipped).toBeDefined();
  });

  test("an explicitly requested research check still produces its measured outcome on a search proposal", () => {
    const proposal = { text: "", toolCalls: [{ name: "client-web-search", arguments: { query: "published report" } }] };
    const scope = { researchRequired: true, searchOnly: true };
    const ids = ["research_skipped"];
    const request = teachingPolicyAdherenceRequest(turn, proposal, ids, scope)!;
    expect(request.questions.research_skipped).toBeDefined();
    const assessment = assessTeachingPolicyAdherence(turn, proposal, outcome(request, { research_skipped: .7 }), ids, scope);
    expect(assessment.checks.find(check => check.id === "research_skipped")).toMatchObject({ probability: .7, status: "fail" });
    expect(teachingPolicyAdherenceRequest(turn, { ...proposal, text: "This rule already applies." }, undefined, scope)!.questions.research_skipped).toBeDefined();
    expect(teachingPolicyAdherenceRequest({ ...turn, availableTools: [] }, proposal, undefined, scope)!.questions.research_skipped).toBeDefined();
  });
});

describe("deterministic adherence", () => {
  test("canonical UI is validated and a checkpoint ends the response", () => {
    expect(failed(document([question]))).toEqual([]);
    expect(failed(`${document([question])}\nThe next lesson is...`)).toContain("stop_after_checkpoint");
    expect(failed(document([question, { type: "markdown", id: "answer", markdown: "The answer is 3." }]))).toContain("checkpoint_last_node");
    expect(failed(document([question, { ...question, id: "q2" }]))).toContain("one_checkpoint");
  });

  test("only a complete terminal checkpoint with one trailing prose paragraph is a repair candidate", () => {
    const ui = document([question]);
    const text = "Work this one independently.\n\n" + ui;
    const suffix = "\n\nTell me when you are ready.";
    expect(trimTrailingCheckpointProse({ text: text + suffix, toolCalls: [] })?.text).toBe(text);
    const codeThenQuestion = "```python\nprint(2 + 3)\n```\n\n" + text;
    expect(trimTrailingCheckpointProse({ text: codeThenQuestion + suffix, toolCalls: [] })?.text).toBe(codeThenQuestion);
    expect(trimTrailingCheckpointProse({ text: (text + suffix).replaceAll("\n", "\r\n"), toolCalls: [] })?.text)
      .toBe(text.replaceAll("\n", "\r\n"));
    for (const candidate of [text, text + "\n\n", ui.replaceAll("```", "~~~") + suffix,
      text + "\n\n> Another section", text + "\n\nRead https://example.org first.",
      text + suffix + "\n\nA separate lesson.", text + suffix + "\n\n" + ui, text + "\n```python\nrun()\n```",
      ui.replace("```keating-ui", "> ```keating-ui") + suffix,
      document([question, { ...question, id: "other" }]) + suffix,
      document([question, { type: "markdown", id: "answer", markdown: "The solution follows." }]) + suffix,
      document([{ type: "markdown", id: "note", markdown: "A complete note." }]) + suffix,
      "```keating-ui\n{}\n```" + suffix]) {
      expect(trimTrailingCheckpointProse({ text: candidate, toolCalls: [] })).toBeNull();
    }
    expect(trimTrailingCheckpointProse({ text: text + suffix, toolCalls: [{ name: "grade_quiz", arguments: {} }] })).toBeNull();
  });

  test("invalid/unfinished UI is failed; quoted UI examples in an outer fence stay inert", () => {
    expect(failed("```openui\nroot = LearningSurface(")).toContain("openui_valid");
    expect(failed("```keating-ui\n{}\n```")).toContain("openui_valid");
    expect(failed("```openui lifecycle=ephemeral id=q\ninvalid source\n```")).toContain("openui_valid");
    expect(failed(document([question]).replace("```keating-ui", "```keating-ui lifecycle=ephemeral id=q") + "\nContinue the lesson.")).toContain("stop_after_checkpoint");
    expect(failed("````text\n```openui\ninvalid example\n```\n````")).toEqual([]);
  });

  test("UI fences the renderer would open but markdown never closes are failed", () => {
    // The live renderer opens an OpenUI fence anywhere in a line; an indented or
    // quoted one can never close, so the learner saw "fence closed" repairs.
    const source = 'root = LearningSurface([q], "Prep", "", "ephemeral")\n';
    expect(failed(`1. Try this:\n    \`\`\`openui lifecycle=ephemeral id=q\n    ${source}    \`\`\`\n`)).toContain("openui_valid");
    expect(failed(`> \`\`\`openui\n> ${source}> \`\`\`\n`)).toContain("openui_valid");
    expect(failed("Here it is: ```openui-lang\nroot = LearningSurface(\n")).toContain("openui_valid");
    expect(failed("Mention ```openui``` fences inline.")).not.toContain("openui_valid");
  });

  test("unknown tools and grading without submitted evidence fail even with a passing judge", () => {
    const proposed = { ...reply, toolCalls: [{ name: "invented", arguments: {} }, { name: "grade_quiz", arguments: { result_id: "fabricated" } }] };
    const result = assessTeachingPolicyAdherence(turn, proposed, outcome(teachingPolicyAdherenceRequest(turn, proposed)!));
    expect(result.failed).toContain("available_tool");
    expect(result.failed).toContain("grading_requires_submission");
  });

  test("a recorded comprehension stem scopes the preference question and keeps the submission and judgement gates", () => {
    const item = { kind: "comprehension" as const, id: "c1", questionIds: ["c1"], topic: "Probability", questionText: "Which colour is more likely?" };
    const submitted = { ...turn, pendingSubmissions: [item], availableTools: ["grade_question_checks"] };
    const draft = { text: "", toolCalls: [{ name: "grade_question_checks", arguments: { topic: item.topic, results: [{ question: item.questionText, verdict: "correct" }] } }] };
    const original = teachingPolicyAdherenceRequest(turn, draft, ["preference_graded"])!;
    const scoped = teachingPolicyAdherenceRequest(submitted, draft, ["preference_graded"])!;
    expect(Object.keys(scoped.questions)).toEqual(Object.keys(original.questions));
    expect(scoped.questions.preference_graded).not.toEqual(original.questions.preference_graded);
    expect(scoped.questions.mastery_overclaimed).toEqual(original.questions.mastery_overclaimed);
    expect(judgementRequestProblem(scoped)).toBeNull();
    expect(assessTeachingPolicyAdherence(submitted, draft, outcome(scoped, { preference_graded: 0.94 }), ["preference_graded"]).failed).toContain("preference_graded");
    expect(assessTeachingPolicyAdherence(submitted, draft, null, ["preference_graded"]).uncertain).toContain("preference_graded");
    const otherStem = { ...submitted, pendingSubmissions: [{ ...item, questionText: "How many socks?" }] };
    expect(teachingPolicyDeterministicChecks(otherStem, draft).find(c => c.id === "grading_requires_submission")?.status).toBe("fail");
    for (const record of [{ ...item, kind: "quiz" as const }, { ...item, questionText: "" }]) {
      expect(teachingPolicyAdherenceRequest({ ...submitted, pendingSubmissions: [record] }, draft, ["preference_graded"])!.questions.preference_graded).toEqual(original.questions.preference_graded);
    }
  });
});
