import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionData, SessionMetadata } from "../types/session";
import {
  buildSessionSnapshotRecord,
  resolveSnapshotTitle,
  shouldRequestAutoTitle,
} from "../hooks/agent/session-snapshot";
import { liveSessionAncestry } from "../hooks/agent/useSessionPersistence";
import {
  bootstrapMayProceed,
  latestRestorableSessionId,
  locationWithoutSessionParam,
  requestedSessionId,
} from "../hooks/agent/session-restore";
import { cleanSuggestedTitle, sessionTitleContext, SESSION_TITLE_SYSTEM_PROMPT } from "../hooks/agent/session-title";
import { alternativeSessionRecord, usableAlternativeText } from "../hooks/agent/alternative-response";
import { retryTurnIndex } from "../hooks/agent/panel-callbacks";
import { initialForkInfo, recordResponsePreference, sessionHasSettledReply } from "../hooks/agent/session-records";
import { createSnapshotScheduler, STREAMING_SNAPSHOT_DELAY_MS } from "../hooks/agent/agent-observers";
import { parseSettingsDeepLink, requestedSettingsTab } from "../hooks/agent/settings-deep-link";
import { answeredQuestions, feedbackSignal, messageFeedbackRecord } from "../hooks/agent/useLearnerSignalEvents";
import { visiblePersistentStorageStatus } from "../hooks/agent/usePersistentStorage";
import { sessionTitle } from "../hooks/session-metadata";

const user = (text: string, timestamp = 1) => ({ role: "user", content: [{ type: "text", text }], timestamp }) as AgentMessage;
const assistant = (text: string, timestamp = 2, stopReason = "stop") =>
  ({ role: "assistant", content: [{ type: "text", text }], timestamp, stopReason }) as unknown as AgentMessage;
const model = { provider: "openai", id: "gpt", name: "GPT", api: "openai-completions" } as any;

function stored(overrides: Partial<SessionData> = {}): SessionData {
  const messages = [user("Teach me fractions"), assistant("Sure")];
  return {
    id: "s1", title: sessionTitle(messages), model, thinkingLevel: "medium", messages,
    createdAt: "c", lastModified: "m", ...overrides,
  } as SessionData;
}

describe("session snapshot record", () => {
  test("a fresh session takes its title from the conversation", () => {
    const messages = [user("Why is the sky blue?"), assistant("Scattering")];
    expect(resolveSnapshotTitle(null, messages)).toEqual({
      title: sessionTitle(messages), hasManualTitle: false, aiGeneratedTitle: false,
    });
  });

  test("a learner rename survives later saves; an untouched derived title follows the conversation", () => {
    const messages = [user("Something new entirely"), assistant("ok")];
    expect(resolveSnapshotTitle(stored({ title: "My own name" }), messages)).toMatchObject({ title: "My own name", hasManualTitle: true });
    expect(resolveSnapshotTitle(stored(), messages)).toMatchObject({ title: sessionTitle(messages), hasManualTitle: false });
  });

  test("an accepted AI title is kept and not treated as a manual rename", () => {
    expect(resolveSnapshotTitle(stored({ title: "Fractions basics", aiGeneratedTitle: true }), [user("x")]))
      .toEqual({ title: "Fractions basics", hasManualTitle: false, aiGeneratedTitle: true });
  });

  test("live ancestry wins; otherwise stored ancestry and comparison fields are preserved", () => {
    const existing = stored({
      parentSessionId: "stored-parent", forkedAt: "f0", forkedFromMessageTimestamp: 9,
      generatedAlternative: true, hiddenAlternative: true, alternativeForMessageTimestamp: 7, responsePreference: "original",
    });
    const base = { sessionId: "s1", createdAt: "c", now: "n", model, thinkingLevel: "high" as const, messages: existing.messages, existing };
    const live = buildSessionSnapshotRecord({ ...base, ancestry: { parentSessionId: null, forkedAt: undefined } });
    expect(live.data.parentSessionId).toBeNull();
    expect(live.metadata.forkedAt).toBeUndefined();
    const other = buildSessionSnapshotRecord({ ...base, ancestry: undefined });
    expect(other.metadata).toMatchObject({
      parentSessionId: "stored-parent", forkedAt: "f0", forkedFromMessageTimestamp: 9, generatedAlternative: true,
      hiddenAlternative: true, alternativeForMessageTimestamp: 7, responsePreference: "original",
      lastModified: "n", createdAt: "c", messageCount: 2, thinkingLevel: "high", modelProvider: "openai", modelId: "gpt",
    });
    expect(other.data).toMatchObject({ id: "s1", model, thinkingLevel: "high", lastModified: "n", parentSessionId: "stored-parent" });
  });

  test("ancestry is only supplied for the live session", () => {
    const refs = { sessionIdRef: { current: "live" }, sessionParentIdRef: { current: "p" }, sessionForkedAtRef: { current: "t" } };
    expect(liveSessionAncestry(refs, "live")).toEqual({ parentSessionId: "p", forkedAt: "t" });
    expect(liveSessionAncestry(refs, "other")).toBeUndefined();
  });

  test("auto titles wait for two exchanges, run once, and never replace a chosen title", () => {
    const two = [user("a", 1), assistant("b", 2), user("c", 3), assistant("d", 4)];
    const base = { hasManualTitle: false, aiGeneratedTitle: false, messages: two, alreadyRequested: false };
    expect(shouldRequestAutoTitle(base)).toBe(true);
    expect(shouldRequestAutoTitle({ ...base, messages: two.slice(0, 2) })).toBe(false);
    expect(shouldRequestAutoTitle({ ...base, alreadyRequested: true })).toBe(false);
    expect(shouldRequestAutoTitle({ ...base, hasManualTitle: true })).toBe(false);
    expect(shouldRequestAutoTitle({ ...base, aiGeneratedTitle: true })).toBe(false);
  });
});

