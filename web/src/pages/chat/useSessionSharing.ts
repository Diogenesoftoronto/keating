/**
 * Share-session state for the chat page: consent gate, share-link creation and
 * the transient status shown in the header menu and the share banner.
 */
import { useState } from "react";
import { usePostHog } from "@posthog/react";
import type { SharedSessionUrlResult } from "../../keating/shared-sessions";
import {
  loadKeatingUiSettings,
  saveKeatingUiSettings,
} from "../../keating/ui-settings";
import {
  acknowledgeShareConsent,
  PUBLIC_SHARE_CONSENT_MESSAGE,
  shareFailureMessage,
  shareNeedsConsent,
  shareReadyMessage,
  type ShareState,
} from "./session-sharing";

export interface SessionSharing {
  shareState: ShareState;
  shareUrl: string | null;
  shareMessage: string | null;
  /** First click: asks for consent when needed, otherwise shares. */
  handleShare: () => Promise<void>;
  /** Second click after the warning: remembers consent, then shares. */
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

  const performShare = async () => {
    setShareState("sharing");
    setShareMessage(null);
    setShareUrl(null);
    try {
      const result = await shareSession();
      setShareUrl(result.url);
      setShareMessage(shareReadyMessage(result));
      setShareState("copied");
      posthog.capture("session_shared", {
        share_mode: result.mode,
        fallback: result.fallback,
        session_id: activeSessionId,
      });
      window.setTimeout(() => setShareState("idle"), 1600);
    } catch (error) {
      console.warn("Failed to share session:", error);
      setShareMessage(shareFailureMessage(error));
      setShareState("error");
      window.setTimeout(() => setShareState("idle"), 2200);
    }
  };

  // Rich session shares publish more than the old transcript-only links. Gate
  // the first expanded share behind fresh consent even when the legacy
  // transcript warning was already acknowledged. Local links stay on-device.
  const handleShare = async () => {
    if (shareNeedsConsent(loadKeatingUiSettings())) {
      setShareUrl(null);
      setShareMessage(PUBLIC_SHARE_CONSENT_MESSAGE);
      setShareState("confirm");
      return;
    }
    await performShare();
  };

  // Second click after the warning: remember the acknowledgement so the prompt
  // never shows again, then create the link.
  const confirmShare = async () => {
    const acknowledged = acknowledgeShareConsent(loadKeatingUiSettings());
    if (acknowledged) saveKeatingUiSettings(acknowledged);
    await performShare();
  };

  const dismissShare = () => {
    setShareState("idle");
    setShareUrl(null);
    setShareMessage(null);
  };

  return { shareState, shareUrl, shareMessage, handleShare, confirmShare, dismissShare };
}
