import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { LANGUAGE_PRACTICE_ROUNDS_FIXTURE, type UiLanguagePracticeNode } from "@keating/learner-contracts";
import { LanguagePractice, type LanguagePracticeProps } from "./LanguagePractice";
import { installRecordingFixture, recordingFixtureStreams, recordingFixtureRevokedUrls } from "./language/recording-fixture";

const node: UiLanguagePracticeNode = { type: "language-practice", id: "language-spanish", title: "A little Spanish", language: "Spanish", rounds: LANGUAGE_PRACTICE_ROUNDS_FIXTURE };
const meta = {
  title: "Learning/Language practice",
  component: LanguagePractice,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div style={{ width: "min(38rem, 100%)", margin: "1rem auto" }}><Story /></div>],
  args: { node, disabled: false, onAction: fn(() => true) },
} satisfies Meta<typeof LanguagePractice>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Translation: Story = {};
export const WordOrder: Story = { args: { node: { ...node, rounds: [node.rounds[1]!] } } };
export const Listening: Story = { args: { node: { ...node, rounds: [node.rounds[2]!] } } };
export const Pronunciation: Story = { args: { node: { ...node, rounds: [node.rounds[3]!] } } };
export const ProviderVoice: Story = { args: { node: { ...node, rounds: [{ id: "voice", kind: "pronunciation", prompt: "Listen. Say it. Compare.", text: "Buenos días" }] } } };

