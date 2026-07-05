import type { Meta, StoryObj } from "@storybook/react-vite";
import { Recipes } from "./Recipes";

const meta = {
	title: "Design System/Recipes",
	component: Recipes,
	parameters: {
		layout: "fullscreen",
	},
} satisfies Meta<typeof Recipes>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
