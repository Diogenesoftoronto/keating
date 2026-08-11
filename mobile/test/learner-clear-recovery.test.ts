import { describe, expect, test } from "bun:test";
import { resumePendingLearningDataClear } from "../src/lib/learner-repository/clear-recovery";

const intent = { id: "clear-1", createdAt: "2026-08-10T00:00:00.000Z" };

function fixture(failAt?: string) {
  const calls: string[] = [];
  let pending: typeof intent | null = intent;
  const step = async (name: string) => {
    calls.push(name);
    if (name === failAt) throw new Error(`failed:${name}`);
  };
  return {
    calls,
    records: {
      pendingClear: async () => pending,
      clear: async () => step("repository"),
      completeClear: async (id: string) => {
        await step(`complete:${id}`);
        pending = null;
      },
    },
    dependencies: {
      clearPersistedState: async () => step("state"),
      clearComposerDrafts: async () => step("drafts"),
      clearComposerAttachmentFiles: async () => step("files"),
      clearLearnerContext: async () => step("context"),
    },
  };
}

describe("learning-data clear recovery", () => {
  test("does nothing without a pending intent", async () => {
    const state = fixture();
    state.records.pendingClear = async () => null;
    expect(await resumePendingLearningDataClear(state.records, state.dependencies)).toBeNull();
    expect(state.calls).toEqual([]);
  });

  test("clears every store and removes the intent last", async () => {
    const state = fixture();
    expect(await resumePendingLearningDataClear(state.records, state.dependencies)).toEqual(intent);
    expect(state.calls).toEqual(["state", "drafts", "files", "context", "repository", "complete:clear-1"]);
    expect(await state.records.pendingClear()).toBeNull();
  });

  test("keeps the intent when interrupted so the full idempotent sequence resumes", async () => {
    const interrupted = fixture("files");
    await expect(resumePendingLearningDataClear(interrupted.records, interrupted.dependencies)).rejects.toThrow("failed:files");
    expect(await interrupted.records.pendingClear()).toEqual(intent);
    expect(interrupted.calls).toEqual(["state", "drafts", "files"]);

    const resumed = fixture();
    expect(await resumePendingLearningDataClear(resumed.records, resumed.dependencies)).toEqual(intent);
    expect(resumed.calls.at(-1)).toBe("complete:clear-1");
  });
});
