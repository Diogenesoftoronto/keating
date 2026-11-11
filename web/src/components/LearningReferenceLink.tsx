import { createContext, useContext, useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { css } from "../../styled-system/css";
import { findLearningReference, LEARNING_REFERENCES_CHANGED_EVENT, type LearningReference } from "../keating/learning-intelligence/references";

/** The conversation whose references a rendered reply may cite. */
export const LearningReferenceScope = createContext<string | undefined>(undefined);

const KIND_LABELS: Record<LearningReference["kind"], string> = {
	"answer-step": "Your reasoning",
	"learner-idea": "Your idea",
	"important-question": "A question from the lesson",
	"learning-constraint": "Something you said about your plans",
	memory: "Something you shared",
	"lesson-fact": "From an earlier explanation",
	"worked-example": "An earlier example",
	"assigned-task": "A task you were given",
};

const HIGHLIGHT = "keating-reference";

function subscribeReferences(listener: () => void) {
	window.addEventListener(LEARNING_REFERENCES_CHANGED_EVENT, listener);
	window.addEventListener("storage", listener);
	return () => {
		window.removeEventListener(LEARNING_REFERENCES_CHANGED_EVENT, listener);
		window.removeEventListener("storage", listener);
	};
}

function messageRow(reference: LearningReference, root: Pick<Document, "querySelectorAll">): HTMLElement | null {
	const rows = [...root.querySelectorAll<HTMLElement>("[data-learning-message-ids]")].filter((element) => {
		try {
			return element.dataset.learningSessionId === reference.anchor.sessionId
				&& (JSON.parse(element.dataset.learningMessageIds ?? "[]") as unknown[]).includes(reference.anchor.messageId);
		} catch {
			return false;
		}
	});
	// Never guess between repeated rows.
	return rows.length === 1 ? rows[0]! : null;
}

/** A Range over the quote as rendered, when markup has not split or reworded it. */
function quoteRange(row: HTMLElement, quote: string): Range | null {
	const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	let text = "";
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		nodes.push(node as Text);
		text += (node as Text).data;
	}
	const start = text.indexOf(quote);
	if (start < 0 || text.indexOf(quote, start + 1) >= 0) return null;
	const end = start + quote.length;
	const range = document.createRange();
	let offset = 0;
	for (const node of nodes) {
		const next = offset + node.data.length;
		if (start >= offset && start <= next) range.setStart(node, start - offset);
		if (end >= offset && end <= next) { range.setEnd(node, end - offset); return range; }
		offset = next;
	}
	return null;
}

type Highlights = { set(name: string, value: unknown): void; delete(name: string): void };
const highlights = (): Highlights | undefined => (globalThis.CSS as unknown as { highlights?: Highlights } | undefined)?.highlights;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

/** Scroll to the cited message and mark its exact words; false when it is not on screen. */
export function revealLearningReference(reference: LearningReference, root: Pick<Document, "querySelectorAll"> = document): boolean {
	const row = messageRow(reference, root);
	if (!row) return false;
	const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
	row.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
	row.focus({ preventScroll: true });
	const range = typeof document === "undefined" ? null : quoteRange(row, reference.anchor.quote);
	const registry = highlights();
	const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
	if (range && registry && Highlight) {
		registry.set(HIGHLIGHT, new Highlight(range));
		clearTimeout(clearTimer);
		clearTimer = setTimeout(() => registry.delete(HIGHLIGHT), 4_000);
	} else {
		row.dataset.referenceFlash = "true";
		setTimeout(() => { delete row.dataset.referenceFlash; }, 2_000);
	}
	return true;
}

const chip = css({
	display: "inline",
	padding: 0,
	border: 0,
	borderBottom: "1.5px solid var(--primary)",
	background: "color-mix(in srgb, var(--primary) 8%, transparent)",
	color: "inherit",
	font: "inherit",
	cursor: "pointer",
	_hover: { background: "color-mix(in srgb, var(--primary) 16%, transparent)" },
	_focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "1px" },
});
const unresolved = css({ borderBottom: "1.5px dotted var(--muted-foreground)" });
const card = css({
	position: "absolute",
	zIndex: 40,
	left: 0,
	top: "calc(100% + 0.375rem)",
	width: "min(22rem, 80vw)",
	display: "grid",
	gap: "0.375rem",
	padding: "0.625rem 0.75rem",
	border: "1px solid var(--border)",
	borderRadius: "0.5rem",
	background: "var(--background)",
	boxShadow: "0 6px 24px color-mix(in srgb, black 14%, transparent)",
	fontSize: "0.8125rem",
	lineHeight: 1.45,
	textAlign: "left",
	whiteSpace: "normal",
});
const kicker = css({ fontSize: "0.6875rem", fontWeight: 650, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted-foreground)" });
const quoteClass = css({ margin: 0, paddingLeft: "0.5rem", borderLeft: "2px solid var(--primary)", fontStyle: "italic" });
const hint = css({ fontSize: "0.75rem", color: "var(--muted-foreground)" });

export function LearningReferenceLink({ id, children }: { id: string; children: ReactNode }) {
	const sessionId = useContext(LearningReferenceScope);
	const tooltipId = useId();
	// Snapshot as a string: a fresh object per read would re-render forever.
	const snapshot = useSyncExternalStore(
		subscribeReferences,
		() => JSON.stringify(findLearningReference(sessionId, id)),
		() => JSON.stringify(findLearningReference(sessionId, id)),
	);
	const reference = useMemo(() => JSON.parse(snapshot) as LearningReference | null, [snapshot]);
	const [open, setOpen] = useState(false);
	const [missing, setMissing] = useState(false);
	useEffect(() => { setMissing(false); }, [reference]);

	// Like an ambiguous quote: say so rather than link somewhere wrong.
	if (!reference) return <span className={unresolved} title="This reference is no longer available.">{children}</span>;
	const quote = reference.anchor.quote.length > 320 ? `${reference.anchor.quote.slice(0, 319)}…` : reference.anchor.quote;
	return (
		<span className={css({ position: "relative", display: "inline" })} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
			<button
				type="button"
				className={chip}
				aria-describedby={open ? tooltipId : undefined}
				data-learning-reference={reference.id}
				onFocus={() => setOpen(true)}
				onBlur={() => setOpen(false)}
				onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
				onClick={() => setMissing(!revealLearningReference(reference))}
			>
				{children}
			</button>
			{open ? (
				<span role="tooltip" id={tooltipId} className={card}>
					<span className={kicker}>{KIND_LABELS[reference.kind]}</span>
					<span className={quoteClass}>“{quote}”</span>
					<span className={hint}>{missing ? "That message isn't shown here any more." : "Select to go to the original message."}</span>
				</span>
			) : null}
		</span>
	);
}
