import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, within } from "storybook/test";
import { css } from "../../styled-system/css";
import { KeatingUiSettingsTab } from "./KeatingUiSettingsTab";

const meta = {
	title: "Settings/InterfaceSettings",
	component: KeatingUiSettingsTab,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className={css({ minHeight: "100vh", backgroundColor: "var(--background)", padding: { base: "0.75rem", sm: "1.5rem" }, color: "var(--foreground)" })}>
				<div className={css({ marginInline: "auto", width: "100%", maxWidth: "56rem" })}>
					<Story />
				</div>
			</div>
		),
	],
} satisfies Meta<typeof KeatingUiSettingsTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ResponseComparisonsEnabled: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await fireEvent.change(
			canvas.getByRole("spinbutton", { name: "Response comparison chance percent" }),
			{ target: { value: "35" } },
		);
	},
};

export const Mobile: Story = {
	parameters: { viewport: { defaultViewport: "mobile1" } },
	globals: { viewport: { value: "mobile1", isRotated: false } },
};
