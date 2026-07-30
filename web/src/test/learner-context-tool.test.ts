import { describe, expect, test } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createTeachingTools } from "../keating/browser-tools/teaching";

async function executeText(tool: AgentTool, params: Record<string, unknown> = {}): Promise<string> {
	const result = await (tool.execute as any)("test-call", params, undefined, () => {});
	return result.content.map((item: { text?: string }) => item.text ?? "").join("\n");
}

describe("legacy learner context tools", () => {
	test("legacy learner inspection no longer records another session start", async () => {
		let sessionStarts = 0;
		const storage = {
			recordSessionStart: async () => { sessionStarts += 1; },
			getLearnerState: async () => ({
				sessionsCount: 3,
				feedbackHistory: [],
				topicsExplored: [],
				lastSessionAt: null,
			}),
		} as any;
		const learnerState = createTeachingTools(storage).find((tool) => tool.name === "learner_state");
		expect(learnerState).toBeDefined();
		await executeText(learnerState!);

		expect(sessionStarts).toBe(0);
	});
});
