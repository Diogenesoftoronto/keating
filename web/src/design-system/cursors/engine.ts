/**
 * The pixel: one small element that follows the pointer on Motion springs and reshapes for what is under it.
 * Plain DOM, no React state: a pointer move must never cause a render.
 */
import { animate } from "motion";
import { motionAllowed } from "../motion";
import { cursorVariables } from "./drawings";
import { cursorBusy, cursorPreferenceForced, onCursorBusy } from "./preference";
import { resolvePixel, type PixelMode, type PixelTarget } from "./resolve";

const SPRINGS: Record<PixelMode, object> = {
	rest: { type: "spring", stiffness: 900, damping: 46, mass: 0.6 },
	frame: { type: "spring", stiffness: 520, damping: 30 },
	line: { type: "spring", stiffness: 520, damping: 32 },
	bar: { type: "spring", stiffness: 520, damping: 32 },
	tag: { type: "spring", stiffness: 800, damping: 44, mass: 0.6 },
	hide: { type: "spring", stiffness: 700, damping: 40 },
};
const IDLE_MS = 900;
const STYLE_ID = "keating-cursor-variables";
const ROOT = 'html[data-keating-cursors="on"]';

/**
 * Cursors only make sense with a pointer that hovers. `any-` so a laptop with a touch screen still counts.
 * The stored preference "always" skips the check, for browsers that misreport their pointer (headless ones do).
 */
export function cursorsSupported(): boolean {
	if (typeof window === "undefined" || typeof document === "undefined") return false;
	return cursorPreferenceForced() || !!window.matchMedia?.("(any-hover: hover) and (any-pointer: fine)").matches;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attrs: Record<string, string> = {}) {
	const node = document.createElement(tag);
	node.className = className;
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
	return node;
}
function topLayerRoot(node: Element): Element | null {
	for (let at: Element | null = node; at; at = at.parentElement) {
		try {
			if (at.matches("dialog:modal, :popover-open")) return at;
		} catch {
			return null;
		}
	}
	return null;
}

