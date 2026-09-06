import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseSimulationExpression, type UiSimulationNode, type UiSimulationParameter } from "@keating/learner-contracts";
import { SimulationRenderer } from "../components/SimulationRenderer";
import { formatSimulationNumber, parameterPrecision, sampleSimulation } from "../components/simulation/sampling";

const parameter: UiSimulationParameter = { id: "time", label: "Time", min: 0, max: 10, step: 1, value: 2, unit: "s" };
function expression(source: string) {
	const parsed = parseSimulationExpression(source, ["time", "speed"]);
	if (!parsed.ok) throw new Error("Test expression must be valid.");
	return parsed.node;
}

describe("simulation chart observations", () => {
	test("sweeps one parameter while holding every other setting fixed", () => {
		const values = { time: 2, speed: 3 };
		const samples = sampleSimulation(parameter, expression("time * speed"), values);
		expect(samples).toHaveLength(11);
		expect(samples[0]).toEqual({ x: 0, y: 0 });
		expect(samples.at(-1)).toEqual({ x: 10, y: 30 });
		expect(samples.find((point) => point.x === 2)).toEqual({ x: 2, y: 6 });
		expect(values).toEqual({ time: 2, speed: 3 });
		expect(sampleSimulation(parameter, expression("time * speed"), { time: 2, speed: 4 }).at(-1)?.y).toBe(40);
	});

	test("keeps undefined domain samples missing instead of inventing zeroes", () => {
		const samples = sampleSimulation(parameter, expression("1 / (time - 2)"), { time: 2, speed: 1 });
		expect(samples.find((point) => point.x === 2)).toEqual({ x: 2, y: undefined });
		expect(samples.find((point) => point.x === 1)?.y).toBe(-1);
		expect(samples.find((point) => point.x === 3)?.y).toBe(1);
		const negativeRoots = sampleSimulation(parameter, expression("(time - 2) ^ 0.5"), { time: 2 });
		expect(negativeRoots.find((point) => point.x === 1)?.y).toBeUndefined();
		expect(negativeRoots.find((point) => point.x === 2)?.y).toBe(0);
		expect(sampleSimulation(parameter, expression("10 ^ 400"), { time: 2 }).every((point) => point.y === undefined)).toBe(true);
	});

	test("respects coarse discrete settings and does not fabricate intermediate steps", () => {
		const discrete = { ...parameter, min: 0, max: 10, step: 3, value: 3 };
		expect(sampleSimulation(discrete, expression("time"), { time: 3 }).map((point) => point.x)).toEqual([0, 3, 6, 9]);
		expect(sampleSimulation({ ...discrete, step: 20, value: 0 }, expression("time"), { time: 0 })).toEqual([{ x: 0, y: 0 }]);
	});

	test("bounds dense sweeps while including both continuous endpoints and the exact current value", () => {
		const continuous = { ...parameter, step: undefined, min: -10, max: 10, value: 1 / 3 };
		const samples = sampleSimulation(continuous, expression("time ^ 2"), { time: 1 / 3 });
		expect(samples.length).toBeLessThanOrEqual(82);
		expect(samples[0]?.x).toBe(-10);
		expect(samples.at(-1)?.x).toBe(10);
		expect(samples.find((point) => point.x === 1 / 3)?.y).toBeCloseTo(1 / 9, 10);
		const denseDiscrete = sampleSimulation({ ...parameter, max: 100000, step: 0.1 }, expression("time"), { time: 2 });
		expect(denseDiscrete.length).toBeLessThanOrEqual(82);
		expect(denseDiscrete.every((point) => Math.abs(point.x / 0.1 - Math.round(point.x / 0.1)) < 1e-6)).toBe(true);
	});

	test("keeps small or large finite values intelligible and handles exponential step notation", () => {
		expect(formatSimulationNumber(undefined)).toBe("—");
		expect(formatSimulationNumber(Infinity)).toBe("—");
		expect(formatSimulationNumber(1e-9)).toBe("1.00e-9");
		expect(formatSimulationNumber(1e12)).toBe("1.00e+12");
		expect(parameterPrecision({ ...parameter, step: 1e-6 })).toBe(6);
		expect(parameterPrecision({ ...parameter, step: undefined })).toBe(2);
	});

	test("deduplicates floating-point step copies while retaining the exact slider value", () => {
		const samples = sampleSimulation({ ...parameter, min: 0, max: 15, step: 0.1, value: 5 }, expression("time"), { time: 5.1 });
		expect(samples.filter((point) => point.x.toFixed(1) === "5.1")).toEqual([{ x: 5.1, y: 5.1 }]);
	});
});

describe("simulation chart accessible fallback", () => {
	const node: UiSimulationNode = {
		type: "simulation", id: "motion", title: "How far will it go?", parameters: [parameter, { id: "speed", label: "Speed", min: 0, max: 20, step: 1, value: 3, unit: "m/s" }],
		readouts: [{ id: "distance", label: "Distance", unit: "m", expr: "time * speed", emphasis: true }],
	};
	test("exposes graph axes, named native controls, current readouts, and the full data table without a canvas", () => {
		const html = renderToStaticMarkup(<SimulationRenderer node={node} />);
		expect(html).toContain('data-simulation="motion"');
		expect(html).toContain('data-simulation-readout="distance"');
		expect(html).toContain('aria-label="Graph horizontal axis"');
		expect(html).toContain('aria-label="Graph output"');
		expect(html).toContain('aria-label="Time (s)"');
		expect(html).toContain('aria-label="Speed (m/s)"');
		expect(html).toContain("View sampled values");
		expect(html).toContain("<table");
		expect(html).toContain("Distance (m)");
		expect(html).toContain("Other controls stay at their current settings.");
		expect(html).toContain(" (now)");
	});

	test("renders useful controls and a no-value fallback when the whole sweep is undefined", () => {
		const html = renderToStaticMarkup(<SimulationRenderer node={{ ...node, readouts: [{ id: "missing", label: "Quotient", expr: "time / 0" }] }} />);
		expect(html).toContain("No finite values at these settings.");
		expect(html).toContain("No value");
		expect(html).not.toContain("NaN");
		expect(html).not.toContain("Infinity");
		expect(html).toContain('type="range"');
	});
});
