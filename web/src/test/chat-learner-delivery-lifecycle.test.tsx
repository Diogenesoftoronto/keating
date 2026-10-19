/**
 * Mounted lifecycle of learner-submission delivery: the real
 * useLearnerDelivery and useQuizConversationEvents hooks, driven by window
 * events through the react-mount host, with submissions retained in a real
 * conversation event store.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useMemo } from "react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createReactMountHarness } from "./helpers/react-mount";
import { MemoryStorage } from "./helpers/memory-storage";
import { browserConversationRuntime } from "../keating/integration/conversation-runtime";
import type { FlueConversation } from "../keating/flue/conversation";
import type { ChatPanelSetupCallbacks } from "../types/chat-panel";
import {
  createLearnerResponseRetainer,
  pauseLearnerDelivery,
  RETAIN_LEARNER_RESPONSE_EVENT,
} from "../components/chat/learner-delivery";
import { useLearnerDelivery } from "../components/chat/useLearnerDelivery";
import { useQuizConversationEvents } from "../components/chat/useQuizConversationEvents";

interface Delivery { session: string; text: string }

/** A conversation double: records each admitted learner turn with its session. */
function fakeConversation(sessionId: string, deliveries: Delivery[], streaming = false) {
  const agent = {
    sessionId,
    context: { isStreaming: streaming, messages: [] as AgentMessage[], model: { provider: "test", id: "m", input: ["text"] } },
    async sendPrepared(message: AgentMessage, prepare: (signal: AbortSignal) => Promise<void>) {
      agent.context.messages.push(message);
      await prepare(new AbortController().signal);
      const content = (message as { content: Array<{ text?: string }> }).content;
      deliveries.push({ session: sessionId, text: content.map((part) => part.text ?? "").join("") });
    },
  };
  return agent;
}
type FakeConversation = ReturnType<typeof fakeConversation>;

let storage: MemoryStorage;
let originalWindow: typeof globalThis.window;
const runtimeFor = (sessionId: string) => browserConversationRuntime(sessionId, storage);
const pendingIn = (sessionId: string) => runtimeFor(sessionId).pendingLearnerResponses().map((item) => item.receiptId);

/** One chat thread wired as AssistantThread wires it, with panel callbacks bound to the conversation's session. */
function Thread({ agent }: { agent: FakeConversation | null }) {
  const callbacks = useMemo<ChatPanelSetupCallbacks>(() => ({
    sessionId: agent?.sessionId,
    getPendingLearnerResponses: () => (agent ? runtimeFor(agent.sessionId).pendingLearnerResponses() : []),
    onLearnerResponseDelivered: (response) => {
      const runtime = runtimeFor(agent!.sessionId);
      runtime.resolveLearnerResponse(response.receiptId);
      runtime.resolveAction(response.uiActionId);
    },
  }), [agent]);
  const conversation = agent as unknown as FlueConversation | null;
  const { submitLearnerTurn } = useLearnerDelivery({
    agent: conversation,
    callbacks,
    isRunning: agent?.context.isStreaming ?? false,
    onLocalMessagesShown: () => {},
    onSendStarted: () => {},
  });
  useQuizConversationEvents({ agent: conversation, submitLearnerTurn });
  return null;
}

const submitQuiz = (resultId: string, topic: string) =>
  window.dispatchEvent(new CustomEvent("keating:quiz-submitted", { detail: { resultId, topic, score: 1, total: 1 } }));
const answerQuestion = (answer: string) =>
  window.dispatchEvent(new CustomEvent("keating:question-answered", {
    detail: { topic: "Sets", answers: [{ question: "What is a subset?", answer, grading: "pending" }] },
  }));
const requestRemediation = (level: string) =>
  window.dispatchEvent(new CustomEvent("keating:quiz-remediation-requested", { detail: { level, topic: "Sets" } }));

beforeEach(() => {
  storage = new MemoryStorage();
  originalWindow = globalThis.window;
  const target = new EventTarget() as unknown as Window & typeof globalThis;
  Object.assign(target, { localStorage: storage });
  globalThis.window = target;
  // The page's conversation store, as useConversationRuntime installs it.
  window.addEventListener(RETAIN_LEARNER_RESPONSE_EVENT, createLearnerResponseRetainer(runtimeFor));
});

afterEach(() => {
  globalThis.window = originalWindow;
});

