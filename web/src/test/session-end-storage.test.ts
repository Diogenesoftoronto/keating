import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { KeatingStorage } from "../keating/storage";

beforeEach(() => { (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory(); });

async function fixture() {
  const storage = new KeatingStorage();
  const state = await storage.getLearnerState();
  state.sessions = [
    { id: "old", startedAt: 100, topicsCovered: ["algebra"] },
    { id: "new", startedAt: 200, topicsCovered: [] },
  ];
  await storage.saveLearnerState(state);
  return storage;
}

describe("session-end persistence", () => {
  test("captures the session being left before a new current session is selected", async () => {
    const storage = await fixture();
    storage.setCurrentSessionId("old");
    const ending = storage.recordSessionEnd(["algebra"]);
    storage.setCurrentSessionId("new");
    await ending;
    const state = await storage.getLearnerState();
    expect(state.sessions[0]?.endedAt).toBeGreaterThan(100);
    expect(state.sessions[0]?.topicsCovered).toEqual(["algebra"]);
    expect(state.sessions[1]?.endedAt).toBeUndefined();
  });

  test("closes a specified session without rebuilding unrelated learner evidence", async () => {
    const storage = await fixture();
    const rebuild = spyOn(storage, "getLearnerState").mockImplementation(async () => { throw new Error("Unrelated profile rebuild"); });
    try {
      await storage.recordSessionEnd([], "old");
      expect(rebuild).not.toHaveBeenCalled();
    } finally { rebuild.mockRestore(); }
    expect((await storage.getLearnerState()).sessions[0]?.endedAt).toBeDefined();
  });

  test("concurrent session ends preserve both records and do not close an unrelated active session", async () => {
    const storage = await fixture();
    await Promise.all([storage.recordSessionEnd(["algebra"], "old"), storage.recordSessionEnd(["geometry"], "new")]);
    const state = await storage.getLearnerState();
    expect(state.sessions.map((session) => Boolean(session.endedAt))).toEqual([true, true]);
    expect(state.sessions.map((session) => session.topicsCovered)).toEqual([["algebra"], ["geometry"]]);
    const priorEnd = state.sessions[0]?.endedAt;
    await storage.recordSessionEnd(["replacement"], "old");
    expect((await storage.getLearnerState()).sessions[0]).toMatchObject({ endedAt: priorEnd, topicsCovered: ["algebra"] });
  });

  test("a missing old session cannot close the latest learner session", async () => {
    const storage = await fixture();
    await storage.recordSessionEnd([], "missing");
    expect((await storage.getLearnerState()).sessions.every((session) => !session.endedAt)).toBe(true);
  });
});
