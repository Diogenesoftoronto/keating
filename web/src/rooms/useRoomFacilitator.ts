import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Api, Model } from "@earendil-works/pi-ai";
import { applyRoomOperation, randomOperationId, releaseFacilitatorOnUnload, RoomApiError } from "./client";
import type { RoomClientSocketMessage, RoomOperationInput, RoomViewerSnapshot } from "./contracts";
import { planFacilitatorTurn, previewAudienceIncludes } from "./facilitation";
import { runFacilitatorTurn, type FacilitatorStreamFn } from "./facilitator-turn";
import type { RoomSession } from "./useRoomSession";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT, subscribeModelPrefs } from "../keating/model-prefs";

const HEARTBEAT_MS = 15_000;
const PREVIEW_THROTTLE_MS = 150;

export type FacilitatorStatus = "off" | "starting" | "listening" | "thinking";

export interface RoomFacilitatorControls {
  status: FacilitatorStatus;
  modelLabel: string;
  error: string;
  localPreview: { turnId: string; text: string } | null;
  start: (options?: { takeOver?: boolean }) => Promise<void>;
  stop: () => Promise<void>;
}

export interface RoomFacilitatorDependencies {
  apply: typeof applyRoomOperation;
  resolveModel: () => Promise<Model<Api>>;
  modelLabel: (model: Model<Api>) => string;
  persona: () => Promise<string>;
  stream: FacilitatorStreamFn;
  newTurnId: () => string;
  releaseOnUnload: typeof releaseFacilitatorOnUnload;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (timer: number) => void;
  setInterval: (callback: () => void, ms: number) => number;
  clearInterval: (timer: number) => void;
  now: () => number;
}

const defaults: RoomFacilitatorDependencies = {
  apply: applyRoomOperation,
  resolveModel: async () => (await import("./facilitator-model")).resolveFacilitatorModel(),
  modelLabel: (model) => (model.name || model.id).slice(0, 160),
  persona: async () => (await import("./facilitator-model")).facilitatorPersona(),
  stream: async (model, context, options) => (await import("../hooks/keating-stream")).hybridStreamFn(model, context, options),
  newTurnId: () => randomOperationId("turn"),
  releaseOnUnload: releaseFacilitatorOnUnload,
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (timer) => window.clearTimeout(timer),
  setInterval: (callback, ms) => window.setInterval(callback, ms),
  clearInterval: (timer) => window.clearInterval(timer),
  now: Date.now,
};

