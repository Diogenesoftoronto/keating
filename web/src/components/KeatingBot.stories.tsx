import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { KeatingBot, type KeatingBotState } from "./KeatingBot";

const states: KeatingBotState[] = ["idle", "listening", "thinking", "speaking", "success", "waving"];
const meta = {
	title: "Brand/KeatingBot",
	component: KeatingBot,
	args: { variant: "head", state: "idle", size: 64, animated: true },
	argTypes: { variant: { control: "select", options: ["head", "body"] }, state: { control: "select", options: states }, size: { control: { type: "range", min: 24, max: 240, step: 8 } }, frame: { control: { type: "number", min: 0, max: 11, step: 1 }, description: "Zero-based frozen frame. Thinking has 4; speaking has 8; body waving has 12. Clear to animate." } },
} satisfies Meta<typeof KeatingBot>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
export const FullBody: Story = { args: { variant: "body", size: 160 } };
export const Static: Story = { args: { animated: false, state: "thinking" } };
export const StaticSuccess: Story = { args: { animated: false, state: "success", size: 160 } };
export const StaticBodySuccess: Story = { args: { animated: false, state: "success", variant: "body", size: 160 } };
export const StateGallery: Story = {
	render: args => <div style={{ display: "flex", flexWrap: "wrap", gap: "2rem", padding: "1rem" }}>
		{states.map(state => <figure key={state} style={{ margin: 0, display: "grid", justifyItems: "center", gap: "1rem" }}>
			<KeatingBot {...args} state={state} size={160} />
			<KeatingBot {...args} state={state} size={64} />
			<KeatingBot {...args} state={state} size={32} />
			<figcaption style={{ fontSize: ".8125rem", textTransform: "capitalize" }}>{state}{state === "speaking" ? " · 8 mouth shapes" : state === "thinking" ? " · 4 frames" : ""}</figcaption>
		</figure>)}
	</div>,
};
export const FullBodyGallery: Story = { ...StateGallery, args: { variant: "body" } };
export const SpeakingFrames: Story = {
	args: { state: "speaking", size: 128 },
	render: args => <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", padding: "1rem" }}>{Array.from({ length: args.state === "waving" ? 12 : args.state === "thinking" ? 4 : 8 }, (_, frame) => <figure key={frame} style={{ margin: 0, textAlign: "center" }}><KeatingBot {...args} frame={frame} /><figcaption style={{ marginTop: ".5rem", fontSize: ".8125rem" }}>Frame {frame + 1}</figcaption></figure>)}</div>,
};
export const ThinkingFrames: Story = { ...SpeakingFrames, args: { state: "thinking", size: 128 } };
export const BodySpeakingFrames: Story = { ...SpeakingFrames, args: { state: "speaking", variant: "body", size: 160 } };
export const BodyThinkingFrames: Story = { ...SpeakingFrames, args: { state: "thinking", variant: "body", size: 160 } };

function StatePlayground() {
	const [state, setState] = useState<KeatingBotState>("idle");
	const [iteration, setIteration] = useState(0);
	const [freeze, setFreeze] = useState(false);
	const [frame, setFrame] = useState(0);
	return <div style={{ display: "grid", justifyItems: "center", gap: "1.5rem", padding: "2rem" }}>
		<div style={{ display: "flex", flexWrap: "wrap", gap: "2rem" }}><KeatingBot key={`head:${iteration}`} variant="head" state={state} size={160} frame={freeze ? frame : undefined} /><KeatingBot key={`body:${iteration}`} variant="body" state={state} size={160} frame={freeze ? frame : undefined} /></div>
		<div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem" }}>{states.map(value => <button type="button" key={value} aria-pressed={state === value} onClick={() => { setState(value); setIteration(previous => previous + 1); }} style={{ minHeight: 44, padding: ".5rem .875rem", border: "1px solid currentColor", borderRadius: 6, font: "inherit", background: state === value ? "var(--accent, #eee)" : "transparent", color: "inherit", cursor: "pointer" }}>{value}</button>)}</div>
		<p style={{ fontSize: ".8125rem" }}>Switch states, or select success again to replay its one-shot animation.</p>
		<label><input type="checkbox" checked={freeze} onChange={event => setFreeze(event.target.checked)} /> Inspect individual frames</label>
		{freeze && <label>Frame {Math.min(frame, state === "waving" ? 11 : state === "speaking" ? 7 : 3) + 1} of {state === "waving" ? 12 : state === "speaking" ? 8 : 4}<input type="range" min={0} max={state === "waving" ? 11 : state === "speaking" ? 7 : 3} step={1} value={Math.min(frame, state === "waving" ? 11 : state === "speaking" ? 7 : 3)} onChange={event => setFrame(Number(event.target.value))} /></label>}
	</div>;
}

export const Playground: Story = { render: () => <StatePlayground /> };

export const Waving: Story = { args: { state: "waving", variant: "body", size: 208 } };
export const WavingFrames: Story = { ...SpeakingFrames, args: { state: "waving", variant: "body", size: 160 } };
