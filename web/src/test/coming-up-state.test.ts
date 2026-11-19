import { describe, expect, mock, test } from "bun:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComingUpQueue } from "../keating/coming-up";
import type { LearnerState } from "../keating/storage";

// ComingUp's browser storage singleton touches window during module evaluation;
// reducer tests replace only that boundary and restore the module registry immediately.
mock.module("../hooks/keating-storage", () => ({
	getInitPromise: () => Promise.resolve(),
	keatingStorage: {},
}));
const { comingUpPageReducer, initialComingUpPageState, DueReviewSummary } = await import("../pages/ComingUp");
mock.restore();

function learnerState(): LearnerState {
	return {
		schemaVersion: 3,
		topicsExplored: [],
		feedbackHistory: [],
		strengths: [],
		weaknesses: [],
		topicProfiles: [],
		sessionsCount: 0,
		sessions: [],
		profileBeliefs: [],
		studyPriorities: [],
	};
}

describe("Coming Up page state", () => {
	test("load and operation feedback transitions cannot leave stale success and error messages together", () => {
		const failedLoad = comingUpPageReducer(initialComingUpPageState, {
			type: "data.failed",
			error: "Storage unavailable",
		});
		expect(failedLoad.loadState).toBe("ready");
		expect(failedLoad.feedback).toEqual({ status: "", error: "Storage unavailable" });

		let state = comingUpPageReducer(initialComingUpPageState, {
			type: "data.loaded",
			decks: [],
			verifications: [],
			learnerState: learnerState(),
		});
		expect(state.loadState).toBe("ready");
		expect(state.data.learnerState).not.toBeNull();

		state = comingUpPageReducer(state, { type: "feedback.error", error: "Import failed" });
		expect(state.feedback).toEqual({ status: "", error: "Import failed" });

		state = comingUpPageReducer(state, { type: "feedback.status", status: "Import complete" });
		expect(state.feedback).toEqual({ status: "Import complete", error: "" });

		state = comingUpPageReducer(state, { type: "transfer.started" });
		expect(state.transferBusy).toBe(true);
		expect(state.feedback).toEqual({ status: "", error: "" });
		state = comingUpPageReducer(state, { type: "transfer.finished" });
		expect(state.transferBusy).toBe(false);
	});

	test("drag transitions clear the item and destination together", () => {
		let state = comingUpPageReducer(initialComingUpPageState, { type: "drag.started", itemId: "deck:algebra" });
		state = comingUpPageReducer(state, { type: "drag.entered", lane: "maintain" });
		expect(state.drag).toEqual({ itemId: "deck:algebra", lane: "maintain" });

		state = comingUpPageReducer(state, { type: "drag.ended" });
		expect(state.drag).toEqual({ itemId: null, lane: null });
	});

	test("review sessions start at the first deck, advance, and reset at the boundary", () => {
		const deckIds = ["algebra", "calculus"];
		let state = comingUpPageReducer(initialComingUpPageState, { type: "review.started", deckIds });
		deckIds.push("statistics");
		expect(state.review).toEqual({ deckIds: ["algebra", "calculus"], index: 0 });

		state = comingUpPageReducer(state, { type: "review.advanced" });
		expect(state.review).toEqual({ deckIds: ["algebra", "calculus"], index: 1 });

		state = comingUpPageReducer(state, { type: "review.advanced" });
		expect(state.review).toEqual({ deckIds: [], index: 0 });
	});
});

test("the due summary keeps the review action, overdue count and empty companion in their respective states", () => {
  const queue: ComingUpQueue = { items:[],lanes:{focus:[],maintain:[],low:[]},dueCardCount:0,overdueCardCount:0,estimatedMinutes:0,dueDeckIds:[] };
  const render = (value:ComingUpQueue) => renderToStaticMarkup(createElement(DueReviewSummary,{queue:value,deckCount:1,openChecks:0,onStart() {}}));
  const empty = render(queue);
  expect(empty).toContain("Review runway is clear");
  expect(empty).toContain("keating-bot");
  expect(empty).toMatch(/<button[^>]*disabled/);
  const due = render({...queue,dueCardCount:4,overdueCardCount:2,estimatedMinutes:5});
  expect(due).toContain("4 cards are ready");
  expect(due).toContain("2 overdue by more than a day");
  expect(due).not.toMatch(/<button[^>]*disabled/);
});
