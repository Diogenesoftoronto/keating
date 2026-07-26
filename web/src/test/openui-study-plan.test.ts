import { describe, expect, it } from "bun:test";
import {
	flattenStudyPlanItems,
	studyPlanDependencyGraph,
	studyPlanLeafItems,
	type StudyPlanItem,
} from "../keating/openui/study-plan";

const plan: StudyPlanItem[] = [
	{
		id: "foundations",
		title: "Foundations",
		children: [
			{ id: "terms", title: "Core terms" },
			{ id: "model", title: "Mental model", dependsOn: ["terms"] },
		],
	},
	{
		id: "application",
		title: "Application",
		dependsOn: ["foundations"],
		children: [
			{ id: "worked-example", title: "Worked example", dependsOn: ["model"] },
		],
	},
];

describe("nested OpenUI study plans", () => {
	it("flattens nested areas while preserving author order", () => {
		expect(flattenStudyPlanItems(plan).map((item) => item.id)).toEqual([
			"foundations",
			"terms",
			"model",
			"application",
			"worked-example",
		]);
	});

	it("counts only actionable leaves for learner progress", () => {
		expect(studyPlanLeafItems(plan).map((item) => item.id)).toEqual([
			"terms",
			"model",
			"worked-example",
		]);
	});

	it("derives a Mermaid dependency graph from valid ids", () => {
		const graph = studyPlanDependencyGraph(plan);

		expect(graph?.edgeCount).toBe(3);
		expect(graph?.code).toContain('["Core terms"]');
		expect(graph?.code).toContain('["Mental model"]');
		expect(graph?.code).toContain("-->");
	});

	it("ignores missing and self-referential dependency ids", () => {
		expect(studyPlanDependencyGraph([
			{ id: "only", title: "Only step", dependsOn: ["missing", "only"] },
		])).toBeNull();
	});
});
