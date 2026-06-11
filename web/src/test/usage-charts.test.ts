import { describe, expect, it } from "bun:test";

import {
	getCurriculumDisplayEnd,
	getPrimaryCurriculumTopic,
	getVisibleCurriculumSessions,
	hasMeaningfulPolicyScores,
} from "../components/usage-chart-data";
import type { LearnerState } from "../keating/storage";

const base = 1_800_000_000_000;

describe("usage chart data shaping", () => {
	it("omits topicless learner sessions from the curriculum timeline", () => {
		const sessions: LearnerState["sessions"] = [
			{ startedAt: base, topicsCovered: [] },
			{ startedAt: base + 2_000, topicsCovered: ["  "] },
			{ startedAt: base + 1_000, topicsCovered: ["Bayes Rule"] },
		];

		const visible = getVisibleCurriculumSessions(sessions);

		expect(visible).toHaveLength(1);
		expect(getPrimaryCurriculumTopic(visible[0])).toBe("Bayes Rule");
	});

	it("bounds open session display duration so old unfinished rows do not dominate the chart", () => {
		const openSession: LearnerState["sessions"][number] = {
			startedAt: base,
			topicsCovered: ["Derivatives"],
		};

		expect(getCurriculumDisplayEnd(openSession, base + 86_400_000)).toBe(base + 30 * 60 * 1000);
	});

	it("uses explicit endedAt when a session is complete", () => {
		const closedSession: LearnerState["sessions"][number] = {
			startedAt: base,
			endedAt: base + 7_000,
			topicsCovered: ["Derivatives"],
		};

		expect(getCurriculumDisplayEnd(closedSession, base + 86_400_000)).toBe(base + 7_000);
	});

	it("treats all-zero policy scores as low-signal instead of a meaningful trend", () => {
		expect(hasMeaningfulPolicyScores([{ score: 0 }, { score: 0 }])).toBe(false);
		expect(hasMeaningfulPolicyScores([{ score: 0 }, { score: 12.5 }])).toBe(true);
	});
});
