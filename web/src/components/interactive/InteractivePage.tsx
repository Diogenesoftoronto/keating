import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { isolateForModal } from "../../lib/motion";
import { CircleAlert, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { buildInteractivePageDocument, type InteractivePageRejection } from "../../keating/interactive-page/document";
import { createContextSync, createGestureGate, createInteractivePageHost, randomChannelId } from "../../keating/interactive-page/host";
import { INTERACTIVE_PAGE_LIMITS, type InteractiveShareResult, type JsonValue } from "../../keating/interactive-page/protocol";
import { createInteractivePageStateStore, type InteractivePageStateStore } from "../../keating/interactive-page/state-store";
import { browserThemeSource, readInteractivePageContext, watchAppContext } from "../../keating/interactive-page/theme";

export type InteractivePageStatus = "loading" | "ready" | "invalid" | "oversize" | "blocked" | "crashed";

export interface InteractivePageProps {
	pageId: string;
	title: string;
	html: string;
	/** Required plain-text alternative: what the page shows and teaches. */
	description: string;
	libraries?: readonly string[];
	/** Past or read-only turns: the page still runs, but cannot share. */
	disabled?: boolean;
	/** Delivers a learner-initiated result to the tutor. Return false if it could not be sent. */
	onShare?: (result: InteractiveShareResult) => boolean;
	stateStore?: InteractivePageStateStore;
	className?: string;
}

interface RuntimeState {
	generation: number;
	status: "loading" | "ready" | "blocked" | "crashed";
	message?: string;
}

export type InteractivePageAction =
	| { type: "reload" }
	| { type: "ready" }
	| { type: "error"; message: string }
	| { type: "timeout" }
	| { type: "navigated" };

export function interactivePageReducer(state: RuntimeState, action: InteractivePageAction): RuntimeState {
	switch (action.type) {
		case "reload":
			return { generation: state.generation + 1, status: "loading" };
		case "ready":
			return state.status === "loading" ? { ...state, status: "ready", message: undefined } : state;
		case "error":
			return state.status === "loading" ? { ...state, status: "crashed", message: action.message } : state;
		case "timeout":
			return state.status === "loading" ? { ...state, status: "crashed", message: "The page did not start in time." } : state;
		case "navigated":
			return state.status === "blocked" ? state : { ...state, status: "blocked", message: undefined };
	}
}

export const INITIAL_INTERACTIVE_PAGE_STATE: RuntimeState = { generation: 0, status: "loading" };

const FALLBACK_HEADLINES: Record<Exclude<InteractivePageStatus, "ready">, string> = {
	loading: "Loading interactive page…",
	invalid: "This interactive page could not be shown.",
	oversize: "This interactive page is too large to show.",
	blocked: "This interactive page tried to leave its frame, so Keating stopped it.",
	crashed: "This interactive page did not start.",
};

function rejectionStatus(rejection: InteractivePageRejection): "invalid" | "oversize" | "blocked" {
	if (rejection.reason === "oversize") return "oversize";
	if (rejection.reason === "forbidden-markup") return "blocked";
	return "invalid";
}

export function InteractivePageFallback({ status, title, description, message, onReload }: { status: Exclude<InteractivePageStatus, "ready">; title: string; description: string; message?: string; onReload: () => void }) {
	const alert = status !== "loading";
	return (
		<div role={alert ? "alert" : "status"} className={fallbackClass} data-interactive-status={status}>
			<p className={fallbackHeadlineClass}>
				{alert ? <CircleAlert size={14} aria-hidden="true" className={css({ flexShrink: 0, marginTop: "0.2rem" })} /> : null}
				<span>{FALLBACK_HEADLINES[status]}{message ? ` ${message}` : ""}</span>
			</p>
			<p className={fallbackDescriptionClass}><span className={css({ fontWeight: 600 })}>{title}: </span>{description}</p>
			<button type="button" className={controlClass} onClick={onReload}><RotateCcw size={14} aria-hidden="true" />Reload</button>
		</div>
	);
}

function hasRecentActivation(): boolean {
	const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
	// Fail closed where the API is missing: no gesture can be proven.
	return activation?.isActive === true;
}

function useBlobUrl(source: string | null): string | null {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		if (source === null) {
			setUrl(null);
			return;
		}
		const next = URL.createObjectURL(new Blob([source], { type: "text/html;charset=utf-8" }));
		setUrl(next);
		return () => URL.revokeObjectURL(next);
	}, [source]);
	return url;
}

