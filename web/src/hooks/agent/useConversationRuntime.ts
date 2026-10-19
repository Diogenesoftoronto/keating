/**
 * The canonical conversation event store for the active session. Accepts
 * canonical events and OpenUI actions dispatched by the chat UI, retains
 * pending learner submissions, answers conversation-id lookups, and announces
 * UI actions restored from storage.
 */
import { useCallback, useEffect, useRef } from "react";
import {
  browserConversationRuntime,
  recordOpenUIAction,
  type ConversationRuntime,
} from "../../keating/integration";
import type { ConversationEvent } from "../../keating/protocol";
import type { KeatingOpenUIAction } from "../../keating/openui/types";
import { keatingStorage } from "../keating-storage";
import {
  createLearnerResponseRetainer,
  RETAIN_LEARNER_RESPONSE_EVENT,
} from "../../components/chat/learner-delivery";
import type { AgentHostRefs } from "./host-refs";

export type ConversationRuntimeLookup = (sessionId?: string) => ConversationRuntime | null;

export function useConversationRuntime(
  refs: Pick<AgentHostRefs, "sessionIdRef">,
): ConversationRuntimeLookup {
  const { sessionIdRef } = refs;
  const conversationRuntimeRef = useRef<ConversationRuntime | null>(null);

  const conversationRuntime = useCallback<ConversationRuntimeLookup>(
    (sessionId = sessionIdRef.current) => {
      if (typeof window === "undefined") return null;
      const current = conversationRuntimeRef.current;
      if (current?.sessionId === sessionId) return current;
      const runtime = browserConversationRuntime(
        sessionId,
        window.localStorage,
      );
      conversationRuntimeRef.current = runtime;
      const pendingActions = runtime.pendingActions();
      if (pendingActions.length > 0) {
        window.dispatchEvent(
          new CustomEvent("keating:pending-ui-actions-restored", {
            detail: { sessionId, actions: pendingActions },
          }),
        );
      }
      return runtime;
    },
    [],
  );

  useEffect(() => {
    const receiveCanonicalEvent = (event: Event) => {
      const canonical = (event as CustomEvent<ConversationEvent>).detail;
      if (!canonical || canonical.sessionId !== sessionIdRef.current) return;
      conversationRuntime(canonical.sessionId)?.accept(canonical);
    };
    window.addEventListener(
      "keating:conversation-event",
      receiveCanonicalEvent,
    );
    return () =>
      window.removeEventListener(
        "keating:conversation-event",
        receiveCanonicalEvent,
      );
  }, [conversationRuntime]);

  useEffect(() => {
    const provideConversationIds = (event: Event) => {
      const detail = (event as CustomEvent<{ ids?: { sessionId: string } }>)
        .detail;
      if (detail) detail.ids = { sessionId: sessionIdRef.current };
    };
    window.addEventListener("keating:conversation-ids", provideConversationIds);
    return () =>
      window.removeEventListener(
        "keating:conversation-ids",
        provideConversationIds,
      );
  }, []);

  useEffect(() => {
    const receiveOpenUIAction = (event: Event) => {
      const detail = (event as CustomEvent<KeatingOpenUIAction | {
        kind: "keating-openui-dispatch";
        action: KeatingOpenUIAction;
        persisted?: Promise<void>;
      }>).detail;
      const wrapped = detail?.kind === "keating-openui-dispatch";
      const action = wrapped ? detail.action : detail;
      if (!action) return;
      const persist = async () => {
        if (action.kind === "canonical") {
          await keatingStorage.materializeCanonicalOpenUiAction(
            action.action,
            action.sourceDocument,
            action.receipt.createdAt,
          );
        }
        recordOpenUIAction(conversationRuntime()!, action);
      };
      if (wrapped) detail.persisted = persist();
      else void persist();
    };
    window.addEventListener("keating:openui-action", receiveOpenUIAction);
    return () =>
      window.removeEventListener("keating:openui-action", receiveOpenUIAction);
  }, [conversationRuntime]);

  // Learner submissions are retained in their own session's store until the
  // conversation admits them, like canonical OpenUI receipts.
  useEffect(() => {
    const retainLearnerResponse = createLearnerResponseRetainer(conversationRuntime);
    window.addEventListener(RETAIN_LEARNER_RESPONSE_EVENT, retainLearnerResponse);
    return () =>
      window.removeEventListener(RETAIN_LEARNER_RESPONSE_EVENT, retainLearnerResponse);
  }, [conversationRuntime]);

  return conversationRuntime;
}
