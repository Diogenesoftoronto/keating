import { afterEach, expect, test } from "bun:test";
import { learningSourceHash, type LearningEvidenceAnchor } from "@keating/learner-contracts";
import { clearLearningPassage, getLearningNavigationFeedback, getLearningPassage, learningMessageId, learningMessageText, learningPassageExcerpt, learningPassageIsFocused, learningRowSourceIds, navigateLearningSource, openLearningSource, resolveLearningSource, revealLearningPassage, setLearningNavigationFeedback, showLearningPassage, subscribeLearningNavigationFeedback, waitForLearningSession, type LearningNavigationRequest } from "../keating/learning-intelligence/source-navigation";
import { configureJudgementDiagnostics } from "../keating/judgement/diagnostics";
import { runSessionSwitch, SessionSwitchRequests } from "../hooks/session-switch";

const text = "I used 🧠 to remember. Then I divided by 2.";
const message = { role: "user", timestamp: 42, content: [{ type: "text", text }] };
const anchor: LearningEvidenceAnchor = { sessionId: "source", messageId: learningMessageId(message, 0), quote: "🧠", start: 7, end: 9, sourceHash: learningSourceHash(text) };
afterEach(() => { clearLearningPassage(); setLearningNavigationFeedback(""); configureJudgementDiagnostics({ enabled: false, details: false }); });

test("original ids and exact text remain shared across extraction and navigation", () => {
  expect(learningMessageId({ ...message, id: "native-id" }, 3)).toBe("native-id");
  expect(learningMessageText({ role: "user", content: [{ type: "text", text: "first" }, { type: "image" }, { type: "text", text: "second" }] })).toBe("first\n\nsecond");
  expect(resolveLearningSource(anchor, { id: "source", messages: [message] })?.text).toBe(text);
});

test("changed source, missing message, duplicate id and split Unicode never open another passage", () => {
  expect(resolveLearningSource(anchor, { id: "source", messages: [{ ...message, content: text + " changed" }] })).toBeNull();
  expect(resolveLearningSource(anchor, { id: "source", messages: [] })).toBeNull();
  const duplicated = { ...message, id: "duplicated" };
  expect(resolveLearningSource({ ...anchor, messageId: "duplicated" }, { id: "source", messages: [duplicated, duplicated] })).toBeNull();
  expect(resolveLearningSource({ ...anchor, quote: text.slice(7, 8), end: 8 }, { id: "source", messages: [message] })).toBeNull();
});

test("resolving repeated anchors reads only the matching message in a long conversation", () => {
  let unrelatedReads = 0, sourceReads = 0;
  const source = { ...message, id: "selected", get content() { sourceReads++; return text; } };
  const messages = Array.from({ length: 100 }, (_, index) => ({ id: `other-${index}`, role: index % 2 ? "assistant" : "user",
    get content() { unrelatedReads++; return "unrelated ".repeat(200); } }));
  const session = { id: "source", messages: [...messages, { id: "selected", role: "toolResult", content: "not a learner source" }, source] };
  for (let index = 0; index < 12; index++) {
    expect(resolveLearningSource({ ...anchor, messageId: "selected" }, session)?.text).toBe(text);
  }
  expect(unrelatedReads).toBe(0); expect(sourceReads).toBe(12);
});

test("ambiguous identities are rejected before reading or hashing either candidate", () => {
  let reads = 0;
  const duplicate = { id: "duplicate", role: "user", get content() { reads++; return text; } };
  expect(resolveLearningSource({ ...anchor, messageId: "duplicate" }, { id: "source", messages: [duplicate, duplicate] })).toBeNull();
  expect(reads).toBe(0);
});

test("visible row mapping uses original source identity after filtering and refuses ambiguous repeats", () => {
  const originals = [{ role: "toolResult", content: "hidden" }, message];
  const row = { id: "user-0-42", role: "user", createdAt: new Date(42), content: [{ type: "text", text }] };
  expect(learningRowSourceIds([row], originals)).toEqual([["user-1-42"]]);
  const noTimestamp = { role: "user", content: "same" };
  expect(learningRowSourceIds([{ id: "a", role: "user", content: "same" }, { id: "b", role: "user", content: "same" }], [noTimestamp])).toEqual([[], []]);
  const repeatedTimestamp = { role: "user", timestamp: 42, content: "another answer" };
  expect(learningRowSourceIds([row, { ...row, id: "user-1-42", content: "another answer" }], [...originals, repeatedTimestamp]))
    .toEqual([["user-1-42"], ["user-2-42"]]);
});

