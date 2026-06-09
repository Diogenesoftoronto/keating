import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ForkBanner } from "./ForkBanner";

const meta = {
	title: "Chat/ForkBanner",
	component: ForkBanner,
	args: {
		parentTitle: "Photosynthesis basics",
		onOpenOriginal: fn(),
	},
} satisfies Meta<typeof ForkBanner>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongTitle: Story = {
	args: {
		parentTitle:
			"A very long original session title that should be truncated gracefully instead of pushing the Open original button off-screen",
	},
};
