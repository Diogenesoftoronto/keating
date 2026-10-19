/**
 * Activation analytics for the chat composer: records that it was viewed and
 * flags a session where no message is sent within 45 seconds of a visible page.
 */
import { useEffect } from "react";
import { usePostHog } from "@posthog/react";

export function useChatActivationTracking(activeSessionId: string): void {
  const posthog = usePostHog();
  useEffect(() => {
    const sessionId = activeSessionId;
    let activated = false;
    posthog.capture("chat_composer_viewed", {
      session_id: sessionId,
      activation_wait_ms: 45_000,
    });

    const handleMessageSent = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId === sessionId)
        activated = true;
    };
    window.addEventListener("keating:message-sent", handleMessageSent);
    const timer = window.setTimeout(() => {
      if (activated || document.visibilityState !== "visible") return;
      posthog.capture("chat_activation_stalled", {
        session_id: sessionId,
        wait_ms: 45_000,
        survey_trigger: "activation_blocker",
      });
    }, 45_000);

    return () => {
      window.removeEventListener("keating:message-sent", handleMessageSent);
      window.clearTimeout(timer);
    };
  }, [activeSessionId, posthog]);
}
