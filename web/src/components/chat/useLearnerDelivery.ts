/**
 * Send path for one chat thread. Composer sends go straight to the agent and
 * are refused while it streams. Learner submissions (quiz results, question
 * answers, remediation/reframe requests, OpenUI responses) are stamped with
 * the thread's session, retained in that session's store, and delivered
 * through a `LearnerDeliveryQueue` only while that session is active, idle and
 * not being switched away from. See learner-delivery.ts for the states.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { usePostHog } from "@posthog/react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AppendMessage } from "@assistant-ui/react";
import type { FlueConversation } from "../../keating/flue/conversation";
import type { PendingLearnerResponse } from "../../keating/event-store";
import type { KeatingOpenUIAction } from "../../keating/openui/types";
import {
  createOpenUIActionLearnerResponse,
  serializeLearnerResponse,
} from "../../keating/learner-response";
import type { ChatPanelSetupCallbacks } from "../../types/chat-panel";
import {
  makeAttachmentErrorMessage,
  makePromptErrorMessage,
} from "../assistant-chat-messages";
import {
  canonicalActionReceiptId,
  LearnerDeliveryQueue,
  learnerDeliveryPaused,
  learnerSubmission,
  retainLearnerResponse,
  subscribeLearnerDeliveryPauses,
  transcriptUserTexts,
  type SubmissionIdentity,
} from "./learner-delivery";
import {
  makeUserMessageFromAppend,
  makeUserTextMessage,
  prepareAttachmentsForModel,
  userTextMessage,
} from "./user-message";

/** Submits a learner turn for this thread's session; queued until it can be delivered. */
export type SubmitLearnerTurn = (
  serialized: string | ((identity: SubmissionIdentity) => string),
  submissionId?: string,
) => void;

export interface LearnerDelivery {
  /** Composer send; resolves false when refused (no agent, empty, streaming). */
  onNew: (message: AppendMessage, onAdmitted?: () => void) => Promise<boolean>;
  sendText: (text: string) => Promise<void>;
  submitLearnerTurn: SubmitLearnerTurn;
  handleOpenUIAction: (action: KeatingOpenUIAction) => Promise<boolean>;
}

