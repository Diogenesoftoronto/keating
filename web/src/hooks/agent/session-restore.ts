/**
 * Decisions for the first conversation a chat panel shows: which saved
 * session to restore, when a delayed bootstrap step is still allowed to act,
 * and how long storage may take before a fresh session starts instead.
 */
import type { SessionMetadata } from "../../types/session";

export const SESSION_RESTORE_TIMEOUT_MS = 5_000;

export async function withSessionRestoreTimeout<T>(
  operation: Promise<T>,
  label: string,
): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(
      () =>
        reject(
          new Error(`${label} timed out after ${SESSION_RESTORE_TIMEOUT_MS}ms`),
        ),
      SESSION_RESTORE_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

/** The most recently modified session the learner can see (not a hidden alternative). */
export function latestRestorableSessionId(items: readonly SessionMetadata[]): string | null {
  return items
    .filter((item) => !item.hiddenAlternative)
    .sort((left, right) =>
      right.lastModified.localeCompare(left.lastModified),
    )[0]?.id ?? null;
}

/**
 * An explicit `?session=` wins; otherwise a signed-in turn interrupted by an
 * account redirect reopens its session.
 */
export function requestedSessionId(
  search: string,
  pending: () => { ready?: boolean; sessionId: string } | null | undefined,
): string | null {
  return new URLSearchParams(search)
    .get("session")
    ?.trim() || (pending()?.ready ? pending()!.sessionId : null);
}

/** The location without its `session` parameter, for history.replaceState. */
export function locationWithoutSessionParam(location: Pick<Location, "pathname" | "search" | "hash">): string {
  const params = new URLSearchParams(location.search);
  params.delete("session");
  const next = params.toString();
  return `${location.pathname}${next ? `?${next}` : ""}${location.hash}`;
}

/**
 * A delayed bootstrap step may act only while its panel attachment is the
 * latest, no navigation began since, the same panel is mounted, and no
 * conversation exists yet.
 */
export function bootstrapMayProceed(state: {
  generationCurrent: boolean;
  requestCurrent: boolean;
  panelUnchanged: boolean;
  hasAgent: boolean;
}): boolean {
  return state.generationCurrent && state.requestCurrent && state.panelUnchanged && !state.hasAgent;
}