test("cross-session opening verifies first, switches once, then checks the loaded source again", async () => {
  let active = "current", loads = 0, reveals = 0;
  const result = await openLearningSource(anchor, {
    read: async () => ({ id: "source", messages: [message] }), activeSessionId: () => active,
    load: async id => { loads++; active = id; }, current: () => true,
    reveal: async (_anchor, source) => { reveals++; expect(source.text).toBe(text); return true; },
  });
  expect(result).toBe("opened"); expect(loads).toBe(1); expect(reveals).toBe(1);
});

test("same-session source never reloads or cancels the current conversation", async () => {
  expect(await openLearningSource(anchor, { read: async () => ({ id: "source", messages: [message] }), activeSessionId: () => "source",
    load: async () => { throw new Error("must not load"); }, current: () => true, reveal: async () => true })).toBe("opened");
});

test("deleted and changed sources do not switch; superseded navigation does not reveal", async () => {
  let loads = 0, reveals = 0;
  const dependencies = { read: async () => null, activeSessionId: () => "current", load: async () => { loads++; }, current: () => true, reveal: async () => { reveals++; return true; } };
  expect(await openLearningSource(anchor, dependencies)).toBe("stale");
  expect(await openLearningSource(anchor, { ...dependencies, read: async () => ({ id: "source", messages: [message] }), current: () => false })).toBe("superseded");
  expect(loads).toBe(0); expect(reveals).toBe(0);
});

test("an absent Chat panel refuses navigation before storage reads or loading", async () => {
  let reads = 0, loads = 0;
  expect(await openLearningSource(anchor, { hasPanel: () => false, read: async () => { reads++; return null; }, activeSessionId: () => "other",
    load: async () => { loads++; }, current: () => true, reveal: async () => true })).toBe("unavailable");
  expect(reads).toBe(0); expect(loads).toBe(0);
});

test("cross-session navigation preserves streaming replies, including a reply starting during source lookup", async () => {
  let streaming = true, reads = 0, loads = 0, closed = 0;
  const dependencies = { isStreaming: () => streaming, read: async () => { reads++; streaming = true; return { id: "source", messages: [message] }; }, activeSessionId: () => "other",
    load: async () => { loads++; }, current: () => true, beforeReveal: () => { closed++; }, reveal: async () => true };
  expect(await openLearningSource(anchor, dependencies)).toBe("busy"); expect(reads).toBe(0);
  streaming = false;
  expect(await openLearningSource(anchor, dependencies)).toBe("busy"); expect(reads).toBe(1);
  expect(loads).toBe(0); expect(closed).toBe(0);
});

test("settings close only after source verification and before passage reveal", async () => {
  const order: string[] = [];
  const dependencies = { read: async () => { order.push("read"); return { id: "source", messages: [message] }; }, activeSessionId: () => "source", load: async () => {}, current: () => true,
    beforeReveal: () => { order.push("close settings"); }, reveal: async () => { order.push("reveal"); return true; } };
  expect(await openLearningSource(anchor, dependencies)).toBe("opened");
  expect(order).toEqual(["read", "read", "close settings", "reveal"]);
  order.length = 0;
  expect(await openLearningSource(anchor, { ...dependencies, read: async () => null })).toBe("stale");
  expect(order).toEqual([]);
});

test("source disclosure bounds neighbouring text and preserves exact Unicode passage offsets", () => {
  const original = "x".repeat(800) + "🧠" + "y".repeat(800);
  const excerpt = learningPassageExcerpt(original, 800, 802);
  expect(excerpt.quote).toBe("🧠");
  expect(excerpt.before).toBe("…" + "x".repeat(400));
  expect(excerpt.after).toBe("y".repeat(400) + "…");
});

test("a jump is successful only when the exact mark owns focus and is visible outside a modal", () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document"), previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let modal = false, modalHidden = false, active: unknown = null, visible = true;
  const rect = { width: 100, height: 20, top: 10, left: 10, right: 110, bottom: 30 };
  const mark = { parentElement: null, closest: () => null, getClientRects: () => visible ? [rect] : [], getBoundingClientRect: () => rect } as unknown as HTMLElement;
  const modalElement = { parentElement: null, closest: () => null, getClientRects: () => [rect] };
  try {
    Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelectorAll: () => modal ? [modalElement] : [], get activeElement() { return active; } } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: 400, innerHeight: 800, getComputedStyle: (element: unknown) => ({ display: "inline", visibility: element === modalElement && modalHidden ? "hidden" : "visible", opacity: "1" }) } });
    expect(learningPassageIsFocused(mark)).toBe(false);
    active = mark;
    expect(learningPassageIsFocused(mark)).toBe(true);
    modal = true;
    expect(learningPassageIsFocused(mark)).toBe(false);
    modalHidden = true;
    expect(learningPassageIsFocused(mark)).toBe(true);
    modal = false; visible = false;
    expect(learningPassageIsFocused(mark)).toBe(false);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument); else Reflect.deleteProperty(globalThis, "document");
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("failed reveals remove their own selected disclosure and preserve a newer navigation", async () => {
  configureJudgementDiagnostics({ enabled: true, details: true });
  const source = resolveLearningSource(anchor, { id: "source", messages: [message] })!;
  expect(await revealLearningPassage(anchor, source, () => false)).toBe(false);
  expect(getLearningPassage()).toBeNull();
  const newer = { ...anchor, messageId: "newer" };
  expect(await revealLearningPassage(anchor, source, () => { showLearningPassage(newer, { ...source, messageId: "newer" }); return false; })).toBe(false);
  expect(getLearningPassage()?.anchor.messageId).toBe("newer");
});

