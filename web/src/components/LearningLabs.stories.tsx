import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { SharedUiDocumentRenderer, type SharedUiActionEvent } from "../keating/openui/shared-renderer";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CodingChallenge } from "./CodingChallenge";
import { MusicLab } from "./MusicLab";
import { TWO_SUM_CHALLENGE, MUSIC_LAB_EXAMPLES } from "./labs/examples";

const meta = { title: "Learning/Labs", parameters: { layout: "centered" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const frame = { width: "min(640px, calc(100vw - 40px))", padding: "16px" };

export const Coding: Story = { render: () => <div style={frame}><CodingChallenge node={TWO_SUM_CHALLENGE} /></div> };
export const TypeScript: Story = { render: () => <div style={frame}><CodingChallenge node={{ ...TWO_SUM_CHALLENGE, language: "typescript", starterCode: "function twoSum(nums: number[], target: number): number[] {\n  return [];\n}" }} /></div> };
export const MobileCoding: Story = { render: () => <div style={{ width: "min(350px, calc(100vw - 32px))" }}><CodingChallenge node={TWO_SUM_CHALLENGE} /></div> };
export const Polyrhythm: Story = { render: () => <div style={frame}><MusicLab node={MUSIC_LAB_EXAMPLES.polyrhythm} /></div> };
export const Intervals: Story = { render: () => <div style={frame}><MusicLab node={MUSIC_LAB_EXAMPLES.intervals} /></div> };
export const Timbre: Story = { render: () => <div style={frame}><MusicLab node={MUSIC_LAB_EXAMPLES.timbre} /></div> };
export const MobileMusic: Story = { render: () => <div style={{ width: "min(350px, calc(100vw - 32px))" }}><MusicLab node={MUSIC_LAB_EXAMPLES.polyrhythm} /></div> };

function CodingResultHandoff() {
  const [events, setEvents] = useState<SharedUiActionEvent[]>([]);
  return <div style={frame}><SharedUiDocumentRenderer document={{ schemaVersion: 1, id: "coding-handoff", revision: 0, lifecycle: "ready", supportedSurfaces: ["web"], createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z", nodes: [TWO_SUM_CHALLENGE] }} onAction={event => { setEvents(previous => [...previous, event]); return true; }} /><pre data-testid="coding-evidence">{JSON.stringify(events)}</pre></div>;
}

export const CodingHandoff: Story = {
  render: () => <CodingResultHandoff />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editor = canvas.getByRole("textbox", { name: "Your JavaScript solution" });
    await userEvent.clear(editor);
    await userEvent.click(editor);
    await userEvent.paste("function twoSum() { return [0,1]; }");
    await userEvent.click(canvas.getByRole("button", { name: "Run tests" }));
    await waitFor(() => expect(canvas.getByText("2 / 3 sample tests passed")).toBeVisible(), { timeout: 10000 });
    const evidence = JSON.parse(canvas.getByTestId("coding-evidence").textContent!);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].intent).toMatchObject({ type: "run-coding-challenge", code: "function twoSum() { return [0,1]; }", cases: [{ passed: true }, { passed: false }, { passed: true }] });
    await userEvent.clear(editor);
    await userEvent.click(editor);
    await userEvent.paste("function twoSum(nums, target) { for(let i=0;i<nums.length;i++) for(let j=i+1;j<nums.length;j++) if(nums[i]+nums[j]===target) return [i,j]; }");
    await userEvent.click(canvas.getByRole("button", { name: "Run tests" }));
    await waitFor(() => expect(canvas.getByText("3 / 3 sample tests passed")).toBeVisible(), { timeout: 10000 });
    const passed = JSON.parse(canvas.getByTestId("coding-evidence").textContent!);
    expect(passed).toHaveLength(2);
    expect(passed[1].intent.cases.every((item: { passed: boolean }) => item.passed)).toBe(true);
    expect(passed[1].intent.runId).not.toBe(passed[0].intent.runId);
  },
};

export const CodingWorkTimer: Story = {
  render: () => <CodingResultHandoff />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const clock = canvas.getByRole("timer");
    const editor = canvas.getByRole("textbox", { name: "Your JavaScript solution" });
    expect(clock).toHaveTextContent("00:00");
    expect(canvas.getByRole("button", { name: "Pause work timer" })).toBeDisabled();
    await userEvent.click(editor);
    await waitFor(() => expect(clock).not.toHaveTextContent("00:00"), { timeout: 3000 });
    await userEvent.click(canvas.getByRole("button", { name: "Pause work timer" }));
    const pausedTime = clock.textContent;
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(clock).toHaveTextContent(pausedTime!);
    expect(canvas.getByText("Paused")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Resume work timer" }));
    await userEvent.clear(editor);
    await userEvent.click(editor);
    await userEvent.paste("function twoSum(nums, target) { for(let i=0;i<nums.length;i++) for(let j=i+1;j<nums.length;j++) if(nums[i]+nums[j]===target) return [i,j]; }");
    await userEvent.click(canvas.getByRole("button", { name: "Run tests" }));
    await waitFor(() => expect(canvas.getByText("3 / 3 sample tests passed")).toBeVisible(), { timeout: 10000 });
    expect(canvas.getByText("Complete")).toBeVisible();
    const events = JSON.parse(canvas.getByTestId("coding-evidence").textContent!);
    expect(events).toHaveLength(1);
    expect(events[0].intent.timing.runNumber).toBe(1);
    expect(events[0].intent.timing.workingMs).toBeGreaterThanOrEqual(1000);
    expect(events[0].intent.timing.sinceLastRunMs).toBe(events[0].intent.timing.workingMs);
    const finishedTime = clock.textContent;
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(clock).toHaveTextContent(finishedTime!);
    await userEvent.click(editor);
    expect(canvas.getByText("Counting")).toBeVisible();
  },
};
