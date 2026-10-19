/**
 * Shared prologue for operations that replace the learner's whole data set
 * (import and clear): evidence tied to the old data is invalidated, the active
 * reply is stopped and awaited, and the repository is marked as being replaced.
 */
import type { MutableRefObject } from "react";
import type { LearnerRepository } from "@/lib/learner-repository";
import type { RepositoryRefs } from "@/state/use-learner-repository";
import type { LearnerEvidence } from "@/state/use-learner-evidence";

export interface ReplacementEnv {
  repo: RepositoryRefs;
  evidence: Pick<LearnerEvidence, "memoryAdmissionRef" | "needleRecallRef" | "quizPerformanceRef">;
  stopGeneration(): void;
  generationPromiseRef: MutableRefObject<Promise<void> | null>;
}

/** Message shown when the repository is not open yet, by operation. */
export function loadingMessage(action: "importing" | "clearing"): string {
  return `Learning data is still loading. Wait a moment and try ${action} again.`;
}

/**
 * Returns the repository with `clearing` set. The caller must reset both
 * flags in a `finally`. Throws, with the evidence flag already reset, when
 * the repository is not open.
 */
export async function beginDataReplacement(env: ReplacementEnv, action: "importing" | "clearing"): Promise<LearnerRepository> {
  env.repo.evidenceChanging.current = true;
  env.evidence.memoryAdmissionRef.current?.cancel();
  env.evidence.needleRecallRef.current?.clear();
  env.evidence.quizPerformanceRef.current?.session.invalidate();
  env.stopGeneration();
  const activeCompletion = env.generationPromiseRef.current;
  if (activeCompletion) await activeCompletion.catch(() => undefined);
  const repository = env.repo.repository.current;
  if (!repository) {
    env.repo.evidenceChanging.current = false;
    throw new Error(loadingMessage(action));
  }
  env.repo.clearing.current = true;
  return repository;
}

export function endDataReplacement(repo: RepositoryRefs): void {
  repo.clearing.current = false;
  repo.evidenceChanging.current = false;
}
