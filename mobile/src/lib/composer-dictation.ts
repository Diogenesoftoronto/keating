export interface DictationScope {
  /** Identifies the session and draft generation the recording started in. */
  startScope: string;
  currentScope: string;
}

export function dictationScopeKey(sessionId: string, draftGeneration: number): string {
  return `${sessionId}:${draftGeneration}`;
}

/**
 * Merge a late transcription into the live draft. Returns null when the draft
 * the recording belonged to is gone (message sent or session switched), so the
 * caller never resurrects sent text.
 */
export function mergeDictation(current: string, transcript: string, scope: DictationScope): string | null {
  if (scope.startScope !== scope.currentScope) return null;
  const text = transcript.trim();
  if (!text) return current;
  return current.trim() ? `${current.trimEnd()} ${text}` : text;
}
