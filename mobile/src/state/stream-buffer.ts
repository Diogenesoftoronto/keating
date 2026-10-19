/**
 * Coalesces streamed text so a multi-round tool exchange does not force a
 * React render per protocol event. The owner flushes on a timer and at the end.
 */
export interface StreamBuffer {
  /** Text accumulated so far (what the next flush would render). */
  pending(): string;
  append(delta: string): void;
  set(text: string): void;
  /** Separates adjacent provider rounds with a blank line. */
  separateRound(): void;
  /**
   * Writes when the text or the trace changed since the last flush; returns whether it wrote.
   * `takeTraceDirty` must report and clear the trace's dirty flag on every call.
   */
  flush(takeTraceDirty: () => boolean, write: (content: string) => void): boolean;
}

export function createStreamBuffer(): StreamBuffer {
  let pending = "";
  let rendered = "";
  return {
    pending: () => pending,
    append(delta) { pending += delta; },
    set(text) { pending = text; },
    separateRound() { pending = `${pending.trimEnd()}\n\n`; },
    flush(takeTraceDirty, write) {
      const traceDirty = takeTraceDirty();
      if (pending === rendered && !traceDirty) return false;
      rendered = pending;
      write(rendered);
      return true;
    },
  };
}