describe("session restore", () => {
  const meta = (id: string, lastModified: string, hiddenAlternative = false) => ({ id, lastModified, hiddenAlternative }) as SessionMetadata;

  test("restores the most recent visible session", () => {
    expect(latestRestorableSessionId([meta("a", "2024-01-01"), meta("b", "2024-03-01", true), meta("c", "2024-02-01")])).toBe("c");
    expect(latestRestorableSessionId([])).toBeNull();
  });

  test("an explicit ?session= wins over a pending signed-in turn, which needs to be ready", () => {
    let reads = 0;
    const pending = () => { reads += 1; return { ready: true, sessionId: "pending" }; };
    expect(requestedSessionId("?session=%20abc%20", pending)).toBe("abc");
    expect(reads).toBe(0);
    expect(requestedSessionId("?session=", pending)).toBe("pending");
    expect(requestedSessionId("", () => ({ ready: false, sessionId: "pending" }))).toBeNull();
    expect(requestedSessionId("", () => null)).toBeNull();
  });

  test("strips only the session parameter", () => {
    expect(locationWithoutSessionParam({ pathname: "/chat", search: "?session=a&ask=b", hash: "#x" })).toBe("/chat?ask=b#x");
    expect(locationWithoutSessionParam({ pathname: "/", search: "?session=a", hash: "" })).toBe("/");
  });

  test("a delayed bootstrap acts only for the latest attachment with no navigation and no conversation", () => {
    const ok = { generationCurrent: true, requestCurrent: true, panelUnchanged: true, hasAgent: false };
    expect(bootstrapMayProceed(ok)).toBe(true);
    for (const key of ["generationCurrent", "requestCurrent", "panelUnchanged"] as const) {
      expect(bootstrapMayProceed({ ...ok, [key]: false })).toBe(false);
    }
    expect(bootstrapMayProceed({ ...ok, hasAgent: true })).toBe(false);
  });

  test("a forked session shows its banner immediately with a placeholder parent title", () => {
    expect(initialForkInfo({ parentSessionId: "p", forkedAt: "t" })).toEqual({ parentId: "p", parentTitle: "original session", forkedAt: "t" });
    expect(initialForkInfo({ parentSessionId: "p" })).toBeNull();
    expect(initialForkInfo({ forkedAt: "t" })).toBeNull();
  });
});

describe("response comparison", () => {
  const alternative = stored({ id: "alt", generatedAlternative: true, hiddenAlternative: true });

  test("choosing the alternative makes it visible; other choices keep it hidden", () => {
    const chosen = recordResponsePreference({ alternative, existingMetadata: null, preference: "alternative", originalMessageTimestamp: 5, now: "n" });
    expect(chosen.data).toMatchObject({ hiddenAlternative: false, responsePreference: "alternative", lastModified: "n" });
    expect(chosen.metadata).toMatchObject({
      id: "alt", messageCount: 2, generatedAlternative: true, hiddenAlternative: false,
      alternativeForMessageTimestamp: 5, responsePreference: "alternative", lastModified: "n",
    });
    const kept = recordResponsePreference({ alternative, existingMetadata: { id: "alt", title: "stored" } as SessionMetadata, preference: "original", originalMessageTimestamp: 5, now: "n" });
    expect(kept.metadata).toMatchObject({ title: "stored", hiddenAlternative: true, responsePreference: "original" });
  });

  test("a generated alternative is a hidden child session of the same branch", () => {
    const branch = [user("q", 1)];
    const reply = assistant("other answer", 3);
    const { data, metadata } = alternativeSessionRecord({
      id: "alt", now: "n", sourceSessionId: "src", branchMessages: branch, alternative: reply,
      assistantTimestamp: 2, model, thinkingLevel: "low",
    });
    expect(data.messages).toEqual([...branch, reply]);
    expect(data.title).toBe(`${sessionTitle(branch) || "Alternative response"} (alternative)`);
    expect(metadata).toMatchObject({
      parentSessionId: "src", forkedAt: "n", forkedFromMessageTimestamp: 2, generatedAlternative: true,
      hiddenAlternative: true, alternativeForMessageTimestamp: 2, aiGeneratedTitle: false, messageCount: 2,
    });
  });

  test("failed or empty alternatives are discarded", () => {
    expect(usableAlternativeText(assistant("  kept  "))).toBe("kept");
    expect(usableAlternativeText(assistant("text", 2, "error"))).toBe("");
    expect(usableAlternativeText(assistant("text", 2, "aborted"))).toBe("");
    expect(usableAlternativeText({ role: "assistant", content: "plain" } as unknown as AgentMessage)).toBe("");
  });
});

