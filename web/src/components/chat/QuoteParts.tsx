/**
 * Passage quotes in the tutor chat: the floating "Quote" control for a
 * selection, the per-message Quote action, the composer preview, and the
 * quotation shown in a sent learner turn.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useAui, useAuiState } from "@assistant-ui/react";
import type { AppendMessage } from "@assistant-ui/react";
import { ArrowUpRight, Quote, X } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import {
	MAX_QUOTE_LENGTH,
	MAX_QUOTES_PER_TURN,
	parseQuotedTurn,
	passageQuoteDisplayText,
	quoteSourceLabel,
	truncateQuoteForPreview,
	type PassageQuote,
	type QuotedLearnerTurn,
} from "../../keating/passage-quote";
import {
	addDraftQuote,
	getDraftQuotes,
	removeDraftQuote,
	useDraftQuotes,
	type AddDraftQuoteResult,
} from "../../keating/passage-quote-draft";
import { appendMessageWithQuotes } from "./user-message";
import { captureSelectionQuote, captureWholeSource, quoteSourceStatus, revealQuoteSource, QUOTE_SOURCE_SELECTOR, type CapturedQuote } from "./quote-dom";
import { forgetRecentSelection, recentSelectionIn, usePassageSelection } from "./usePassageSelection";

const srOnly = css({
	position: "absolute",
	width: "1px",
	height: "1px",
	padding: 0,
	margin: "-1px",
	overflow: "hidden",
	clip: "rect(0, 0, 0, 0)",
	whiteSpace: "nowrap",
	borderWidth: 0,
});

const focusRing = {
	outline: "2px solid var(--ring, var(--primary))",
	outlineOffset: "2px",
};

const smallButton = css({
	display: "inline-flex",
	alignItems: "center",
	gap: "0.25rem",
	minHeight: "2.75rem",
	borderRadius: "{radii.keating}",
	border: "1.5px solid var(--line)",
	backgroundColor: "var(--background)",
	paddingInline: "0.5rem",
	fontSize: "0.75rem",
	color: "var(--foreground)",
	cursor: "pointer",
	_hover: { backgroundColor: "var(--accent)" },
	_focusVisible: focusRing,
});

const quietIconButton = css({
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	flexShrink: 0,
	width: "2.75rem",
	height: "2.75rem",
	borderRadius: "{radii.keating}",
	color: "var(--muted-foreground)",
	cursor: "pointer",
	_hover: { backgroundColor: "var(--accent)", color: "var(--foreground)" },
	_focusVisible: focusRing,
});

function addResultMessage(result: AddDraftQuoteResult, truncated: boolean): string {
	if (result === "full") return `You can attach up to ${MAX_QUOTES_PER_TURN} quotes to one message. Remove one to add another.`;
	if (result === "duplicate") return "That passage is already quoted in your message.";
	return truncated
		? `Quote added to your message. It was shortened to the first ${MAX_QUOTE_LENGTH.toLocaleString("en")} characters.`
		: "Quote added to your message.";
}

function focusComposer() {
	const input = document.querySelector<HTMLTextAreaElement>(".composer-root textarea");
	input?.focus({ preventScroll: true });
}

function attach(sessionId: string | undefined, captured: CapturedQuote): string {
	const result = addDraftQuote(sessionId, captured.quote, captured.truncated);
	if (result === "added") {
		window.getSelection()?.removeAllRanges();
		forgetRecentSelection();
	}
	return addResultMessage(result, captured.truncated);
}

const keepSelection = (event: ReactMouseEvent | React.PointerEvent) => event.preventDefault();

/**
 * Floating "Quote" control near a selection inside a quote source. It sits
 * below the selection (phones show their own selection menu above it), is
 * clamped inside a 16px gutter, never takes focus by itself, and responds to
 * Alt+Q for learners who select with the keyboard.
 */
