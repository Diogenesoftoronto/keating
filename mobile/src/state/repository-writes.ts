/**
 * Serialized write queue for the SQLite learner repository. Every mutation
 * waits for the previous one (success or failure) so snapshots never
 * interleave, and a failed write never blocks the ones queued behind it.
 */
import type { MutableRefObject } from "react";

export type WriteTail = MutableRefObject<Promise<unknown>>;

/** Queues `task` behind the current tail and makes its promise the new tail. */
export function enqueueRepositoryWrite<Result>(tail: WriteTail, task: () => Promise<Result>): Promise<Result> {
  const write = tail.current.catch(() => undefined).then(task);
  tail.current = write;
  return write;
}

/** Resolves once every queued write has settled, ignoring their failures. */
export async function drainRepositoryWrites(tail: WriteTail): Promise<void> {
  await tail.current.catch(() => undefined);
}
