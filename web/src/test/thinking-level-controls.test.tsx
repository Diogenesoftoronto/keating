import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { ThinkingLevelControl } from "../components/ThinkingLevelControl";
import { ModelPicker } from "../components/ModelPicker";
import {
	effectiveThinkingLevel,
	supportedThinkingLevels,
	thinkingLevelLabel,
	thinkingLevelSummary,
} from "../components/thinking-level";

const base = {
	api: "anthropic-messages", provider: "anthropic", baseUrl: "https://example.test", input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 8000,
} as const;
const reasoning = { ...base, id: "r", name: "Reasoner", reasoning: true } as unknown as Model<Api>;
const extended = { ...base, id: "x", name: "Extended", reasoning: true, thinkingLevelMap: { xhigh: "xhigh", max: "max" } } as unknown as Model<Api>;
const plain = { ...base, id: "p", name: "Plain", reasoning: false } as unknown as Model<Api>;

describe("thinking level helpers", () => {
	it("offers only the levels a model accepts", () => {
		expect(supportedThinkingLevels(reasoning)).toEqual(["off", "minimal", "low", "medium", "high"]);
		expect(supportedThinkingLevels(extended)).toContain("max");
		expect(supportedThinkingLevels(plain)).toEqual(["off"]);
		expect(supportedThinkingLevels(null)).toHaveLength(7);
	});

	it("reports the level the runtime will really use", () => {
		expect(effectiveThinkingLevel(reasoning, "max")).toBe("high");
		expect(effectiveThinkingLevel(extended, "max")).toBe("max");
		expect(effectiveThinkingLevel(null, "xhigh")).toBe("xhigh");
		expect(thinkingLevelLabel("xhigh")).toBe("Extra high");
		expect(thinkingLevelSummary(reasoning, "max")).toBe("Thinking: High");
		expect(thinkingLevelSummary(plain, "high")).toBe("No thinking step");
		expect(thinkingLevelSummary(reasoning, "off")).toBe("Thinking off");
	});
});

describe("ThinkingLevelControl", () => {
	it("renders a labelled radio group with the effective level checked and the only tab stop", () => {
		const html = renderToStaticMarkup(<ThinkingLevelControl model={reasoning} level="max" onChange={() => {}} />);
		expect(html).toContain('role="radiogroup"');
		expect(html.match(/role="radio"/g)).toHaveLength(5);
		expect(html).not.toContain(">Maximum<");
		expect(html).toMatch(/aria-checked="true" tabindex="0"[^>]*>High</);
		expect(html.match(/tabindex="0"/g)).toHaveLength(1);
		expect(html).toContain("Applies from your next message.");
	});

	it("explains a model without a thinking step instead of offering choices", () => {
		const html = renderToStaticMarkup(<ThinkingLevelControl model={plain} level="medium" onChange={() => {}} />);
		expect(html).toContain("Not available");
		expect(html).not.toContain('role="radio"');
	});

	it("disables the choices while a reply is running", () => {
		const html = renderToStaticMarkup(<ThinkingLevelControl model={reasoning} level="low" disabled onChange={() => {}} />);
		expect(html.match(/disabled=""/g)).toHaveLength(5);
		expect(html).toContain("Wait for the reply to finish");
	});

	it("sits above the model list when passed as picker controls", () => {
		const html = renderToStaticMarkup(<ModelPicker open label="Find a model" selected="a" onSelect={() => {}} onClose={() => {}}
			items={[{ id: "a", name: "Alpha", group: "Group" }]}
			controls={<ThinkingLevelControl model={reasoning} level="medium" onChange={() => {}} />} />);
		expect(html.indexOf("model-picker__controls")).toBeGreaterThan(-1);
		expect(html.indexOf("model-picker__controls")).toBeLessThan(html.indexOf("model-picker__results"));
	});
});
