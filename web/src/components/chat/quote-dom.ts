/**
 * DOM side of passage quotes: reading a selection inside a quote source,
 * mapping normalised text offsets back to DOM ranges, and revealing a quoted
 * passage. Any element with `data-quote-source-kind` and
 * `data-quote-source-id` is a source; descendants marked `data-quote-exclude`
 * (tool cards, reasoning) are not part of its text.
 */
import { scrollBehavior } from "../../lib/motion";
import {
	createPassageQuote,
	isQuoteSourceKind,
	resolveQuote,
	revealQuoteSourceDetail,
	MAX_QUOTE_CONTEXT,
	REVEAL_QUOTE_SOURCE_EVENT,
	type PassageQuote,
	type QuoteSource,
} from "../../keating/passage-quote";

export const QUOTE_SOURCE_SELECTOR = "[data-quote-source-kind][data-quote-source-id]";
const EXCLUDE_SELECTOR = "[data-quote-exclude]";
const BLOCK_SELECTOR = "p,li,h1,h2,h3,h4,h5,h6,div,pre,blockquote,td,th,tr,section,article,figure,figcaption,dt,dd,table";

export interface CapturedQuote {
	quote: PassageQuote;
	truncated: boolean;
	source: HTMLElement;
}

function elementOf(node: Node | null): Element | null {
	if (!node) return null;
	return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

export function quoteSourceElement(node: Node | null): HTMLElement | null {
	return (elementOf(node)?.closest(QUOTE_SOURCE_SELECTOR) as HTMLElement | null) ?? null;
}

export function quoteSourceFromElement(element: HTMLElement): QuoteSource | null {
	const kind = element.dataset.quoteSourceKind;
	const id = element.dataset.quoteSourceId;
	if (!isQuoteSourceKind(kind) || !id) return null;
	const revision = element.dataset.quoteSourceRevision;
	const parsedRevision = revision === undefined || revision === "" ? undefined : Number(revision);
	return {
		kind,
		id,
		...(parsedRevision !== undefined && Number.isSafeInteger(parsedRevision) && parsedRevision >= 0 ? { revision: parsedRevision } : {}),
		...(element.dataset.quoteSourceLabel ? { label: element.dataset.quoteSourceLabel } : {}),
	};
}

interface TextMap {
	text: string;
	/** For each character of `text`, the DOM point it came from (null for inserted breaks). */
	points: ({ node: Text; offset: number } | null)[];
}

function sourceTextNodes(source: HTMLElement): Text[] {
	const nodes: Text[] = [];
	const walker = source.ownerDocument.createTreeWalker(source, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const parent = node.parentElement;
			if (!parent) return NodeFilter.FILTER_REJECT;
			if (parent.closest(EXCLUDE_SELECTOR) && source.contains(parent.closest(EXCLUDE_SELECTOR))) return NodeFilter.FILTER_REJECT;
			if (parent.closest("script,style,button,[aria-hidden='true']")) return NodeFilter.FILTER_REJECT;
			return NodeFilter.FILTER_ACCEPT;
		},
	});
	for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
	return nodes;
}

/**
 * The source's visible text, whitespace-normalised exactly as
 * `normalizeQuoteWhitespace` would, with a break between block elements.
 * When `range` is given, also returns its normalised [start, end).
 */
function mapSourceText(source: HTMLElement, range?: Range): TextMap & { start?: number; end?: number } {
	let text = "";
	const points: TextMap["points"] = [];
	let pendingSpace = false;
	let previousBlock: Element | null = null;
	let start: number | undefined;
	let end: number | undefined;
	for (const node of sourceTextNodes(source)) {
		const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
		if (previousBlock && block !== previousBlock) pendingSpace = true;
		previousBlock = block;
		const data = node.data;
		let selectedFrom = data.length;
		let selectedTo = 0;
		if (range) {
			const isStart = range.startContainer === node;
			const isEnd = range.endContainer === node;
			// -1: node starts before the range, 0: inside it, 1: after it.
			const position = range.comparePoint(node, 0);
			selectedFrom = isStart ? range.startOffset : position === 0 ? 0 : data.length;
			selectedTo = isEnd ? range.endOffset : isStart || position === 0 ? data.length : 0;
		}
		for (let offset = 0; offset < data.length; offset++) {
			const character = data[offset]!;
			if (/\s/.test(character)) {
				pendingSpace = true;
				continue;
			}
			if (pendingSpace && text.length) {
				text += " ";
				points.push(null);
			}
			pendingSpace = false;
			if (range && offset >= selectedFrom && offset < selectedTo) {
				if (start === undefined) start = text.length;
				end = text.length + 1;
			}
			text += character;
			points.push({ node, offset });
		}
	}
	return { text, points, start, end };
}

export function sourceText(source: HTMLElement): string {
	return mapSourceText(source).text;
}

/**
 * Reads the current selection. Returns null when it is empty, lies outside
 * any source, or spans two sources.
 */
