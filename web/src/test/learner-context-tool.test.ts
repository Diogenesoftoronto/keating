import { describe, expect, test } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createLearnerContextCapabilityTools, createTeachingTools } from "../keating/browser-tools/teaching";
import type { ToolRegistry } from "../keating/browser-tools/shared";

async function executeText(tool: AgentTool, params: Record<string, unknown> = {}): Promise<string> {
	const result = await (tool.execute as any)("test-call", params, undefined, () => {});
	return result.content.map((item: { text?: string }) => item.text ?? "").join("\n");
}

describe("learner context capability", () => {
	test("batches selected sections through the legacy compatibility adapters", async () => {
		const invocations: Array<{ name: string; params: Record<string, unknown> }> = [];
		const registry: ToolRegistry = {
			has: () => true,
			invoke: async (name, params) => {
				invocations.push({ name, params });
				return `result:${name}`;
			},
		};
		const [tool] = createLearnerContextCapabilityTools(registry);
		const output = await executeText(tool, {
			sections: ["profile", "goals", "profile"],
			goal_status: "active",
		});

		expect(invocations).toEqual([
			{ name: "learner_state", params: {} },
			{ name: "list_learner_goals", params: { status: "active" } },
		]);
		expect(output).toContain("## profile");
		expect(output).toContain("## goals");
	});

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
