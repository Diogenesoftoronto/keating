import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { compileOpenUISourceToSharedDocument } from "@keating/learner-contracts";
import { css } from "../../../styled-system/css";
import { SharedUiDocumentRenderer } from "./shared-renderer";

const frameClass = css({ width: "min(40rem, calc(100vw - 2rem))", paddingBlock: "1rem" });

/** Authored the way the tutor writes it: one OpenUI statement, compiled to the shared contract. */
function StoryFrame({ statement }: { statement: string }) {
	const document = compileOpenUISourceToSharedDocument(`root = LearningSurface([model], "", "", "ephemeral")\nmodel = ${statement}`, {
		documentId: `storybook-${statement.slice(0, 24).replace(/\W+/g, "-")}`,
		createdAt: "2026-11-20T00:00:00.000Z",
	});
	return <div className={frameClass}><SharedUiDocumentRenderer document={document} onAction={() => true} /></div>;
}

const meta = {
	title: "Learning/Early learning",
	component: StoryFrame,
	parameters: { layout: "centered" },
} satisfies Meta<typeof StoryFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A worked hop drawn for the learner to read, then a point for them to place. */
export const NumberLineHops: Story = {
	args: { statement: 'NumberLine("add-on", "Start at 3, hop 4", 0, 10, 1, [{ value: 3, label: "start" }], [{ from: 3, to: 4 }, { from: 4, to: 5 }], "Two hops are done. Make two more. Where do you land?", "ephemeral", "Count each hop out loud.")' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const line = canvas.getByRole("slider", { name: "Your point on the number line" });
		line.focus();
		await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
		await expect(line).toHaveAttribute("aria-valuenow", "7");
	},
};

/** A picture only: the tutor talks over it, so there are no controls. */
export const NumberLinePicture: Story = {
	args: { statement: 'NumberLine("skip-count", "Counting by fives", 0, 50, 5, [], [{ from: 0, to: 5 }, { from: 5, to: 10 }, { from: 10, to: 15 }])' },
};

export const TenFrameMakeTen: Story = {
	args: { statement: 'TenFrame("make-ten", "Make ten", 7, 1, "How many more make ten? Fill them in.")' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Space 8" }));
		await expect(canvas.getByRole("button", { name: "Space 8, filled" })).toHaveAttribute("aria-pressed", "true");
	},
};

export const TwoTenFrames: Story = {
	args: { statement: 'TenFrame("teen", "Thirteen", 13, 2)' },
};

export const PlaceValueBuild: Story = {
	args: { statement: 'PlaceValue("build-342", "Build 342", 0, "Build 342 with hundreds, tens and ones.")' },
};

export const PlaceValuePicture: Story = {
	args: { statement: 'PlaceValue("show-256", "What number is this?", 256)' },
};

export const FractionBarsCompare: Story = {
	args: { statement: 'FractionBars("half-quarters", "One half and quarters", [{ parts: 2, shaded: 1, label: "1/2" }, { parts: 4, shaded: 0, label: "quarters" }, { parts: 8, shaded: 0, label: "eighths" }], "Shade the quarters and the eighths so each matches one half.")' },
};

export const CountingArrayApples: Story = {
	args: { statement: 'CountingArray("apples", "Rows of apples", 3, 4, "apple", "How many apples? Tap each one as you count.")' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Row 1, apple 1" }));
		await expect(canvas.getByText("Counted 1")).toBeInTheDocument();
	},
};

export const CountingArrayDots: Story = {
	args: { statement: 'CountingArray("times", "Four rows of six", 4, 6, "dot")' },
};

export const ClockSetTime: Story = {
	args: { statement: 'Clock("half-past", "Half past three", 3, 0, "Set the clock to half past three.")' },
};
