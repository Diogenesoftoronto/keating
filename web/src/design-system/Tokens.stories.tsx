import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tokens } from "./Tokens";

const meta = {
	title: "Design System/Tokens",
	component: Tokens,
	parameters: {
		layout: "fullscreen",
	},
} satisfies Meta<typeof Tokens>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
