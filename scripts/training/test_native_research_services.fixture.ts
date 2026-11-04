/** Explicit offline judge/budget double. Never used by a live provider test. */
import { createHash } from "node:crypto";
import type { ResearchServiceInput, ResearchServices } from "./native_draft_review.js";
import type { JudgementAnswer } from "../../packages/learner-contracts/src/judgement/contracts.js";
import type { ExtractionRequest } from "../../packages/learner-contracts/src/learning-extraction-contract.js";
import { createNativeLearningExtractor, type NativeLearningExtractionReceipt } from "./native_learning_extraction.js";

const provenance = Object.freeze({ synthetic: true, kind: "deterministic_protocol_fixture", actual_model_calls: 0,
  live_provider_evidence: false, wire_model_id_is_fixture: true });
const jsonSha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createResearchServices({ request, log }: ResearchServiceInput): ResearchServices {
  const config = request.research_capture.services_config as { missingJudge?: boolean; denyBudget?: boolean; failedShadow?: boolean; unconfiguredJudge?: boolean } | undefined;
  log("fixture_provenance", provenance);
  const extractor = createNativeLearningExtractor({ sessionId: typeof request.id === "string" ? request.id : "native-structural-fixture",
    scope: "offline-fixture-no-account", request: async (body, scope, signal) => {
      signal?.throwIfAborted();
      const input: ExtractionRequest = JSON.parse(body);
      // Protocol-only null answers: no inferred learner traits or fabricated grounded facts.
      const response = { model: "extraction-clairic/clairic-synthetic-fixture-v1", truncated: false,
        answers: Object.fromEntries(Object.keys(input.fields).map(field => [field, { type: "text", value: null, p_null: 1 }])),
        usage: { input_tokens: 0, output_tokens: 0 }, provenance };
      log("fixture_extraction_transport", { body, scope, response, provenance });
      return Response.json(response);
    } });
  const services: ResearchServices = {
    async reserve(role, payload) {
      log("fixture_reservation", { role, payload, offline: true });
      if (config?.denyBudget) throw new Error("fixture-budget-denied");
    },
    async judge(input) {
      if (config?.missingJudge && "quality_progress" in input.questions) return { ok: false, error: { code: "backend-unavailable", retryable: false } };
      const answers: Record<string, JudgementAnswer> = {};
      for (const [id, question] of Object.entries(input.questions)) {
        if (question.type === "noul") answers[id] = { type: "noul", noul: id.startsWith("quality_") ? .99 : .01 };
        else if (question.type === "choice") {
          const keys = Object.keys(question.criteria);
          const choice = id === "draft_standard" ? "supported" : id === "draft_choice" && keys.includes("draft_2") ? "draft_2" : keys[0]!;
          answers[id] = { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? 1 : 0])) };
        } else answers[id] = { type: "score", score: 0, confidence: 1,
          probabilities: Object.fromEntries(question.criteria.map((_, i) => [String(i), i === 0 ? 1 : 0])),
          legend: Object.fromEntries(question.criteria.map((value, i) => [String(i), value])) };
      }
      return { ok: true, response: { backend: { backend: "fixture", model: "native-research-fixture-v1", calibrationSha256: null },
        answers, usage: { inputTokens: 0, outputTokens: 0 } } };
    },
    async shadow(context, signal, review) {
      if (config?.failedShadow) throw new Error("fixture-shadow-failed");
      log("fixture_shadow_context", { context: structuredClone(context) });
      const originalContext = structuredClone(context);
      context.systemPrompt = "SHADOW_MUTATION_MUST_STAY_PRIVATE";
      const drafts = [];
      for (let attempt = 1; attempt <= 10; attempt++) {
        signal.throwIfAborted();
        const candidate = { text: `PRIVATE_SHADOW_ANSWER ${attempt}: two groups of four make eight.`, tool_calls: [] };
        const proposal = { schema_version: "ampersand-shadow/v1", status: "completed", model: "synthetic-shadow-fixture-v1",
          thinking: "max", thinking_evidence: "offline_simulated_thinking", context_sha256: jsonSha(originalContext),
          request_sha256: jsonSha({ context: originalContext, attempt }), projection: "deterministic_fixture_from_original_native_context",
          session_id: null, candidate, raw_action: { type: "synthetic_fixture_proposal", candidate }, usage: null,
          cleanup: "not_applicable_offline_fixture", private_reasoning_available: false, provenance };
        const judgement = await review({ text: candidate.text, toolCalls: [] });
        const draft = { attempt, proposal, judgement, provenance };
        drafts.push(draft);
        log("ampersand_reviewed_draft", draft);
      }
      return { schema_version: "ampersand-hindsight/v1", status: "completed", original_context_sha256: jsonSha(originalContext),
        drafts, hindsight_only: true, learner_visible: false, tools_executed: false, provenance };
    },
    async extract(context, message, signal) {
      const receipt: NativeLearningExtractionReceipt = await extractor.extract({ ...context, systemPrompt: context.systemPrompt ?? "" }, message, signal);
      return { ...receipt, provenance };
    },
  };
  if (config?.unconfiguredJudge) {
    // This branch is used only inside the disposable tape RPC process. Never
    // inherit a real direct credential while testing absent local configuration.
    for (const key of ["TYPESAFE_API_KEY", "KEATING_JUDGEMENT_ENDPOINT", "KEATING_JUDGEMENT_DIRECT",
      "KEATING_JUDGEMENT_MODEL", "KEATING_JUDGEMENT_CALIBRATION_SHA256"]) delete process.env[key];
    delete services.judge;
  }
  return services;
}
