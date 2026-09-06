import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState, type ReactNode } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { Select, type SelectProps } from "./Select";

const meta = {
  title: "Design System/Select",
  component: Select,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div style={{ padding: "24px 16px", maxWidth: 420, color: "var(--foreground)", fontFamily: "var(--font-ui, sans-serif)" }}><Story /></div>],
  args: { value: "", onValueChange: fn(), children: <><option value="">All subjects</option><option value="math">Mathematics</option><option value="science">Science</option><option value="languages">Languages</option></> },
  render: (args) => <ControlledSelect {...args} />,
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

function Field({ children, htmlFor, label = "Subject" }: { children: ReactNode; htmlFor: string; label?: string }) {
  return <div style={{ display: "grid", gap: 8, minWidth: 0 }}><label htmlFor={htmlFor} style={{ fontSize: 14, fontWeight: 600 }}>{label}</label>{children}</div>;
}

function ControlledSelect(args: SelectProps) {
  const [value, setValue] = useState(args.value);
  return <Field htmlFor="select-story"><Select {...args} id="select-story" value={value} onValueChange={(next) => { setValue(next); args.onValueChange(next); }} /></Field>;
}

export const Default: Story = {};

export const EmptyAndNumeric: Story = {
  args: { children: <><option value="">Off</option><option value={5}>5 seconds</option><option value={15}>15 seconds</option></> },
  render: (args) => <TimerForm {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("combobox", { name: "Reveal timer" }));
    await userEvent.click(await page.findByRole("option", { name: "15 seconds" }));
    await expect(args.onValueChange).toHaveBeenLastCalledWith("15");
    await userEvent.click(canvas.getByRole("button", { name: "Save timer" }));
    await expect(canvas.getByRole("status")).toHaveTextContent("Saved: 15");
    await userEvent.click(canvas.getByRole("combobox", { name: "Reveal timer" }));
    await userEvent.click(await page.findByRole("option", { name: "Off" }));
    await expect(args.onValueChange).toHaveBeenLastCalledWith("");
    await userEvent.click(canvas.getByRole("button", { name: "Save timer" }));
    await expect(canvas.getByRole("status")).toHaveTextContent("Saved: off");
  },
};

function TimerForm(args: SelectProps) {
  const [value, setValue] = useState(args.value);
  const [saved, setSaved] = useState<string>();
  return <form aria-label="Timer settings" onSubmit={(event) => { event.preventDefault(); setSaved(String(new FormData(event.currentTarget).get("delay"))); }} style={{ display: "grid", gap: 16 }}>
    <Field htmlFor="timer-select" label="Reveal timer"><Select {...args} id="timer-select" name="delay" value={value} onValueChange={(next) => { setValue(next); args.onValueChange(next); }} /></Field>
    <button type="submit">Save timer</button>
    <output role="status">{saved === undefined ? "Unsaved" : `Saved: ${saved || "off"}`}</output>
  </form>;
}

export const KeyboardAndGroups: Story = {
  args: { value: "art", children: <><optgroup label="Available"><option value="art">Art</option><option value="biology" disabled>Biology</option><option value="math">Mathematics</option><option value="science">Science</option></optgroup><optgroup label="Coming soon" disabled><option value="astronomy">Astronomy</option><option value="zoology">Zoology</option></optgroup></> },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("combobox", { name: "Subject" });
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    await page.findByRole("option", { name: "Art" });
    await userEvent.keyboard("{End}");
    await waitFor(() => expect(page.getByRole("option", { name: "Science" })).toHaveFocus());
    await expect(page.getByRole("option", { name: "Zoology" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Home}");
    await waitFor(() => expect(page.getByRole("option", { name: "Art" })).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(page.getByRole("option", { name: "Mathematics" })).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await expect(args.onValueChange).toHaveBeenLastCalledWith("math");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}");
    await page.findByRole("option", { name: "Art" });
    await userEvent.keyboard("s");
    await waitFor(() => expect(page.getByRole("option", { name: "Science" })).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(trigger).toHaveTextContent("Mathematics");
  },
};

export const Disabled: Story = {
  args: { value: "science", disabled: true },
  play: async ({ canvasElement }) => { await expect(within(canvasElement).getByRole("combobox", { name: "Subject" })).toBeDisabled(); },
};

export const LongMenu: Story = {
  args: { value: "1", children: Array.from({ length: 40 }, (_, index) => <option key={index + 1} value={index + 1}>{index === 8 ? "Session 9 · A very long title that wraps cleanly within narrow phone screens" : `Session ${index + 1}`}</option>) },
};

export const InNativeDialog: Story = {
  render: (args) => <DialogSelect {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Choose subject" }));
    const dialog = await page.findByRole("dialog", { name: "Practice settings" });
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Subject" }));
    const option = await within(dialog).findByRole("option", { name: "Languages" });
    await userEvent.click(option);
    await expect(within(dialog).getByRole("combobox", { name: "Subject" })).toHaveTextContent("Languages");
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  },
};

function DialogSelect(args: SelectProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(args.value);
  return <>
    <button type="button" onClick={() => dialog.current?.showModal()}>Choose subject</button>
    <dialog ref={dialog} aria-labelledby="select-dialog-title" style={{ width: "min(360px, calc(100vw - 24px))", padding: 20, borderRadius: 12, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", overflow: "visible" }}>
      <h2 id="select-dialog-title" style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Practice settings</h2>
      <Field htmlFor="dialog-select"><Select {...args} ref={trigger} id="dialog-select" value={value} onValueChange={(next) => { setValue(next); args.onValueChange(next); }} /></Field>
      <button type="button" onClick={() => dialog.current?.close()} style={{ marginTop: 20 }}>Done</button>
    </dialog>
  </>;
}

export const Required: Story = {
  args: { children: <><option value="">Choose a subject</option><option value="math">Mathematics</option></>, required: true },
  render: (args) => <TimerForm {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Save timer" }));
    await expect(canvas.getByRole("status")).toHaveTextContent("Unsaved");
    await expect(canvas.getByRole("combobox", { name: "Reveal timer" })).toHaveFocus();
    await userEvent.click(canvas.getByRole("combobox", { name: "Reveal timer" }));
    await userEvent.click(await page.findByRole("option", { name: "Mathematics" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save timer" }));
    await expect(canvas.getByRole("status")).toHaveTextContent("Saved: math");
  },
};