describe("learner submission delivery (mounted)", () => {
  test("a submission made while lesson A streams is never delivered into B, and reaches A when A is active and idle", async () => {
    const deliveries: Delivery[] = [];
    const harness = createReactMountHarness();
    const lessonA = fakeConversation("A", deliveries, true);
    await harness.render(<Thread agent={lessonA} />);
    submitQuiz("run-1", "Fractions");
    await harness.render(<Thread agent={lessonA} />);
    expect(deliveries).toEqual([]);
    expect(pendingIn("A")).toEqual(["quiz-result:run-1"]);

    // Same unkeyed thread, now showing lesson B while A's turn is still queued.
    await harness.render(<Thread agent={fakeConversation("B", deliveries)} />);
    expect(deliveries).toEqual([]);
    expect(pendingIn("A")).toEqual(["quiz-result:run-1"]);

    // Back to A in a fresh conversation, idle: delivered there, once.
    await harness.render(<Thread agent={fakeConversation("A", deliveries)} />);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.session).toBe("A");
    expect(deliveries[0]!.text).toStartWith('I finished the quiz on "Fractions".');
    expect(pendingIn("A")).toEqual([]);
    await harness.unmount();
  });

  test("a submission survives leaving chat and is delivered once when its session is next idle", async () => {
    const deliveries: Delivery[] = [];
    const first = createReactMountHarness();
    await first.render(<Thread agent={fakeConversation("A", deliveries, true)} />);
    answerQuestion("Every element is in the other set");
    await first.unmount();
    expect(deliveries).toEqual([]);
    expect(pendingIn("A")).toHaveLength(1);

    const second = createReactMountHarness();
    await second.render(<Thread agent={fakeConversation("A", deliveries)} />);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.session).toBe("A");
    expect(deliveries[0]!.text).toContain("Every element is in the other set");
    expect(pendingIn("A")).toEqual([]);

    // Remounting again finds nothing left to deliver.
    await second.unmount();
    const third = createReactMountHarness();
    await third.render(<Thread agent={fakeConversation("A", deliveries)} />);
    expect(deliveries).toHaveLength(1);
    await third.unmount();
  });

  test("several submissions queued during a reply are delivered in submission order", async () => {
    const deliveries: Delivery[] = [];
    const harness = createReactMountHarness();
    const lesson = fakeConversation("A", deliveries, true);
    await harness.render(<Thread agent={lesson} />);
    submitQuiz("run-1", "Fractions");
    answerQuestion("first answer");
    requestRemediation("Recall");
    await harness.render(<Thread agent={lesson} />);
    expect(deliveries).toEqual([]);

    lesson.context.isStreaming = false; // The reply finished.
    await harness.render(<Thread agent={lesson} />);
    expect(deliveries.map((delivery) => delivery.session)).toEqual(["A", "A", "A"]);
    expect(deliveries[0]!.text).toStartWith("I finished the quiz");
    expect(deliveries[1]!.text).toContain("first answer");
    expect(deliveries[2]!.text).toStartWith('I need help with "Recall"');
    expect(pendingIn("A")).toEqual([]);
    await harness.unmount();
  });

  test("submitting the same quiz run again, before or after delivery, delivers it once", async () => {
    const deliveries: Delivery[] = [];
    const harness = createReactMountHarness();
    const lesson = fakeConversation("A", deliveries, true);
    await harness.render(<Thread agent={lesson} />);
    submitQuiz("run-1", "Fractions");
    submitQuiz("run-1", "Fractions");
    expect(pendingIn("A")).toEqual(["quiz-result:run-1"]);

    lesson.context.isStreaming = false;
    await harness.render(<Thread agent={lesson} />);
    submitQuiz("run-1", "Fractions");
    await harness.render(<Thread agent={lesson} />);
    expect(deliveries).toHaveLength(1);
    expect(pendingIn("A")).toEqual([]);
    await harness.unmount();
  });

  test("a save-before-switch hold on the session defers delivery until it is released", async () => {
    const deliveries: Delivery[] = [];
    const harness = createReactMountHarness();
    const lesson = fakeConversation("A", deliveries);
    await harness.render(<Thread agent={lesson} />);
    const release = pauseLearnerDelivery("A");
    answerQuestion("held answer");
    await harness.render(<Thread agent={lesson} />);
    expect(deliveries).toEqual([]);
    expect(pendingIn("A")).toHaveLength(1);

    release();
    await harness.render(<Thread agent={lesson} />);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.text).toContain("held answer");
    await harness.unmount();
  });
});
