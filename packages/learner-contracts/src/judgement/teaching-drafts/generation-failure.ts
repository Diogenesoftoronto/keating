export const TUTOR_RATE_LIMIT_REASON = "generation-rate-limited";
/** The provider reported a finished reply that held no text or tool call. Kept apart so outages can be traced. */
export const TUTOR_EMPTY_REASON = "generation-empty";
/** Hosts throw this message when a completed generation is empty. */
export const TUTOR_EMPTY_ERROR = "draft-empty-response";
export function isTutorEmptyResponse(error: unknown): boolean {
  return error instanceof Error && error.message === TUTOR_EMPTY_ERROR;
}
export const TUTOR_RATE_LIMIT_MESSAGE = "The reply provider rate limited this request (HTTP 429). Try again or choose a different reply model.";

/** Classify only a failed tutor request. Pi may flatten an HTTP error into a status-prefixed message. */
export function isTutorRateLimit(error: unknown): boolean {
  if (error && typeof error === "object") {
    const value = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
    const status = value.status ?? value.statusCode ?? value.response?.status;
    if (status !== undefined) return status === 429;
  }
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const text = message.trim();
  return text === TUTOR_RATE_LIMIT_REASON || /^(?:HTTP\s+|(?:Provider )?request failed with (?:HTTP |status(?: code)? ))429\b/iu.test(text)
    || /^429(?:$|\s*[{\[]|\s+(?:status code|too many requests|rate[_ -]?limit(?:ed)?|error)\b)/iu.test(text);
}
