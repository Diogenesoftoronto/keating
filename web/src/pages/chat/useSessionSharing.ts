/**
 * Share-session state for the chat page: consent gate, share-link creation and
 * the result that stays in the sheet until the learner dismisses it.
 */
import { useEffect, useRef, useState } from "react";
import { usePostHog } from "@posthog/react";
import type { SharedSessionUrlResult } from "../../keating/shared-sessions";
import {
  loadKeatingUiSettings,
  saveKeatingUiSettings,
} from "../../keating/ui-settings";
import {
  acknowledgeShareConsent,
  shareFailureMessage,
  shareNeedsConsent,
  shareReadyMessage,
  type ShareState,
} from "./session-sharing";

export interface SessionSharing {
  shareState: ShareState;
  shareUrl: string | null;
  shareMessage: string | null;
  /** Open a new sheet for the current session. */
  handleShare: () => Promise<void>;
  /** Create a link after the sheet confirms the current mode. */
  confirmShare: () => Promise<void>;
  dismissShare: () => void;
}

export function useSessionSharing({
  activeSessionId,
  shareSession,
}: {
  activeSessionId: string;
  shareSession: () => Promise<SharedSessionUrlResult>;
}): SessionSharing {
  const posthog = usePostHog();
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  const request = useRef(0);
  const busy = useRef(false);
  const mode = useRef<ReturnType<typeof loadKeatingUiSettings>["shareLinkMode"] | null>(null);

  useEffect(() => {
    dismissShare();
    return () => { request.current++; };
  }, [activeSessionId]);

  const handleShare = async () => {
    mode.current = loadKeatingUiSettings().shareLinkMode;
    setShareUrl(null);
    setShareMessage("Share session");
    setShareState("confirm");
  };

  const confirmShare = async () => {
    if (busy.current || shareState !== "confirm") return;
    const settings = loadKeatingUiSettings();
    if (settings.shareLinkMode !== mode.current) {
      setShareMessage("The share mode changed. Reopen Share session to continue.");
      setShareState("error");
      return;
    }
    busy.current = true;
    const id = ++request.current;
    setShareState("sharing");
    try {
      if (shareNeedsConsent(settings)) {
        const acknowledged = acknowledgeShareConsent(settings);
        if (acknowledged) saveKeatingUiSettings(acknowledged);
      }
      const result = await shareSession();
      if (request.current !== id) return;
      setShareUrl(result.url);
      setShareMessage(shareReadyMessage(result));
      setShareState("ready");
      posthog.capture("session_shared", {
        share_mode: result.mode,
        fallback: result.fallback,
        session_id: activeSessionId,
      });
    } catch (error) {
      if (request.current !== id) return;
      console.warn("Failed to share session:", error);
      setShareMessage(shareFailureMessage(error));
      setShareState("error");
    } finally {
      if (request.current === id) busy.current = false;
    }
  };

  function dismissShare() {
    request.current++;
    busy.current = false;
    setShareState("idle");
    setShareUrl(null);
    setShareMessage(null);
  }

  return { shareState, shareUrl, shareMessage, handleShare, confirmShare, dismissShare };
}
