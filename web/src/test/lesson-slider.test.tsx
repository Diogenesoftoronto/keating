import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LessonSlider } from "../components/lesson/LessonSlider";
import { formatSimulationCompact } from "../components/simulation/sampling";

describe("chart and slider numbers are worded for people", () => {
	test("three significant figures, never more decimals than the authored precision, units attached", () => {
		expect(formatSimulationCompact(83.89830508474574, 2, "%")).toBe("83.9%");
		expect(formatSimulationCompact(0.9803921568627443, 2, "%")).toBe("0.98%");
		expect(formatSimulationCompact(5000, 0, "per 100k")).toBe("5,000 per 100k");
		expect(formatSimulationCompact(99.4, 1, "%")).toBe("99.4%");
		expect(formatSimulationCompact(undefined)).toBe("—");
		expect(formatSimulationCompact(1e-9)).toBe("1.00e-9");
	});
});

describe("LessonSlider", () => {
	const html = renderToStaticMarkup(<LessonSlider label="Specificity (%)" min={50} max={100} step={0.1} value={99.4} start={99}
		format={value => `${value}%`} onChange={() => {}} />);
	test("keeps a named native range with formatted value text for keyboards and screen readers", () => {
		expect(html).toContain('type="range"');
		expect(html).toContain('aria-label="Specificity (%)"');
		expect(html).toContain('aria-valuetext="99.4%"');
		expect(html).toContain('step="0.1"');
	});
	test("shows the value in the label row as an exact-value action and marks where the learner started", () => {
		expect(html).toContain('aria-label="99.4%. Type an exact Specificity (%)"');
		expect(html).toContain("lesson-slider__start");
		expect(html).toContain("data-moved");
	});
});