export function QuoteSelectionControl({ sessionId }: { sessionId?: string }) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const [announcement, setAnnouncement] = useState("");
	const { selection, clear } = usePassageSelection(() => document.activeElement === buttonRef.current);

	const quoteSelection = useCallback(() => {
		const captured = captureSelectionQuote(window.getSelection()) ?? selection;
		if (!captured) return;
		setAnnouncement(attach(sessionId, captured));
		clear();
		focusComposer();
	}, [clear, selection, sessionId]);

	useEffect(() => {
		if (!selection) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (!event.altKey || event.ctrlKey || event.metaKey || event.code !== "KeyQ") return;
			const target = event.target as HTMLElement | null;
			if (target?.closest("input,textarea,[contenteditable='true']")) return;
			event.preventDefault();
			quoteSelection();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [quoteSelection, selection]);

	const status = <span role="status" aria-live="polite" className={srOnly}>{announcement}</span>;
	if (!selection || typeof document === "undefined") return status;

	const viewportWidth = window.innerWidth || 360;
	const viewportHeight = window.innerHeight || 640;
	const width = selection.truncated ? 168 : 84;
	const height = 36;
	const gutter = 16;
	const below = selection.rect.bottom + 8;
	const top = below + height <= viewportHeight - gutter ? below : Math.max(gutter, selection.rect.top - height - 8);
	const centre = selection.rect.left + selection.rect.width / 2;
	const left = Math.min(Math.max(gutter, centre - width / 2), Math.max(gutter, viewportWidth - gutter - width));

	return (
		<>
			{status}
			{createPortal(
				<button
					ref={buttonRef}
					type="button"
					data-quote-selection-control=""
					aria-keyshortcuts="Alt+Q"
					title={selection.truncated ? `Only the first ${MAX_QUOTE_LENGTH.toLocaleString("en")} characters will be quoted (Alt+Q)` : "Quote this passage in your message (Alt+Q)"}
					onPointerDown={keepSelection}
					onMouseDown={keepSelection}
					onClick={quoteSelection}
					style={{ top, left }}
					className={css({
						position: "fixed",
						zIndex: 60,
						display: "inline-flex",
						alignItems: "center",
						gap: "0.375rem",
						height: "2.75rem",
						maxWidth: "calc(100vw - 2rem)",
						borderRadius: "999px",
						border: "1px solid var(--border)",
						backgroundColor: "var(--foreground)",
						color: "var(--background)",
						paddingInline: "0.75rem",
						fontSize: "0.8125rem",
						fontWeight: 600,
						boxShadow: "var(--shadow-card)",
						cursor: "pointer",
						_focusVisible: focusRing,
					})}
				>
					<Quote size={14} aria-hidden="true" />
					{selection.truncated ? `Quote first ${MAX_QUOTE_LENGTH.toLocaleString("en")} chars` : "Quote"}
				</button>,
				document.body,
			)}
		</>
	);
}

/**
 * Per-message Quote action: quotes the current selection when it lies in
 * this message, otherwise the whole message (bounded).
 */
export function QuoteMessageButton({ sessionId, className }: { sessionId?: string; className?: string }) {
	const ref = useRef<HTMLButtonElement>(null);
	const [announcement, setAnnouncement] = useState("");
	const onClick = () => {
		const root = ref.current?.closest("[data-learning-message-ids], [data-quote-message-root]") ?? ref.current?.parentElement?.parentElement;
		const source = root?.querySelector<HTMLElement>(QUOTE_SOURCE_SELECTOR);
		if (!source) return;
		const live = captureSelectionQuote(window.getSelection());
		const captured = (live && live.source === source ? live : null) ?? recentSelectionIn(source) ?? captureWholeSource(source);
		if (!captured) return;
		setAnnouncement(attach(sessionId, captured));
		focusComposer();
	};
	return (
		<>
			<button
				ref={ref}
				type="button"
				className={cx(quietIconButton, className)}
				aria-label="Quote in your message"
				title="Quote the selected passage, or this whole reply, in your message"
				onPointerDown={keepSelection}
				onMouseDown={keepSelection}
				onClick={onClick}
			>
				<Quote size={13} aria-hidden="true" />
			</button>
			<span role="status" aria-live="polite" className={srOnly}>{announcement}</span>
		</>
	);
}