test("navigation timeout aborts the switch before late preparation can commit and keeps feedback outside Settings", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const switches = new SessionSwitchRequests();
  let finishPreparation!: () => void, committed = false, signal: AbortSignal | undefined, handled: Promise<void> | undefined;
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent(event: Event) {
      const detail = (event as CustomEvent<LearningNavigationRequest>).detail;
      signal = detail.signal;
      const request = switches.begin();
      const onAbort = () => { if (switches.isCurrent(request)) switches.begin(); };
      detail.signal.addEventListener("abort", onAbort, { once: true });
      handled = runSessionSwitch({ isCurrent: () => !detail.signal.aborted && switches.isCurrent(request), prepare: () => new Promise<void>(resolve => { finishPreparation = resolve; }),
        persist: async () => {}, commit: async () => { committed = true; } }).then(result => { detail.resolve(result ? "opened" : "superseded"); })
        .finally(() => detail.signal.removeEventListener("abort", onAbort));
      return true;
    } } });
    expect(await navigateLearningSource(anchor, { timeoutMs: 5 })).toBe("unavailable");
    expect(signal?.aborted).toBe(true);
    expect(getLearningNavigationFeedback()).toContain("could not be opened");
    finishPreparation(); await handled;
    expect(committed).toBe(false);
    expect(getLearningNavigationFeedback()).toContain("could not be opened");
  } finally { if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window"); }
});

test("each navigation attempt clears the stable status before repeating its result", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const messages: string[] = [];
  const unsubscribe = subscribeLearningNavigationFeedback(() => messages.push(getLearningNavigationFeedback()));
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent(event: Event) { (event as CustomEvent<LearningNavigationRequest>).detail.resolve("busy"); return true; } } });
    await navigateLearningSource(anchor); await navigateLearningSource(anchor);
    expect(messages[0]).toBe(""); expect(messages[2]).toBe("");
    expect(messages[1]).toBe(messages[3]);
  } finally { unsubscribe(); if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window"); }
});

test("a resolved transition launcher waits for the source conversation to actually attach", async () => {
  let active = "current", attached = false, revealed = false;
  const timer = setTimeout(() => { active = "source"; attached = true; }, 5);
  try {
    expect(await openLearningSource(anchor, {
      read: async () => ({ id: "source", messages: [message] }), activeSessionId: () => active, current: () => true,
      load: async id => { await Promise.resolve(); await waitForLearningSession(id, { activeSessionId: () => active, ready: () => attached, current: () => true, onTimeout: () => { throw new Error("must attach"); }, timeoutMs: 100 }); },
      reveal: async () => { revealed = true; expect(attached).toBe(true); return true; },
    })).toBe("opened");
    expect(revealed).toBe(true);
  } finally { clearTimeout(timer); }
});

test("attachment timeout invalidates its pending switch and prevents a late commit", async () => {
  const requests = new SessionSwitchRequests(), request = requests.begin();
  let finish!: () => void, committed = false;
  const transition = runSessionSwitch({ isCurrent: () => requests.isCurrent(request), prepare: () => new Promise<void>(resolve => { finish = resolve; }), persist: async () => {}, commit: async () => { committed = true; } });
  expect(await waitForLearningSession("source", { activeSessionId: () => "current", ready: () => false, current: () => requests.isCurrent(request), onTimeout: () => { if (requests.isCurrent(request)) requests.begin(); }, timeoutMs: 5 })).toBe(false);
  finish(); await transition;
  expect(committed).toBe(false);
});

test("superseded attachment waits stop without invalidating the newer switch", async () => {
  let cancelled = false;
  expect(await waitForLearningSession("source", { activeSessionId: () => "other", ready: () => false, current: () => false, onTimeout: () => { cancelled = true; }, timeoutMs: 5 })).toBe(false);
  expect(cancelled).toBe(false);
});
