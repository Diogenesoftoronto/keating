/**
 * Turns a provider's own error text into something a learner can act on. The
 * raw message stays available behind the "show raw errors" setting, because it
 * is what actually helps when debugging a custom endpoint.
 */

const PATTERNS: ReadonlyArray<{ test: RegExp; message: string }> = [
  {
    test: /\b(401|unauthorized|invalid[_ -]?api[_ -]?key|authentication)\b/i,
    message: "The provider rejected your API key. Check it in Settings.",
  },
  {
    test: /\b(403|forbidden|permission)\b/i,
    message: "Your account is not allowed to use this model. Pick another model in Settings.",
  },
  {
    test: /\b(404|not[_ -]?found|does not exist|unknown model)\b/i,
    message: "The provider does not recognise this model ID. Pick another model in Settings.",
  },
  {
    test: /\b(429|rate[_ -]?limit|quota|insufficient[_ -]?quota|billing)\b/i,
    message: "The provider is rate limiting or out of quota. Wait a moment, then try again.",
  },
  {
    test: /\b(5\d{2}|overloaded|unavailable|internal server error)\b/i,
    message: "The provider is having trouble right now. Try again in a moment.",
  },
  {
    test: /\b(network|fetch failed|timed? ?out|timeout|econnrefused|unable to resolve host)\b/i,
    message: "Could not reach the provider. Check your connection and the base URL in Settings.",
  },
  {
    test: /\bcontext (length|window)|too many tokens|maximum context\b/i,
    message: "This lesson is too long for the model's context. Start a new lesson to continue.",
  },
];

export function friendlyErrorMessage(raw: string): string {
  const matched = PATTERNS.find((pattern) => pattern.test.test(raw));
  if (matched) return matched.message;
  return "The model request failed. Turn on raw provider errors in Settings to see the full message.";
}

/** Picks the message to show, honouring the learner's raw-errors preference. */
export function presentedErrorMessage(raw: string, showRawErrors: boolean): string {
  const trimmed = raw.trim();
  if (!trimmed) return "The model request failed.";
  return showRawErrors ? trimmed : friendlyErrorMessage(trimmed);
}
