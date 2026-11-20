import { StatusDot } from "../../design-system/kit";
import { useMediaQuery } from "../../hooks/use-media-query";
import { KeatingGlyph } from "../../design-system/glyphs";
import { categorize } from "../../components/session-card-visuals";
/**
 * Chat page header: session panel toggle, brand, model button, toolbar actions
 * and the overflow menu. The overflow menu's open state lives here; everything
 * it acts on (sessions, sharing, speech, artifacts) is passed in by the page.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { usePostHog } from "@posthog/react";

import { useNavigate } from "@tanstack/react-router";
import { css, cx } from "../../../styled-system/css";
import { AppLink as Link } from "../../components/AppLink";
import { KnowledgeSourcesButton } from "../../components/settings/KnowledgeSources";
import { NotOrganicAccountMenuItem } from "../../components/NotOrganicAccountMenuItem";
import { ThemeToggle } from "../../components/ThemeToggle";
import { applicationRootHref, WEBSITE_ORIGIN } from "../../lib/hosted-navigation";
import { DOCUMENTATION_URL } from "../../lib/tutorial-links";
import { BLOG_URL } from "../../lib/blog-links";
import type { ShareState } from "./session-sharing";

const GITHUB_ISSUE_URL =
  "https://github.com/Diogenesoftoronto/keating/issues/new";

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

const menuItemClass = css({
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  borderRadius: "0.375rem",
  paddingInline: "0.75rem",
  paddingBlock: "0.5rem",
  textAlign: "left",
  fontSize: "0.875rem",
  transitionProperty: "color, background-color, border-color",
  transitionDuration: "150ms",
  _hover: {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
});


export interface ChatHeaderProps {
  sessionTitle?: string;
  messageCount?: number;
  isPending: boolean;
  modelLabel: string;
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
  modelLabel, sessionTitle, messageCount = 0,
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Close mobile menu on click outside or escape
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !mobileMenuRef.current?.querySelector("dialog[open]")) { setMobileMenuOpen(false); menuButtonRef.current?.focus(); }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(e.target as Node) && !menuButtonRef.current?.contains(e.target as Node)
      ) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [mobileMenuOpen]);

  // Panda globalCss drives responsive visibility via `.chat-only-desktop` (header icons,
  // md+) and `.chat-only-compact` (overflow-menu duplicates, < md).
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
      aria-label="Chat navigation"
    >
      <button
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
        {mobileSidebarOpen ? (
          <KeatingGlyph name={compact ? "menu" : "panel"} active />
        ) : (
          <KeatingGlyph name={compact ? "menu" : "panel"} />
        )}
      </button>
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
      <div key={activeSessionId} className="ch-title">
        <strong>{sessionTitle || "New session"}</strong>
        {compact ? <small>{modelLabel} · Socratic</small> : <small>Socratic{subject.key !== "general" && ` · ${subject.label}`} · {messageCount} {messageCount === 1 ? "message" : "messages"}</small>}
      </div>
      {!compact && <button
        type="button"
        onClick={openModelSelector}
        title={`Model: ${modelLabel}`}
        aria-label={`Change model. Current model: ${modelLabel}`}
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
      {!compact && <HeaderSources />}
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
        {canvasEnabled && <button
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
          className={actionButtonClass}
          ref={menuButtonRef}
          title="Menu"
          aria-label="More menu"
          aria-expanded={mobileMenuOpen}
          aria-haspopup="true"
          onClick={() => setMobileMenuOpen((o) => !o)}
        >
          <KeatingGlyph name={mobileMenuOpen ? "x" : "more"} />
        </button>
      </div>

      {/* Overflow menu */}
      {mobileMenuOpen && (
        <ChatOverflowMenu
          compact={compact} reviewHref={reviewHref} openModelSelector={openModelSelector} modelLabel={modelLabel}
          menuRef={mobileMenuRef}
          isPending={isPending}
          openSettings={openSettings}
          speechEnabled={speechEnabled}
          shareState={shareState}
          onClose={() => setMobileMenuOpen(false)}
          newSession={newSession}
          handleShare={async () => { menuButtonRef.current?.focus(); await handleShare(); }}
          toggleSpeech={toggleSpeech}
          onOpenOriginal={onOpenOriginal} onOpenNodePod={onOpenNodePod}
        />
      )}
    </nav>
  );
}

function HeaderSources() {
  return <div className="ch-sources" data-glyph-host>
    <KnowledgeSourcesButton />
    <KeatingGlyph name="book" size={15} className="ch-sources-glyph" />
    <KeatingGlyph name="chev" size={13} className="ch-sources-caret" />
  </div>;
}

