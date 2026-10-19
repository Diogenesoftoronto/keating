/**
 * Chat page header: session panel toggle, brand, model button, toolbar actions
 * and the overflow menu. The overflow menu's open state lives here; everything
 * it acts on (sessions, sharing, speech, artifacts) is passed in by the page.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { usePostHog } from "@posthog/react";
import {
  ChevronDown,
  LibraryBig,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  X,
} from "lucide-react";
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
  isPending: boolean;
  modelLabel: string;
  activeSessionId: string;
  mobileSidebarOpen: boolean;
  speechEnabled: boolean;
  canvasEnabled: boolean;
  artifactBrowserOpen: boolean;
  shareState: ShareState;
  toggleMobileSidebar: () => void;
  openModelSelector: () => void;
  openSettings: () => void;
  toggleArtifactBrowser: (source: "toolbar" | "mobile_menu") => void;
  newSession: () => void;
  handleShare: () => Promise<void>;
  confirmShare: () => Promise<void>;
  toggleSpeech: () => void;
  onOpenNodePod: () => void;
}

export function ChatHeader({
  isPending,
  modelLabel,
  activeSessionId,
  mobileSidebarOpen,
  speechEnabled,
  canvasEnabled,
  artifactBrowserOpen,
  shareState,
  toggleMobileSidebar,
  openModelSelector,
  openSettings,
  toggleArtifactBrowser,
  newSession,
  handleShare,
  confirmShare,
  toggleSpeech,
  onOpenNodePod,
}: ChatHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Close mobile menu on click outside or escape
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(e.target as Node)
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
          css({ display: "inline-flex", lg: { display: "none" } }),
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
          <PanelLeftClose size={16} />
        ) : (
          <PanelLeftOpen size={16} />
        )}
      </button>
      <Link
        to={applicationRootHref(window.location.hostname, import.meta.env.KEATING_WEB_BUILD_TARGET === "app")}
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
        <img
								src="/brand/logo-lockup-compact.avif"
          alt="Keating"
          className={css({
            height: "1.5rem",
            width: "auto",
            objectFit: "contain",
          })}
        />
      </Link>
      {/*
       * Model belongs in the top-left, next to the identity, not buried in
       * the composer: it frames the whole conversation rather than the one
       * message you are typing, and it needs to be readable at a glance
       * without opening anything.
       */}
      <button
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
        <span
          className={css({
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          })}
        >
          {modelLabel}
        </span>
        <ChevronDown size={13} className={css({ flexShrink: 0 })} />
      </button>
      <KnowledgeSourcesButton />
      <span className="chat-mode-badge chat-only-desktop">
        MODE: SOCRATIC
      </span>

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
        <button className={actionButtonClass} aria-label="Settings" title="Settings" onClick={openSettings}><Settings size={16}/></button>
        {canvasEnabled && <button className={actionButtonClass} aria-label={artifactBrowserOpen ? "Close materials" : "Open materials"} aria-pressed={artifactBrowserOpen} onClick={() => toggleArtifactBrowser("toolbar")}><LibraryBig size={16}/></button>}
        <button
          className={actionButtonClass}
          title="Menu"
          aria-label="More menu"
          aria-expanded={mobileMenuOpen}
          aria-haspopup="true"
          onClick={() => setMobileMenuOpen((o) => !o)}
        >
          {mobileMenuOpen ? <X size={16} /> : <Menu size={16} />}
        </button>
      </div>

      {/* Overflow menu */}
      {mobileMenuOpen && (
        <ChatOverflowMenu
          menuRef={mobileMenuRef}
          isPending={isPending}
          activeSessionId={activeSessionId}
          speechEnabled={speechEnabled}
          shareState={shareState}
          onClose={() => setMobileMenuOpen(false)}
          newSession={newSession}
          handleShare={handleShare}
          confirmShare={confirmShare}
          toggleSpeech={toggleSpeech}
          onOpenNodePod={onOpenNodePod}
        />
      )}
    </nav>
  );
}

/** Overflow menu entries. Every entry closes the menu before acting. */
function ChatOverflowMenu({
  menuRef,
  isPending,
  activeSessionId,
  speechEnabled,
  shareState,
  onClose,
  newSession,
  handleShare,
  confirmShare,
  toggleSpeech,
  onOpenNodePod,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  isPending: boolean;
  activeSessionId: string;
  speechEnabled: boolean;
  shareState: ShareState;
  onClose: () => void;
  newSession: () => void;
  handleShare: () => Promise<void>;
  confirmShare: () => Promise<void>;
  toggleSpeech: () => void;
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
          className={cx(
            menuItemClass,
            "",
            shareState === "copied"
              ? css({ color: "var(--primary)" })
              : "",
            shareState === "error"
              ? css({ color: "var(--destructive)" })
              : "",
          )}
          onClick={() => {
            onClose();
            if (shareState === "confirm") confirmShare();
            else handleShare();
          }}
          disabled={isPending || shareState === "sharing"}
        >

          {shareState === "copied"
            ? "Link copied"
            : shareState === "confirm"
              ? "Confirm public share"
              : "Share session"}
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
        <button
          className={menuItemClass}
          onClick={() => {
            onClose();
            if (activeSessionId) {
              navigate({ to: "/review/sessions/$sessionId", params: { sessionId: activeSessionId } });
            } else {
              navigate({ to: "/review" });
            }
          }}
        >

          Review session
        </button>
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