/** Switches Keating cursors on for this document. Returns the function that switches them off again. */
export function startKeatingCursors(): () => void {
	if (!cursorsSupported()) return () => {};
	const html = document.documentElement;

	const style = el("style", "", { id: STYLE_ID });
	style.textContent = `${ROOT}{${cursorVariables("paper")}}${ROOT}.dark{${cursorVariables("term")}}`;
	document.head.appendChild(style);
	html.setAttribute("data-keating-cursors", "on");

	const layer = el("div", "kc-layer", { "aria-hidden": "true", popover: "manual" });
	const px = el("div", "kc-px", { "data-mode": "rest" });
	const tag = el("span", "kc-tag");
	const meter = el("span", "kc-tag", { "data-meter": "" });
	px.append(el("i", "kc-fill"), ...["tl", "tr", "bl", "br"].map(c => el("i", "kc-c", { "data-c": c })), el("i", "kc-dot"), tag);
	layer.append(px, meter);
	document.body.appendChild(layer);
	const promote = () => {
		try {
			if (layer.matches(":popover-open")) layer.hidePopover();
			layer.showPopover();
		} catch {
			layer.setAttribute("data-plain", "");
		}
	};
	promote();

	const at = { x: 0, y: 0, held: false, inside: false, node: null as Element | null };
	let last = "", live = false, frame = 0, idle = 0, recheck = 0, top: Element | null = null;

	const measure = (text: string) => { meter.textContent = text; return meter.offsetWidth; };
	function place(target: PixelTarget) {
		const vw = window.innerWidth, vh = window.innerHeight;
		if (target.mode === "frame" && target.el) {
			const r = target.el.getBoundingClientRect(), pad = at.held ? 1 : 4;
			return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
		}
		if (target.mode === "line" && target.el) {
			const rects = target.el.getClientRects();
			let r = rects[0] ?? target.el.getBoundingClientRect();
			for (const candidate of rects) if (at.y >= candidate.top && at.y <= candidate.bottom) r = candidate;
			return { x: r.left, y: r.bottom - 2, w: r.width, h: 2 };
		}
		if (target.mode === "bar" && target.el) {
			const r = target.el.getBoundingClientRect();
			return target.flat
				? { x: r.left, y: r.top + r.height / 2 - 1.5, w: r.width, h: 3 }
				: { x: r.left + r.width / 2 - 1.5, y: r.top, w: 3, h: r.height };
		}
		if (target.mode === "tag") {
			const text = target.tag ?? "";
			if (tag.textContent !== text) tag.textContent = text;
			const w = measure(text) + 25;
			let x = at.x + 14, y = at.y + 20;
			if (x + w > vw - 4) x = at.x - 12 - w;
			if (y + 20 > vh - 4) y = at.y - 28;
			return { x, y, w, h: 20 };
		}
		if (target.mode === "hide") return { x: at.x + 1, y: at.y + 1, w: 0, h: 0 };
		return { x: at.x + 13, y: at.y + 17, w: 6, h: 6 };
	}
	function apply() {
		frame = 0;
		if (!at.inside || !at.node?.isConnected) {
			px.removeAttribute("data-live");
			live = false; last = "";
			return;
		}
		const target = resolvePixel(at.node, {
			styleOf: node => getComputedStyle(node),
			viewport: { width: window.innerWidth, height: window.innerHeight },
			held: at.held,
			busy: cursorBusy(),
		});
		const root = topLayerRoot(at.node);
		if (root !== top) { top = root; if (root) promote(); }
		const box = place(target);
		px.dataset.mode = target.mode;
		px.toggleAttribute("data-warn", !!target.warn);
		px.toggleAttribute("data-spin", !!target.spin);
		px.setAttribute("data-live", "");
		const key = [target.mode, box.x, box.y, box.w, box.h].map(v => typeof v === "number" ? Math.round(v) : v).join();
		if (key === last) return;
		last = key;
		animate(px, { x: box.x, y: box.y, width: box.w, height: box.h }, !live || !motionAllowed() ? { duration: 0 } : SPRINGS[target.mode]);
		live = true;
	}
	const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
	const refresh = () => { last = ""; schedule(); };
	/** After something changes under a still pointer (a press, a scroll, a menu closing), look again. */
	function look() {
		if (!at.inside) return;
		at.node = document.elementFromPoint(at.x, at.y);
		refresh();
	}
	function sparks() {
		if (!motionAllowed()) return;
		for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
			const spark = el("i", "kc-spark");
			layer.appendChild(spark);
			const turn = dx * dy < 0 ? 45 : -45;
			animate(spark, { x: [at.x + dx * 5, at.x + dx * 13], y: [at.y + dy * 5, at.y + dy * 13], rotate: [turn, turn], opacity: [1, 0] }, { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] });
			window.setTimeout(() => spark.remove(), 340);
		}
	}

	const onMove = (e: PointerEvent) => {
		if (e.pointerType === "touch") { at.inside = false; schedule(); return; }
		at.x = e.clientX; at.y = e.clientY; at.inside = true;
		at.node = e.target instanceof Element ? e.target : null;
		px.removeAttribute("data-idle");
		window.clearTimeout(idle);
		idle = window.setTimeout(() => px.setAttribute("data-idle", ""), IDLE_MS);
		schedule();
	};
	const onDown = (e: PointerEvent) => {
		if (e.pointerType === "touch" || e.button !== 0) return;
		at.held = true;
		if (at.inside) {
			sparks();
			if (px.dataset.mode === "rest" && motionAllowed()) animate(px, { scale: [0.4, 1] }, { type: "spring", stiffness: 600, damping: 14 });
		}
		refresh();
	};
	const onUp = () => {
		at.held = false;
		refresh();
		window.clearTimeout(recheck);
		recheck = window.setTimeout(look, 120);
	};
	const onLeave = () => { at.inside = false; schedule(); };
	const onOut = (e: MouseEvent) => { if (!e.relatedTarget) onLeave(); };
	const onScroll = () => look();
	const stopBusy = onCursorBusy(refresh);

	const passive = { passive: true, capture: true } as const;
	window.addEventListener("pointermove", onMove, passive);
	window.addEventListener("pointerdown", onDown, passive);
	window.addEventListener("pointerup", onUp, passive);
	window.addEventListener("pointercancel", onUp, passive);
	window.addEventListener("scroll", onScroll, passive);
	window.addEventListener("resize", onScroll, passive);
	window.addEventListener("blur", onLeave);
	document.addEventListener("mouseout", onOut, passive);

	return () => {
		window.removeEventListener("pointermove", onMove, passive);
		window.removeEventListener("pointerdown", onDown, passive);
		window.removeEventListener("pointerup", onUp, passive);
		window.removeEventListener("pointercancel", onUp, passive);
		window.removeEventListener("scroll", onScroll, passive);
		window.removeEventListener("resize", onScroll, passive);
		window.removeEventListener("blur", onLeave);
		document.removeEventListener("mouseout", onOut, passive);
		stopBusy();
		if (frame) cancelAnimationFrame(frame);
		window.clearTimeout(idle);
		window.clearTimeout(recheck);
		layer.remove();
		style.remove();
		html.removeAttribute("data-keating-cursors");
	};
}
