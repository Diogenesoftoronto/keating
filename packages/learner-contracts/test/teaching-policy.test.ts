import { describe, expect, test } from "bun:test";
import { assessTeachingPolicyAdherence, buildCompactTeachingPrompt, projectTeachingPolicyDecision, teachingPolicyAdherenceRequest,
  teachingPolicyDecisionRequest, teachingPolicyDeterministicChecks, TEACHING_POLICY_RULES, TEACHING_POLICY_DECISIONS, TEACHING_INTERACTION_FEATURES,
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
    expect(Object.keys(request.questions)).toHaveLength(TEACHING_POLICY_DECISIONS.length + TEACHING_INTERACTION_FEATURES.length);
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

describe("deterministic adherence", () => {
  test("canonical UI is validated and a checkpoint ends the response", () => {
    expect(failed(document([question]))).toEqual([]);
    expect(failed(`${document([question])}\nThe next lesson is...`)).toContain("stop_after_checkpoint");
    expect(failed(document([question, { type: "markdown", id: "answer", markdown: "The answer is 3." }]))).toContain("checkpoint_last_node");
    expect(failed(document([question, { ...question, id: "q2" }]))).toContain("one_checkpoint");
  });

  test("invalid/unfinished UI is failed; quoted UI examples in an outer fence stay inert", () => {
    expect(failed("```openui\nroot = LearningSurface(")).toContain("openui_valid");
    expect(failed("```keating-ui\n{}\n```")).toContain("openui_valid");
    expect(failed("```openui lifecycle=ephemeral id=q\ninvalid source\n```")).toContain("openui_valid");
    expect(failed(document([question]).replace("```keating-ui", "```keating-ui lifecycle=ephemeral id=q") + "\nContinue the lesson.")).toContain("stop_after_checkpoint");
    expect(failed("````text\n```openui\ninvalid example\n```\n````")).toEqual([]);
  });

  test("unknown tools and grading without submitted evidence fail even with a passing judge", () => {
    const proposed = { ...reply, toolCalls: [{ name: "invented", arguments: {} }, { name: "grade_quiz", arguments: { result_id: "fabricated" } }] };
    const result = assessTeachingPolicyAdherence(turn, proposed, outcome(teachingPolicyAdherenceRequest(turn, proposed)!));
    expect(result.failed).toContain("available_tool");
    expect(result.failed).toContain("grading_requires_submission");
  });
});