/** Pending quotes above the composer input. */
export function QuoteComposerPreview({ sessionId }: { sessionId?: string }) {
	const quotes = useDraftQuotes(sessionId);
	const aui = useAui();
	const composerEmpty = useAuiState(({ composer }) => !composer.text.trim());
	if (!quotes.length) return null;
	const askOnly = () => {
		aui.thread().append({ role: "user", content: [{ type: "text", text: "" }] });
	};
	return (
		<div
			data-quote-composer-preview=""
			className={css({ display: "grid", gap: "0.375rem" })}
			aria-label="Quoted passages for your message"
			role="group"
		>
			<ul className={css({ display: "grid", gap: "0.375rem", listStyle: "none", margin: 0, padding: 0 })}>
				{quotes.map((quote) => (
					<li
						key={quote.draftId}
						className={css({
							display: "flex",
							alignItems: "flex-start",
							gap: "0.5rem",
							minWidth: 0,
							borderLeft: "3px solid var(--primary)",
							borderRadius: "0.25rem",
							backgroundColor: "color-mix(in srgb, var(--muted, var(--accent)) 60%, transparent)",
							paddingBlock: "0.375rem",
							paddingInlineStart: "0.5rem",
							paddingInlineEnd: "0.25rem",
						})}
					>
						<Quote size={13} aria-hidden="true" className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--muted-foreground)" })} />
						<div className={css({ minWidth: 0, flex: 1, fontSize: "0.75rem", lineHeight: "1.125rem" })}>
							<div className={css({ fontWeight: 600, color: "var(--foreground)" })}>Quoting {quoteSourceLabel(quote.source)}</div>
							<div className={css({ color: "var(--foreground)", overflowWrap: "anywhere" })}>“{truncateQuoteForPreview(quote.exact)}”</div>
							{quote.truncated ? (
								<div className={css({ color: "var(--muted-foreground)" })}>Shortened to the first {MAX_QUOTE_LENGTH.toLocaleString("en")} characters.</div>
							) : null}
						</div>
						<button
							type="button"
							className={quietIconButton}
							aria-label={`Remove quote from ${quoteSourceLabel(quote.source)}: ${truncateQuoteForPreview(quote.exact, 40)}`}
							onClick={() => {
								removeDraftQuote(sessionId, quote.draftId);
								focusComposer();
							}}
						>
							<X size={13} aria-hidden="true" />
						</button>
					</li>
				))}
			</ul>
			<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>
				{quotes.length >= MAX_QUOTES_PER_TURN ? <span>Up to {MAX_QUOTES_PER_TURN} quotes per message.</span> : null}
				{composerEmpty ? (
					<button type="button" className={smallButton} onClick={askOnly}>
						Ask about {quotes.length === 1 ? "this passage" : "these passages"}
					</button>
				) : null}
			</div>
		</div>
	);
}

/**
 * Sends a composer message with the pending quotes of `sessionId` folded in.
 * The quotes leave the composer once the turn is admitted to the transcript;
 * a refused send keeps them.
 */
export async function sendWithDraftQuotes(
	sessionId: string | undefined,
	message: AppendMessage,
	send: (message: AppendMessage, onAdmitted?: () => void) => Promise<boolean>,
): Promise<boolean> {
	const quotes = getDraftQuotes(sessionId);
	if (!quotes.length) return send(message);
	const ids = quotes.map((quote) => quote.draftId);
	const release = () => {
		for (const id of ids) removeDraftQuote(sessionId, id);
	};
	const sent = await send(appendMessageWithQuotes(message, quotes), release);
	if (sent) release();
	return sent;
}

