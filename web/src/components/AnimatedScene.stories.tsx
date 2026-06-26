import type { Meta, StoryObj } from "@storybook/react-vite";
import { AnimatedScene } from "./AnimatedScene";

const manimBody = `async function construct(scene, M) {
  const title = new M.Text({ text: "Bayes rule", fontSize: 48, color: "#f4f1e8" });
  title.moveTo([0, 2.8, 0]);
  await scene.play(new M.Write(title));

  const prior = new M.Text({ text: "Prior", fontSize: 30, color: "#fbbf24" });
  prior.moveTo([-4, 0.8, 0]);
  const evidence = new M.Text({ text: "Evidence", fontSize: 30, color: "#93c5fd" });
  evidence.moveTo([0, 0.8, 0]);
  const posterior = new M.Text({ text: "Posterior", fontSize: 30, color: "#86efac" });
  posterior.moveTo([4, 0.8, 0]);

  await scene.play(new M.FadeIn(prior), new M.FadeIn(evidence));
  await scene.play(new M.Create(new M.Arrow([-2.8, 0.8, 0], [-1.1, 0.8, 0], { color: "#93c5fd" })));
  await scene.play(new M.FadeIn(posterior));
  await scene.wait(1.2);
}`;

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
  <script>
    const panels = document.querySelectorAll('.panel');
    panels.forEach((panel, index) => {
      panel.animate(
        [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { delay: index * 420, duration: 620, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' }
      );
    });
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
			<div className="w-[min(58rem,calc(100vw-2rem))]">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AnimatedScene>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ManimWeb: Story = {
	args: {
		payload: {
			topic: "Bayes rule",
			kind: "manim",
			summary: "A staged prior to evidence to posterior flow using manim-web primitives.",
			body: manimBody,
		},
	},
};

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
