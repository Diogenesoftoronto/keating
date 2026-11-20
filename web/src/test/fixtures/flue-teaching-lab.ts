import { createElement, createRef, Fragment } from "react";
import { createRoot } from "react-dom/client";
import runtimeUrl from "virtual:keating-flue-runtime";
import { AssistantChatPanel } from "../../components/AssistantChatPanel";
import { useAgentHostRefs } from "../../hooks/agent/host-refs";
import { sessionPanelCallbacks } from "../../hooks/agent/panel-callbacks";
import { useConversationRuntime } from "../../hooks/agent/useConversationRuntime";
import { useSessionPersistence } from "../../hooks/agent/useSessionPersistence";
import { sessions } from "../../hooks/keating-storage";
import { getAppStorage } from "../../keating/app-storage";
import { KeatingApiKeyPromptDialog } from "../../components/KeatingApiKeyPromptDialog";
import { FlueConversation } from "../../keating/flue/conversation";
import { parseLearnerResponse } from "../../keating/learner-response";
import type { ChatPanelHandle, ChatPanelSetupCallbacks } from "../../types/chat-panel";
import { model, response } from "./flue-chat";

export async function runTeachingLabFixture() {
  const sessionId = "practice-a-scale";
  const lab = { id: "play-two", title: "Play a major third", brief: "Play C4 followed by E4.",
    adapter: { kind: "midi" }, checkpoints: [
      { id: "third", title: "Two pitches", check: { kind: "notes", notes: [60, 64] } },
      { id: "tonic", title: "Return to C", check: { kind: "notes", notes: [60] } },
    ] };
  const authored = ["\x60\x60\x60openui lifecycle=workspace id=intervals", "root = LearningSurface([practice])",
    "practice = Lab(" + JSON.stringify(lab) + ")", "\x60\x60\x60"].join("\n");
  const turns: { passed: boolean; evidence: string }[] = [];
  const chat = new FlueConversation({
    sessionId, initialState: { model, tools: [], messages: [] }, getApiKey: () => "offline-fixture",
    streamFn: (_model, context) => {
      const last = context.messages.at(-1);
      if (last?.role !== "user") throw new Error("Expected a learner turn.");
      const text = typeof last.content === "string" ? last.content : last.content.find(part => part.type === "text")?.text ?? "";
      if (text === "Teach me to play a major third.") return response([{ type: "text", text: authored }]);
      if (text === "Explain the interval.") return response([{ type: "text", text: "The interval spans four semitones." }]);
      const envelope = parseLearnerResponse(text);
      if (envelope?.kind !== "openui-action" || envelope.payload.kind !== "canonical" || envelope.payload.action.type !== "observe-lab") {
        throw new Error("Model did not receive the serialized canonical lab observation.");
      }
      const { passed, evidence } = envelope.payload.action;
      turns.push({ passed, evidence });
      return response([{ type: "text", text: passed ? "Those notes make a major third." : "Keep C4 and try a different second note." }]);
    },
  }, runtimeUrl);

  const host = document.body.appendChild(document.createElement("main"));
  const panel = createRef<ChatPanelHandle>();
  let callbacks: ChatPanelSetupCallbacks | undefined;
  let journal: ReturnType<typeof useConversationRuntime> | undefined;
  function Fixture() {
    const refs = useAgentHostRefs(undefined, false);
    refs.agentRef.current = chat;
    refs.sessionIdRef.current = sessionId;
    journal = useConversationRuntime(refs);
    const persistence = useSessionPersistence(refs);
    const save = () => persistence.saveSessionSnapshot(chat, sessionId, refs.sessionCreatedAtRef.current);
    const config = sessionPanelCallbacks({ refs, agent: chat, conversationRuntime: journal, sessionId, posthog: { capture() {} },
      applyThinkingLevel() {}, openModelSelector() {}, openImageModelSelector() {}, async forkSession() {},
      async ensureSessionStartContext() {}, persistSnapshot: async () => { await save(); }, saveLocalMessages: async () => { await save(); },
    });
    callbacks = config;
    return createElement(Fragment, {}, createElement(AssistantChatPanel, { ref: panel }), createElement(KeatingApiKeyPromptDialog));
  }
  const root = createRoot(host);
  root.render(createElement(Fixture));
  try {
    for (let i = 0; !panel.current && i < 150; i++) await new Promise(resolve => setTimeout(resolve, 20));
    if (!panel.current || !callbacks) throw new Error("Chat panel did not mount.");
    await getAppStorage().providerKeys.set(model.provider, "local-fixture-only");
    Object.assign(window, {
      withdrawLabKey: () => getAppStorage().providerKeys.delete(model.provider),
      labMissingCredentialCount: () => chat.context.messages.filter(message =>
        message.role === "assistant" && message.errorMessage?.includes("no credentials are available")).length,
    });
    await panel.current.setConversation(chat, callbacks);
    await chat.send("Teach me to play a major third.");
    if (chat.context.errorMessage) throw new Error(chat.context.errorMessage);
    await new Promise<void>(resolve => Object.assign(window, { finishTeachingLabFixture: resolve }));
    if (chat.context.errorMessage) throw new Error(chat.context.errorMessage);
    await callbacks.onLocalMessagesChanged?.();
    const runtime = journal?.(sessionId);
    const saved = await sessions.loadSession(sessionId);
    return { sessionId, turns, actions: runtime?.replay().uiActions.map(action => action.type),
      pending: runtime?.pendingLearnerResponses().length, saved: JSON.stringify(saved?.messages) };
  } finally {
    await getAppStorage().providerKeys.delete(model.provider);
    root.unmount();
    await chat.dispose();
  }
}
