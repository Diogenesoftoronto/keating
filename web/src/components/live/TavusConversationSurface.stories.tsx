import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { css } from "../../../styled-system/css";
import TavusConversationSurface from "./TavusConversationSurface";

const stageClass = css({
	position: "relative",
	width: "min(56rem, 100vw)",
	height: "min(38rem, 100vh)",
	minHeight: "24rem",
});

const meta = {
	title: "Live/TavusConversationSurface",
	component: TavusConversationSurface,
	parameters: { layout: "centered" },
	decorators: [(Story) => <div className={stageClass}><Story /></div>],
	args: {
		url: "https://tavus.daily.co/storybook-preview?t=not-a-real-token",
		title: "KeatingBot interactive video conversation",
		onEvent: fn(),
		onControlsChange: fn(),
		connect: false,
	},
} satisfies Meta<typeof TavusConversationSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A non-networked prejoin state. It never requests camera or microphone access. */
export const ReadyToJoin: Story = {};

export const MobileStage: Story = {
	parameters: { viewport: { defaultViewport: "mobile1" } },
	globals: { viewport: { value: "mobile1", isRotated: false } },
};