export function captureSelectionQuote(selection: Selection | null): CapturedQuote | null {
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
	const range = selection.getRangeAt(0);
	const startSource = quoteSourceElement(range.startContainer);
	const endSource = quoteSourceElement(range.endContainer);
	if (!startSource || startSource !== endSource) return null;
	// A selection inside an editable field is the learner's own text.
	if (elementOf(range.commonAncestorContainer)?.closest("input,textarea,[contenteditable='true']")) return null;
	const source = quoteSourceFromElement(startSource);
	if (!source) return null;
	const mapped = mapSourceText(startSource, range);
	if (mapped.start === undefined || mapped.end === undefined) return null;
	const created = createPassageQuote({
		source,
		exact: mapped.text.slice(mapped.start, mapped.end),
		prefix: mapped.text.slice(Math.max(0, mapped.start - MAX_QUOTE_CONTEXT - 1), mapped.start),
		suffix: mapped.text.slice(mapped.end, mapped.end + MAX_QUOTE_CONTEXT + 1),
	});
	return created ? { ...created, source: startSource } : null;
}

/** Quotes a whole source element (bounded). */
export function captureWholeSource(element: HTMLElement): CapturedQuote | null {
	const source = quoteSourceFromElement(element);
	if (!source) return null;
	const created = createPassageQuote({ source, exact: sourceText(element) });
	return created ? { ...created, source: element } : null;
}

export function findQuoteSourceElements(kind: string, id: string, root: ParentNode = document): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(QUOTE_SOURCE_SELECTOR)].filter(
		(element) => element.dataset.quoteSourceKind === kind && element.dataset.quoteSourceId === id,
	);
}

export type QuoteSourceStatus = "found" | "changed" | "absent";

/** Whether the quoted passage is still where it was quoted from, in the rendered DOM. */
export function quoteSourceStatus(quote: PassageQuote, root: ParentNode = document): { status: QuoteSourceStatus; element?: HTMLElement; start?: number; end?: number } {
	const elements = findQuoteSourceElements(quote.source.kind, quote.source.id, root);
	if (elements.length !== 1) return { status: elements.length ? "changed" : "absent" };
	const element = elements[0]!;
	const current = quoteSourceFromElement(element);
	if (quote.source.revision !== undefined && current?.revision !== undefined && current.revision !== quote.source.revision) {
		return { status: "changed", element };
	}
	const resolved = resolveQuote(quote, sourceText(element));
	return resolved.status === "found"
		? { status: "found", element, start: resolved.start, end: resolved.end }
		: { status: "changed", element };
}

const HIGHLIGHT_NAME = "keating-quote-reveal";
let styleInstalled = false;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

function installRevealStyle(doc: Document) {
	if (styleInstalled || !doc.head) return;
	styleInstalled = true;
	const style = doc.createElement("style");
	style.setAttribute("data-keating-quote-reveal", "");
	// Underline as well as colour, so the highlight is not colour-only.
	style.textContent = `::highlight(${HIGHLIGHT_NAME}){background-color:color-mix(in srgb, var(--primary) 28%, transparent);text-decoration:underline 2px;text-underline-offset:3px;}
[data-quote-revealed]{outline:2px dashed var(--primary);outline-offset:4px;border-radius:4px;}
@media (prefers-reduced-motion: no-preference){[data-quote-revealed]{transition:outline-color .2s ease;}}`;
	doc.head.appendChild(style);
}

function rangeFor(element: HTMLElement, start: number, end: number): Range | null {
	const { points } = mapSourceText(element);
	let first = start;
	while (first < end && !points[first]) first++;
	let last = end - 1;
	while (last >= first && !points[last]) last--;
	const from = points[first];
	const to = points[last];
	if (!from || !to) return null;
	const range = element.ownerDocument.createRange();
	range.setStart(from.node, from.offset);
	range.setEnd(to.node, to.offset + 1);
	return range;
}

/** Scrolls to and briefly marks the passage. Returns false when it cannot. */
export function highlightPassage(element: HTMLElement, start: number, end: number): boolean {
	const doc = element.ownerDocument;
	installRevealStyle(doc);
	const range = rangeFor(element, start, end);
	const target = (range?.startContainer.parentElement ?? element) as HTMLElement;
	target.scrollIntoView?.({ block: "center", behavior: scrollBehavior(doc) });
	for (const previous of doc.querySelectorAll("[data-quote-revealed]")) previous.removeAttribute("data-quote-revealed");
	element.setAttribute("data-quote-revealed", "");
	const highlights = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
	const HighlightCtor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
	if (range && highlights && HighlightCtor) highlights.set(HIGHLIGHT_NAME, new HighlightCtor(range));
	if (clearTimer) clearTimeout(clearTimer);
	clearTimer = setTimeout(() => {
		element.removeAttribute("data-quote-revealed");
		highlights?.delete(HIGHLIGHT_NAME);
	}, 2_500);
	return true;
}

export type RevealOutcome = "revealed" | "requested" | "changed";

/**
 * "Go to source". Messages are revealed in place. Other kinds are revealed
 * by whichever panel owns them, via `keating:reveal-quote-source`; when that
 * source is on screen and has changed, nothing is dispatched.
 */
export function revealQuoteSource(quote: PassageQuote, root: ParentNode = document): RevealOutcome {
	const status = quoteSourceStatus(quote, root);
	if (status.status === "changed") return "changed";
	if (status.status === "found" && status.element) highlightPassage(status.element, status.start!, status.end!);
	if (quote.source.kind === "message") return status.status === "found" ? "revealed" : "changed";
	window.dispatchEvent(new CustomEvent(REVEAL_QUOTE_SOURCE_EVENT, { detail: revealQuoteSourceDetail(quote) }));
	return status.status === "found" ? "revealed" : "requested";
}
