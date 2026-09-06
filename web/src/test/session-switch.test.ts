import { describe, expect, test } from "bun:test";
import { runSessionSwitch, SessionSaveQueue, SessionSnapshotTracker, SessionSwitchRequests } from "../hooks/session-switch";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("session navigation", () => {
  test("starts runtime preparation and durable persistence together, but never displays unsaved history", async () => {
    const prepared = deferred<string>();
    const persisted = deferred();
    const events: string[] = [];
    const navigation = runSessionSwitch({
      isCurrent: () => true,
      prepare: () => { events.push("prepare"); return prepared.promise; },
      persist: () => { events.push("persist"); return persisted.promise; },
      commit: async (value) => { events.push(value); },
    });
    expect(events).toEqual(["prepare", "persist"]);
    prepared.resolve("visible");
    await Promise.resolve();
    expect(events).toEqual(["prepare", "persist"]);
    persisted.resolve();
    expect(await navigation).toBe(true);
    expect(events).toEqual(["prepare", "persist", "visible"]);
  });

  test("an earlier target read finishing last cannot undo the last click", async () => {
    const requests = new SessionSwitchRequests();
    const first = deferred<string>();
    const second = deferred<string>();
    const displayed: string[] = [];
    const open = async (target: Promise<string>) => {
      const request = requests.begin();
      const session = await requests.read(request, () => target);
      if (session === undefined) return;
      await runSessionSwitch({ isCurrent: () => requests.isCurrent(request), prepare: async () => session, persist: async () => {}, commit: async (value) => { displayed.push(value); } });
    };
    const oldClick = open(first.promise);
    const newClick = open(second.promise);
    second.resolve("last clicked");
    await newClick;
    first.resolve("first clicked");
    await oldClick;
    expect(displayed).toEqual(["last clicked"]);
  });

  test("a later click cancels a prepared switch without dropping the old session save", async () => {
    const requests = new SessionSwitchRequests();
    const request = requests.begin();
    const persisted = deferred();
    let durable = false;
    let committed = false;
    const navigation = runSessionSwitch({
      isCurrent: () => requests.isCurrent(request), prepare: async () => "target",
      persist: async () => { await persisted.promise; durable = true; },
      commit: async () => { committed = true; },
    });
    requests.begin(); // Also covers choosing New or the already active session.
    persisted.resolve();
    expect(await navigation).toBe(false);
    expect(durable).toBe(true);
    expect(committed).toBe(false);
  });

  test("preserves a local edit made after the first save while preparation is still pending", async () => {
    const preparation = deferred<string>();
    const firstSaved = deferred();
    let visibleMessage = "before edit";
    let storedMessage = "";
    let saves = 0;
    const navigation = runSessionSwitch({
      isCurrent: () => true,
      prepare: () => preparation.promise,
      persist: async () => { storedMessage = visibleMessage; saves += 1; firstSaved.resolve(); },
      needsFinalSave: () => visibleMessage !== storedMessage,
      commit: async () => { expect(storedMessage).toBe("after edit"); },
    });
    await firstSaved.promise;
    visibleMessage = "after edit";
    preparation.resolve("next session");
    expect(await navigation).toBe(true);
    expect(saves).toBe(2);
  });

  test("reports a current save failure and keeps the existing session installed", async () => {
    let committed = false;
    await expect(runSessionSwitch({ isCurrent: () => true, prepare: async () => "target", persist: async () => { throw new Error("Disk full"); }, commit: async () => { committed = true; } })).rejects.toThrow("Disk full");
    expect(committed).toBe(false);
  });

  test("a superseded read error does not surface on the newly selected row", async () => {
    const requests = new SessionSwitchRequests();
    const pending = deferred<string>();
    const oldRead = requests.read(requests.begin(), () => pending.promise);
    requests.begin();
    pending.reject(new Error("Old read failed"));
    expect(await oldRead).toBeUndefined();
    await expect(requests.read(requests.current, async () => { throw new Error("Current read failed"); })).rejects.toThrow("Current read failed");
  });
});

describe("session snapshot persistence", () => {
  test("same-session writes stay ordered while other sessions save independently", async () => {
    const queue = new SessionSaveQueue();
    const firstWrite = deferred();
    const firstStarted = deferred();
    const values = new Map<string, string>();
    const first = queue.run("a", async () => { firstStarted.resolve(); await firstWrite.promise; values.set("a", "old"); });
    const second = queue.run("a", async () => { values.set("a", "new"); });
    const independent = queue.run("b", async () => { values.set("b", "independent"); });
    await firstStarted.promise;
    await independent;
    expect(values.get("b")).toBe("independent");
    expect(values.has("a")).toBe(false);
    firstWrite.resolve();
    await Promise.all([first, second]);
    expect(values.get("a")).toBe("new");
  });

  test("a failed write does not prevent the next snapshot from saving", async () => {
    const queue = new SessionSaveQueue();
    const failed = queue.run("a", async () => { throw new Error("Unavailable"); });
    let saved = false;
    const retry = queue.run("a", async () => { saved = true; });
    await expect(failed).rejects.toThrow("Unavailable");
    await retry;
    expect(saved).toBe(true);
  });

  test("restored unchanged messages need no write, but local changes and model settings do", () => {
    const tracker = new SessionSnapshotTracker();
    const agent = {};
    const state = { messages: [{ text: "Stored answer" }], model: { id: "saved-model" }, thinkingLevel: "medium" };
    tracker.remember(agent, tracker.capture(agent, state));
    expect(tracker.isSaved(agent, tracker.capture(agent, state))).toBe(true);
    expect(tracker.needsSave(agent, state)).toBe(false);
    expect(tracker.needsSave(agent, { ...state, messages: [] })).toBe(false);
    expect(tracker.needsSave(agent, { ...state, messages: [], isStreaming: true })).toBe(true);
    expect(tracker.isSaved(agent, tracker.capture(agent, { ...state, messages: [...state.messages] }))).toBe(false);
    expect(tracker.isSaved(agent, tracker.capture(agent, { ...state, model: { id: "other-model" } }))).toBe(false);
    expect(tracker.isSaved(agent, tracker.capture(agent, { ...state, thinkingLevel: "high" }))).toBe(false);
    state.messages[0]!.text = "Edited answer";
    tracker.changed(agent);
    expect(tracker.isSaved(agent, tracker.capture(agent, state))).toBe(false);
  });

  test("finishing an older in-flight write never marks a newer message revision as saved", () => {
    const tracker = new SessionSnapshotTracker();
    const agent = {};
    const state = { messages: [{ text: "First chunk" }], model: "model", thinkingLevel: "low" };
    const writing = tracker.capture(agent, state);
    state.messages[0]!.text = "Complete response";
    tracker.changed(agent);
    tracker.remember(agent, writing);
    expect(tracker.isSaved(agent, tracker.capture(agent, state))).toBe(false);
    tracker.remember(agent, tracker.capture(agent, state));
    expect(tracker.isSaved(agent, tracker.capture(agent, state))).toBe(true);
  });
});