/** Overflow menu entries. Every entry closes the menu before acting. */
function ChatOverflowMenu({
  compact, reviewHref, openModelSelector, modelLabel,
  menuRef,
  isPending,
  openSettings,
  speechEnabled,
  shareState,
  onClose,
  newSession,
  handleShare,
  toggleSpeech,
  onOpenOriginal, onOpenNodePod,
}: {
  compact: boolean; reviewHref: string; openModelSelector: () => void; modelLabel: string;
  menuRef: RefObject<HTMLDivElement | null>;
  isPending: boolean;
  openSettings: () => void;
  speechEnabled: boolean;
  shareState: ShareState;
  onClose: () => void;
  newSession: () => void;
  handleShare: () => Promise<void>;
  toggleSpeech: () => void;
  onOpenOriginal?: () => void;
  onOpenNodePod: () => void;
}) {
  const posthog = usePostHog();
  const navigate = useNavigate();
  return (
    <div
      ref={menuRef}
      role="navigation" aria-label="Chat actions"
      className={cx(
        "font-terminal",
        css({
          position: "absolute",
          right: "0.5rem",
          top: "100%",
          zIndex: 50,
          marginTop: "0.25rem",
          width: "16rem",
          maxHeight: "min(70dvh, 36rem)",
          overflowY: "auto",
          borderRadius: "0.375rem",
          border: "1px solid var(--border)",
          backgroundColor: "var(--background)",
          boxShadow:
            "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
          fontSize: "0.875rem",
        }),
      )}
    >
      <div
        className={css({
          display: "flex",
          flexDirection: "column",
          padding: "0.25rem",
        })}
      >
        {compact && <>
          <button type="button" className={menuItemClass} onClick={() => { onClose(); openModelSelector(); }}>Change model · {modelLabel}</button>
          <HeaderSources />
          <Link to={reviewHref} className={menuItemClass} onClick={onClose}><KeatingGlyph name="pen" size={16} />Review session</Link>
          <Link to={applicationRootHref(globalThis.location?.hostname ?? "", import.meta.env.KEATING_WEB_BUILD_TARGET === "app")} className={menuItemClass} onClick={onClose}>Go to Keating chat</Link>
        </>}
        {onOpenOriginal && <button type="button" className={menuItemClass} onClick={() => { onClose(); onOpenOriginal(); }}>Open original</button>}
        <NotOrganicAccountMenuItem className={menuItemClass} onSignIn={() => onClose()} />
        <button
          className={cx(menuItemClass, "")}
          disabled={isPending}
          onClick={() => {
            onClose();
            newSession();
          }}
        >

          New session
        </button>
        <button
          className={menuItemClass}
          onClick={() => { onClose(); void handleShare(); }}
          disabled={isPending || shareState === "sharing"}
        >
          <KeatingGlyph name="share" size={16} /> Share session
        </button>
        <button
          className={cx(
            menuItemClass,
            "",
            speechEnabled ? css({ color: "var(--primary)" }) : "",
          )}
          onClick={() => {
            onClose();
            posthog.capture("speech_toggled", {
              enabled: !speechEnabled,
            });
            toggleSpeech();
          }}
        >

          {speechEnabled ? "Disable speech" : "Enable speech"}
        </button>
        <ThemeToggle
          className=""
          variant="menu"
          onToggled={() => onClose()}
        />
        <Link
          to="/courses"
          className={menuItemClass}
          onClick={() => onClose()}
        >

          Courses
        </Link>
        <Link to="/labs/systems" className={menuItemClass} onClick={onClose}>
          <KeatingGlyph name="terminal" size={16} />Systems lab
        </Link>
        {import.meta.env.DEV && (
          <button
            className={cx(menuItemClass, "")}
            onClick={() => {
              onClose();
              onOpenNodePod();
            }}
          >

            NodePod runtime
          </button>
        )}
        <button
          className={cx(menuItemClass, "")}
          onClick={() => {
            onClose();
            navigate({ to: "/usage" });
          }}
        >

          Learning usage
        </button>
        <Link
          to="/bench"
          className={menuItemClass}
          onClick={() => onClose()}
        >
          Model benchmark
        </Link>
        <Link
          to="/coming-up"
          className={menuItemClass}
          onClick={() => onClose()}
        >
          Coming up
        </Link>
        <Link
          to="/live"
          className={menuItemClass}
          onClick={() => onClose()}
        >
          Live sessions
        </Link>
        <button className={menuItemClass} onClick={() => { onClose(); openSettings(); }}><KeatingGlyph name="gear" size={16}/>Settings</button>
        <div
          className={cx(
            "",
            css({
              marginBlock: "0.25rem",
              borderTop: "1px solid var(--border)",
            }),
          )}
        />
        <Link
          to={`${WEBSITE_ORIGIN}/`}
          className={menuItemClass}
          onClick={() => onClose()}
        >
          Keating website
        </Link>
        <a
          href={DOCUMENTATION_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={menuItemClass}
          onClick={() => onClose()}
        >
          Documentation
        </a>
        <a
          href={BLOG_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={menuItemClass}
          onClick={() => onClose()}
        >
          Blog
        </a>
        <Link
          to="/paper"
          className={menuItemClass}
          onClick={() => onClose()}
        >
          Paper
        </Link>
        <a
          href="https://github.com/Diogenesoftoronto/keating"
          target="_blank"
          rel="noreferrer"
          className={menuItemClass}
          onClick={() => onClose()}
        >
          GitHub
        </a>
        <a
          href={GITHUB_ISSUE_URL}
          target="_blank"
          rel="noreferrer"
          className={cx(menuItemClass, "")}
          onClick={() => onClose()}
        >
          Report issue
        </a>
      </div>
    </div>
  );
}