/** The hook's browser lifetime, with model/transport boundaries injected for tests. */
export function createRoomFacilitator(
  roomId: string,
  facilitatorId: string,
  callbacks: {
    onChange: (state: Omit<RoomFacilitatorControls, "start" | "stop">) => void;
    applySnapshot: RoomSession["applySnapshot"];
    send: (message: RoomClientSocketMessage) => void;
  },
  overrides: Partial<RoomFacilitatorDependencies> = {},
) {
  const dependencies = { ...defaults, ...overrides };
  let state: Omit<RoomFacilitatorControls, "start" | "stop"> = { status: "off", modelLabel: "", error: "", localPreview: null };
  let snapshot: RoomViewerSnapshot | null = null;
  let presence: readonly string[] = [];
  let disposed = false;
  let running = false;
  let claimed = false;
  let generation = 0;
  let starting: Promise<void> | null = null;
  let model: Model<Api> | null = null;
  let turn: AbortController | null = null;
  let activeTurnId: string | null = null;
  let turnBegan = false;
  let timer: number | undefined;
  let heartbeat: number | undefined;
  let blockedRevision: number | undefined;
  let modelResolution = 0;

  const change = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    if (!disposed) callbacks.onChange(state);
  };
  const ownLease = (value: RoomViewerSnapshot | null) => Boolean(
    value?.room.id === roomId && value.permissions.canFacilitate && value.permissions.isFacilitator &&
    value.room.facilitator?.facilitatorId === facilitatorId,
  );

  const stopLocally = (error = "") => {
    generation += 1;
    running = false;
    turn?.abort();
    turn = null;
    activeTurnId = null;
    turnBegan = false;
    if (timer !== undefined) dependencies.clearTimeout(timer);
    if (heartbeat !== undefined) dependencies.clearInterval(heartbeat);
    timer = heartbeat = undefined;
    blockedRevision = undefined;
    change({ status: "off", localPreview: null, ...(error ? { error } : {}) });
  };

  const update = (next: RoomViewerSnapshot | null, present: readonly string[] = presence) => {
    if (disposed || (next && next.room.id !== roomId)) return;
    const lostOversight = snapshot?.permissions.canOversee && !next?.permissions.canOversee;
    if (next && snapshot && next.room.revision < snapshot.room.revision) return;
    snapshot = next;
    presence = present;
    if (turn && turnBegan && activeTurnId && (next?.room.turn.status !== "thinking" || next.room.turn.turnId !== activeTurnId)) {
      turn.abort();
      change({ localPreview: null });
    }
    if (state.localPreview && (!next || !previewAudienceIncludes(next))) change({ localPreview: null });
    if (running && (lostOversight || !ownLease(next))) {
      stopLocally(!next?.permissions.canFacilitate || lostOversight
        ? "You can no longer run Keating in this room."
        : "Keating moved to another browser.");
      claimed = false;
    }
    schedule();
  };

  const accept = (next: RoomViewerSnapshot, attempt: number) => {
    if (disposed || generation !== attempt || next.room.id !== roomId) return;
    update(next);
    callbacks.applySnapshot(next);
  };

  const apply = async (operation: RoomOperationInput, attempt: number): Promise<RoomViewerSnapshot> => {
    const result = await dependencies.apply(roomId, operation);
    if ("removed" in result) throw new RoomApiError("You are no longer in this room.", 403, "room_not_member");
    if (generation === attempt && "turnId" in operation && operation.turnId === activeTurnId) {
      if (operation.type === "turn.begin") turnBegan = true;
      if (operation.type === "turn.complete") turnBegan = false;
    }
    accept(result, attempt);
    return result;
  };

  const start = (options: { takeOver?: boolean } = {}): Promise<void> => {
    if (disposed || running) return Promise.resolve();
    if (starting) return starting;
    if (!snapshot?.permissions.canFacilitate) {
      change({ error: "You cannot run Keating in this room." });
      return Promise.resolve();
    }
    const attempt = ++generation;
    modelResolution += 1;
    change({ status: "starting", error: "" });
    starting = (async () => {
      try {
        const selected = await dependencies.resolveModel();
        if (disposed || generation !== attempt) return;
        const label = dependencies.modelLabel(selected);
        change({ modelLabel: label });
        const result = await dependencies.apply(roomId, {
          type: "facilitator.claim", facilitatorId, modelLabel: label, takeOver: options.takeOver ?? false,
        });
        if ("removed" in result) throw new RoomApiError("You are no longer in this room.", 403, "room_not_member");
        if (disposed || generation !== attempt) {
          // A stop/navigation may finish while the claim is in flight.
          if (result.room.facilitator?.facilitatorId === facilitatorId) {
            void dependencies.apply(roomId, { type: "facilitator.release", facilitatorId }).catch(() => undefined);
          }
          return;
        }
        accept(result, attempt);
        if (!ownLease(snapshot)) throw new Error("Keating is running in another browser.");
        model = selected;
        running = claimed = true;
        change({ status: "listening", modelLabel: label });
        heartbeat = dependencies.setInterval(() => {
          void apply({ type: "facilitator.heartbeat", facilitatorId }, attempt).catch((cause) => {
            if (disposed || generation !== attempt) return;
            if (cause instanceof RoomApiError && (cause.status === 403 || cause.status === 404 || cause.code === "room_facilitator_replaced")) {
              claimed = false;
              stopLocally(cause.message);
            }
          });
        }, HEARTBEAT_MS);
        schedule();
      } catch (cause) {
        if (!disposed && generation === attempt) stopLocally(cause instanceof Error ? cause.message : "Keating could not start in this browser.");
      }
    })().finally(() => { starting = null; });
    return starting;
  };

  const stop = async () => {
    const release = claimed;
    claimed = false;
    stopLocally();
    const attempt = generation;
    if (release) await apply({ type: "facilitator.release", facilitatorId }, attempt).catch(() => undefined);
  };

  async function runTurn() {
    if (!running || !snapshot || !model || turn || !ownLease(snapshot)) return;
    const plan = planFacilitatorTurn(snapshot, dependencies.now());
    if (!plan.run || plan.notBefore > dependencies.now()) return;
    const controller = new AbortController();
    const attempt = generation;
    const revision = snapshot.room.revision;
    turn = controller;
    let lastPreviewAt = Number.NEGATIVE_INFINITY;
    change({ status: "thinking" });
    try {
      const persona = await dependencies.persona();
      const result = await runFacilitatorTurn({
        facilitatorId, plan, model, modelLabel: dependencies.modelLabel(model), persona,
        presentAccountIds: presence, signal: controller.signal,
      }, {
        apply: (operation) => apply(operation, attempt),
        stream: dependencies.stream,
        newTurnId: () => { activeTurnId = dependencies.newTurnId(); return activeTurnId; },
        onPreview: (turnId, text) => {
          if (disposed || generation !== attempt || controller.signal.aborted || !running || !snapshot || !previewAudienceIncludes(snapshot) ||
              snapshot.room.turn.status !== "thinking" || snapshot.room.turn.turnId !== turnId) return;
          change({ localPreview: { turnId, text } });
          const now = dependencies.now();
          if (now - lastPreviewAt < PREVIEW_THROTTLE_MS) return;
          lastPreviewAt = now;
          callbacks.send({ type: "keating.preview", facilitatorId, turnId, text });
        },
      });
      if (disposed || generation !== attempt) return;
      change({ error: result.status === "failed" ? result.error : "" });
      if (result.status === "skipped" || (result.status === "failed" && !result.snapshot)) blockedRevision = revision;
    } catch (cause) {
      if (disposed || generation !== attempt) return;
      blockedRevision = revision;
      change({ error: cause instanceof Error ? cause.message : "Keating could not take a turn." });
    } finally {
      if (turn === controller) { turn = null; activeTurnId = null; turnBegan = false; }
      if (!disposed && generation === attempt) {
        change({ localPreview: null, status: running ? "listening" : "off" });
        schedule();
      }
    }
  }

  function schedule() {
    if (timer !== undefined) dependencies.clearTimeout(timer);
    timer = undefined;
    if (disposed || !running || turn || !snapshot || blockedRevision === snapshot.room.revision) return;
    const plan = planFacilitatorTurn(snapshot, dependencies.now());
    if (!plan.run) return;
    timer = dependencies.setTimeout(() => { timer = undefined; void runTurn(); }, Math.max(0, plan.notBefore - dependencies.now()) + 25);
  }

  const unload = () => {
    if (claimed) dependencies.releaseOnUnload(roomId, facilitatorId);
    claimed = false;
    stopLocally();
  };
  const dispose = () => {
    disposed = true;
    void stop();
  };
  const prepareModel = async () => {
    const resolution = ++modelResolution;
    const attempt = generation;
    try {
      const selected = await dependencies.resolveModel();
      if (!disposed && generation === attempt && resolution === modelResolution && state.status === "off") {
        change({ modelLabel: dependencies.modelLabel(selected), error: "" });
      }
    } catch (cause) {
      if (!disposed && generation === attempt && resolution === modelResolution && state.status === "off") {
        change({ modelLabel: "", error: cause instanceof Error ? cause.message : "Choose or connect a model in Chat." });
      }
    }
  };
  return { roomId, facilitatorId, update, start, stop, unload, dispose, prepareModel };
}

