import { describe, expect, test } from "bun:test";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { roomSchema, type RoomOperationInput, type RoomViewerSnapshot } from "../rooms/contracts";
import { applyRoomOperation, projectRoomForViewer } from "../rooms/operations";
import { createRoomFacilitator, type RoomFacilitatorControls, type RoomFacilitatorDependencies } from "../rooms/useRoomFacilitator";
import { createRoomSessionConnection, type RoomSessionConnectionDependencies } from "../rooms/useRoomSession";
import { RoomApiError } from "../rooms/client";
import type { RoomClientState } from "../rooms/room-state";

const T0 = Date.parse("2026-10-24T12:00:00.000Z");
const MODEL: Model<Api> = { id: "configured-model", name: "Configured model", provider: "test", api: "openai-completions", baseUrl: "https://model.invalid", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Clock {
  time = T0;
  nextId = 0;
  jobs = new Map<number, { callback: () => void; at: number; repeat?: number }>();
  now = () => this.time;
  setTimeout = (callback: () => void, ms: number) => { const id = ++this.nextId; this.jobs.set(id, { callback, at: this.time + ms }); return id; };
  setInterval = (callback: () => void, ms: number) => { const id = ++this.nextId; this.jobs.set(id, { callback, at: this.time + ms, repeat: ms }); return id; };
  clearTimeout = (id: number) => { this.jobs.delete(id); };
  clearInterval = this.clearTimeout;
  async advance(ms: number) {
    const target = this.time + ms;
    let steps = 0;
    while (true) {
      const due = [...this.jobs].filter(([, job]) => job.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      if (++steps > 200) throw new Error("Unbounded timer loop");
      const [id, job] = due;
      this.time = job.at;
      if (job.repeat) job.at += job.repeat;
      else this.jobs.delete(id);
      job.callback();
      await flush();
    }
    this.time = target;
    await flush();
  }
  dependencies() { return { now: this.now, setTimeout: this.setTimeout, clearTimeout: this.clearTimeout, setInterval: this.setInterval, clearInterval: this.clearInterval }; }
}

class Socket extends EventTarget {
  readyState = 0;
  sent: string[] = [];
  failSend = false;
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  frame(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data: typeof data === "string" ? data : JSON.stringify(data) })); }
  send(value: string) { if (this.failSend) throw new Error("Disconnected"); this.sent.push(value); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  webSocket() { return this as unknown as WebSocket; }
}

