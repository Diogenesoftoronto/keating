/**
 * The chat header's "More" menu: an action list in four groups (this session,
 * learning, account, about Keating). Every entry closes the menu before it acts.
 * Arrow keys, Home and End move between entries; Escape and leaving the menu
 * close it. Sharing leads the list and says where the link will go before the
 * share sheet asks for consent.
 */
import { useEffect, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { usePostHog } from "@posthog/react";
import { useNavigate } from "@tanstack/react-router";
import { AppLink as Link } from "../../components/AppLink";
import { NotOrganicAccountMenuItem } from "../../components/NotOrganicAccountMenuItem";
import { KeatingGlyph } from "../../design-system/glyphs";
import { applicationRootHref, WEBSITE_ORIGIN } from "../../lib/hosted-navigation";
import { DOCUMENTATION_URL } from "../../lib/tutorial-links";
import { BLOG_URL } from "../../lib/blog-links";
import { loadKeatingUiSettings } from "../../keating/ui-settings";
import type { ShareState } from "./session-sharing";
import "./chat-menu.css";

const GITHUB_URL = "https://github.com/Diogenesoftoronto/keating";
const GITHUB_ISSUE_URL = `${GITHUB_URL}/issues/new`;

/** Settings › Models and connections › Connections (owned by the Settings lane). */
export function openConnectionsSettings() {
  window.dispatchEvent(new CustomEvent("keating:open-settings", { detail: { section: "connections" } }));
}

/** The line under "Share session": what kind of link it makes, or how far it got. */
export function shareMenuDetail(shareState: ShareState, local: boolean): string {
  if (shareState === "sharing") return "Creating link…";
  if (shareState === "ready") return "Link ready to copy";
  return local ? "Local link · stays on this device" : "Read-only link · you confirm first";
}

const FOCUSABLE = "a[href],button:not(:disabled)";

export function moveMenuFocus(items: HTMLElement[], current: Element | null, key: string): HTMLElement | undefined {
  if (!items.length) return undefined;
  const index = current ? items.indexOf(current as HTMLElement) : -1;
  if (key === "Home") return items[0];
  if (key === "End") return items[items.length - 1];
  if (key === "ArrowDown") return items[(index + 1) % items.length];
  if (key === "ArrowUp") return items[(index - 1 + items.length) % items.length];
  return undefined;
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const id = `ch-menu-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return <div role="group" aria-labelledby={id} className="ch-menu-group">
    <span id={id} className="ch-menu-heading">{label}</span>
    {children}
  </div>;
}

export interface ChatActionsMenuProps {
  compact: boolean;
  reviewHref: string;
  modelLabel: string;
  menuRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  isPending: boolean;
  speechEnabled: boolean;
  shareState: ShareState;
  onClose: (restoreFocus?: boolean) => void;
  openModelSelector: () => void;
  openSettings: () => void;
  newSession: () => void;
  handleShare: () => Promise<void>;
  toggleSpeech: () => void;
  onOpenOriginal?: () => void;
  onOpenNodePod: () => void;
}

export function ChatActionsMenu({
  compact, reviewHref, modelLabel, menuRef, buttonRef, isPending, speechEnabled, shareState,
  onClose, openModelSelector, openSettings, newSession, handleShare, toggleSpeech, onOpenOriginal, onOpenNodePod,
}: ChatActionsMenuProps) {
  const posthog = usePostHog();
  const navigate = useNavigate();
  const local = loadKeatingUiSettings().shareLinkMode === "local-short";
  const shareBusy = shareState === "sharing";
  const itemClass = "ch-menu-item";

  // Land on the first entry so the keyboard can start moving at once.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
  }, [menuRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const next = moveMenuFocus(items, document.activeElement, event.key);
    if (next) { event.preventDefault(); next.focus(); }
  };

  const chatHome = applicationRootHref(globalThis.location?.hostname ?? "", import.meta.env.KEATING_WEB_BUILD_TARGET === "app");
  const ext = <KeatingGlyph name="ext" size={13} className="ch-menu-ext" />;

  return (
    <div
      ref={menuRef}
      id="chat-actions-menu"
      role="navigation"
      aria-label="Chat actions"
      className="k-menu ch-menu"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !menuRef.current?.contains(next) && !buttonRef.current?.contains(next)) onClose(false);
      }}
    >
      <Group label="This session">
        <button
          type="button"
          className={`${itemClass} ch-menu-share`}
          disabled={isPending || shareBusy}
          onClick={() => { onClose(); void handleShare(); }}
        >
          <KeatingGlyph name="share" size={15} />
          <span className="ch-menu-text">Share session<small>{shareMenuDetail(shareState, local)}</small></span>
        </button>
        {compact && <Link to={reviewHref} className={itemClass} onClick={() => onClose(false)}>
          <KeatingGlyph name="pen" size={15} /><span className="ch-menu-text">Review session</span>
        </Link>}
        {compact && <button type="button" className={itemClass} onClick={() => { onClose(false); openModelSelector(); }}>
          <KeatingGlyph name="chip" size={15} /><span className="ch-menu-text">Change model<small>{modelLabel}</small></span>
        </button>}
        <button type="button" className={itemClass} disabled={isPending} onClick={() => { onClose(); newSession(); }}>
          <KeatingGlyph name="plus" size={15} /><span className="ch-menu-text">New session</span>
        </button>
        {onOpenOriginal && <button type="button" className={itemClass} onClick={() => { onClose(false); onOpenOriginal(); }}>
          <KeatingGlyph name="fork" size={15} /><span className="ch-menu-text">Open original</span>
        </button>}
        <button
          type="button"
          className={itemClass}
          aria-pressed={speechEnabled}
          onClick={() => {
            onClose();
            posthog.capture("speech_toggled", { enabled: !speechEnabled });
            toggleSpeech();
          }}
        >
          <KeatingGlyph name={speechEnabled ? "speaker" : "mute"} size={15} />
          <span className="ch-menu-text">Read replies aloud<small>{speechEnabled ? "On" : "Off"}</small></span>
        </button>
      </Group>
      <hr />
      <Group label="Learn">
        <Link to="/courses" className={itemClass} onClick={() => onClose(false)}><KeatingGlyph name="book" size={15} /><span className="ch-menu-text">Courses</span></Link>
        <Link to="/live" className={itemClass} onClick={() => onClose(false)}><KeatingGlyph name="video" size={15} /><span className="ch-menu-text">Live sessions</span></Link>
        <Link to="/labs/systems" className={itemClass} onClick={() => onClose(false)}><KeatingGlyph name="terminal" size={15} /><span className="ch-menu-text">Systems lab</span></Link>
        <button type="button" className={itemClass} onClick={() => { onClose(false); navigate({ to: "/usage" }); }}><KeatingGlyph name="trend" size={15} /><span className="ch-menu-text">Learning usage</span></button>
        <Link to="/bench" className={itemClass} onClick={() => onClose(false)}><KeatingGlyph name="compare" size={15} /><span className="ch-menu-text">Model benchmark</span></Link>
        <Link to="/coming-up" className={itemClass} onClick={() => onClose(false)}><KeatingGlyph name="calendar" size={15} /><span className="ch-menu-text">Coming up</span></Link>
        {import.meta.env.DEV && <button type="button" className={itemClass} onClick={() => { onClose(false); onOpenNodePod(); }}><KeatingGlyph name="server" size={15} /><span className="ch-menu-text">NodePod runtime</span></button>}
      </Group>
      <hr />
      <Group label="Account">
        <NotOrganicAccountMenuItem className={itemClass} onSignIn={() => onClose(false)} />
        <button
          type="button"
          className={itemClass}
          onClick={() => {
            onClose(false);
            posthog.capture("settings_opened", { source: "chat-menu-connections" });
            openConnectionsSettings();
          }}
        >
          <KeatingGlyph name="link" size={15} /><span className="ch-menu-text">Connections<small>Sources and accounts</small></span>
        </button>
        <button type="button" className={itemClass} onClick={() => { onClose(false); openSettings(); }}>
          <KeatingGlyph name="gear" size={15} /><span className="ch-menu-text">Settings</span>
        </button>
      </Group>
      <hr />
      <Group label="Keating">
        {compact && <Link to={chatHome} className={itemClass} onClick={() => onClose(false)}><KeatingGlyph name="kmark" size={15} /><span className="ch-menu-text">Go to Keating chat</span></Link>}
        <Link to={`${WEBSITE_ORIGIN}/`} className={itemClass} onClick={() => onClose(false)}><KeatingGlyph name="globe" size={15} /><span className="ch-menu-text">Keating website</span></Link>
        <a href={DOCUMENTATION_URL} target="_blank" rel="noopener noreferrer" className={itemClass} onClick={() => onClose(false)}><KeatingGlyph name="doc" size={15} /><span className="ch-menu-text">Documentation</span>{ext}</a>
        <a href={BLOG_URL} target="_blank" rel="noopener noreferrer" className={itemClass} onClick={() => onClose(false)}><KeatingGlyph name="feather" size={15} /><span className="ch-menu-text">Blog</span>{ext}</a>
        <Link to="/paper" className={itemClass} onClick={() => onClose(false)}><KeatingGlyph name="note" size={15} /><span className="ch-menu-text">Paper</span></Link>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={itemClass} onClick={() => onClose(false)}><KeatingGlyph name="code" size={15} /><span className="ch-menu-text">GitHub</span>{ext}</a>
        <a href={GITHUB_ISSUE_URL} target="_blank" rel="noreferrer" className={itemClass} onClick={() => onClose(false)}><KeatingGlyph name="bug" size={15} /><span className="ch-menu-text">Report issue</span>{ext}</a>
      </Group>
    </div>
  );
}
