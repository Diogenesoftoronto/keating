import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { KeatingBot, KEATING_BOT_CHAT_STATES, KEATING_BOT_ACTIVITY_STATES, type KeatingBotState } from "./KeatingBot";

const states: KeatingBotState[] = [...KEATING_BOT_CHAT_STATES, ...KEATING_BOT_ACTIVITY_STATES];
const meta = {
	title: "Brand/KeatingBot",
	component: KeatingBot,
	args: { variant: "head", state: "idle", size: 64, animated: true },
	argTypes: { variant: { control: "select", options: ["head", "body"] }, state: { control: "select", options: states }, size: { control: { type: "range", min: 24, max: 240, step: 8 } }, frame: { control: { type: "number", min: 0, max: 7, step: 1 }, description: "Zero-based frozen frame. Every state has 8 authored stop-motion poses. Clear to animate." } },
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
			<figcaption style={{ fontSize: ".8125rem", textTransform: "capitalize" }}>{state} · 8 poses</figcaption>
		</figure>)}
	</div>,
};
export const FullBodyGallery: Story = { ...StateGallery, args: { variant: "body" } };
export const SpeakingFrames: Story = {
	args: { state: "speaking", size: 128 },
	render: args => <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", padding: "1rem" }}>{Array.from({ length: 8 }, (_, frame) => <figure key={frame} style={{ margin: 0, textAlign: "center" }}><KeatingBot {...args} frame={frame} /><figcaption style={{ marginTop: ".5rem", fontSize: ".8125rem" }}>Frame {frame + 1}</figcaption></figure>)}</div>,
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
		<p style={{ fontSize: ".8125rem" }}>Switch states, or select success, sitting, or flipping again to replay the gesture.</p>
		<label><input type="checkbox" checked={freeze} onChange={event => setFreeze(event.target.checked)} /> Inspect individual frames</label>
		{freeze && <label>Frame {frame + 1} of 8<input type="range" min={0} max={7} step={1} value={frame} onChange={event => setFrame(Number(event.target.value))} /></label>}
	</div>;
}

export const Playground: Story = { render: () => <StatePlayground /> };

export const Waving: Story = { args: { state: "waving", variant: "body", size: 208 } };
export const WavingFrames: Story = { ...SpeakingFrames, args: { state: "waving", variant: "body", size: 160 } };

export const StopMotionGallery: Story = {
	render: args => <div style={{ display: "grid", gap: "3rem", padding: "1rem" }}>
		{[{ title: "Conversation", states: KEATING_BOT_CHAT_STATES }, { title: "Study and play", states: KEATING_BOT_ACTIVITY_STATES }].map(group => <section key={group.title}>
			<h2 style={{ fontSize: "1rem", margin: "0 0 1.5rem" }}>{group.title}</h2>
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "2rem" }}>
				{group.states.map(state => <figure key={state} style={{ margin: 0, display: "grid", justifyItems: "center", gap: "1rem" }}>
					<KeatingBot {...args} variant="head" state={state} size={144} />
					<KeatingBot {...args} variant="body" state={state} size={176} />
					<figcaption style={{ fontSize: ".8125rem", textTransform: "capitalize" }}>{state}</figcaption>
				</figure>)}
			</div>
		</section>)}
	</div>,
};

export const Walking: Story = { args: { state: "walking", variant: "body", size: 208 } };
export const Sitting: Story = { args: { state: "sitting", variant: "body", size: 208 } };
export const Flipping: Story = { args: { state: "flipping", variant: "body", size: 208 } };
export const ActivityFrames: Story = { ...SpeakingFrames, args: { state: "reading", variant: "body", size: 160 } };

export const Loading: Story = { args: { state: "loading", variant: "body", size: 200 } };
