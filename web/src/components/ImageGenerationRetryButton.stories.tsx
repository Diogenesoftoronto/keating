import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { css } from "../../styled-system/css";
import { ImageGenerationRetryButton } from "./ImageGenerationRetryButton";

const meta = {
	title: "Models/ImageGenerationRetryButton",
	component: ImageGenerationRetryButton,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className={css({ borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, var(--destructive) 60%, transparent)", backgroundColor: "color-mix(in srgb, var(--destructive) 10%, transparent)", padding: "0.75rem", fontSize: "0.75rem", color: "var(--destructive)" })}>
				<p>Image generation failed before the provider returned an image.</p>
				<Story />
			</div>
		),
	],
	args: { onRetry: fn() },
} satisfies Meta<typeof ImageGenerationRetryButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FailedGeneration: Story = {};
