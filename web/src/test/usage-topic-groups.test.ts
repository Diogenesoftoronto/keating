import { describe, expect, it } from "bun:test";

import { buildTopicArtifactGroups, categorizeUsageTopic } from "../components/usage-topic-groups";

describe("usage topic artifact grouping", () => {
	it("groups related raw topics into stable learning categories", () => {
		const groups = buildTopicArtifactGroups([
			{ topic: "Derivative", type: "plan" },
			{ topic: "Bayes Rule", type: "map" },
			{ topic: "Recursion in TypeScript", type: "animation" },
			{ topic: "React component state", type: "plan" },
			{ topic: "Photosynthesis", type: "verification" },
			{ topic: "Mitosis in plant cells", type: "map" },
		]);

		expect(groups.find((group) => group.key === "math")?.count).toBe(2);
		expect(groups.some((group) => group.key === "physics")).toBe(false);
		expect(groups.find((group) => group.key === "computing")?.count).toBe(2);
		expect(groups.find((group) => group.key === "life-science")?.count).toBe(2);
		expect(groups.find((group) => group.key === "computing")?.topics.map((topic) => topic.topic).sort()).toEqual([
			"React component state",
			"Recursion in TypeScript",
		]);
	});

	it("tracks artifact type mix inside each group", () => {
		const [group] = buildTopicArtifactGroups([
			{ topic: "Entropy", type: "plan" },
			{ topic: "Entropy", type: "map" },
			{ topic: "Entropy", type: "verification" },
		]);

		expect(group.key).toBe("physics");
		expect(group.types).toEqual({ plan: 1, map: 1, animation: 0, verification: 1 });
		expect(group.topics).toEqual([{ topic: "Entropy", count: 3 }]);
	});

	it("falls back to General Learning for unknown topics", () => {
		expect(categorizeUsageTopic("an oddly named exploration").key).toBe("general");
		expect(categorizeUsageTopic("").key).toBe("general");
	});
});