export function InteractivePage({ pageId, title, html, description, libraries, disabled = false, onShare, stateStore, className }: InteractivePageProps) {
	const ids = useId();
	const titleId = `${ids}-title`;
	const descriptionId = `${ids}-description`;
	const store = useMemo(() => stateStore ?? createInteractivePageStateStore(), [stateStore]);
	const [runtime, dispatch] = useReducer(interactivePageReducer, INITIAL_INTERACTIVE_PAGE_STATE);
	const [contentHeight, setContentHeight] = useState<number>(INTERACTIVE_PAGE_LIMITS.minHeight);
	const [fullscreen, setFullscreen] = useState(false);
	const [notice, setNotice] = useState("");
	const [saveFailed, setSaveFailed] = useState(false);
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const rootRef = useRef<HTMLElement | null>(null);
	const fullscreenToggleRef = useRef<HTMLButtonElement | null>(null);
	const loadsRef = useRef(0);
	const pendingStateRef = useRef<JsonValue | undefined>(undefined);
	const saveTimerRef = useRef<number | undefined>(undefined);
	const libraryKey = (libraries ?? []).join(",");
	const latest = useRef({ disabled, onShare });
	latest.current = { disabled, onShare };

	// `runtime.generation` forces a rebuild with a fresh channel and the latest saved state.
	const built = useMemo(() => {
		const channel = typeof crypto === "undefined" ? `ch-${runtime.generation}` : randomChannelId();
		const saved = store.load(pageId);
		const result = buildInteractivePageDocument({
			html,
			title,
			channel,
			context: readInteractivePageContext(browserThemeSource()),
			state: saved.status === "restored" ? saved.state : null,
			libraries: libraryKey ? libraryKey.split(",") : [],
		});
		return { channel, result };
	}, [html, title, libraryKey, pageId, store, runtime.generation]);
	const pageDocument = built.result.ok ? built.result.document : null;
	const src = useBlobUrl(pageDocument);

	const flushState = useCallback(() => {
		window.clearTimeout(saveTimerRef.current);
		saveTimerRef.current = undefined;
		const state = pendingStateRef.current;
		if (state === undefined) return true;
		pendingStateRef.current = undefined;
		const saved = store.save(pageId, state);
		setSaveFailed(!saved.ok);
		return saved.ok;
	}, [pageId, store]);

	const host = useMemo(() => createInteractivePageHost({
		channel: built.channel,
		frameWindow: () => frameRef.current?.contentWindow ?? null,
		post: (message) => frameRef.current?.contentWindow?.postMessage(message, "*"),
		gate: createGestureGate({
			isFrameFocused: () => typeof window !== "undefined" && window.document.hasFocus() && window.document.activeElement === frameRef.current,
			hasRecentActivation,
		}),
		canShare: () => !latest.current.disabled && Boolean(latest.current.onShare),
		onReady: () => dispatch({ type: "ready" }),
		onHeight: (height) => setContentHeight(height),
		onState: (state) => {
			pendingStateRef.current = state;
			window.clearTimeout(saveTimerRef.current);
			saveTimerRef.current = window.setTimeout(() => host.reportStateSaved(flushState()), 400);
		},
		onShare: (result) => {
			const delivered = latest.current.onShare?.(result) ?? false;
			setNotice(delivered ? "Sent to your tutor." : "This result could not be sent to your tutor.");
			return delivered;
		},
		onOpenLink: (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
		onEscape: () => setFullscreen(false),
		onError: (message) => dispatch({ type: "error", message }),
	}), [built.channel, flushState]);

	const contextSync = useMemo(() => createContextSync(() => readInteractivePageContext(browserThemeSource()), (context) => host.pushContext(context)), [host]);

	useEffect(() => {
		const listener = (event: MessageEvent) => { host.handleMessage(event); };
		window.addEventListener("message", listener);
		return () => window.removeEventListener("message", listener);
	}, [host]);

	useEffect(() => watchAppContext(() => contextSync.sync()), [contextSync]);
	useEffect(() => { if (runtime.status === "ready") contextSync.sync(true); }, [runtime.status, contextSync]);

	useEffect(() => {
		if (!src || runtime.status !== "loading") return;
		const timer = window.setTimeout(() => dispatch({ type: "timeout" }), INTERACTIVE_PAGE_LIMITS.readyTimeoutMs);
		return () => window.clearTimeout(timer);
	}, [src, runtime.status]);

	useEffect(() => () => { flushState(); }, [flushState]);

	useEffect(() => {
		if (!fullscreen) return;
		// The section stays where it is in the DOM (moving it would reload the frame),
		// so everything around it is made inert instead: focus cannot leave the page.
		const restore = rootRef.current ? isolateForModal(rootRef.current) : () => {};
		const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFullscreen(false); };
		window.document.addEventListener("keydown", onKey);
		const overflow = window.document.body.style.overflow;
		window.document.body.style.overflow = "hidden";
		// Start on the exit control, so leaving is one key press away.
		fullscreenToggleRef.current?.focus();
		return () => {
			window.document.removeEventListener("keydown", onKey);
			window.document.body.style.overflow = overflow;
			restore();
			// Back to the control that opened full screen.
			fullscreenToggleRef.current?.focus();
		};
	}, [fullscreen]);

	const reload = () => {
		flushState();
		loadsRef.current = 0;
		setNotice("");
		dispatch({ type: "reload" });
	};

	const status: InteractivePageStatus = built.result.ok ? runtime.status : rejectionStatus(built.result);
	const message = built.result.ok ? runtime.message : built.result.message;
	const frameMounted = src !== null && (status === "loading" || status === "ready");
	const frameHeight = Math.min(INTERACTIVE_PAGE_LIMITS.maxInlineHeight, Math.max(INTERACTIVE_PAGE_LIMITS.minHeight, Math.ceil(contentHeight)));

	return (
		<section ref={rootRef} role={fullscreen ? "dialog" : undefined} aria-modal={fullscreen ? true : undefined} aria-labelledby={titleId} className={cx(rootClass, fullscreen && fullscreenClass, className)} data-interactive-page={pageId}>
			<header className={headerClass}>
				<span id={titleId} className={titleClass}>{title}</span>
				<span className={css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
					{status === "ready" ? <button ref={fullscreenToggleRef} type="button" className={controlClass} aria-pressed={fullscreen} onClick={() => setFullscreen((value) => !value)}>
						{fullscreen ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
						{fullscreen ? "Exit full screen" : "Open full screen"}
					</button> : null}
					{status === "ready" ? <button type="button" className={controlClass} onClick={reload}><RotateCcw size={14} aria-hidden="true" />Reload</button> : null}
				</span>
			</header>
			<span id={descriptionId} className={srOnlyClass}>{description}</span>
			{status !== "ready" ? <InteractivePageFallback status={status} title={title} description={description} message={message} onReload={reload} /> : null}
			{frameMounted ? (
				<div className={cx(frameWrapClass, status === "loading" && loadingFrameClass)}>
					<iframe
						key={src}
						ref={frameRef}
						src={src}
						title={title}
						aria-describedby={descriptionId}
						sandbox="allow-scripts"
						referrerPolicy="no-referrer"
						allow="camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; clipboard-read 'none'; payment 'none'; usb 'none'; serial 'none'; bluetooth 'none'"
						tabIndex={status === "loading" ? -1 : 0}
						aria-hidden={status === "loading" ? true : undefined}
						onLoad={() => {
							loadsRef.current += 1;
							// The first load is our document; any later one is the page navigating itself.
							if (loadsRef.current > 1) dispatch({ type: "navigated" });
						}}
						className={frameClass}
						style={fullscreen ? undefined : { height: frameHeight }}
					/>
				</div>
			) : null}
			<p aria-live="polite" className={noticeClass}>
				{saveFailed ? "Your progress on this page could not be saved in this browser. Keep the tab open or share your result before leaving." : notice}
				{disabled && status === "ready" && !saveFailed && !notice ? "This page is from an earlier turn; results can no longer be sent." : null}
			</p>
		</section>
	);
}

const focusRing = { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" };

const rootClass = css({ display: "grid", gap: "0.5rem", minWidth: 0, width: "100%", maxWidth: "100%" });
const fullscreenClass = css({
	position: "fixed",
	inset: 0,
	zIndex: 60,
	gridTemplateRows: "auto 1fr auto",
	padding: { base: "0.75rem", md: "1.25rem" },
	background: "var(--background)",
	overflow: "auto",
});
const headerClass = css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", minWidth: 0 });
const titleClass = css({ fontSize: "0.875rem", fontWeight: 650, color: "var(--foreground)", minWidth: 0, overflowWrap: "anywhere" });
const frameWrapClass = css({ position: "relative", minWidth: 0, minHeight: 0, height: "100%" });
const loadingFrameClass = css({ position: "absolute", insetInline: 0, top: 0, opacity: 0, pointerEvents: "none" });
const frameClass = css({ display: "block", width: "100%", height: "100%", minHeight: "80px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--background)" });
const controlClass = css({
	display: "inline-flex",
	alignItems: "center",
	gap: "0.375rem",
	minHeight: "2.75rem",
	paddingInline: "0.75rem",
	border: "1.5px solid var(--line)",
	borderRadius: "{radii.keating}",
	transitionProperty: "background-color, color, border-color",
	transitionDuration: "{durations.fast}",
	transitionTimingFunction: "{easings.standard}",
	_active: { borderColor: "var(--ink)" },
	background: "var(--card)",
	color: "var(--foreground)",
	fontSize: "0.8125rem",
	fontWeight: 600,
	cursor: "pointer",
	_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
	_focusVisible: focusRing,
});
const fallbackClass = css({ display: "grid", gap: "0.5rem", justifyItems: "start", padding: "0.875rem", border: "1px dashed var(--border)", borderRadius: "var(--radius)", background: "var(--card)", color: "var(--foreground)", fontSize: "0.8125rem" });
const fallbackHeadlineClass = css({ display: "flex", gap: "0.5rem", alignItems: "flex-start", margin: 0, fontWeight: 600 });
const fallbackDescriptionClass = css({ margin: 0, color: "var(--muted-foreground)", overflowWrap: "anywhere" });
const noticeClass = css({ margin: 0, minHeight: "1rem", fontSize: "0.75rem", color: "var(--muted-foreground)", _empty: { display: "none" } });
const srOnlyClass = css({ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", borderWidth: 0 });
