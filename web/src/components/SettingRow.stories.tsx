import type { Meta, StoryObj } from "@storybook/react-vite";
import { Toggle } from "./Toggle";
import { SettingRow } from "./SettingRow";

const meta = {
	title: "UI/SettingRow",
	component: SettingRow,
	args: {
		title: "Enable Diagnostics",
		description: "Send anonymous usage metrics to help improve Keating.",
		children: <Toggle checked={false} onChange={() => {}} aria-label="Toggle diagnostics" />,
	},
} satisfies Meta<typeof SettingRow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoDescription: Story = {
	args: {
		title: "Dark Mode",
		description: undefined,
		children: <Toggle checked={true} onChange={() => {}} aria-label="Toggle dark mode" />,
	},
};

export const LongDescription: Story = {
	args: {
		title: "Advanced Caching",
		description:
			"When enabled, Keating will cache intermediate computation results across sessions. This reduces latency for repeated topics but increases local storage usage.",
		children: <Toggle checked={false} onChange={() => {}} aria-label="Toggle caching" />,
	},
};

export const WithCustomChild: Story = {
	args: {
		title: "Model Temperature",
		description: "Controls randomness in generated responses.",
		children: (
			<div className="flex items-center gap-2">
				<span className="text-sm font-mono">0.7</span>
				<input type="range" min={0} max={1} step={0.1} defaultValue={0.7} className="w-24 accent-primary" />
			</div>
		),
	},
};
