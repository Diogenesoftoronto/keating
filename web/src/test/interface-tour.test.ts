import { describe, expect, it } from "bun:test";
import {
	INTERFACE_TOUR_STEPS,
	INTERFACE_TOUR_STORAGE_KEY,
	clampTourStep,
	hasSeenInterfaceTour,
	markInterfaceTour,
	readInterfaceTourStep,
	tourCardPlacement,
	visibleTourSteps,
} from "../keating/interface-tour";

function storage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value); },
	};
}

describe("interface tour state", () => {
	it("has not been seen before anything is recorded", () => {
		expect(hasSeenInterfaceTour(storage())).toBe(false);
	});

	it("records outcome and position only", () => {
		const saved = storage();
		expect(markInterfaceTour("completed", saved, 3)).toBe(true);
		expect(hasSeenInterfaceTour(saved)).toBe(true);
		expect(Object.keys(JSON.parse(saved.getItem(INTERFACE_TOUR_STORAGE_KEY)!)).sort())
			.toEqual(["completedAt", "outcome", "step", "version"]);
	});

	it("treats a skipped tour as seen so it does not reappear", () => {
		const saved = storage();
		markInterfaceTour("skipped", saved, 1);
		expect(hasSeenInterfaceTour(saved)).toBe(true);
	});

	it("resumes an unfinished tour without counting it as seen", () => {
		const saved = storage();
		markInterfaceTour("in-progress", saved, 2);
		expect(hasSeenInterfaceTour(saved)).toBe(false);
		expect(readInterfaceTourStep(saved)).toBe(2);
		expect(JSON.parse(saved.getItem(INTERFACE_TOUR_STORAGE_KEY)!).completedAt).toBeNull();
	});

	it("ignores malformed, mis-versioned and out-of-range records", () => {
		const saved = storage();
		for (const value of ["not json", "[]", "null", '{"version":2,"outcome":"completed"}']) {
			saved.setItem(INTERFACE_TOUR_STORAGE_KEY, value);
			expect(hasSeenInterfaceTour(saved)).toBe(false);
			expect(readInterfaceTourStep(saved)).toBe(0);
		}
	});

	it("clamps a stored position into the range of steps actually available", () => {
		expect(clampTourStep(99, 4)).toBe(3);
		expect(clampTourStep(-2, 4)).toBe(0);
		expect(clampTourStep(1.5, 4)).toBe(0);
		expect(clampTourStep("2", 4)).toBe(0);
		// A viewport where no step can be shown must not produce -1.
		expect(clampTourStep(3, 0)).toBe(0);
	});

	it("never throws when browser storage is unavailable", () => {
		const blocked = {
			getItem: () => { throw new Error("blocked"); },
			setItem: () => { throw new Error("blocked"); },
		};
		expect(hasSeenInterfaceTour(blocked)).toBe(false);
		expect(readInterfaceTourStep(blocked)).toBe(0);
		expect(markInterfaceTour("completed", blocked)).toBe(false);
	});
});

describe("choosing which steps can be shown", () => {
	it("keeps only steps whose anchor is on screen, in order", () => {
		const visible = visibleTourSteps(INTERFACE_TOUR_STEPS, (anchor) => anchor !== ".session-panel");
		expect(visible.map((step) => step.id)).toEqual(["composer", "conversation", "artifacts"]);
	});

	it("returns nothing when the interface is not mounted at all", () => {
		expect(visibleTourSteps(INTERFACE_TOUR_STEPS, () => false)).toEqual([]);
	});

	it("drops a step whose selector throws rather than failing the tour", () => {
		const visible = visibleTourSteps(INTERFACE_TOUR_STEPS, (anchor) => {
			if (anchor === ".composer-root") throw new SyntaxError("bad selector");
			return true;
		});
		expect(visible.map((step) => step.id)).toEqual(["conversation", "sessions", "artifacts"]);
	});

	it("points at anchors that exist in the app rather than invented markup", () => {
		expect(INTERFACE_TOUR_STEPS.map((step) => step.anchor)).toEqual([
			".composer-root",
			".chat-page-panel",
			".session-panel",
			".artifact-side-panel",
		]);
	});
});

describe("placing the tour card", () => {
	const viewport = { width: 1200, height: 800 };
	const card = { width: 340, height: 200 };

	it("sits below an anchor with room beneath it", () => {
		const placement = tourCardPlacement({ anchor: { top: 100, left: 400, width: 200, height: 60 }, viewport, card });
		expect(placement.placement).toBe("below");
		expect(placement.top).toBe(172);
		// Centred on the anchor.
		expect(placement.left).toBe(330);
	});

	it("flips above an anchor pinned to the bottom, like the composer", () => {
		const placement = tourCardPlacement({ anchor: { top: 700, left: 400, width: 200, height: 80 }, viewport, card });
		expect(placement.placement).toBe("above");
		expect(placement.top).toBe(488);
	});

	it("keeps the card on screen when neither side has room", () => {
		const placement = tourCardPlacement({ anchor: { top: 0, left: 0, width: 1200, height: 800 }, viewport, card });
		expect(placement.top).toBeGreaterThanOrEqual(12);
		expect(placement.top + card.height).toBeLessThanOrEqual(viewport.height);
	});

	it("clamps horizontally instead of running off either edge", () => {
		const left = tourCardPlacement({ anchor: { top: 100, left: 0, width: 40, height: 40 }, viewport, card });
		expect(left.left).toBe(12);
		const right = tourCardPlacement({ anchor: { top: 100, left: 1180, width: 20, height: 40 }, viewport, card });
		expect(right.left).toBe(viewport.width - card.width - 12);
	});

	it("still produces positive coordinates on a viewport smaller than the card", () => {
		const placement = tourCardPlacement({
			anchor: { top: 10, left: 10, width: 40, height: 40 },
			viewport: { width: 200, height: 150 },
			card,
		});
		expect(placement.top).toBeGreaterThanOrEqual(12);
		expect(placement.left).toBeGreaterThanOrEqual(12);
	});
});
