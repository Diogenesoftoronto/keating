import type { KeatingBotState } from "../KeatingBot";
import type { Point } from "./drag-physics";
import { activityTargetSelector, activityTarget, type DropTarget } from "./drop-targets";

export type Grip = "top" | "left" | "right" | "underside";
export type SurfaceContact = { target: DropTarget; grip: Grip };

type Box = { top: number; bottom: number; left: number; right: number };

// The atlas has transparent margins. Probe just beyond the visible hands, feet,
// and raised hand, then check the actual distance back to the painted edge.
export function gripProbes(p: Point, size: number) {
	const reach = size * 0.10;
	return [
		{ grip: "top", x: p.x + size * 0.50, y: p.y + size * 0.96, dx: 0, dy: reach },
		{ grip: "left", x: p.x + size * 0.83, y: p.y + size * 0.40, dx: reach, dy: 0 },
		{ grip: "right", x: p.x + size * 0.17, y: p.y + size * 0.40, dx: -reach, dy: 0 },
		{ grip: "underside", x: p.x + size * 0.50, y: p.y + size * 0.15, dx: 0, dy: -reach },
	] as const;
}

export function touchesEdge(probe: ReturnType<typeof gripProbes>[number], box: Box) {
	const { x, y, dx, dy, grip } = probe;
	if (grip === "left" || grip === "right") {
		return y > box.top && y < box.bottom && Math.abs(x - box[grip]) <= Math.abs(dx);
	}
	return x > box.left && x < box.right && Math.abs(y - (grip === "top" ? box.top : box.bottom)) <= Math.abs(dy);
}

export function findSurfaceContact(p: Point, size: number, viewport: HTMLElement): SurfaceContact | undefined {
	for (const probe of gripProbes(p, size)) {
		const hit = document.elementsFromPoint(probe.x + probe.dx, probe.y + probe.dy)
			.find(el => !el.closest(".chat-mascot-perch"));
		if (!hit || !viewport.contains(hit) || hit.closest('[aria-busy="true"]')) continue;
		const el = hit.closest<HTMLElement>(activityTargetSelector);
		if (el && touchesEdge(probe, el.getBoundingClientRect())) return { target: activityTarget(el), grip: probe.grip };
	}
}

export function surfacePose(target: DropTarget, hungry: boolean): KeatingBotState {
	const el = target.el;
	if (target.kind === "snack") return hungry ? "tea-break" : "flashcards";
	if (el.matches("[data-music-lab]")) return "headphones";
	if (el.matches("[data-language-practice]")) return "language";
	if (el.matches("[data-quiz-results]")) return "clapping";
	if (el.matches("[data-task], [data-task-brief]")) return "writing";
	if (el.matches(".mermaid-container")) return "pointing-up";
	if (target.kind === "watch") return "magnifier";
	return "ledge-sitting";
}

export function releasingAway(grip: Grip, v: Point) {
	switch (grip) {
		case "left": return v.x < -180;
		case "right": return v.x > 180;
		case "top": return v.y < -180;
		case "underside": return v.y > 180;
	}
}

// Test the leading hand where its path actually crosses the vertical face.
export function crossesSide<T extends Box>(faces: readonly T[], from: Point, to: Point, size: number) {
	const dx = to.x - from.x;
	if (!dx) return;
	const hand = size * (dx > 0 ? 0.83 : 0.17);
	let first: { face: T; t: number; x: number; y: number } | undefined;
	for (const face of faces) {
		const x = dx > 0 ? face.left : face.right;
		const t = (x - from.x - hand) / dx;
		if (t < 0 || t > 1 || (first && t >= first.t)) continue;
		const y = from.y + (to.y - from.y) * t + size * 0.4;
		if (y > face.top && y < face.bottom) first = { face, t, x: x - hand, y };
	}
	return first;
}
