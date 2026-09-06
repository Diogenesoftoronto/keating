import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { SandboxView } from "./SandboxView";

function RuntimeStory() {
  const [open, setOpen] = useState(true);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open runtime</button>
    <SandboxView open={open} onClose={() => setOpen(false)} />
  </>;
}

const meta = {
  title: "Workspace/Runtime",
  component: RuntimeStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RuntimeStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Uses the real runtime; starting NodePod requires an explicit button press. */
export const BrowserWorkspace: Story = {};
export const Mobile: Story = { parameters: { viewport: { defaultViewport: "mobile1" } } };

export const DropdownNavigation: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole("dialog", { name: "Runtime" });
    await userEvent.click(within(dialog).getByRole("combobox", { name: "More runtime views" }));
    await userEvent.click(await within(dialog).findByRole("option", { name: "Diagnostics" }));
    await expect(await within(dialog).findByRole("heading", { name: "Diagnostics" })).toBeVisible();
    await userEvent.click(await within(dialog).findByRole("combobox", { name: "Operation" }));
    await userEvent.click(await within(dialog).findByRole("option", { name: "Ping runtime" }));
    await expect(await within(dialog).findByRole("combobox", { name: "Operation" })).toHaveTextContent("Ping runtime");
  },
};
