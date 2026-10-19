import { describe, expect, test } from "bun:test";
import type { SystemDesignGraph, SystemDesignSpec } from "@keating/learner-contracts";
import {
  clearAllDiagramDrafts, clearDiagramDraft, createDiagramDraftWriter, loadDiagramDraft, mobileDiagramDraftKey, parseStoredDiagramDraft, saveDiagramDraft,
  serializeDiagramDraft, type DiagramDraftStorage,
} from "../src/lib/diagram-draft-storage";

const spec: SystemDesignSpec = {
  kinds: ["client", "service"],
  components: [{ id: "web", label: "Web", kind: "client" }], connections: [],
  checks: [{ id: "svc", label: "A service exists", type: "component", kind: "service" }],
};
const graph: SystemDesignGraph = {
  components: [{ id: "web", label: "Web", kind: "client" }, { id: "api", label: "API", kind: "service" }],
  connections: [{ id: "c1", from: "web", to: "api", label: "HTTPS" }],
};

function memoryStorage(initial: Record<string, string> = {}): DiagramDraftStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async getItem(key) { return data.get(key) ?? null; },
    async setItem(key, value) { data.set(key, value); },
    async removeItem(key) { data.delete(key); },
    async getAllKeys() { return [...data.keys()]; },
    async multiRemove(keys) { for (const key of keys) data.delete(key); },
  };
}

describe("mobile diagram drafts", () => {
  test("keys isolate document, revision and node, including delimiter-bearing ids", () => {
    const key = mobileDiagramDraftKey("doc", 1, "node");
    expect(key).not.toBe(mobileDiagramDraftKey("doc", 2, "node"));
    expect(key).not.toBe(mobileDiagramDraftKey("other", 1, "node"));
    expect(key).not.toBe(mobileDiagramDraftKey("doc", 1, "other"));
    expect(mobileDiagramDraftKey("a:b", 1, "c")).not.toBe(mobileDiagramDraftKey("a", 1, "b:c"));
    expect(key.startsWith("keating.mobile.diagram-draft.v1.")).toBe(true);
  });

  test("a saved draft restores the graph and explanation, and nothing derived", async () => {
    const storage = memoryStorage();
    const key = mobileDiagramDraftKey("doc", 0, "node");
    await saveDiagramDraft(key, { graph, explanation: "Because" }, storage);
    expect(JSON.parse(storage.data.get(key)!)).toEqual({ version: 1, graph, explanation: "Because" });
    expect(await loadDiagramDraft(key, spec, storage)).toEqual({ graph, explanation: "Because" });
  });

  test("nothing saved restores as undefined; untrusted saved values reject so the editor can say so", async () => {
    const storage = memoryStorage();
    const key = mobileDiagramDraftKey("doc", 0, "node");
    expect(await loadDiagramDraft(key, spec, storage)).toBeUndefined();
    for (const raw of ["not json", "[]", JSON.stringify({ version: 2, graph, explanation: "" }), JSON.stringify({ version: 1, graph, explanation: "", mermaid: "x" }),
      JSON.stringify({ version: 1, graph: { ...graph, components: [...graph.components, { id: "q", label: "Q", kind: "queue" }] }, explanation: "" }),
      JSON.stringify({ version: 1, graph: { components: [], connections: [{ id: "x", from: "a", to: "b" }] }, explanation: "" })]) {
      storage.data.set(key, raw);
      await expect(loadDiagramDraft(key, spec, storage)).rejects.toThrow("invalid");
    }
  });

  test("a draft saved for one palette is not restored against a different spec", () => {
    const raw = serializeDiagramDraft({ graph, explanation: "Because" });
    expect(parseStoredDiagramDraft(raw, spec)).toBeDefined();
    expect(parseStoredDiagramDraft(raw, { ...spec, kinds: ["client"] })).toBeUndefined();
  });

  test("clearing removes one draft; clearing all removes only diagram drafts", async () => {
    const storage = memoryStorage({ "keating.mobile.composer-draft.v1.s1": "{}", other: "x" });
    const a = mobileDiagramDraftKey("doc", 0, "a");
    const b = mobileDiagramDraftKey("doc", 0, "b");
    await saveDiagramDraft(a, { graph, explanation: "" }, storage);
    await saveDiagramDraft(b, { graph, explanation: "" }, storage);
    await clearDiagramDraft(a, storage);
    expect([...storage.data.keys()].sort()).toEqual([b, "keating.mobile.composer-draft.v1.s1", "other"].sort());
    await clearAllDiagramDrafts(storage);
    expect([...storage.data.keys()].sort()).toEqual(["keating.mobile.composer-draft.v1.s1", "other"]);
  });
});

describe("diagram draft writers", () => {
  const content = { graph, explanation: "Because" };
  const key = mobileDiagramDraftKey("doc", 0, "node");

  test("a normal edit is saved and then marked clean, so teardown writes nothing more", async () => {
    const storage = memoryStorage();
    const writer = createDiagramDraftWriter(key, storage);
    expect(writer.dirty).toBe(false);
    writer.noteEdit();
    expect(writer.dirty).toBe(true);
    expect(await writer.save(content)).toBe(true);
    expect(writer.dirty).toBe(false);
    storage.data.clear();
    expect(await writer.flush(content)).toBe(false);
    expect(storage.data.size).toBe(0);
  });

  test("teardown flushes edits that never reached storage", async () => {
    const storage = memoryStorage();
    const writer = createDiagramDraftWriter(key, storage);
    writer.noteEdit();
    expect(await writer.flush(content)).toBe(true);
    expect(await loadDiagramDraft(key, spec, storage)).toEqual(content);
    expect(writer.dirty).toBe(false);
  });

  test("an edit made while a write is running keeps the draft dirty", async () => {
    const storage = memoryStorage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow: DiagramDraftStorage = { ...storage, setItem: async (k, v) => { await gate; await storage.setItem(k, v); } };
    const writer = createDiagramDraftWriter(key, slow);
    writer.noteEdit();
    const saving = writer.save(content);
    writer.noteEdit();
    release();
    expect(await saving).toBe(true);
    expect(writer.dirty).toBe(true);
  });

  test("clearing invalidates a live writer: its autosave and teardown flush stay dropped", async () => {
    const storage = memoryStorage();
    const writer = createDiagramDraftWriter(key, storage);
    writer.noteEdit();
    await writer.save(content);
    writer.noteEdit();
    await clearAllDiagramDrafts(storage);
    expect(storage.data.size).toBe(0);
    expect(await writer.save(content)).toBe(false);
    expect(await writer.flush(content)).toBe(false);
    expect(storage.data.size).toBe(0);
    expect(writer.dirty).toBe(true);
  });

  test("clearing waits for a write that is already in flight, then removes it", async () => {
    const storage = memoryStorage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow: DiagramDraftStorage = { ...storage, setItem: async (k, v) => { await gate; await storage.setItem(k, v); } };
    const writer = createDiagramDraftWriter(key, slow);
    writer.noteEdit();
    const saving = writer.save(content);
    const clearing = clearAllDiagramDrafts(storage);
    release();
    await Promise.all([saving, clearing]);
    expect(storage.data.size).toBe(0);
  });

  test("a writer created after the clear works normally", async () => {
    const storage = memoryStorage();
    await clearAllDiagramDrafts(storage);
    const writer = createDiagramDraftWriter(key, storage);
    writer.noteEdit();
    expect(await writer.save(content)).toBe(true);
    expect(storage.data.has(key)).toBe(true);
  });
});
