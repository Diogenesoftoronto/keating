import { useSessions } from "../hooks/use-sessions";
import { useMediaQuery } from "../hooks/use-media-query";
import { SessionBrowserDesktop } from "./SessionBrowserDesktop";
import { SessionBrowserSheet } from "./SessionBrowserSheet";

/**
 * Below this width the browser renders as a full-screen sheet; at or
 * above it, as the resizable left panel. Single source of truth for
 * every session-UI breakpoint decision.
 */
export const SESSION_BROWSER_BREAKPOINT = 1024;

export interface SessionBrowserProps {
	activeSessionId?: string;
	/** Session currently being forked (drives the fork spinner). */
	forkingSessionId?: string | null;
	/** Session that just arrived from a fork (drives the arrival animation). */
	forkedSessionId?: string | null;
	/** Desktop only: collapsed-strip state, persisted by the caller. */
	collapsed?: boolean;
	onCollapsedChange?: (next: boolean) => void;
	/** Mobile only: sheet visibility, owned by the caller (agent store). */
	mobileOpen?: boolean;
	onMobileClose?: () => void;
	onLoad: (sessionId: string) => void | Promise<void>;
	onFork: (sessionId: string) => void | Promise<void>;
	onNewSession?: () => void;
	/** AI title suggestion; resolves to the suggested title (caller owns the model call). */
	onSuggestTitle?: (sessionId: string) => Promise<string>;
}

function useIsDesktop(): boolean {
	return useMediaQuery(`(min-width: ${SESSION_BROWSER_BREAKPOINT}px)`);
}

/**
 * The one session interface: a resizable tree panel on desktop, a
 * full-screen card sheet on mobile. All session CRUD (load, fork, new,
 * rename, delete, AI title) is available in both variants; list state
 * comes from the shared useSessions hook.
 */
export function SessionBrowser(props: SessionBrowserProps) {
	const isDesktop = useIsDesktop();
	const store = useSessions({ withHeroes: !isDesktop });

	if (isDesktop) {
		return <SessionBrowserDesktop {...props} store={store} />;
	}
	if (!props.mobileOpen) return null;
	return <SessionBrowserSheet {...props} store={store} />;
}
