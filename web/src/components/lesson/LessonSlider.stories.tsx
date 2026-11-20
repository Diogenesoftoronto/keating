import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { LessonFrame } from "./LessonFrame";
import { LessonSlider, type LessonSliderProps } from "./LessonSlider";

const percent = (value: number) => `${Number(value.toFixed(1))}%`;

function Demo({ width = 420, ...props }: Partial<LessonSliderProps> & { width?: number }) {
  const [value, setValue] = useState(props.value ?? 99);
  return <div style={{ width: `min(${width}px, calc(100vw - 32px))`, padding: 16 }}>
    <LessonFrame glyph="signal" kind="Simulation" title="A positive test result">
      <LessonSlider label="Specificity (%)" min={50} max={100} step={0.1} start={99} format={percent} {...props} value={value} onChange={setValue} />
      <LessonSlider label="Tempo (BPM)" min={40} max={160} step={1} start={96} value={96} format={value => `${value} BPM`} onChange={() => {}} disabled={props.disabled} />
    </LessonFrame>
  </div>;
}

const meta = { title: "Learning/Lesson slider", component: Demo, parameters: { layout: "centered" } } satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

/** At rest: the value sits at the end of the label row, the ruler shows min and max. */
export const Rest: Story = {};

/** Keyboard focus: the value tag rides above the square thumb and the thumb takes the focus ring. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const range = canvas.getByRole("slider", { name: "Specificity (%)" });
    await userEvent.tab();
    expect(range).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(range).toHaveAttribute("aria-valuetext", "99.2%");
  },
};

/** Moved from the authored start: a faint tick and "from 99%" show how far the learner went. */
export const MovedFromStart: Story = { args: { value: 99.9 } };

/** Typing an exact value: the inline number becomes a well. */
export const ExactValue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Type an exact Specificity/ }));
    const well = canvas.getByRole("spinbutton", { name: "Specificity (%) numeric value" });
    await userEvent.clear(well);
    await userEvent.type(well, "72.5{Enter}");
    expect(canvas.getByRole("slider", { name: "Specificity (%)" })).toHaveAttribute("aria-valuetext", "72.5%");
  },
};

export const Disabled: Story = { args: { disabled: true, value: 80 } };

/** Phone width: the ruler keeps its ends, "from" hides under 17rem. */
export const Narrow: Story = { args: { width: 300, value: 70 } };
