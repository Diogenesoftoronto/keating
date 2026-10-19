import { describe, expect, test } from "bun:test";
import { resumePendingLearningDataClear } from "../src/lib/learner-repository/clear-recovery";
import type { DiagramDraftStorage } from "../src/lib/diagram-draft-storage";
import { createDiagramDraftWriter, mobileDiagramDraftKey } from "../src/lib/diagram-draft-storage";
import { learningDataClearDependencies } from "../src/lib/learner-repository/learning-data-clear";

function memoryStorage(initial: Record<string, string>): DiagramDraftStorage & { entries: Map<string, string> } {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem: async (key) => entries.get(key) ?? null,
    setItem: async (key, value) => { entries.set(key, value); },
    removeItem: async (key) => { entries.delete(key); },
    getAllKeys: async () => [...entries.keys()],
    multiRemove: async (keys) => { for (const key of keys) entries.delete(key); },
  };
}

const intent = { id: "clear-1", createdAt: "2026-10-19T00:00:00.000Z" };

function fixture(storage: DiagramDraftStorage) {
  const calls: string[] = [];
  const stores = {
    clearPersistedState: async () => { calls.push("state"); },
    clearComposerDrafts: async () => { calls.push("composer-drafts"); },
    clearComposerAttachmentFiles: async () => { calls.push("files"); },
    clearLearnerContext: async () => { calls.push("context"); },
    diagramDraftStorage: storage,
  };
  const records = {
    pendingClear: async () => intent,
    clear: async () => { calls.push("repository"); },
    completeClear: async () => { calls.push("complete"); },
  };
  return { calls, stores, records };
}

describe("clearing learning data", () => {
  test("removes every diagram draft and leaves unrelated storage alone", async () => {
    const keyA = mobileDiagramDraftKey("doc-1", 1, "node-a");
    const keyB = mobileDiagramDraftKey("doc-2", 4, "node-b");
    const storage = memoryStorage({ [keyA]: "{}", [keyB]: "{}", "keating.mobile.other": "keep" });
    const { stores, records } = fixture(storage);

    await resumePendingLearningDataClear(records, learningDataClearDependencies(stores));

    expect([...storage.entries.keys()]).toEqual(["keating.mobile.other"]);
  });

  test("clears diagram drafts together with composer drafts, before attachments and context", async () => {
    const storage = memoryStorage({ [mobileDiagramDraftKey("d", 1, "n")]: "{}" });
    const order: string[] = [];
    const tracking: DiagramDraftStorage = {
      ...storage,
      multiRemove: async (keys) => { order.push("diagram-drafts"); await storage.multiRemove(keys); },
    };
    const { calls, stores, records } = fixture(tracking);
    stores.clearComposerDrafts = async () => { order.push("composer-drafts"); };
    stores.clearComposerAttachmentFiles = async () => { order.push("files"); };

    await resumePendingLearningDataClear(records, learningDataClearDependencies(stores));

    expect(order).toEqual(["composer-drafts", "diagram-drafts", "files"]);
    expect(calls).toEqual(["state", "context", "repository", "complete"]);
  });

  test("a failing diagram store stops the clear before the repository intent is removed", async () => {
    const storage = memoryStorage({ [mobileDiagramDraftKey("d", 1, "n")]: "{}" });
    storage.multiRemove = async () => { throw new Error("storage offline"); };
    const { calls, stores, records } = fixture(storage);

    await expect(resumePendingLearningDataClear(records, learningDataClearDependencies(stores))).rejects.toThrow("storage offline");

    expect(calls).not.toContain("repository");
    expect(calls).not.toContain("complete");
  });

  test("passes the other stores through untouched", async () => {
    const { stores } = fixture(memoryStorage({}));
    const dependencies = learningDataClearDependencies(stores);
    expect(dependencies.clearPersistedState).toBe(stores.clearPersistedState);
    expect(dependencies.clearComposerAttachmentFiles).toBe(stores.clearComposerAttachmentFiles);
    expect(dependencies.clearLearnerContext).toBe(stores.clearLearnerContext);
  });
});

describe("clearing while a diagram editor is still mounted", () => {
  test("the editor's autosave and unmount flush cannot write deleted drafts back", async () => {
    const key = mobileDiagramDraftKey("doc-1", 1, "node-a");
    const storage = memoryStorage({});
    const content = { graph: { components: [{ id: "a", label: "A", kind: "service" }], connections: [] }, explanation: "typed before clearing" };
    const writer = createDiagramDraftWriter(key, storage);
    writer.noteEdit();
    await writer.save(content); // autosave landed and marked the draft clean
    writer.noteEdit(); // a later edit is still unsaved
    expect(storage.entries.has(key)).toBe(true);

    const { stores, records } = fixture(storage);
    await resumePendingLearningDataClear(records, learningDataClearDependencies(stores));
    expect([...storage.entries.keys()]).toEqual([]);

    // The lesson unmounts after the clear intent completes and its cleanup tries to flush.
    await writer.flush(content);
    await writer.save(content);
    expect([...storage.entries.keys()]).toEqual([]);
  });
});
