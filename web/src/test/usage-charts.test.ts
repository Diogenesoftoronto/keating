import { describe, expect, it } from "bun:test";

import {
	buildModelUsageBreakdown,
	getCurriculumDisplayEnd,
	getPrimaryCurriculumTopic,
	getVisibleCurriculumSessions,
	hasMeaningfulPolicyScores,
} from "../components/usage-chart-data";
import type { LearnerState } from "../keating/storage";
import type { SessionMetadata } from "../types/session";

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

	it("groups model usage by token share and falls back to message share", () => {
		const usage = {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		const sessions = [
			{
				id: "a",
				title: "A",
				createdAt: "2026-01-01T00:00:00.000Z",
				lastModified: "2026-01-01T00:00:00.000Z",
				messageCount: 2,
				usage: { ...usage, totalTokens: 100 },
				thinkingLevel: "medium",
				preview: "",
				modelProvider: "openai",
				modelId: "gpt-a",
				modelName: "GPT A",
			},
			{
				id: "b",
				title: "B",
				createdAt: "2026-01-01T00:00:00.000Z",
				lastModified: "2026-01-01T00:00:00.000Z",
				messageCount: 4,
				usage: { ...usage, totalTokens: 300 },
				thinkingLevel: "medium",
				preview: "",
				modelProvider: "openai",
				modelId: "gpt-b",
				modelName: "GPT B",
			},
		] satisfies SessionMetadata[];

		const tokenBreakdown = buildModelUsageBreakdown(sessions);
		expect(tokenBreakdown.basis).toBe("tokens");
		expect(tokenBreakdown.entries[0].label).toBe("GPT B");
		expect(tokenBreakdown.entries[0].share).toBe(0.75);

		const messageBreakdown = buildModelUsageBreakdown(sessions.map((session) => ({
			...session,
			usage,
		})));
		expect(messageBreakdown.basis).toBe("messages");
		expect(messageBreakdown.entries[0].label).toBe("GPT B");
		expect(messageBreakdown.entries[0].value).toBe(4);
	});
});
