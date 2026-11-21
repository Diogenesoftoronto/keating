/**
 * Phone navigation for the chat: a thin bar on the bottom edge, within thumb reach, holding the five
 * things a learner moves between: the session list, this session's materials, a new session, review,
 * and everything else under More. The header above keeps only the session title (the model trigger)
 * and Share, so the two bars balance.
 *
 * The bar never stacks under another bottom bar: it steps aside while Recess is flying and while
 * Recess shows its own Loadout / Controls / Look tabs (see chat-tabbar.css).
 */
import { AppLink as Link } from "../../components/AppLink";
import { KeatingGlyph } from "../../design-system/glyphs";
import { useMediaQuery } from "../../hooks/use-media-query";
import { ChatActionsMenu } from "./ChatActionsMenu";
import type { ChatHeaderProps } from "./ChatHeader";
import { useChatMenu } from "./use-chat-menu";
import "./chat-tabbar.css";

export const CHAT_COMPACT_QUERY = "(max-width: 780px)";

export function ChatTabBar({
  isPending, modelLabel, modelDetail, activeSessionId, mobileSidebarOpen, speechEnabled, canvasEnabled,
  artifactBrowserOpen, materialCount = 0, shareState, toggleMobileSidebar, openModelSelector, openSettings,
  toggleArtifactBrowser, newSession, handleShare, toggleSpeech, onOpenOriginal, onOpenNodePod,
}: ChatHeaderProps) {
  const compact = useMediaQuery(CHAT_COMPACT_QUERY);
  const menu = useChatMenu();
  if (!compact) return null;

  const reviewHref = activeSessionId ? `/review/sessions/${encodeURIComponent(activeSessionId)}` : "/review";
  const modelText = modelDetail ? `${modelLabel} · ${modelDetail}` : modelLabel;

  return (
    <nav className="ch-tabbar" aria-label="Chat navigation" data-tabs={canvasEnabled ? 5 : 4}>
      <button
        type="button"
        className="ch-tab"
        aria-label={mobileSidebarOpen ? "Close sessions" : "Open sessions"}
        aria-pressed={mobileSidebarOpen}
        onClick={toggleMobileSidebar}
      >
        <KeatingGlyph name="menu" size={20} active={mobileSidebarOpen} />
        <span>Sessions</span>
      </button>
      {canvasEnabled && <button
        type="button"
        className="ch-tab"
        aria-label={`${artifactBrowserOpen ? "Close materials" : "Open materials"}${materialCount ? `, ${materialCount} in this session` : ""}`}
        aria-pressed={artifactBrowserOpen}
        data-material-count={materialCount}
        onClick={() => toggleArtifactBrowser("toolbar")}
      >
        <span className="ch-tab-icon">
          <KeatingGlyph name="layers" size={20} active={artifactBrowserOpen} />
          {materialCount > 0 && <b aria-hidden="true">{materialCount > 99 ? "99+" : materialCount}</b>}
        </span>
        <span>Materials</span>
      </button>}
      <button type="button" className="ch-tab ch-tab-new" aria-label="New session" disabled={isPending} onClick={newSession}>
        <span className="ch-tab-icon"><KeatingGlyph name="plus" size={18} /></span>
        <span>New</span>
      </button>
      <Link to={reviewHref} className="ch-tab" aria-label="Review session">
        <KeatingGlyph name="pen" size={20} />
        <span>Review</span>
      </Link>
      <button
        type="button"
        className="ch-tab"
        ref={menu.buttonRef}
        aria-label="More menu"
        aria-expanded={menu.open}
        aria-controls={menu.open ? "chat-actions-menu" : undefined}
        onClick={() => menu.open ? menu.close() : menu.setOpen(true)}
      >
        <KeatingGlyph name={menu.open ? "x" : "more"} size={20} />
        <span>More</span>
      </button>

      {menu.open && (
        <ChatActionsMenu
          compact tabBar reviewHref={reviewHref} modelLabel={modelText}
          menuRef={menu.menuRef} buttonRef={menu.buttonRef}
          isPending={isPending}
          speechEnabled={speechEnabled}
          shareState={shareState}
          onClose={menu.close}
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
