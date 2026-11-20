/**
 * The pixel: one small element that follows the pointer on Motion springs and reshapes for what is under it.
 * Plain DOM, no React state: a pointer move must never cause a render.
 */
import { animate } from "motion";
import { motionAllowed } from "../motion";
import { cursorVariables } from "./drawings";
import { cursorBusy, cursorPreferenceForced, onCursorBusy } from "./preference";
import { resolvePixel, type PixelMode, type PixelTarget } from "./resolve";

/** Same feel as the Motion springs this used to start on every move; now one integrator retargets instead. */
const SPRINGS: Record<PixelMode, { stiffness: number; damping: number; mass: number }> = {
	rest: { stiffness: 900, damping: 46, mass: 0.6 },
	frame: { stiffness: 520, damping: 30, mass: 1 },
	line: { stiffness: 520, damping: 32, mass: 1 },
	bar: { stiffness: 520, damping: 32, mass: 1 },
	tag: { stiffness: 800, damping: 44, mass: 0.6 },
	hide: { stiffness: 700, damping: 40, mass: 1 },
};
const STEP = 1 / 240;
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

	// motionAllowed() builds a MediaQueryList per call; the engine asks every frame, so keep one live list here.
	const reduceQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
	const moving = () => html.getAttribute("data-reduce-motion") !== "true" && !reduceQuery?.matches;
	const at = { x: 0, y: 0, held: false, inside: false, node: null as Element | null };
	let last = "", live = false, frame = 0, idle = 0, recheck = 0, top: Element | null = null, stale = false;
	// What the pointer is over changes far less often than it moves: resolve once per element, held and busy state.
	let resolved: { node: Element; held: boolean; busy: boolean; at: number; target: PixelTarget } | null = null;
	const RESOLVE_MS = 250; // still notices an element that turns disabled or busy under a moving pointer

	const widths = new Map<string, number>();
	const measure = (text: string) => {
		let width = widths.get(text);
		if (width === undefined) {
			meter.textContent = text;
			width = meter.offsetWidth;
			if (widths.size > 64) widths.clear();
			widths.set(text, width);
		}
		return width;
	};

	// ── the spring: x, y, width, height chase their goals; the loop sleeps once they arrive ──
	const now = { x: 0, y: 0, w: 6, h: 6 }, speed = { x: 0, y: 0, w: 0, h: 0 }, goal = { x: 0, y: 0, w: 6, h: 6 };
	let spring = SPRINGS.rest, motionFrame = 0, motionAt = 0;
	const keys = ["x", "y", "w", "h"] as const;
	function paint() {
		px.style.transform = `translate3d(${now.x}px,${now.y}px,0)`;
		px.style.width = `${Math.max(0, now.w)}px`;
		px.style.height = `${Math.max(0, now.h)}px`;
	}
	function snap() {
		for (const k of keys) { now[k] = goal[k]; speed[k] = 0; }
		if (motionFrame) cancelAnimationFrame(motionFrame);
		motionFrame = 0;
		paint();
	}
	function step(time: number) {
		let dt = Math.min(1 / 30, (time - motionAt) / 1000);
		motionAt = time;
		const { stiffness, damping, mass } = spring;
		while (dt > 0) {
			const h = Math.min(STEP, dt);
			dt -= h;
			for (const k of keys) {
				speed[k] += ((-stiffness * (now[k] - goal[k]) - damping * speed[k]) / mass) * h;
				now[k] += speed[k] * h;
			}
		}
		let resting = true;
		for (const k of keys) if (Math.abs(speed[k]) > 0.5 || Math.abs(now[k] - goal[k]) > 0.1) { resting = false; break; }
		if (resting) { snap(); return; }
		paint();
		motionFrame = requestAnimationFrame(step);
	}
	function chase(box: { x: number; y: number; w: number; h: number }, mode: PixelMode, instant: boolean) {
		goal.x = box.x; goal.y = box.y; goal.w = box.w; goal.h = box.h;
		spring = SPRINGS[mode];
		if (instant) { snap(); return; }
		if (!motionFrame) { motionAt = performance.now(); motionFrame = requestAnimationFrame(step); }
	}
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
		if (stale && at.inside) { stale = false; at.node = document.elementFromPoint(at.x, at.y); }
		if (!at.inside || !at.node?.isConnected) {
			px.removeAttribute("data-live");
			live = false; last = "";
			return;
		}
		const busy = cursorBusy();
		let target: PixelTarget;
		const stamp = performance.now();
		if (resolved && resolved.node === at.node && resolved.held === at.held && resolved.busy === busy && stamp - resolved.at < RESOLVE_MS) target = resolved.target;
		else {
			target = resolvePixel(at.node, {
				styleOf: node => getComputedStyle(node),
				viewport: { width: window.innerWidth, height: window.innerHeight },
				held: at.held,
				busy,
			});
			resolved = { node: at.node, held: at.held, busy, at: stamp, target };
			const root = topLayerRoot(at.node);
			if (root !== top) { top = root; if (root) promote(); }
		}
		const box = place(target);
		if (px.dataset.mode !== target.mode) px.dataset.mode = target.mode;
		if (px.hasAttribute("data-warn") !== !!target.warn) px.toggleAttribute("data-warn", !!target.warn);
		if (px.hasAttribute("data-spin") !== !!target.spin) px.toggleAttribute("data-spin", !!target.spin);
		if (!live) px.setAttribute("data-live", "");
		const key = [target.mode, box.x, box.y, box.w, box.h].map(v => typeof v === "number" ? Math.round(v) : v).join();
		if (key === last) return;
		last = key;
		// Once shrunk away (text, the game), the pixel just keeps its place: no spring to run for something unseen.
		const unseen = target.mode === "hide" && now.w < 0.5 && now.h < 0.5;
		chase(box, target.mode, !live || !moving() || unseen);
		live = true;
	}
	const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
	const refresh = () => { last = ""; resolved = null; schedule(); };
	/** After something changes under a still pointer (a press, a scroll, a menu closing), look again: once per frame, however many events. */
	function look() {
		if (!at.inside) return;
		stale = true;
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
			if (px.dataset.mode === "rest" && motionAllowed()) {
				px.removeAttribute("data-pop");
				void px.offsetWidth; // restart the pop
				px.setAttribute("data-pop", "");
			}
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
		if (motionFrame) cancelAnimationFrame(motionFrame);
		window.clearTimeout(idle);
		window.clearTimeout(recheck);
		layer.remove();
		style.remove();
		html.removeAttribute("data-keating-cursors");
	};
}
