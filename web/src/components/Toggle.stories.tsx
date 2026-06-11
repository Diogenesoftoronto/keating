import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Toggle } from "./Toggle";

const meta = {
	title: "UI/Toggle",
	component: Toggle,
	args: {
		checked: false,
		onChange: fn(),
		"aria-label": "Demo toggle",
	},
} satisfies Meta<typeof Toggle>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Off: Story = {};

export const On: Story = {
	args: { checked: true },
};

export const DisabledOff: Story = {
	args: { disabled: true, checked: false },
};

export const DisabledOn: Story = {
	args: { disabled: true, checked: true },
};

export const SuccessToneOn: Story = {
	args: { tone: "success", checked: true },
};

export const SuccessToneOff: Story = {
	args: { tone: "success", checked: false },
};