export function useLearnerDelivery({
  agent,
  callbacks,
  isRunning,
  onLocalMessagesShown,
  onSendStarted,
}: {
  agent: FlueConversation | null;
  callbacks: ChatPanelSetupCallbacks;
  isRunning: boolean;
  /** A local-only message (an error) was appended to the transcript. */
  onLocalMessagesShown: () => void;
  onSendStarted: () => void;
}): LearnerDelivery {
  const posthog = usePostHog();

  const sendUserMessage = useCallback(async (userMessage: AgentMessage, onAdmitted?: () => void) => {
    if (!agent || agent.context.isStreaming) return false;
    onSendStarted();
    try {
      await agent.sendPrepared(userMessage, async (signal) => {
        // The turn is in the saved transcript now. Durable deliveries settle
        // here, not when the reply finishes: a reload mid-reply must not
        // submit the same learner response a second time.
        await callbacks.onLocalMessagesChanged?.();
        onAdmitted?.();
        const provider = agent.context.model.provider;
        if (callbacks.onApiKeyRequired && !(await callbacks.onApiKeyRequired(provider))) {
          throw new Error(`Authentication error: no credentials are available for ${provider}. Open Settings → Providers & Models, connect the provider, then retry this message.`);
        }
        signal.throwIfAborted();
        await callbacks.onBeforeSend?.();
      });
    } catch (error) {
      console.error("Keating send failed:", error);
      posthog.capture("message_send_failed", { error_type: "prompt_error" });
      agent.context.messages.push(makePromptErrorMessage(agent, error));
      onLocalMessagesShown();
    }
    await callbacks.onLocalMessagesChanged?.();
    return true;
  }, [agent, callbacks, posthog]);

  const sendText = useCallback(async (text: string) => {
    if (text.trim()) await sendUserMessage(makeUserTextMessage(text));
  }, [sendUserMessage]);

  const onNew = useCallback(
    async (message: AppendMessage, onAdmitted?: () => void) => {
      if (!agent) return false;
      const userMessage = makeUserMessageFromAppend(message);
      if (!userMessage) return false;
      if (agent.context.isStreaming) return false;

      const attachmentError = prepareAttachmentsForModel(userMessage, agent.context.model);
      if (attachmentError) {
        agent.context.messages.push(userMessage, makeAttachmentErrorMessage(agent, attachmentError));
        onLocalMessagesShown();
        await callbacks.onLocalMessagesChanged?.();
        return true;
      }

      return sendUserMessage(userMessage, onAdmitted);
    },
    [agent, callbacks, sendUserMessage],
  );

  const sessionId = agent?.sessionId ?? callbacks.sessionId;
  // Re-render (and so re-drain) when a save-before-switch hold is released.
  const paused = useSyncExternalStore(
    subscribeLearnerDeliveryPauses,
    () => learnerDeliveryPaused(sessionId),
    () => false,
  );
  const queueRef = useRef<LearnerDeliveryQueue | null>(null);
  queueRef.current ??= new LearnerDeliveryQueue();
  const queue = queueRef.current;
  // Deliveries run outside render; they read the latest committed thread.
  const latest = useRef({ agent, callbacks, onNew, sessionId });
  latest.current = { agent, callbacks, onNew, sessionId };

  /** Delivers queued turns of the active session, one at a time, while it is idle. */
  const drain = useCallback(() => {
    const { agent, callbacks, onNew, sessionId } = latest.current;
    // The hold is read live: a switch may begin between renders.
    if (!agent || !sessionId || learnerDeliveryPaused(sessionId) || agent.context.isStreaming) return;
    const next = queue.next(sessionId);
    if (!next) return;
    void queue.deliver(
      next,
      (serialized, onAdmitted) => onNew(userTextMessage(serialized), onAdmitted),
      () => callbacks.onLearnerResponseDelivered?.(next),
    ).then((outcome) => { if (outcome === "delivered") drain(); });
  }, []);

  const queueLearnerResponse = useCallback((pending: PendingLearnerResponse) => {
    if (queue.admit(pending) === "queued") drain();
  }, [drain]);

  const submitLearnerTurn = useCallback<SubmitLearnerTurn>((serialized, submissionId) => {
    const sessionId = latest.current.sessionId;
    if (!sessionId) return;
    if (submissionId && queue.knows(submissionId)) return;
    const response = learnerSubmission({ sessionId, serialized, submissionId });
    retainLearnerResponse(response);
    queueLearnerResponse(response);
  }, [queueLearnerResponse]);

  const handleOpenUIAction = useCallback(
    async (action: KeatingOpenUIAction) => {
      const detail: {
        kind: "keating-openui-dispatch";
        action: KeatingOpenUIAction;
        persisted?: Promise<void>;
      } = { kind: "keating-openui-dispatch", action };
      window.dispatchEvent(
        new CustomEvent("keating:openui-action", { detail }),
      );
      await detail.persisted;
      if (action.kind === "canonical") {
        const receiptId = canonicalActionReceiptId(action.action);
        const pending = callbacks.getPendingLearnerResponses?.()
          .find((candidate) => candidate.receiptId === receiptId);
        if (!pending) return false;
        queueLearnerResponse(pending);
        return true;
      }
      submitLearnerTurn((identity) => serializeLearnerResponse(
        createOpenUIActionLearnerResponse(action, { id: identity.sessionMessageId, submittedAt: identity.submittedAt }),
      ));
      return true;
    },
    [callbacks.getPendingLearnerResponses, queueLearnerResponse, submitLearnerTurn],
  );

  // Durable responses retained for this session (earlier mounts, reloads, or
  // while another session was active): settle the ones already admitted,
  // deliver the rest.
  useEffect(() => {
    if (!agent) return;
    const sent = transcriptUserTexts(agent.context.messages);
    for (const pending of callbacks.getPendingLearnerResponses?.() ?? []) {
      if (queue.knows(pending.receiptId)) continue;
      if (sent.has(pending.serialized)) callbacks.onLearnerResponseDelivered?.(pending);
      else queueLearnerResponse(pending);
    }
  }, [agent, callbacks.getPendingLearnerResponses, callbacks.onLearnerResponseDelivered, queueLearnerResponse]);

  useEffect(() => {
    drain();
  }, [isRunning, agent, sessionId, paused, drain]);

  return { onNew, sendText, submitLearnerTurn, handleOpenUIAction };
}
