import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { css } from "../../styled-system/css";
import { STARTER_PROMPTS } from "../keating/starter-prompts";
import { SuggestedPrompts } from "./AssistantChatPanel";

const representativePrompts = [
	STARTER_PROMPTS.find((prompt) => prompt.domain === "earth-science")!,
	STARTER_PROMPTS.find((prompt) => prompt.domain === "psychology")!,
	STARTER_PROMPTS.find((prompt) => prompt.domain === "literature")!,
];

const meta = {
	title: "Chat/SuggestedPrompts",
	component: SuggestedPrompts,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className={css({ height: "28rem", minWidth: 0, backgroundColor: "var(--background)", color: "var(--foreground)" })}>
				<Story />
			</div>
		),
	],
	args: {
		onSelect: fn(),
		initialPrompts: representativePrompts,
	},
} satisfies Meta<typeof SuggestedPrompts>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DiverseTopics: Story = {};

export const MobileCarousel: Story = {
	parameters: {
		viewport: { defaultViewport: "mobile1" },
	},
	globals: {
		viewport: { value: "mobile1", isRotated: false },
	},
};
