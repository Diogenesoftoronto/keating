import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { UiDocument, UiSimulationNode } from "@keating/learner-contracts";
import { css } from "../../../styled-system/css";
import { SharedUiDocumentRenderer } from "./shared-renderer";

const frameClass = css({ width: "min(48rem, calc(100vw - 2rem))", paddingBlock: "1rem" });

function documentOf(node: UiSimulationNode): UiDocument {
	return {
		schemaVersion: 1,
		id: `storybook-${node.id}`,
		revision: 0,
		lifecycle: "ready",
		retention: "workspace",
		supportedSurfaces: ["web", "desktop", "mobile", "terminal"],
		nodes: [node],
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
	};
}

function StoryFrame({ node }: { node: UiSimulationNode }) {
	return <div className={frameClass}><SharedUiDocumentRenderer document={documentOf(node)} /></div>;
}

const meta = {
	title: "Learning/Simulation",
	component: StoryFrame,
	parameters: { layout: "centered" },
} satisfies Meta<typeof StoryFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The case the component exists for: a 99% accurate test, a rare condition, and
 * an answer almost nobody predicts. Drag specificity from 99 to 99.9 and watch
 * one decimal place move the result about ninefold.
 */
export const BaseRateNeglect: Story = {
	args: {
		node: {
			type: "simulation",
			id: "base-rate",
			title: "A positive test result",
			brief: "Guess the answer before you touch anything. Then raise **specificity** by one decimal place.",
			parameters: [
				{ id: "prevalence", label: "Prevalence", unit: "per 100k", min: 1, max: 5000, step: 1, value: 10 },
				{ id: "sensitivity", label: "Sensitivity", unit: "%", min: 50, max: 100, step: 0.1, value: 99 },
				{ id: "specificity", label: "Specificity", unit: "%", min: 50, max: 100, step: 0.1, value: 99 },
			],
			readouts: [
				{
					id: "ppv",
					label: "Chance they actually have it",
					unit: "%",
					emphasis: true,
					expr: "100 * (prevalence/100000 * sensitivity/100) / (prevalence/100000 * sensitivity/100 + (1 - prevalence/100000) * (1 - specificity/100))",
				},
				{
					id: "ratio",
					label: "False positives per true positive",
					precision: 1,
					expr: "((1 - prevalence/100000) * (1 - specificity/100)) / (prevalence/100000 * sensitivity/100)",
				},
			],
		},
	},
};

/** Compound growth, where the intuition that breaks is linear thinking. */
export const CompoundGrowth: Story = {
	args: {
		node: {
			type: "simulation",
			id: "compounding",
			title: "What a percentage point is worth",
			brief: "Raise the rate by one point. How does the curve change?",
			parameters: [
				{ id: "principal", label: "Starting amount", min: 100, max: 100000, step: 100, value: 10000 },
				{ id: "rate", label: "Annual rate", unit: "%", min: 0, max: 15, step: 0.1, value: 5 },
				{ id: "years", label: "Years", min: 1, max: 50, step: 1, value: 30 },
			],
			readouts: [
				{ id: "final", label: "Final amount", emphasis: true, precision: 0, expr: "principal * (1 + rate/100) ^ years" },
				{ id: "multiple", label: "Multiple of what you put in", precision: 2, expr: "(1 + rate/100) ^ years" },
				{ id: "simple", label: "If it did not compound", precision: 0, expr: "principal * (1 + rate/100 * years)" },
			],
		},
	},
};

export const MobileExperiment: Story = {
	args: CompoundGrowth.args,
	parameters: { viewport: { defaultViewport: "mobile1" } },
	render: ({ node }) => <div style={{ width: "min(22rem, calc(100vw - 2rem))" }}><SharedUiDocumentRenderer document={documentOf(node)} /></div>,
};

export const ChangeGraphAxes: Story = {
	args: CompoundGrowth.args,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(canvas.getByRole("combobox", { name: "Graph horizontal axis" }));
		await userEvent.click(await page.findByRole("option", { name: "Annual rate (%)" }));
		await userEvent.click(await canvas.findByRole("combobox", { name: "Graph output" }));
		await userEvent.click(await page.findByRole("option", { name: "If it did not compound" }));
		await expect(await canvas.findByRole("figure", { name: "If it did not compound against Annual rate (%)" })).toBeVisible();
	},
};

/** A sampled plot must never draw a connection across an undefined result. */
export const DomainGap: Story = {
	args: {
		node: {
			type: "simulation",
			id: "domain-gap",
			title: "What happens near zero?",
			brief: "Move the input toward zero from either side.",
			parameters: [{ id: "input", label: "Input", min: -4, max: 4, step: 0.1, value: 1 }],
			readouts: [
				{ id: "reciprocal", label: "Reciprocal", expr: "1 / input", emphasis: true },
				{ id: "square-root", label: "Square root", expr: "input ^ 0.5" },
			],
		},
	},
};

/**
 * Division by zero, a negative fractional power, and an overflow. Every one of
 * these must read as an em dash — never NaN, Infinity, or a broken surface.
 */
export const UndecidableReadouts: Story = {
	args: {
		node: {
			type: "simulation",
			id: "edge-cases",
			title: "Readouts that cannot produce a number",
			brief: "Set the divisor to zero. The readouts degrade; the surface does not.",
			parameters: [
				{ id: "numerator", label: "Numerator", min: 0, max: 100, step: 1, value: 42 },
				{ id: "divisor", label: "Divisor", min: 0, max: 10, step: 1, value: 0 },
			],
			readouts: [
				{ id: "quotient", label: "Divided by zero", emphasis: true, expr: "numerator / divisor" },
				{ id: "root", label: "Root of a negative", expr: "(0 - numerator) ^ 0.5" },
				{ id: "overflow", label: "Overflowed", expr: "10 ^ 400 * 10 ^ 400" },
				{ id: "fine", label: "Still fine", expr: "numerator + divisor" },
			],
		},
	},
};
