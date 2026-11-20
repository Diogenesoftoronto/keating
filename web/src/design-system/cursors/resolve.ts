/**
 * Decides what the pixel does over an element. The answer is read from the cursor the stylesheet already
 * resolved for it, so the pixel and the cursor image can never disagree, and new screens need no wiring.
 *
 * Optional hints on an element or an ancestor:
 *   data-cursor="frame | line | bar | tag | hide | rest"   force a pixel shape
 *   data-cursor-tag="pick me up"                            words for the label
 *   data-cursor-tag-held="let go to drop"                   words while the button is down
 */
export type PixelMode = "rest" | "frame" | "line" | "bar" | "tag" | "hide";
export interface PixelTarget {
	mode: PixelMode;
	/** The element the pixel snaps to (frame, line, bar). */
	el?: Element;
	tag?: string;
	warn?: boolean;
	spin?: boolean;
	/** Bars lie along a panel edge: upright for a column edge, flat for a row edge. */
	flat?: boolean;
}
type StyleOf = (el: Element) => { cursor: string; display: string };

const MODES = new Set<PixelMode>(["rest", "frame", "line", "bar", "tag", "hide"]);
const PRESSABLE =
	'a[href], button, summary, label, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemradio"], ' +
	'[role="menuitemcheckbox"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [role="treeitem"]';
/** A frame around most of the window is noise, not a hint. */
const FRAME_LIMIT = { width: 0.8, height: 0.6 };

/** The system cursor a computed `cursor` value ends in: `url(…) 12 3, pointer` gives `pointer`. */
export function cursorKeyword(value: string): string {
	const last = value.slice(value.lastIndexOf(",") + 1).trim().toLowerCase();
	return /^[a-z-]+$/.test(last) ? last : "auto";
}

function hint(el: Element, held: boolean): string | undefined {
	const owner = el.closest("[data-cursor-tag]");
	if (!owner) return undefined;
	return (held && owner.getAttribute("data-cursor-tag-held")) || owner.getAttribute("data-cursor-tag") || undefined;
}
function pressRoot(el: Element, styleOf: StyleOf): Element {
	const named = el.closest(PRESSABLE);
	if (named) return named;
	let root = el;
	for (let i = 0; i < 8 && root.parentElement; i++) {
		if (cursorKeyword(styleOf(root.parentElement).cursor) !== "pointer") break;
		root = root.parentElement;
	}
	return root;
}
function tooLarge(el: Element, viewport: { width: number; height: number }): boolean {
	const r = el.getBoundingClientRect();
	return r.width > viewport.width * FRAME_LIMIT.width || r.height > viewport.height * FRAME_LIMIT.height;
}
function tagOrRest(el: Element, held: boolean, extra?: Partial<PixelTarget>): PixelTarget {
	const tag = hint(el, held);
	return tag ? { mode: "tag", tag, ...extra } : { mode: "rest", ...extra };
}

export function resolvePixel(
	el: Element,
	options: { styleOf: StyleOf; viewport: { width: number; height: number }; held?: boolean; busy?: boolean },
): PixelTarget {
	const { styleOf, viewport, held = false, busy = false } = options;
	const forced = el.closest("[data-cursor]");
	const mode = forced?.getAttribute("data-cursor") as PixelMode | null;
	if (forced && mode && MODES.has(mode)) {
		if (mode === "tag") return tagOrRest(el, held);
		return { mode, el: forced };
	}
	if (el instanceof HTMLInputElement && el.type === "range") {
		return { mode: "tag", tag: el.getAttribute("aria-valuetext") || el.value };
	}
	switch (cursorKeyword(styleOf(el).cursor)) {
		case "pointer": {
			const tag = hint(el, held);
			if (tag) return { mode: "tag", tag };
			const root = pressRoot(el, styleOf);
			if (tooLarge(root, viewport)) return { mode: "rest" };
			const inlineLink = root.tagName === "A" && styleOf(root).display === "inline";
			return { mode: inlineLink ? "line" : "frame", el: root };
		}
		case "text":
			return { mode: "hide" };
		case "not-allowed":
			return tagOrRest(el, held, { warn: true });
		case "col-resize":
			return { mode: "bar", el };
		case "row-resize":
			return { mode: "bar", el, flat: true };
		case "wait":
		case "progress":
			return { mode: "rest", spin: true };
		case "grab":
			return tagOrRest(el, held);
		case "grabbing":
			return tagOrRest(el, true);
		default:
			return tagOrRest(el, held, { spin: busy });
	}
}
