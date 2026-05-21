import { describe, expect, test } from "bun:test";
import { parseStoryboard } from "../src/components/SceneRenderer";

describe("scene renderer storyboard parser", () => {
	test("parses range durations without double-counting duration lines", () => {
		const storyboard = `# Animation Storyboard: Test Topic

## Scene 1: Introduction (0-2s)
- **Visual**: A title card appears.
- **Narration**: Start here.
- **Duration**: 2s

## Scene 2: Example (2-8s)
- **Visual**: A worked example animates.
- **Audio**: Watch the pieces move.
- **Highlight**: Key idea`;

		const parsed = parseStoryboard(storyboard);

		expect(parsed.title).toBe("Test Topic");
		expect(parsed.scenes).toHaveLength(2);
		expect(parsed.scenes[0].duration).toBe("2s");
		expect(parsed.scenes[1].duration).toBe("2-8s");
		expect(parsed.totalDuration).toBe(8);
	});
});
