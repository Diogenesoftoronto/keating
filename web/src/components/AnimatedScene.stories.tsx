import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import { AnimatedScene } from "./AnimatedScene";

const storyWidthClass = css({ width: "min(58rem, calc(100vw - 2rem))" });

const hyperframesBody = `<!doctype html>
<html>
<body>
  <main class="stage">
    <section class="panel prior">Prior<br><small>belief before evidence</small></section>
    <section class="panel evidence">Evidence<br><small>what the world just showed</small></section>
    <section class="panel posterior">Posterior<br><small>updated belief</small></section>
  </main>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #08111f; color: #f4f1e8; font-family: ui-monospace, monospace; overflow: hidden; }
    .stage { width: min(920px, 92vw); display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
    .panel { min-height: 180px; display: grid; place-items: center; text-align: center; border: 1px solid rgba(244,241,232,.35); background: rgba(244,241,232,.08); font-size: 28px; transform: translateY(24px); opacity: 0; }
    small { display: block; max-width: 14ch; margin-top: 12px; color: #c7d2fe; font-size: 12px; line-height: 1.4; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    gsap.timeline()
      .to(".prior", { opacity: 1, y: 0, duration: 0.55 })
      .to(".evidence", { opacity: 1, y: 0, duration: 0.55 })
      .to(".posterior", { opacity: 1, y: 0, duration: 0.55 });
  </script>
</body>
</html>`;

const meta = {
	title: "Artifacts/Authored Animation",
	component: AnimatedScene,
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
} satisfies Meta<typeof AnimatedScene>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Hyperframes: Story = {
	args: {
		payload: {
			topic: "Bayes rule",
			kind: "hyperframes",
			summary: "A self-contained HTML timeline for the same concept.",
			body: hyperframesBody,
		},
	},
};
