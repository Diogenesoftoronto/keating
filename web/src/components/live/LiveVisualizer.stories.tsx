import type { Meta, StoryObj } from "@storybook/react-vite";

import { css } from "../../../styled-system/css";
import LiveVisualizer from "./LiveVisualizer";

const frameClass = css({
	display: "grid",
	placeItems: "center",
	width: "22rem",
	height: "22rem",
	backgroundColor: "var(--background)",
});

const meta = {
	title: "Live/LiveVisualizer",
	component: LiveVisualizer,
	parameters: { layout: "centered" },
	decorators: [(Story) => <div className={frameClass}><Story /></div>],
	args: { state: "listening", inputStream: null, size: 208 },
	argTypes: {
		state: { control: "select", options: ["connecting", "listening", "speaking", "working", "idle"] },
	},
} satisfies Meta<typeof LiveVisualizer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Listening: Story = {};
export const Connecting: Story = { args: { state: "connecting" } };
export const Speaking: Story = { args: { state: "speaking" } };
export const UsingATool: Story = { args: { state: "working" } };
export const Idle: Story = { args: { state: "idle" } };