function initialRoom(id = "room_test") {
  const at = new Date(T0).toISOString();
  return roomSchema.parse({
    schemaVersion: 1, id, title: "Study group", hostAccountId: "host", createdAt: at, updatedAt: at, revision: 0, settings: {},
    members: [
      { accountId: "host", displayName: "Host", role: "host", joinedAt: at },
      { accountId: "teach", displayName: "Teacher", role: "teacher", joinedAt: at },
      { accountId: "maya", displayName: "Maya", role: "learner", joinedAt: at },
    ],
    messages: [{ id: "msg_one", seq: 1, body: "@Keating, help?", kind: "chat", audience: "room", authorAccountId: "maya", authorName: "Maya", authorRole: "learner", createdAt: at }],
    nextSeq: 2, turn: { status: "idle", consideredSeq: 0, throughSeq: 0 },
  });
}
const view = (id = "room_test") => projectRoomForViewer(initialRoom(id), "host", { now: T0 });
function reply() : AssistantMessage {
  return { role: "assistant", api: MODEL.api, provider: MODEL.provider, model: MODEL.id, timestamp: T0, stopReason: "toolUse", content: [{ type: "toolCall", id: "send_one", name: "send_message", arguments: { content: "Maya, show your reasoning." } }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
function inference() { const stream = createAssistantMessageEventStream(); stream.end(reply()); return stream; }

function sessionHarness(overrides: Partial<RoomSessionConnectionDependencies> = {}, id = "room_test") {
  const clock = new Clock();
  const sockets: Socket[] = [];
  const states: RoomClientState[] = [];
  const statuses: string[] = [];
  const errors: string[] = [];
  const loadErrors: unknown[] = [];
  const connection = createRoomSessionConnection(id, {
    onState: (state) => states.push(state), onStatus: (status) => statuses.push(status), onError: (message) => errors.push(message), onLoadError: (error) => loadErrors.push(error),
  }, {
    ...clock.dependencies(), getRoom: async () => view(id), apply: async () => view(id), getEarlier: async () => ({ messages: [], hasEarlierMessages: false }),
    socket: () => { const socket = new Socket(); sockets.push(socket); return socket.webSocket(); }, ...overrides,
  });
  return { clock, sockets, states, statuses, errors, loadErrors, connection, state: () => states.at(-1)! };
}

describe("the session hook's real connection lifecycle", () => {
  test("HTTP polling catches up when websocket construction or reconnection fails", async () => {
    let current = view();
    let calls = 0;
    const h = sessionHarness({ getRoom: async () => { calls++; return current; }, socket: () => { throw new Error("Websocket unsupported by proxy"); } });
    await flush();
    expect(h.state().snapshot?.room.revision).toBe(0);
    current = structuredClone(current);
    current.room.revision = 3;
    current.room.messages[0]!.body = "Edited while disconnected";
    await h.clock.advance(10_000);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(h.state().snapshot?.room.messages[0]?.body).toBe("Edited while disconnected");
    expect(h.statuses.at(-1)).toBe("reconnecting");
    h.connection.stop();
    expect(h.clock.jobs.size).toBe(0);
  });

  test("reconnect opens fetch an authoritative snapshot and stale socket frames are ignored", async () => {
    let current = view();
    const h = sessionHarness({ getRoom: async () => current });
    await flush();
    const old = h.sockets[0]!;
    old.open();
    await flush();
    old.close();
    current = structuredClone(current);
    current.room.revision = 4;
    current.room.messages[0]!.body = "Latest";
    await h.clock.advance(1000);
    const next = h.sockets[1]!;
    expect(next).toBeDefined();
    next.open();
    await flush();
    expect(h.state().snapshot?.room.messages[0]?.body).toBe("Latest");
    const count = h.states.length;
    old.frame({ type: "removed", roomId: "room_test" });
    old.open();
    expect(h.states).toHaveLength(count);
    expect(h.state().removed).toBe(false);
    h.connection.stop();
  });

  test("unknown and malformed frames leave a usable room state", async () => {
    const h = sessionHarness();
    await flush();
    const before = h.state();
    h.sockets[0]!.frame({ type: "future-version-message" });
    h.sockets[0]!.frame({ type: "presence", roomId: "room_test", accountIds: null });
    h.sockets[0]!.frame("not json");
    h.sockets[0]!.frame("null");
    expect(h.state()).toBe(before);
    h.sockets[0]!.frame({ type: "presence", roomId: "room_test", accountIds: ["host"] });
    expect(h.state().presentAccountIds).toEqual(["host"]);
    h.connection.stop();
  });

  test("a missed patch revision fetches missed edits instead of retaining a stale history", async () => {
    let current = view();
    const h = sessionHarness({ getRoom: async () => current });
    await flush();
    h.sockets[0]!.open();
    await flush();
    current = structuredClone(current);
    current.room.revision = 3;
    current.room.messages[0]!.body = "Edited at revision 2";
    const { messages: _messages, ...room } = current.room;
    h.sockets[0]!.frame({ type: "room.patch", revision: 3, snapshot: { room, viewer: current.viewer, permissions: current.permissions }, messages: [] });
    await flush();
    expect(h.state().snapshot?.room.messages[0]?.body).toBe("Edited at revision 2");
    h.connection.stop();
  });

  test("send failures and a missing pong recover without throwing or leaking timers", async () => {
    const h = sessionHarness();
    await flush();
    h.sockets[0]!.open();
    h.sockets[0]!.failSend = true;
    expect(() => h.connection.send({ type: "typing" })).not.toThrow();
    expect(h.statuses.at(-1)).toBe("reconnecting");
    await h.clock.advance(1000);
    h.sockets[1]!.open();
    await h.clock.advance(25_000);
    expect(h.sockets[1]!.sent).toContain("ping");
    await h.clock.advance(25_000);
    expect(h.statuses.at(-1)).toBe("reconnecting");
    h.connection.stop();
    expect(h.clock.jobs.size).toBe(0);
  });

  test("removed closes the socket, stops polling and cannot be undone by a late fetch", async () => {
    const late = deferred<RoomViewerSnapshot>();
    const h = sessionHarness({ getRoom: () => late.promise });
    h.connection.applySnapshot(view());
    const socket = h.sockets[0]!;
    socket.open();
    socket.frame({ type: "removed", roomId: "room_test" });
    expect(h.state()).toMatchObject({ removed: true, snapshot: null, preview: null });
    expect(socket.readyState).toBe(3);
    expect(h.clock.jobs.size).toBe(0);
    late.resolve(view());
    await flush();
    expect(h.state().removed).toBe(true);
    expect(h.state().snapshot).toBeNull();
  });

  test("refreshes coalesce, and permission denial clears already-loaded room data", async () => {
    const pending = deferred<RoomViewerSnapshot>();
    let calls = 0;
    const h = sessionHarness({ getRoom: () => { calls++; return pending.promise; } });
    h.connection.applySnapshot(view());
    const first = h.connection.refresh();
    expect(h.connection.refresh()).toBe(first);
    expect(calls).toBe(1);
    pending.reject(new RoomApiError("Access removed", 403, "room_not_member"));
    await first;
    expect(h.state()).toMatchObject({ removed: true, snapshot: null });
    expect(h.clock.jobs.size).toBe(0);
  });

  test("old-room fetches, mutations, pagination, errors and frames are fenced after cleanup", async () => {
    const fetch = deferred<RoomViewerSnapshot>();
    const mutation = deferred<RoomViewerSnapshot>();
    const page = deferred<{ messages: RoomViewerSnapshot["room"]["messages"]; hasEarlierMessages: boolean }>();
    const old = sessionHarness({ getRoom: () => fetch.promise, apply: () => mutation.promise, getEarlier: () => page.promise });
    old.connection.applySnapshot(view());
    const mutating = old.connection.mutate({ type: "member.rename", displayName: "New name" });
    const paging = old.connection.loadEarlier();
    old.connection.stop();
    const count = old.states.length;
    const errors = old.errors.length;
    const next = sessionHarness({}, "room_next");
    fetch.resolve(view()); mutation.resolve(view()); page.resolve({ messages: view().room.messages, hasEarlierMessages: false });
    old.sockets[0]!.open();
    old.sockets[0]!.frame({ type: "removed", roomId: "room_next" });
    expect(await mutating).toBeNull();
    await paging;
    await flush();
    expect(old.states).toHaveLength(count);
    expect(old.errors).toHaveLength(errors);
    expect(old.clock.jobs.size).toBe(0);
    expect(next.state().snapshot?.room.id).toBe("room_next");
    next.connection.stop();
  });

  test("late private pagination is discarded on demotion", async () => {
    const page = deferred<{ messages: RoomViewerSnapshot["room"]["messages"]; hasEarlierMessages: boolean }>();
    const h = sessionHarness({ getEarlier: () => page.promise });
    await flush();
    const loading = h.connection.loadEarlier();
    const learner = view();
    learner.room.revision = 1;
    learner.viewer.role = "learner";
    learner.permissions.canOversee = false;
    h.connection.applySnapshot(learner);
    page.resolve({ messages: [{ ...view().room.messages[0]!, id: "msg_private", kind: "whisper", audience: "teachers", body: "Private guidance" }], hasEarlierMessages: false });
    await loading;
    expect(JSON.stringify(h.state())).not.toContain("Private guidance");
    h.connection.stop();
  });
});

function facilitatorHarness(overrides: Partial<RoomFacilitatorDependencies> = {}, facilitatorId = "browser_one", shared?: ReturnType<typeof server>) {
  const clock = shared?.clock ?? new Clock();
  const backend = shared ?? server(clock);
  const states: Omit<RoomFacilitatorControls, "start" | "stop">[] = [];
  const previews: unknown[] = [];
  const releases: string[][] = [];
  let calls = 0;
  const runtime = createRoomFacilitator("room_test", facilitatorId, {
    onChange: (state) => states.push(state), applySnapshot: () => undefined, send: (message) => previews.push(message),
  }, {
    ...clock.dependencies(), apply: backend.apply, resolveModel: async () => MODEL, modelLabel: (model) => model.name,
    persona: async () => "Teach with questions", stream: (model) => { calls++; expect(model).toBe(MODEL); return inference(); },
    newTurnId: () => `turn_${++backend.turns}`, releaseOnUnload: (roomId, id) => { releases.push([roomId, id]); }, ...overrides,
  });
  runtime.update(backend.snapshot());
  return { runtime, clock, backend, states, previews, releases, calls: () => calls, state: () => states.at(-1)! };
}
function server(clock: Clock) {
  let room = initialRoom();
  let n = 0;
  const operations: RoomOperationInput[] = [];
  return {
    clock, operations, turns: 0,
    snapshot: () => projectRoomForViewer(room, "host", { now: clock.now() }),
    update: (input: RoomOperationInput) => { room = applyRoomOperation(room, "host", { ...input, id: `server_${++n}`, roomId: room.id }, new Date(clock.now()).toISOString()).room; },
    apply: async (_roomId: string, input: RoomOperationInput) => {
      operations.push(input);
      try { room = applyRoomOperation(room, "host", { ...input, id: `server_${++n}`, roomId: room.id }, new Date(clock.now()).toISOString()).room; }
      catch (error) { const cause = error as { message: string; code: string; statusCode: number }; throw new RoomApiError(cause.message, cause.statusCode, cause.code); }
      return projectRoomForViewer(room, "host", { now: clock.now() });
    },
  };
}

describe("the facilitator hook's actual browser lifetime", () => {
  test("shows the actual configured model before starting without claiming a lease or calling inference", async () => {
    const h = facilitatorHarness();
    await h.runtime.prepareModel();
    expect(h.state()).toMatchObject({ status: "off", modelLabel: MODEL.name, error: "" });
    expect(h.backend.operations).toEqual([]);
    expect(h.calls()).toBe(0);
    h.runtime.dispose();
  });

  test("a missing model is surfaced before and during start without a claim or generated reply", async () => {
    const h = facilitatorHarness({ resolveModel: async () => { throw new Error("Choose or connect a model in Chat"); } });
    await h.runtime.prepareModel();
    expect(h.state()).toMatchObject({ status: "off", modelLabel: "", error: "Choose or connect a model in Chat" });
    await h.runtime.start();
    expect(h.state()).toMatchObject({ status: "off", error: "Choose or connect a model in Chat" });
    expect(h.backend.operations).toEqual([]);
    expect(h.calls()).toBe(0);
    h.runtime.dispose();
  });

  test("coalesces duplicate starts and passes one browser ID through claim, turns, heartbeat and release", async () => {
    const h = facilitatorHarness();
    const first = h.runtime.start();
    expect(h.runtime.start()).toBe(first);
    await first;
    expect(h.state()).toMatchObject({ status: "listening", modelLabel: MODEL.name });
    await h.clock.advance(1000);
    expect(h.calls()).toBe(1);
    await h.clock.advance(15_000);
    await h.runtime.stop();
    expect(h.backend.operations.map((op) => op.type)).toEqual(["facilitator.claim", "turn.begin", "turn.complete", "facilitator.heartbeat", "facilitator.release"]);
    for (const operation of h.backend.operations) expect("facilitatorId" in operation && operation.facilitatorId).toBe("browser_one");
    expect(h.clock.jobs.size).toBe(0);
  });

  test("same-account tabs cannot run duplicate facilitators or release the other browser", async () => {
    const one = facilitatorHarness();
    await one.runtime.start();
    const two = facilitatorHarness({}, "browser_two", one.backend);
    await two.runtime.start();
    expect(two.state().status).toBe("off");
    expect(two.state().error).toContain("already");
    expect(two.backend.snapshot().room.facilitator?.facilitatorId).toBe("browser_one");
    await two.runtime.stop();
    expect(two.backend.snapshot().room.facilitator?.facilitatorId).toBe("browser_one");
    one.runtime.dispose(); two.runtime.dispose();
    await flush();
  });

  test("stopping during model selection prevents a late claim", async () => {
    const selected = deferred<Model<Api>>();
    const h = facilitatorHarness({ resolveModel: () => selected.promise });
    const starting = h.runtime.start();
    await h.runtime.stop();
    selected.resolve(MODEL);
    await starting;
    expect(h.backend.operations).toEqual([]);
    expect(h.state().status).toBe("off");
    h.runtime.dispose();
  });

  test("an older heartbeat response cannot cancel a turn whose begin is still awaiting its response", async () => {
    const clock = new Clock();
    const backend = server(clock);
    const begin = deferred<RoomViewerSnapshot>();
    let began: RoomViewerSnapshot | undefined;
    const h = facilitatorHarness({ apply: async (roomId, operation) => {
      const result = await backend.apply(roomId, operation);
      if (operation.type === "turn.begin") { began = result; return begin.promise; }
      return result;
    } }, "browser_one", backend);
    await h.runtime.start();
    const oldHeartbeat = await backend.apply("room_test", { type: "facilitator.heartbeat", facilitatorId: "browser_one" });
    await clock.advance(1000);
    expect(began).toBeDefined();
    h.runtime.update(oldHeartbeat);
    begin.resolve(began!);
    await flush();
    expect(h.calls()).toBe(1);
    expect(backend.snapshot().room.messages.some((message) => message.kind === "keating")).toBe(true);
    h.runtime.dispose();
    await flush();
  });

  test("stopping or navigating while a claim is in flight releases the late claim without reviving the hook", async () => {
    const claim = deferred<RoomViewerSnapshot>();
    const operations: RoomOperationInput[] = [];
    const h = facilitatorHarness({ apply: async (_roomId, operation) => { operations.push(operation); return operation.type === "facilitator.claim" ? claim.promise : view(); } });
    const starting = h.runtime.start();
    await flush();
    expect(h.state()).toMatchObject({ status: "starting", modelLabel: MODEL.name });
    h.runtime.dispose();
    const count = h.states.length;
    const claimed = view();
    claimed.room.facilitator = { accountId: "host", facilitatorId: "browser_one", displayName: "Host", modelLabel: MODEL.name, claimedAt: new Date(T0).toISOString(), heartbeatAt: new Date(T0).toISOString() };
    claim.resolve(claimed);
    await starting;
    await flush();
    expect(operations.map((op) => op.type)).toEqual(["facilitator.claim", "facilitator.release"]);
    expect(h.states).toHaveLength(count);
    expect(h.clock.jobs.size).toBe(0);
  });

  test("lease loss cancels a buffered turn, and late model success cannot preview or publish", async () => {
    const stream = createAssistantMessageEventStream();
    let signal: AbortSignal | undefined;
    const h = facilitatorHarness({ stream: (_model, _context, options) => { signal = options.signal; return stream; } });
    await h.runtime.start();
    await h.clock.advance(1000);
    stream.push({ type: "toolcall_delta", contentIndex: 0, delta: "content", partial: reply() });
    await flush();
    expect(h.state().localPreview).toBeNull();
    expect(h.previews).toEqual([]);
    h.backend.update({ type: "facilitator.claim", facilitatorId: "browser_two", modelLabel: "Other", takeOver: true });
    h.runtime.update(h.backend.snapshot());
    expect(signal?.aborted).toBe(true);
    expect(h.state()).toMatchObject({ status: "off", localPreview: null });
    stream.end(reply());
    await flush();
    expect(h.backend.snapshot().room.messages.some((message) => message.kind === "keating")).toBe(false);
    expect(h.previews).toEqual([]);
    expect(h.state().localPreview).toBeNull();
    h.runtime.dispose();
  });

  test("losing oversight during a buffered turn prevents its preview", async () => {
    const stream = createAssistantMessageEventStream();
    const h = facilitatorHarness({ stream: () => stream });
    await h.runtime.start();
    await h.clock.advance(1000);
    stream.push({ type: "toolcall_delta", contentIndex: 0, delta: "content", partial: reply() });
    await flush();
    const changed = h.backend.snapshot();
    changed.room.revision++;
    changed.viewer.role = "learner";
    changed.permissions.canOversee = false;
    changed.room.settings.replyReview = "teacher-approves";
    h.runtime.update(changed);
    expect(h.state()).toMatchObject({ status: "off", localPreview: null });
    stream.end(reply());
    await flush();
    expect(h.state().localPreview).toBeNull();
    h.runtime.dispose();
  });

  test("hiding a source cancels a buffered turn while preserving the facilitator", async () => {
    const stream = createAssistantMessageEventStream();
    let signal: AbortSignal | undefined;
    const h = facilitatorHarness({ stream: (_model, _context, options) => { signal = options.signal; return stream; } });
    await h.runtime.start();
    await h.clock.advance(1000);
    stream.push({ type: "toolcall_delta", contentIndex: 0, delta: "content", partial: reply() });
    await flush();
    expect(h.state().localPreview).toBeNull();
    h.backend.update({ type: "message.hide", messageId: "msg_one", hidden: true });
    h.runtime.update(h.backend.snapshot());
    expect(signal?.aborted).toBe(true);
    expect(h.state().localPreview).toBeNull();
    stream.end(reply());
    await flush();
    expect(h.state().status).toBe("listening");
    expect(h.backend.snapshot().room.facilitator?.facilitatorId).toBe("browser_one");
    expect(h.backend.snapshot().room.messages.some((message) => message.kind === "keating")).toBe(false);
    h.runtime.dispose();
    await flush();
  });

  test("pagehide releases only this browser's lease and cancels all local work", async () => {
    const h = facilitatorHarness();
    await h.runtime.start();
    h.runtime.unload();
    expect(h.releases).toEqual([["room_test", "browser_one"]]);
    expect(h.state()).toMatchObject({ status: "off", localPreview: null });
    expect(h.clock.jobs.size).toBe(0);
    h.runtime.dispose();
    await flush();
    expect(h.backend.operations.filter((op) => op.type === "facilitator.release")).toHaveLength(0);
  });

  test("server refusals do not create an immediate retry loop", async () => {
    const backend = server(new Clock());
    const h = facilitatorHarness({ apply: async (roomId, operation) => {
      if (operation.type === "turn.begin") throw new RoomApiError("Already considered", 409, "room_turn_stale");
      return backend.apply(roomId, operation);
    } }, "browser_one", backend);
    await h.runtime.start();
    await h.clock.advance(10_000);
    expect(h.calls()).toBe(0);
    expect(h.state().status).toBe("listening");
    h.runtime.dispose();
    await flush();
  });
});