export const CompleteMixedPractice: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Your translation" }), "Buenas noches");
    await userEvent.click(canvas.getByRole("button", { name: "Check" }));
    await waitFor(() => expect(canvas.getByText("One to practice")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Your translation" }), "Buenos días");
    await userEvent.click(canvas.getByRole("button", { name: "Check" }));
    await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
    await userEvent.click(canvas.getByRole("button", { name: "Quiero" }));
    await userEvent.click(canvas.getByRole("button", { name: "un" }));
    await userEvent.click(canvas.getByRole("button", { name: "café" }));
    await userEvent.click(canvas.getByRole("button", { name: "Check" }));
    await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
    await expect(canvas.queryByText("Hola", { exact: true })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Listen to reference" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Listen to reference" })).toBeEnabled(), { timeout: 6_000 });
    await userEvent.type(canvas.getByRole("textbox", { name: "What you heard" }), "Hola");
    await userEvent.click(canvas.getByRole("button", { name: "Check" }));
    await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
    await expect(canvas.getByRole("button", { name: "Finish practice" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Record yourself" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "Skip" }));
    await expect(canvas.getByRole("heading", { name: "Practice complete" })).toHaveFocus();
    await expect(canvas.getByText("3/3")).toBeVisible();
    await expect(args.onAction).toHaveBeenCalledWith(expect.objectContaining({ intent: expect.objectContaining({ type: "complete-language-practice", correct: 3, objectiveTotal: 3, pronunciationPracticed: 0, rounds: expect.arrayContaining([expect.objectContaining({ roundId: "greeting", attempts: 2 }), expect.objectContaining({ roundId: "thanks", outcome: "skipped", attempts: 0 })]) }) }));
  },
};

export const SaveRecovery: Story = {
  args: { node: { ...node, rounds: [node.rounds[0]!] }, onAction: fn() },
  render: (args) => <RecoverablePractice {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Your translation" }), "Buenos días");
    await userEvent.click(canvas.getByRole("button", { name: "Check" }));
    await userEvent.click(canvas.getByRole("button", { name: "Finish practice" }));
    await expect(canvas.getByRole("heading", { name: "Ready to save" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Retry save practice" }));
    await expect(canvas.getByRole("heading", { name: "Practice complete" })).toHaveFocus();
    const calls = (args.onAction as ReturnType<typeof fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0]).toEqual(calls[1]?.[0]);
  },
};

export const AudioUnavailable: Story = {
  args: { node: { ...node, rounds: [{ id: "missing", kind: "listening", prompt: "Type what you hear", text: "Hola", acceptedAnswers: ["Hola"], referenceAudioUrl: "/audio/language/missing.mp3" }] } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Listen to reference" }));
    await waitFor(() => expect(canvas.getByRole("alert")).toBeVisible(), { timeout: 6_000 });
    await expect(canvas.getByRole("button", { name: "Check" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Skip" }));
    await expect(canvas.getByRole("heading", { name: "Practice complete" })).toBeVisible();
    await expect(args.onAction).toHaveBeenCalledWith(expect.objectContaining({ intent: expect.objectContaining({ correct: 0, pronunciationPracticed: 0, rounds: [expect.objectContaining({ outcome: "skipped", attempts: 0 })] }) }));
  },
};

function RecoverablePractice(args: LanguagePracticeProps) {
  const attempts = useRef(0);
  return <LanguagePractice {...args} onAction={(event) => { args.onAction?.(event); attempts.current += 1; return attempts.current > 1; }} />;
}

export const RecordingLifecycleFixture: Story = {
  args: { node: { ...node, rounds: [node.rounds[3]!] } },
  beforeEach: installRecordingFixture,
  decorators: [(Story) => <><p style={{ padding: "0 .75rem", fontSize: 12 }}>Browser recording fixture · synthetic microphone</p><Story /></>],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Listen to reference" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Listen to reference" })).toBeEnabled(), { timeout: 6_000 });
    await userEvent.click(canvas.getByRole("button", { name: "Record yourself" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: /^Stop ·/ })).toBeEnabled());
    // A real, short capture interval ensures the browser has encoded audio chunks.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await userEvent.click(canvas.getByRole("button", { name: /^Stop ·/ }));
    await waitFor(() => expect(canvas.getByText("Your recording")).toBeVisible());
    const audio = canvasElement.querySelector("audio")!;
    expect(audio.src).toMatch(/^blob:/);
    expect(recordingFixtureStreams[0]!.getTracks().every((track) => track.readyState === "ended")).toBe(true);
    await audio.play();
    await waitFor(() => expect(canvas.getByRole("button", { name: "Finish practice" })).toBeEnabled(), { timeout: 4_000 });
    await userEvent.click(canvas.getByRole("button", { name: "Finish practice" }));
    await expect(canvas.getByRole("heading", { name: "Practice complete" })).toHaveFocus();
    expect(recordingFixtureRevokedUrls).toContain(audio.src);
    await expect(args.onAction).toHaveBeenCalledWith(expect.objectContaining({ intent: expect.objectContaining({ correct: 0, objectiveTotal: 0, pronunciationPracticed: 1, rounds: [expect.objectContaining({ roundId: "thanks", outcome: "practiced", attempts: 1 })] }) }));
    const intent = (args.onAction as ReturnType<typeof fn>).mock.calls[0]?.[0].intent;
    expect(intent.rounds[0]).not.toHaveProperty("answer");
  },
};

export const RecordingCancelFixture: Story = {
  args: { node: { ...node, rounds: [node.rounds[3]!] } },
  beforeEach: installRecordingFixture,
  render: (args) => <DismissibleRecordingFixture {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Record yourself" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: /^Stop ·/ })).toBeEnabled());
    await userEvent.click(canvas.getByRole("button", { name: "Close capture test" }));
    expect(recordingFixtureStreams[0]!.getTracks().every((track) => track.readyState === "ended")).toBe(true);
    await expect(args.onAction).not.toHaveBeenCalled();
  },
};

function DismissibleRecordingFixture(args: LanguagePracticeProps) {
  const [open, setOpen] = useState(true);
  return <><p style={{ padding: "0 .75rem", fontSize: 12 }}>Browser recording fixture · synthetic microphone</p>{open ? <><button type="button" onClick={() => setOpen(false)}>Close capture test</button><LanguagePractice {...args} /></> : <p>Capture closed</p>}</>;
}
