import { StatusDot } from "../../design-system/kit";
import { useMediaQuery } from "../../hooks/use-media-query";
import { KeatingGlyph } from "../../design-system/glyphs";
import { categorize } from "../../components/session-card-visuals";
/**
 * Chat page header: session panel toggle, brand, title, model trigger, then
 * Materials, Review, Share, the light/dark control and the More menu. Everything
 * the menu acts on (sessions, sharing, speech, artifacts) is passed in by the page.
 * On phones this is a thin bar with only the title block (the model trigger) and
 * Share; navigation lives in the bottom ChatTabBar. Knowledge sources live in
 * Settings › Connections.
 */
import { css, cx } from "../../../styled-system/css";
import { AppLink as Link } from "../../components/AppLink";
import { ThemeToggle } from "../../components/ThemeToggle";
import { applicationRootHref } from "../../lib/hosted-navigation";
import { ChatActionsMenu } from "./ChatActionsMenu";
import type { ShareState } from "./session-sharing";
import { useChatMenu } from "./use-chat-menu";

const actionButtonPandaClass = css({
  display: "inline-flex",
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  transitionProperty: "color, background-color, border-color, opacity",
  transitionDuration: "150ms",
  _hover: {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  _disabled: {
    pointerEvents: "none",
    opacity: 0.5,
  },
});




export interface ChatHeaderProps {
  sessionTitle?: string;
  messageCount?: number;
  isPending: boolean;
  modelLabel: string;
  /** Short extra for the model, such as the thinking level, shown after its name. */
  modelDetail?: string;
  activeSessionId: string;
  mobileSidebarOpen: boolean;
  speechEnabled: boolean;
  canvasEnabled: boolean;
  artifactBrowserOpen: boolean;
  /** Materials in the active session, shown as a badge on the materials button. */
  materialCount?: number;
  shareState: ShareState;
  toggleMobileSidebar: () => void;
  openModelSelector: () => void;
  openSettings: () => void;
  toggleArtifactBrowser: (source: "toolbar" | "mobile_menu") => void;
  newSession: () => void;
  handleShare: () => Promise<void>;
  confirmShare: () => Promise<void>;
  toggleSpeech: () => void;
  onOpenOriginal?: () => void;
  onOpenNodePod: () => void;
}

export function ChatHeader({
  isPending,
  modelLabel, modelDetail, sessionTitle, messageCount = 0,
  activeSessionId,
  mobileSidebarOpen,
  speechEnabled,
  canvasEnabled,
  artifactBrowserOpen,
  materialCount = 0,
  shareState,
  toggleMobileSidebar,
  openModelSelector,
  openSettings,
  toggleArtifactBrowser,
  newSession,
  handleShare,
  toggleSpeech,
  onOpenOriginal, onOpenNodePod,
}: ChatHeaderProps) {
  const subject = categorize(sessionTitle);
  const compact = useMediaQuery("(max-width: 780px)");
  const reviewHref = activeSessionId ? `/review/sessions/${encodeURIComponent(activeSessionId)}` : "/review";
  const { open: mobileMenuOpen, setOpen: setMobileMenuOpen, close: closeMenu, buttonRef: menuButtonRef, menuRef: mobileMenuRef } = useChatMenu();

  // Panda globalCss drives responsive visibility via `.chat-only-desktop` (header icons,
  // md+) and `.chat-only-compact` (overflow-menu duplicates, < md).
  const modelText = modelDetail ? `${modelLabel} · ${modelDetail}` : modelLabel;
  const actionButtonClass = cx("chat-action-button", actionButtonPandaClass);

  return (
    <nav
      className={cx(
        "chat-header",
        css({
          position: "relative",
          display: "flex",
          height: "3.5rem",
          flexShrink: 0,
          alignItems: "center",
          gap: "0.5rem",
          borderBottom: "1px solid var(--border)",
          paddingInline: "0.5rem",
          paddingBlock: "0.5rem",
          sm: { paddingInline: "1rem" },
        }),
      )}
      aria-label={compact ? "Session" : "Chat navigation"}
      data-compact={compact || undefined}
    >
      {!compact && <button
        type="button"
        className={cx(
          actionButtonClass,
          "ch-panel-toggle",
        )}
        title={
          mobileSidebarOpen ? "Close sessions panel" : "Open sessions panel"
        }
        aria-label={
          mobileSidebarOpen ? "Close sessions panel" : "Open sessions panel"
        }
        aria-pressed={mobileSidebarOpen}
        onClick={toggleMobileSidebar}
      >
        <KeatingGlyph name="panel" active={mobileSidebarOpen} />
      </button>}
      {!compact && <Link
        to={applicationRootHref(globalThis.location?.hostname ?? "", import.meta.env.KEATING_WEB_BUILD_TARGET === "app")}
        className={cx(
          "chat-brand",
          css({
            display: "inline-flex",
            minWidth: 0,
            flexShrink: 0,
            alignItems: "center",
            gap: "0.5rem",
            borderRadius: "0.375rem",
            paddingInline: "0.5rem",
            paddingBlock: "0.25rem",
          }),
        )}
        aria-label="Go to Keating chat"
      >
        <KeatingGlyph name="kmark" className="ch-compact-logo" />
        <img
								src="/brand/logo-lockup-compact.avif"
          alt="Keating"
          className={css({
            height: "1.5rem",
            width: "auto",
            objectFit: "contain",
          })}
        />
      </Link>}
      {compact ? <button
        key={activeSessionId}
        type="button"
        className="ch-title ch-title-model"
        onClick={openModelSelector}
        aria-label={`Change model. Current model: ${modelText}`}
      >
        <strong>{sessionTitle || "New session"}</strong>
        <small><StatusDot tone="ok" label="Model selected" /><span>{modelText}</span><KeatingGlyph name="chev" size={13} /></small>
      </button> : <div key={activeSessionId} className="ch-title">
        <strong>{sessionTitle || "New session"}</strong>
        <small>Socratic{subject.key !== "general" && ` · ${subject.label}`} · {messageCount} {messageCount === 1 ? "message" : "messages"}</small>
      </div>}
      {!compact && <button
        type="button"
        onClick={openModelSelector}
        title={`Model: ${modelText}`}
        aria-label={`Change model. Current model: ${modelText}`}
        className={cx(
          "chat-model-button",
          css({
            display: "inline-flex",
            minWidth: 0,
            maxWidth: "11rem",
            flexShrink: 1,
            alignItems: "center",
            gap: "0.25rem",
            borderRadius: "0.5rem",
            paddingInline: "0.5rem",
            paddingBlock: "0.25rem",
            fontSize: "0.8125rem",
            fontWeight: 500,
            color: "var(--muted-foreground)",
            cursor: "pointer",
            _hover: {
              backgroundColor: "var(--accent)",
              color: "var(--accent-foreground)",
            },
          }),
        )}
      >
        <StatusDot tone="ok" label="Model selected" />
        <span
          className={css({
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          })}
        >
          {modelLabel}
        </span>
        <KeatingGlyph name="chev" size={15} className={css({ flexShrink: 0 })} />
      </button>}
      {/* Actions */}
      <div
        className={cx(
          "chat-actions",
          css({
            marginLeft: "auto",
            display: "flex",
            minWidth: 0,
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "0.25rem",
            overflow: "hidden",
            sm: { flex: 1 },
          }),
        )}
      >
        {canvasEnabled && !compact && <button
          className={cx(actionButtonClass, css({ position: "relative" }))}
          aria-label={`${artifactBrowserOpen ? "Close materials" : "Open materials"}${materialCount ? `, ${materialCount} in this session` : ""}`}
          title={materialCount ? `Materials (${materialCount} in this session)` : "Materials"}
          aria-pressed={artifactBrowserOpen}
          data-material-count={materialCount}
          onClick={() => toggleArtifactBrowser("toolbar")}
        >
          <KeatingGlyph name="layers" /><span className="ch-label">Materials{materialCount > 0 && ` · ${materialCount}`}</span>
        </button>}
        {!compact && <Link to={reviewHref} className="ch-review" aria-label="Review session" title="Review session">
          <KeatingGlyph name="pen" /><span className="ch-label">Review</span>
        </Link>}
        <button
          type="button"
          className={cx(actionButtonClass, "ch-share")}
          aria-label={shareState === "sharing" ? "Share session, creating link" : "Share session"}
          title="Share session"
          data-share-state={shareState}
          disabled={isPending || shareState === "sharing"}
          onClick={() => void handleShare()}
        >
          <KeatingGlyph name="share" /><span className="ch-label">Share</span>
        </button>
        {!compact && <ThemeToggle className="ch-theme" />}
        {!compact && <button
          type="button"
          className={actionButtonClass}
          ref={menuButtonRef}
          title="More"
          aria-label="More menu"
          aria-expanded={mobileMenuOpen}
          aria-controls={mobileMenuOpen ? "chat-actions-menu" : undefined}
          onClick={() => mobileMenuOpen ? closeMenu() : setMobileMenuOpen(true)}
        >
          <KeatingGlyph name={mobileMenuOpen ? "x" : "more"} />
        </button>}
      </div>

      {/* Overflow menu */}
      {mobileMenuOpen && !compact && (
        <ChatActionsMenu
          compact={false} reviewHref={reviewHref} modelLabel={modelText}
          menuRef={mobileMenuRef} buttonRef={menuButtonRef}
          isPending={isPending}
          speechEnabled={speechEnabled}
          shareState={shareState}
          onClose={closeMenu}
          openModelSelector={openModelSelector}
          openSettings={openSettings}
          newSession={newSession}
          handleShare={handleShare}
          toggleSpeech={toggleSpeech}
          onOpenOriginal={onOpenOriginal} onOpenNodePod={onOpenNodePod}
        />
      )}
    </nav>
  );
}
