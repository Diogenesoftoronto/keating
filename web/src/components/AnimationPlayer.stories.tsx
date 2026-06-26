import type { Meta, StoryObj } from "@storybook/react-vite";
import { AnimationPlayer } from "./AnimationPlayer";

const storyboard = `# Animation Storyboard: Entropy

## Scene 1: Intuition (3s)
- **Visual**: Three ordered bars loosen into a wider distribution.
- **Narration**: Entropy measures how many arrangements fit the same macrostate.
- **Highlight**: More arrangements means less surprise.

## Scene 2: Transfer (4s)
- **Visual**: A tidy shelf and a messy shelf are compared as state spaces.
- **Narration**: The messy shelf has many more ways to be messy.
- **Transition**: Match the concrete shelf to the formal distribution.`;

const manimManifest = JSON.stringify({
	topic: "Entropy",
	slug: "entropy",
	renderer: "manim",
	scenes: ["intuition", "transfer"],
	duration: 7,
}, null, 2);

const hyperframesManifest = JSON.stringify({
	topic: "Entropy",
	slug: "entropy",
	renderer: "hyperframes",
	scenes: ["intuition", "transfer"],
	duration: 7,
}, null, 2);

const hyperframesScene = `<!doctype html>
<html>
<body>
  <div class="stage">
    <h1>Entropy</h1>
    <div class="bars"><i></i><i></i><i></i><i></i><i></i></div>
    <p>Energy spreads across more possible arrangements.</p>
  </div>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #08111f; color: #f4f1e8; font-family: ui-monospace, monospace; overflow: hidden; }
    .stage { width: min(760px, 90vw); text-align: center; }
    h1 { font-size: 48px; margin: 0 0 32px; }
    .bars { display: flex; align-items: end; justify-content: center; gap: 14px; height: 220px; }
    i { width: 54px; background: #4be388; animation: spread 2.8s infinite alternate cubic-bezier(.16,1,.3,1); }
    i:nth-child(1) { height: 30%; animation-delay: 0ms; }
    i:nth-child(2) { height: 54%; animation-delay: 110ms; }
    i:nth-child(3) { height: 86%; animation-delay: 220ms; }
    i:nth-child(4) { height: 48%; animation-delay: 330ms; }
    i:nth-child(5) { height: 24%; animation-delay: 440ms; }
    p { color: #c7d2fe; }
    @keyframes spread { to { height: 52%; transform: translateY(var(--shift, 0)); opacity: .78; } }
  </style>
</body>
</html>`;

const meta = {
	title: "Artifacts/Animation Player",
	component: AnimationPlayer,
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story) => (
			<div className="w-[min(58rem,calc(100vw-2rem))]">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AnimationPlayer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ManimStoryboardArtifact: Story = {
	args: {
		storyboard,
		scene: "async function construct(scene, M) { /* stored manim scene source */ }",
		manifest: manimManifest,
	},
};

export const HyperframesArtifact: Story = {
	args: {
		storyboard,
		scene: hyperframesScene,
		manifest: hyperframesManifest,
	},
};
