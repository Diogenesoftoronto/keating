/** Native payload limits run inside the transport callback, where errors stop the request. */
export const HARNESS_V3_BOUNDED_APIS = ["openai-completions", "openai-responses", "azure-openai-responses", "anthropic-messages", "google-generative-ai", "google-vertex"] as const;

export function limitHarnessPayload(api: string, input: unknown, maximum: number): { payload: Record<string, any>; field: string; maximum: number } {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || !input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("harness_invalid_provider_payload");
  }
  const payload = structuredClone(input) as Record<string, any>;
  let field: string;
  switch (api) {
    case "openai-completions": {
      if (!Array.isArray(payload.messages)) throw new Error("harness_invalid_provider_payload");
      // Use the field selected by Pi's model compatibility settings, never add competing limits.
      const keys = ["max_tokens", "max_completion_tokens"].filter((key) => key in payload);
      if (keys.length !== 1) throw new Error("harness_ambiguous_output_limit");
      field = keys[0]!;
      payload[field] = maximum;
      break;
    }
    case "openai-responses":
    case "azure-openai-responses":
      if (!Array.isArray(payload.input)) throw new Error("harness_invalid_provider_payload");
      field = "max_output_tokens";
      payload.max_output_tokens = maximum;
      break;
    case "anthropic-messages":
      if (!Array.isArray(payload.messages)) throw new Error("harness_invalid_provider_payload");
      field = "max_tokens";
      payload.max_tokens = maximum;
      if (payload.thinking?.type === "enabled" && payload.thinking.budget_tokens >= maximum) {
        throw new Error("harness_thinking_budget_exceeds_output_limit");
      }
      break;
    case "google-generative-ai":
    case "google-vertex":
      if (!Array.isArray(payload.contents) || !payload.config || typeof payload.config !== "object") throw new Error("harness_invalid_provider_payload");
      field = "config.maxOutputTokens";
      payload.config.maxOutputTokens = maximum;
      break;
    default: throw new Error("harness_unsupported_provider_api");
  }
  return { payload, field, maximum };
}
