import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ChatIntro } from "./ChatIntro";

const meta = {
	title: "Chat/ChatIntro",
	component: ChatIntro,
	args: {
		onDismiss: fn(),
	},
	parameters: {
		layout: "fullscreen",
	},
} satisfies Meta<typeof ChatIntro>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
