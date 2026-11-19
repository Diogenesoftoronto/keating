import { describe, expect, test } from "bun:test";
import { KeatingBenchContent } from "../pages/KeatingBench";
import { renderWithRouter } from "./course-render";

describe("model benchmark page", () => {
	test("the empty shared view keeps the evidence selector, verdict and methodology", async () => {
		const html = await renderWithRouter(<KeatingBenchContent samples={[]} quizRecords={[]} feedbackEntries={[]} />);
		expect(html).toContain('role="radiogroup" aria-label="Evidence from"');
		expect(html).toMatch(/aria-checked="true"[^>]*>Shared</);
		expect(html).toContain("No sessions in this view yet.");
		expect(html).toContain("<b>No replay cases yet</b>");
		expect(html).toContain("<b>No benchmarkable sessions in this view.</b>");
		expect(html).toContain("Provider replay execution is not built");
	});

	test("the plot shares the leader band across ranked and unranked models", async () => {
		const samples = ["first", "second", "third"].map(id => ({
			id, title: id, source: "shared" as const, createdAt: "2026-11-01",
			model: { id, name: id, provider: "test" }, messages: [],
		}));
		const quizRecords = samples.flatMap(({ id }, index) =>
			Array.from({ length: index === 2 ? 3 : 20 }, (_, n) => ({
				id: id + n, sessionId: id, topic: "Algebra", createdAt: n, score: 3, totalQuestions: 4,
			})));
		const html = await renderWithRouter(<KeatingBenchContent samples={samples} quizRecords={quizRecords} feedbackEntries={[]} />);
		expect(html).toContain("All 2 ranked models overlap");
		expect(html.match(/class="kc-band"/g)).toHaveLength(3);
		expect(html.match(/class="kc-range"/g)).toHaveLength(2);
		expect(html).toContain('aria-label="first: 75, likely 70 to 80"');
		expect(html).toContain("Too few signals for a range");
		expect(html.match(/class="bench-toggle" aria-expanded="false"/g)).toHaveLength(3);
	});
});

test("a lower-ranked tie identifies the model whose interval overlaps", async () => {
  const samples = ["Alpha", "Beta", "Gamma"].map(name => ({
    id:name, title:name, source:"shared" as const, createdAt:"2026-11-01",
    model:{id:name,name,provider:"fixture"}, messages:[],
  }));
  const quizRecords = samples.flatMap(({id}, index) => Array.from({length:20}, (_, n) => ({
    id:id+n, sessionId:id, topic:"Algebra", createdAt:n, score:index === 0 ? 4 : 1, totalQuestions:4,
  })));
  const html = await renderWithRouter(<KeatingBenchContent samples={samples} quizRecords={quizRecords} feedbackEntries={[]}/>);
  expect(html.replaceAll("<!-- -->", "")).toContain("tied with 2 · Beta");
});
