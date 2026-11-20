import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UiActionReceipt, UiLabNode } from "@keating/learner-contracts";
import { TeachingLab } from "./TeachingLab";

const frame = { width: "min(640px, calc(100vw - 32px))", padding: 16 };
const midi: UiLabNode = { type: "lab", id: "play-two", title: "Play a major third", brief: "Play C4 followed by E4, then return to C.",
  adapter: { kind: "midi" }, checkpoints: [
    { id: "third", title: "Two pitches", check: { kind: "notes", notes: [60, 64] } },
    { id: "tonic", title: "Return to C", check: { kind: "notes", notes: [60] } },
  ] };
const shell: UiLabNode = { type: "lab", id: "greet", title: "Print a greeting", brief: "Make the script print hello and exit cleanly.",
  adapter: { kind: "code", language: "sh", source: "echo hello" }, checkpoints: [
    { id: "hello", title: "Prints hello", check: { kind: "output", stdout: "hello\n", exitCode: 0 } },
  ] };
const serial: UiLabNode = { type: "lab", id: "thermo", title: "Read the room temperature", brief: "Hold the sensor still and check a reading between 18 and 24 °C.",
  adapter: { kind: "serial", baudRate: 9600, unit: "°C" }, checkpoints: [
    { id: "range", title: "A reading in range", check: { kind: "range", min: 18, max: 24 } },
  ] };
const met: UiActionReceipt = { state: "completed", action: { type: "observe-lab", nodeId: "play-two", checkpointId: "third", attemptId: "a1", passed: true,
  observation: { kind: "notes", notes: [60, 64], input: "screen" }, evidence: "" } } as unknown as UiActionReceipt;

const meta = { title: "Learning/Teaching lab", component: TeachingLab, parameters: { layout: "centered" },
  decorators: [Story => <div style={frame}><Story /></div>] } satisfies Meta<typeof TeachingLab>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Midi: Story = { args: { node: midi, onAction: () => true } };
export const MidiOneMet: Story = { args: { node: midi, receipts: [met], onAction: () => true } };
export const Shell: Story = { args: { node: shell, onAction: () => true } };
export const Serial: Story = { args: { node: serial } };
