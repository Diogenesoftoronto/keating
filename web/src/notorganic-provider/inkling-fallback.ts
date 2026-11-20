import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
} from "@earendil-works/pi-ai";
import { hasNotOrganicInferenceScope } from "@keating/runtime-config";
import { NOTORGANIC_LUNA_MODEL, NOTORGANIC_MERCURY_2_MODEL, NOTORGANIC_SOL_MODEL } from "./index";
import type { NotOrganicProviderSession } from "./public-client";
import { hostedInklingBillingCode, isTinkerBillingBlock } from "./provider-billing";

export function inklingFallbackModel(scope: string, context: Context) {
  const scopes = new Set(scope.split(/\s+/));
  if (hasNotOrganicInferenceScope(scopes, NOTORGANIC_SOL_MODEL.id)) return NOTORGANIC_SOL_MODEL;
  if (hasNotOrganicInferenceScope(scopes, NOTORGANIC_LUNA_MODEL.id)) return NOTORGANIC_LUNA_MODEL;
  if (!hasNotOrganicInferenceScope(scopes, NOTORGANIC_MERCURY_2_MODEL.id)) return null;
  const hasImage = context.messages.some(message => Array.isArray(message.content)
    && message.content.some(part => part.type === "image"));
  // A byte bound is conservative across tokenizers. Mercury is text-only
  // and has a smaller window than the Inkling session it may replace.
  const capacity = NOTORGANIC_MERCURY_2_MODEL.contextWindow - NOTORGANIC_MERCURY_2_MODEL.maxTokens;
  return !hasImage && new TextEncoder().encode(JSON.stringify(context)).length < capacity
    ? NOTORGANIC_MERCURY_2_MODEL : null;
}

export function sameInferenceSession(before: NotOrganicProviderSession | null, after: NotOrganicProviderSession | null): boolean {
  if (!before || !after) return false;
  return before.id ? before.id === after.id : before.accessToken === after.accessToken;
}

function unavailable(message: AssistantMessage, signal?: AbortSignal): AssistantMessage {
  return signal?.aborted
    ? { ...message, stopReason: "aborted", errorMessage: "Request aborted" }
    : { ...message, errorMessage: "The selected hosted model is unavailable right now." };
}

/** Replace a rejected request before any content or tool activity reaches chat. */
export function withInklingFallback(
  source: AssistantMessageEventStream,
  recover: () => Promise<AssistantMessageEventStream | null>,
  signal?: AbortSignal,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  void (async () => {
    let start: Extract<AssistantMessageEvent, { type: "start" }> | undefined;
    let published = false;
    for await (const event of source) {
      if (event.type === "start") { start = event; continue; }
      const error = event.type === "error" ? event.error.errorMessage ?? "" : "";
      if (event.type === "error" && (error.includes(hostedInklingBillingCode) || isTinkerBillingBlock(error))) {
        if (!published && !signal?.aborted) {
          const fallback = await recover().catch(() => null);
          if (fallback && !signal?.aborted) {
            for await (const next of fallback) output.push(next);
            output.end(await fallback.result());
            return;
          }
        }
        output.push({ type: "error", reason: signal?.aborted ? "aborted" : "error", error: unavailable(event.error, signal) });
        return;
      }
      if (start) { output.push(start); start = undefined; }
      published = true;
      output.push(event);
    }
    output.end(await source.result());
  })();
  return output;
}
