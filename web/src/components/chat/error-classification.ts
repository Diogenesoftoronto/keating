/**
 * Learner-facing classification of chat, voice and tool failures: the title,
 * recovery advice and icon shown in error badges, and whether a failure is
 * worth offering a diagnostics report for.
 */
import {
  CircleAlert,
  CircleDollarSign,
  KeyRound,
  Server,
  ShieldAlert,
  Square,
  Wifi,
} from "lucide-react";
import { classifyLlmError, type LlmErrorDetails } from "../../core/api-retry";

export const VOICE_ERROR_PATTERNS =
  /keating_voice|gemini live speech|voice layer|speech model|speech failed|speech timed out/i;

export interface ClassifiedError extends LlmErrorDetails {
  icon: typeof CircleAlert;
}

/**
 * Categories the learner can act on directly: a missing key, missing credits,
 * a prompt that is too long or malformed, or a safety refusal. Everything else
 * (server faults, withdrawn models, unrecognized failures) cannot be fixed from
 * the UI, so those are the ones worth reporting.
 */
const NON_REPORTABLE_ERROR_CATEGORIES = new Set([
	"auth",
	"billing",
	"context-length",
	"invalid-request",
	"safety",
	"aborted",
	"network",
	"rate-limit",
	"timeout",
	"missing-key",
	"permission",
	"model-unavailable",
	"unsupported-provider",
	"microphone-denied",
	"microphone-unavailable",
	"camera-denied",
	"camera-unavailable",
	"camera-in-use",
	"screen-denied",
	"vision-unsupported",
]);

/** Report summary for a failure with no known learner-side recovery. */
export function diagnosticsSummaryForFailure(
	failure: { category?: string; kind?: string; title?: string },
	prefix?: string,
): string | undefined {
	const category = failure.category ?? failure.kind ?? "unknown";
	if (NON_REPORTABLE_ERROR_CATEGORIES.has(category)) return undefined;
	const summary = failure.title ? `${category}: ${failure.title}` : category;
	return prefix ? `${prefix}: ${summary}` : summary;
}

export function speechDiagnosticsSummary(errorText: string): string | undefined {
	if (/no speech was detected|microphone unavailable|could not attach|speech provider key/i.test(errorText)) return undefined;
	return diagnosticsSummaryForFailure(classifyError(errorText), "speech");
}

export function classifyError(errorText: string): ClassifiedError {
  const isVoiceError = VOICE_ERROR_PATTERNS.test(errorText);
  if (isVoiceError) {
    const underlying = classifyLlmError(errorText);
    return {
      ...underlying,
      title:
        underlying.category === "auth"
          ? "Voice sign-in failed"
          : "Voice model failed",
      description:
        "The optional speech layer failed. The main chat model may still be working.",
      recovery:
        underlying.category === "auth"
          ? "Update the speech provider credentials, or turn speech off and continue with text."
          : "Turn speech off and continue with text, or retry the voice connection.",
      icon: underlying.category === "auth" ? KeyRound : Wifi,
    };
  }

  const details = classifyLlmError(errorText);
  const icon =
    details.category === "auth"
      ? KeyRound
      : details.category === "billing"
        ? CircleDollarSign
        : details.category === "permission" || details.category === "safety"
          ? ShieldAlert
          : details.category === "server" ||
              details.category === "model-unavailable"
            ? Server
            : details.category === "network" ||
                details.category === "rate-limit" ||
                details.category === "timeout"
              ? Wifi
              : details.category === "aborted"
                ? Square
                : CircleAlert;
  return { ...details, icon };
}
