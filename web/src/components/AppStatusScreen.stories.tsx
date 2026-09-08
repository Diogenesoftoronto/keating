import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { AppStatusScreen } from "./AppStatusScreen";

const meta = {
	title: "App/Status screens",
	component: AppStatusScreen,
	parameters: { layout: "fullscreen" },
	args: { status: "404", onBack: fn(), homeHref: "/" },
	argTypes: { status: { control: "select", options: ["loading", "404", "403", "500", "offline"] } },
} satisfies Meta<typeof AppStatusScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
	args: { status: "loading", onBack: undefined },
	parameters: { docs: { description: { story: "Moving TV snow stays inside Keatingbot's screen. It freezes for the system reduced-motion preference or Keating's reduced-motion setting." } } },
};
export const NotFound: Story = { args: { status: "404" } };
export const Forbidden: Story = { args: { status: "403" } };
export const ServerError: Story = { args: { status: "500", onRetry: fn() } };
export const Offline: Story = { args: { status: "offline", onRetry: fn() } };
