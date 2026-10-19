import { describe, expect, test } from "bun:test";
import {
  clearAllComposerDrafts,
  createComposerDraftWriter,
  loadComposerDraft,
  type ComposerDraftStorage,
} from "../src/lib/composer-draft-storage";

function memoryStorage(opts: { slowSet?: Promise<void> } = {}): ComposerDraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async getItem(key) { return map.get(key) ?? null; },
    async setItem(key, value) { if (opts.slowSet) await opts.slowSet; map.set(key, value); },
    async removeItem(key) { map.delete(key); },
    async getAllKeys() { return [...map.keys()]; },
    async multiRemove(keys) { for (const key of keys) map.delete(key); },
  };
}

const attachment = { id: "a1", kind: "image" as const, name: "x.png", mimeType: "image/png", size: 10, uri: "file:///x.png" };
const draft = { text: "typed", attachments: [attachment] };

describe("composer draft epoch guard", () => {
  test("a live session's cleanup flush after clear leaves storage empty", async () => {
    const storage = memoryStorage();
    const writer = createComposerDraftWriter("old", storage);
    writer.noteEdit();
    await clearAllComposerDrafts(storage);
    expect(await writer.flush(draft)).toBe(false);
    expect(storage.map.size).toBe(0);
  });

  test("a normal switch keeps the old session's draft", async () => {
    const storage = memoryStorage();
    const writer = createComposerDraftWriter("old", storage);
    writer.noteEdit();
    expect(await writer.flush(draft)).toBe(true);
    expect((await loadComposerDraft("old", storage)).attachments).toHaveLength(1);
    expect((await loadComposerDraft("new", storage)).text).toBe("");
  });

  test("flush without unsaved edits does not write", async () => {
    const storage = memoryStorage();
    const writer = createComposerDraftWriter("s", storage);
    expect(await writer.flush(draft)).toBe(false);
    expect(storage.map.size).toBe(0);
  });

  test("a write in flight when clear starts is removed", async () => {
    let release!: () => void;
    const storage = memoryStorage({ slowSet: new Promise<void>((resolve) => { release = resolve; }) });
    const writer = createComposerDraftWriter("s", storage);
    writer.noteEdit();
    const pending = writer.save(draft);
    const clearing = clearAllComposerDrafts(storage);
    release();
    await Promise.all([pending, clearing]);
    expect(storage.map.size).toBe(0);
  });

  test("writers created after a clear work again", async () => {
    const storage = memoryStorage();
    await clearAllComposerDrafts(storage);
    const writer = createComposerDraftWriter("fresh", storage);
    writer.noteEdit();
    expect(await writer.save({ text: "hi", attachments: [] })).toBe(true);
    expect((await loadComposerDraft("fresh", storage)).text).toBe("hi");
  });
});
