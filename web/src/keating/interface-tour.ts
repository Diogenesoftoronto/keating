/**
 * The guided tour of the chat interface. Onboarding explains Keating in words;
 * this points at the real controls once the learner is looking at them.
 *
 * Everything here is pure or storage-only so the step selection, resume and
 * placement rules can be tested without a browser.
 */

export const INTERFACE_TOUR_STORAGE_KEY = "keating:tour:v1";
export const INTERFACE_TOUR_REQUESTED_EVENT = "keating:interface-tour-requested";

export type InterfaceTourOutcome = "in-progress" | "completed" | "skipped";

export interface InterfaceTourStep {
	id: string;
	/** CSS selector for the element to point at. Steps whose anchor is absent are skipped. */
	anchor: string;
	title: string;
	body: string;
}

/**
 * Anchors are existing stable class names rather than new markup hooks, so the
 * tour cannot silently drift away from the elements it describes.
 */
export const INTERFACE_TOUR_STEPS: InterfaceTourStep[] = [
	{
		id: "composer",
		anchor: ".composer-root",
		title: "Ask here",
		body: "Type a question, however rough. Keating will usually answer with a question of its own — that is the teaching, not a dodge.",
	},
	{
		id: "conversation",
		anchor: ".chat-page-panel",
		title: "The conversation",
		body: "Answers, diagrams, quizzes and checks all land here. Tell Keating when something is unclear; it adjusts rather than repeating itself.",
	},
	{
		id: "sessions",
		anchor: ".session-panel",
		title: "One session per subject",
		body: "Keep separate topics in separate sessions. Keating remembers what you covered in each and picks up where you left off.",
	},
	{
		id: "artifacts",
		anchor: ".artifact-side-panel",
		title: "Study material",
		body: "When Keating builds a plan, concept map or quiz, it opens beside the conversation so you can work through it while you talk.",
	},
];

type TourStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): TourStorage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.localStorage;
	} catch {
		return undefined;
	}
}

function readRecord(storage: TourStorage | undefined): { version: unknown; outcome: unknown; step: unknown } | null {
	try {
		const saved = JSON.parse(storage?.getItem(INTERFACE_TOUR_STORAGE_KEY) ?? "null");
		return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : null;
	} catch {
		return null;
	}
}

export function hasSeenInterfaceTour(storage: TourStorage | undefined = browserStorage()): boolean {
	const saved = readRecord(storage);
	if (!saved || saved.version !== 1) return false;
	return saved.outcome === "completed" || saved.outcome === "skipped";
}

/** Clamps into range; a non-integer or out-of-range position restarts the tour. */
export function clampTourStep(step: unknown, count: number): number {
	if (count <= 0) return 0;
	if (typeof step !== "number" || !Number.isInteger(step)) return 0;
	return Math.min(Math.max(step, 0), count - 1);
}

export function readInterfaceTourStep(storage: TourStorage | undefined = browserStorage(), count = INTERFACE_TOUR_STEPS.length): number {
	const saved = readRecord(storage);
	if (!saved || saved.version !== 1 || saved.outcome !== "in-progress") return 0;
	return clampTourStep(saved.step, count);
}

/** Records position and outcome only; the tour never stores anything the learner typed. */
export function markInterfaceTour(
	outcome: InterfaceTourOutcome,
	storage: TourStorage | undefined = browserStorage(),
	step = 0,
): boolean {
	try {
		if (!storage) return false;
		storage.setItem(INTERFACE_TOUR_STORAGE_KEY, JSON.stringify({
			version: 1,
			outcome,
			step,
			completedAt: outcome === "in-progress" ? null : new Date().toISOString(),
		}));
		return true;
	} catch {
		return false;
	}
}

/**
 * Only steps whose anchor is on screen. A collapsed sidebar, a narrow viewport
 * or a closed artifact panel simply removes that step instead of leaving the
 * tour pointing at nothing.
 */
export function visibleTourSteps(
	steps: readonly InterfaceTourStep[],
	isPresent: (anchor: string) => boolean,
): InterfaceTourStep[] {
	return steps.filter((step) => {
		try {
			return isPresent(step.anchor);
		} catch {
			// An invalid selector must not take the whole tour down with it.
			return false;
		}
	});
}

/**
 * Replays the tour from the beginning. Settings sits above the chat, so the
 * request is announced rather than rendered here: whoever owns the chat view
 * starts the tour once its own dialog is out of the way.
 */
export function requestInterfaceTour(): void {
	markInterfaceTour("in-progress", browserStorage(), 0);
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent(INTERFACE_TOUR_REQUESTED_EVENT));
}

export function subscribeInterfaceTourRequests(callback: () => void): () => void {
	if (typeof window === "undefined") return () => {};
	window.addEventListener(INTERFACE_TOUR_REQUESTED_EVENT, callback);
	return () => window.removeEventListener(INTERFACE_TOUR_REQUESTED_EVENT, callback);
}

export interface TourRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

export interface TourCardPlacement {
	top: number;
	left: number;
	placement: "above" | "below";
}

/**
 * Places the card below the anchor when there is room and above it otherwise,
 * then clamps both axes so the card can never be pushed off screen by an anchor
 * at the edge of the viewport.
 */
export function tourCardPlacement(input: {
	anchor: TourRect;
	viewport: { width: number; height: number };
	card: { width: number; height: number };
	margin?: number;
}): TourCardPlacement {
	const margin = input.margin ?? 12;
	const { anchor, viewport, card } = input;

	const below = anchor.top + anchor.height + margin;
	const above = anchor.top - card.height - margin;
	const fitsBelow = below + card.height + margin <= viewport.height;
	const fitsAbove = above >= margin;
	// Prefer below; fall back above; if neither fits, keep it on screen anyway.
	const placement: "above" | "below" = fitsBelow || !fitsAbove ? "below" : "above";

	const rawTop = placement === "below" ? below : above;
	const maxTop = Math.max(margin, viewport.height - card.height - margin);
	const top = Math.min(Math.max(rawTop, margin), maxTop);

	const centred = anchor.left + anchor.width / 2 - card.width / 2;
	const maxLeft = Math.max(margin, viewport.width - card.width - margin);
	const left = Math.min(Math.max(centred, margin), maxLeft);

	return { top, left, placement };
}