export function useRoomFacilitator(roomId: string, session: RoomSession): RoomFacilitatorControls {
  const [state, setState] = useState<Omit<RoomFacilitatorControls, "start" | "stop">>({ status: "off", modelLabel: "", error: "", localPreview: null });
  // Stable through renders, fresh for each room lifetime so an old async
  // claim/release cannot interfere with a later visit to the same room.
  const facilitatorId = useMemo(() => randomOperationId("facilitator"), [roomId]);
  const runtimeRef = useRef<ReturnType<typeof createRoomFacilitator> | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    const runtime = createRoomFacilitator(roomId, facilitatorId, {
      onChange: setState,
      applySnapshot: (snapshot) => sessionRef.current.applySnapshot(snapshot),
      send: (message) => sessionRef.current.send(message),
    });
    runtimeRef.current = runtime;
    setState({ status: "off", modelLabel: "", error: "", localPreview: null });
    runtime.update(sessionRef.current.state.snapshot, sessionRef.current.state.presentAccountIds);
    const onUnload = () => runtime.unload();
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      runtime.dispose();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [facilitatorId, roomId]);
  useEffect(() => {
    runtimeRef.current?.update(session.state.removed ? null : session.state.snapshot, session.state.presentAccountIds);
  }, [session.state.snapshot, session.state.presentAccountIds, session.state.removed]);
  const canFacilitate = session.state.snapshot?.permissions.canFacilitate ?? false;
  useEffect(() => {
    if (!canFacilitate) return;
    const prepare = () => { void runtimeRef.current?.prepareModel(); };
    prepare();
    const unsubscribe = subscribeModelPrefs(prepare);
    window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, prepare);
    return () => {
      unsubscribe();
      window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, prepare);
    };
  }, [canFacilitate, roomId]);
  const start = useCallback((options?: { takeOver?: boolean }) => runtimeRef.current?.roomId === roomId ? runtimeRef.current.start(options) : Promise.resolve(), [roomId]);
  const stop = useCallback(() => runtimeRef.current?.roomId === roomId ? runtimeRef.current.stop() : Promise.resolve(), [roomId]);
  return { ...(runtimeRef.current?.roomId === roomId ? state : { status: "off" as const, modelLabel: "", error: "", localPreview: null }), start, stop };
}