type SourceState = "unknown" | "found" | "changed";

function QuotedPassage({ quote }: { quote: PassageQuote }) {
	const [state, setState] = useState<SourceState>("unknown");
	const [notice, setNotice] = useState("");
	useEffect(() => {
		if (quote.source.kind !== "message") return;
		// Wait one frame so sibling messages are in the DOM after a reload.
		const check = () => {
			const status = quoteSourceStatus(quote);
			setState(status.status === "found" ? "found" : status.status === "changed" ? "changed" : "unknown");
		};
		const handle = typeof requestAnimationFrame === "function" ? requestAnimationFrame(check) : setTimeout(check, 0);
		return () => {
			if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle as number);
			else clearTimeout(handle as ReturnType<typeof setTimeout>);
		};
	}, [quote]);
	const label = quoteSourceLabel(quote.source);
	const goToSource = () => {
		const outcome = revealQuoteSource(quote);
		if (outcome === "changed") {
			setState("changed");
			setNotice("");
		} else {
			setNotice(outcome === "revealed" ? "Showing the quoted passage." : `Opening ${label}.`);
		}
	};
	return (
		<figure
			data-quoted-passage=""
			className={css({
				margin: 0,
				display: "grid",
				gap: "0.25rem",
				borderLeft: "3px solid var(--primary)",
				paddingInlineStart: "0.625rem",
				paddingBlock: "0.125rem",
				textAlign: "start",
			})}
		>
			<blockquote className={css({ margin: 0, fontStyle: "italic", color: "var(--foreground)", overflowWrap: "anywhere", whiteSpace: "normal" })}>
				{quote.exact}
			</blockquote>
			<figcaption className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", fontSize: "0.6875rem", color: "var(--muted-foreground)", fontStyle: "normal" })}>
				<span>From {label}</span>
				{state === "changed" ? (
					<span role="note" data-quote-outdated="" className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", fontWeight: 600, color: "var(--foreground)" })}>
						<span aria-hidden="true">⚠</span> This passage has changed since you quoted it
					</span>
				) : (
					<button type="button" className={smallButton} onClick={goToSource} aria-label={`Go to source: ${label}`}>
						<ArrowUpRight size={12} aria-hidden="true" /> Go to source
					</button>
				)}
				<span role="status" aria-live="polite" className={srOnly}>{notice}</span>
			</figcaption>
		</figure>
	);
}

export function QuotedTurnView({ turn }: { turn: QuotedLearnerTurn }) {
	return (
		<div data-quoted-turn="" className={css({ display: "grid", gap: "0.5rem" })}>
			{turn.quotes.map((quote, index) => <QuotedPassage key={`${quote.source.kind}:${quote.source.id}:${index}`} quote={quote} />)}
			{turn.question ? (
				<div className={css({ whiteSpace: "pre-wrap" })}>{turn.question}</div>
			) : (
				<div className={css({ color: "var(--muted-foreground)" })}>Asked about {turn.quotes.length === 1 ? "this passage" : "these passages"}.</div>
			)}
		</div>
	);
}

/**
 * Learner text that carries (or once carried) quote anchors. Returns null for
 * ordinary text so callers keep their usual rendering.
 */
export function learnerQuotePresentation(text: string): { turn: QuotedLearnerTurn } | { text: string } | null {
	if (!text.includes("<!-- keating-quotes")) return null;
	const turn = parseQuotedTurn(text);
	return turn ? { turn } : { text: passageQuoteDisplayText(text) };
}

export function LearnerQuotedText({ text }: { text: string }) {
	const presentation = learnerQuotePresentation(text);
	if (!presentation) return null;
	if ("turn" in presentation) return <QuotedTurnView turn={presentation.turn} />;
	return <div className={css({ whiteSpace: "pre-wrap" })}>{presentation.text}</div>;
}