describe("turn helpers", () => {
  test("cleans suggested titles", () => {
    expect(cleanSuggestedTitle('"Title:   Fractions   and  decimals"')).toBe("Fractions and decimals");
    // Current behaviour: quotes are only stripped at the very ends of the raw reply.
    expect(cleanSuggestedTitle(' "Fractions" ')).toBe('"Fractions"');
    expect(cleanSuggestedTitle("x".repeat(100))).toHaveLength(80);
  });

  test("title requests carry a bounded preview and the current title", () => {
    const context = sessionTitleContext([user("y".repeat(3000))], "Old", () => 5);
    expect(context.systemPrompt).toBe(SESSION_TITLE_SYSTEM_PROMPT);
    const content = (context.messages[0] as { content: string }).content;
    expect(content).toStartWith("Conversation preview:\n");
    expect(content).toEndWith("\n\nCurrent title: Old");
    expect(content.length).toBeLessThan(2400 + 60);
  });

  test("retry regenerates the last learner turn", () => {
    expect(retryTurnIndex([{ role: "user" }, { role: "assistant" }, { role: "user" }])).toBe(1);
    expect(retryTurnIndex([])).toBe(0);
  });

  test("session-start hooks are skipped only once a settled reply exists", () => {
    expect(sessionHasSettledReply([user("a"), assistant("b")])).toBe(true);
    expect(sessionHasSettledReply([user("a"), assistant("b", 2, "error")])).toBe(false);
    expect(sessionHasSettledReply([user("a"), assistant("b", 2, "aborted")])).toBe(false);
    expect(sessionHasSettledReply([])).toBe(false);
  });

  test("streaming updates are debounced; a message end saves at once and saves never overlap", async () => {
    const timers: Array<{ id: number; fn: () => void; ms: number }> = [];
    let nextId = 1;
    const fakeTimers = {
      setTimeout: ((fn: () => void, ms: number) => { timers.push({ id: nextId, fn, ms }); return nextId++; }) as unknown as Window["setTimeout"],
      clearTimeout: ((id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); }) as Window["clearTimeout"],
    };
    const events: string[] = [];
    let active = 0;
    const scheduler = createSnapshotScheduler(async () => {
      active += 1;
      expect(active).toBe(1);
      events.push("save");
      await Promise.resolve();
      active -= 1;
    }, fakeTimers);
    scheduler.scheduleSnapshot();
    scheduler.scheduleSnapshot();
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(STREAMING_SNAPSHOT_DELAY_MS);
    scheduler.persistNow();
    expect(timers).toHaveLength(0);
    await scheduler.persistSnapshot();
    expect(events).toEqual(["save", "save"]);
  });
});

describe("page events", () => {
  test("settings deep links resolve tabs and model sections", () => {
    expect(parseSettingsDeepLink("learning")).toEqual({ tabId: "learning", sectionId: null });
    expect(parseSettingsDeepLink("nonsense")).toEqual({ tabId: "models", sectionId: null });
    expect(parseSettingsDeepLink("learning-unknown")).toEqual({ tabId: "learning", sectionId: null });
    expect(requestedSettingsTab("diagnostics")).toBe("diagnostics");
    expect(requestedSettingsTab(42)).toBe("models");
  });

  test("feedback records keep the exact reply as referent", () => {
    expect(feedbackSignal({ type: "up" })).toBe("thumbs-up");
    expect(feedbackSignal({ type: "down" })).toBe("thumbs-down");
    expect(feedbackSignal({ type: "meh" })).toBeNull();
    expect(feedbackSignal(undefined)).toBeNull();
    expect(messageFeedbackRecord({ type: "down", comment: " too long ", messageId: "m", messageText: " Answer ", messageCreatedAt: 3 }, "s"))
      .toEqual({
        source: "explicit", evidence: " too long ", messageId: "m", sessionId: "s", topicSource: "session-title",
        referent: { sessionId: "s", messageId: "m", content: "Answer", createdAt: 3 },
      });
    expect(messageFeedbackRecord({ type: "up", comment: "  " }, "s")).toMatchObject({ evidence: undefined, messageId: undefined, referent: undefined });
  });

  test("question checks keep only well-formed answers", () => {
    expect(answeredQuestions({ answers: [{ question: "q", answer: "a" }, { question: "q" }, { answer: "a" }] }))
      .toEqual([{ question: "q", answer: "a" }]);
    expect(answeredQuestions(undefined)).toEqual([]);
  });

  test("a declined persistence status is hidden until the browser was checked", () => {
    expect(visiblePersistentStorageStatus("declined", false)).toBe("unknown");
    expect(visiblePersistentStorageStatus("declined", true)).toBe("declined");
    expect(visiblePersistentStorageStatus("granted", false)).toBe("granted");
  });
});
