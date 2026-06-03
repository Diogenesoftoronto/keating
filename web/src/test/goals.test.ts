import { describe, expect, it } from "bun:test";
import {
	advanceGoalStep,
	buildGoal,
	computeGoalProgress,
	goalToMarkdown,
	normalizeGoal,
} from "../keating/goals";

describe("buildGoal", () => {
	it("uses agent-provided steps in order", () => {
		const goal = buildGoal({
			title: "Ship a CLI tool",
			description: "A small TypeScript CLI",
			steps: [
				{ title: "Learn argv parsing", kind: "concept", successCriteria: ["Parse flags"] },
				{ title: "Build the command", kind: "project" },
				{ title: "Empty title should be dropped", kind: "concept" },
			],
		});
		// Two real steps (the one with empty title is kept since title is non-empty here).
		expect(goal.steps.length).toBe(3);
		expect(goal.steps[0].order).toBe(0);
		expect(goal.steps[1].order).toBe(1);
		expect(goal.steps[0].kind).toBe("concept");
		expect(goal.steps[1].kind).toBe("project");
		expect(goal.steps.every((s) => s.status === "not_started")).toBe(true);
		expect(goal.status).toBe("active");
	});

	it("drops steps with blank titles", () => {
		const goal = buildGoal({
			title: "x",
			steps: [{ title: "  " }, { title: "Real step" }],
		});
		expect(goal.steps.length).toBe(1);
		expect(goal.steps[0].title).toBe("Real step");
	});

	it("auto-scaffolds a curriculum when no steps are given", () => {
		const goal = buildGoal({ title: "Understand recursion", topic: "recursion" });
		expect(goal.steps.length).toBeGreaterThanOrEqual(3);
		// Scaffold always ends with a reflection/teach-back step.
		expect(goal.steps[goal.steps.length - 1].kind).toBe("reflection");
	});
});

describe("computeGoalProgress + advanceGoalStep", () => {
	it("tracks progress and marks the next step", () => {
		const goal = buildGoal({
			title: "g",
			steps: [{ title: "a" }, { title: "b" }, { title: "c" }],
		});
		let progress = computeGoalProgress(goal);
		expect(progress.done).toBe(0);
		expect(progress.percent).toBe(0);
		expect(progress.nextStep?.title).toBe("a");

		const after = advanceGoalStep(goal, goal.steps[0].id, "done");
		progress = computeGoalProgress(after);
		expect(progress.done).toBe(1);
		expect(progress.percent).toBe(33);
		expect(progress.nextStep?.title).toBe("b");
		expect(after.steps[0].completedAt).toBeDefined();
	});

	it("marks the goal completed when all steps are done", () => {
		let goal = buildGoal({ title: "g", steps: [{ title: "a" }, { title: "b" }] });
		for (const step of goal.steps) {
			goal = advanceGoalStep(goal, step.id, "done");
		}
		expect(goal.status).toBe("completed");
		expect(computeGoalProgress(goal).percent).toBe(100);
	});

	it("clearing a done step reopens a completed goal", () => {
		let goal = buildGoal({ title: "g", steps: [{ title: "a" }] });
		goal = advanceGoalStep(goal, goal.steps[0].id, "done");
		expect(goal.status).toBe("completed");
		goal = advanceGoalStep(goal, goal.steps[0].id, "in_progress");
		expect(goal.status).toBe("active");
	});
});

describe("goalToMarkdown + normalizeGoal", () => {
	it("round-trips through JSON via normalizeGoal", () => {
		const goal = buildGoal({ title: "Round trip", steps: [{ title: "a" }] });
		const restored = normalizeGoal(JSON.parse(JSON.stringify(goal)));
		expect(restored).not.toBeNull();
		expect(restored?.id).toBe(goal.id);
		expect(restored?.steps.length).toBe(1);
	});

	it("rejects malformed payloads", () => {
		expect(normalizeGoal(null)).toBeNull();
		expect(normalizeGoal({ title: "no steps" })).toBeNull();
		expect(normalizeGoal({ id: "x", title: "y", steps: "nope" })).toBeNull();
	});

	it("renders status marks and progress", () => {
		const goal = buildGoal({ title: "Markdown goal", steps: [{ title: "step one" }] });
		const md = goalToMarkdown(goal);
		expect(md).toContain("# Goal: Markdown goal");
		expect(md).toContain("[ ] 1. step one");
		expect(md).toContain("0/1 steps");
	});
});
