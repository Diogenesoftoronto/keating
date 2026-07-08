import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import { AnimationPlayer } from "./AnimationPlayer";

const storyWidthClass = css({ width: "min(58rem, calc(100vw - 2rem))" });

const storyboard = `# Animation Storyboard: Entropy

## Scene 1: Intuition (3s)
- **Visual**: Three ordered bars loosen into a wider distribution.
- **Narration**: Entropy measures how many arrangements fit the same macrostate.
- **Highlight**: More arrangements means less surprise.

## Scene 2: Transfer (4s)
- **Visual**: A tidy shelf and a messy shelf are compared as state spaces.
- **Narration**: The messy shelf has many more ways to be messy.
- **Transition**: Match the concrete shelf to the formal distribution.`;

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
    i { width: 54px; height: 28%; background: #4be388; }
    p { color: #c7d2fe; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    gsap.timeline({ repeat: 0 })
      .from("h1", { y: 24, opacity: 0, duration: 0.5 })
      .to(".bars i", { height: "82%", opacity: 0.78, stagger: 0.12, duration: 1.3, ease: "power2.inOut" })
      .from("p", { y: 18, opacity: 0, duration: 0.45 }, "-=0.25");
  </script>
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
			<div className={storyWidthClass}>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AnimationPlayer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const HyperframesArtifact: Story = {
	args: {
		storyboard,
		scene: hyperframesScene,
		manifest: hyperframesManifest,
	},
};
