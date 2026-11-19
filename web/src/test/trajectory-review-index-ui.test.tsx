import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PatternDigestPanel } from "../components/trajectory/PatternDigestPanel";
import type { DigestSessionInput } from "../keating/trajectory-passes";
import { TrajectoryReviewIndex } from "../pages/TrajectoryReviewIndex";
import { renderWithRouter } from "./course-render";

describe("session review queue presentation", () => {
	test("the loading queue includes navigation, progress, filter and sort controls before the digest", async () => {
		const html = await renderWithRouter(<TrajectoryReviewIndex />);
		expect(html).toContain("Back to teaching");
		expect(html).toContain("Session reviews");
		expect(html).toContain("Reviews stay local; remote passes send redacted context to the selected provider.");
		expect(html).toContain('aria-label="Review progress"');
		expect(html).toContain("k-busy");
		expect(html).toContain('aria-label="Filter by review status"');
		expect(html).toContain('aria-label="Search sessions"');
		expect(html).toMatch(/<button[^>]+(?=[^>]*aria-label="Sort")(?=[^>]*role="combobox")/);
		expect(html.indexOf("Loading sessions…")).toBeGreaterThan(0);
		expect(html.indexOf("Across your reviews")).toBeGreaterThan(html.indexOf("Loading sessions…"));
	});

	test("the digest stays compact until two reviews qualify, and explains a missing pool", () => {
		const input = { review: { id: "r" }, annotations: [] } as unknown as DigestSessionInput;
		const render = (sessions: DigestSessionInput[]) => renderToStaticMarkup(<PatternDigestPanel sessions={sessions} pools={[]} />);
		expect(render([input])).toContain("Finish two reviews");
		expect(render([input])).not.toContain("Find patterns");
		const ready = render([input, input]);
		expect(ready).toContain("Find patterns");
		expect(ready).toContain("Configure a model pool first.");
		expect(ready).toContain("disabled");
	});
});
