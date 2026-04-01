import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { buildLessonPlan } from "./lesson-plan.js";
import { animationsDir } from "./paths.js";
import { resolveTopic } from "./topics.js";
import { TeacherPolicy } from "./types.js";
import { slugify } from "./util.js";

export type AnimationSceneKind = "function-graph" | "distribution-bars" | "belief-update" | "concept-card";

export interface AnimationManifest {
  topic: string;
  slug: string;
  domain: string;
  sceneKind: AnimationSceneKind;
  rationale: string[];
  focusMoments: string[];
}

export interface AnimationArtifact {
  topicDir: string;
  playerPath: string;
  scenePath: string;
  storyboardPath: string;
  manifestPath: string;
}

function pickSceneKind(topicName: string): AnimationSceneKind {
  const topic = resolveTopic(topicName);
  if (topic.slug === "derivative") return "function-graph";
  if (topic.slug === "entropy") return "distribution-bars";
  if (topic.slug === "bayes-rule") return "belief-update";
  return "concept-card";
}

function importSpecifierFrom(dirPath: string, targetPath: string): string {
  const specifier = relative(dirPath, targetPath).replaceAll("\\", "/");
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

function installedManimWebDistDir(): string {
  const moduleUrl = (import.meta as unknown as { url: string }).url;
  const modulePath = decodeURIComponent(moduleUrl.replace(/^file:\/\//, ""));
  const packageRoot = modulePath.includes("/src/")
    ? modulePath.split("/src/")[0]
    : modulePath.includes("/dist/src/")
      ? modulePath.split("/dist/src/")[0]
      : join(dirname(modulePath), "../../../");
  return join(packageRoot, "node_modules/manim-web/dist");
}

async function copyDir(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await writeFile(targetPath, await readFile(sourcePath));
    }
  }
}

function sceneRationale(topicName: string, policy: TeacherPolicy, sceneKind: AnimationSceneKind): string[] {
  const topic = resolveTopic(topicName);
  return [
    `${topic.title} is marked visualizable=${String(topic.visualizable)} and belongs to ${topic.domain}.`,
    `The current policy prefers diagrams at ${policy.diagramBias.toFixed(2)} and formalism at ${policy.formalism.toFixed(2)}.`,
    sceneKind === "function-graph"
      ? "A function graph highlights local change, secant-to-tangent motion, and equation refinement."
      : sceneKind === "distribution-bars"
        ? "A bar chart makes multiplicity, relative weight, and entropy growth legible before symbol manipulation."
        : sceneKind === "belief-update"
          ? "A belief-update chart makes prior, evidence, and posterior shifts visible instead of purely verbal."
          : "A concept-card scene is safer when the concept is philosophical or the visual grammar is still exploratory.",
    `Interdisciplinary hooks carried into the scene: ${topic.interdisciplinaryHooks.join(", ")}.`
  ];
}

export function buildAnimationManifest(topicName: string, policy: TeacherPolicy): AnimationManifest {
  const topic = resolveTopic(topicName);
  const plan = buildLessonPlan(topicName, policy);
  const sceneKind = pickSceneKind(topicName);
  return {
    topic: topic.title,
    slug: slugify(topicName),
    domain: topic.domain,
    sceneKind,
    rationale: sceneRationale(topicName, policy, sceneKind),
    focusMoments: plan.phases.slice(0, 4).map((phase) => `${phase.title}: ${phase.purpose}`)
  };
}

function derivativeSceneSource(importSpecifier: string): string {
  return `import { Axes, Text, MathTex, Create, Write, FadeIn, Transform } from ${JSON.stringify(importSpecifier)};

const palette = {
  background: "#08111f",
  ink: "#f8f5ec",
  accent: "#ff7a59",
  support: "#7bb0ff",
  soft: "#9dd7c8"
};

function textLine(text, y, fontSize = 28, color = palette.ink) {
  const node = new Text({ text, fontSize, color, fontFamily: "Iowan Old Style, Georgia, serif" });
  node.moveTo([0, y, 0]);
  return node;
}

export async function construct(scene) {
  const title = textLine("Derivative: local change made visible", 3.2, 34);
  const cue = textLine("Shrink the interval while watching the slope stabilize.", 2.55, 24, palette.soft);
  const axes = new Axes({
    xRange: [-2, 3, 1],
    yRange: [-1, 6, 1],
    xLength: 10,
    yLength: 5.5,
    color: palette.support
  });
  axes.moveTo([0, -0.2, 0]);

  const parabola = axes.plot((x) => x * x, {
    xRange: [-1.8, 2.2],
    color: palette.accent,
    strokeWidth: 5
  });

  const secant = new MathTex({
    latex: "\\\\frac{f(x+h)-f(x)}{h}",
    fontSize: 42,
    color: palette.ink
  });
  secant.moveTo([0, -3.05, 0]);

  const tangent = new MathTex({
    latex: "\\\\lim_{h \\\\to 0}\\\\frac{f(x+h)-f(x)}{h}=2x",
    fontSize: 38,
    color: palette.ink
  });
  tangent.moveTo([0, -3.05, 0]);
  await tangent.waitForRender();

  await scene.play(new Write(title), new FadeIn(cue));
  await scene.play(new Create(axes), new Create(parabola));
  await scene.play(new Write(secant));
  await scene.wait(0.6);
  await scene.play(new Transform(secant, tangent));
  await scene.wait(1.2);
}
`;
}

function entropySceneSource(importSpecifier: string): string {
  return `import { BarChart, Text, MathTex, Create, Write, FadeIn, Transform } from ${JSON.stringify(importSpecifier)};

const palette = {
  ink: "#f8f5ec",
  accent: "#ff9b42",
  accentAlt: "#69c2ff",
  accentSoft: "#8fd7b6"
};

function textLine(text, y, fontSize = 28, color = palette.ink) {
  const node = new Text({ text, fontSize, color, fontFamily: "Iowan Old Style, Georgia, serif" });
  node.moveTo([0, y, 0]);
  return node;
}

export async function construct(scene) {
  const title = textLine("Entropy: more compatible arrangements", 3.15, 34);
  const cue = textLine("Count the hidden ways a macrostate can happen.", 2.55, 24, palette.accentSoft);
  const chart = new BarChart({
    values: [1, 3, 8],
    xLabels: ["ordered", "mixed", "high W"],
    barColors: [palette.accentAlt, palette.accentSoft, palette.accent],
    yRange: [0, 8, 2],
    width: 8.5,
    height: 4.6,
    axisColor: palette.ink
  });
  chart.moveTo([0, -0.25, 0]);

  const multiplicity = new MathTex({
    latex: "W \\\\uparrow \\\\Rightarrow S \\\\uparrow",
    fontSize: 38,
    color: palette.ink
  });
  multiplicity.moveTo([0, -2.95, 0]);
  await multiplicity.waitForRender();

  const formula = new MathTex({
    latex: "S = k \\\\log W",
    fontSize: 42,
    color: palette.ink
  });
  formula.moveTo([0, -2.95, 0]);
  await formula.waitForRender();

  await scene.play(new Write(title), new FadeIn(cue));
  await scene.play(new Create(chart));
  await scene.play(new Write(multiplicity));
  await scene.wait(0.6);
  await scene.play(new Transform(multiplicity, formula));
  await scene.wait(1.2);
}
`;
}

function bayesSceneSource(importSpecifier: string): string {
  return `import { BarChart, Text, MathTex, Create, Write, FadeIn, Transform } from ${JSON.stringify(importSpecifier)};

const palette = {
  ink: "#f8f5ec",
  prior: "#8fd7b6",
  evidence: "#79a8ff",
  posterior: "#ff7a59"
};

function textLine(text, y, fontSize = 28, color = palette.ink) {
  const node = new Text({ text, fontSize, color, fontFamily: "Iowan Old Style, Georgia, serif" });
  node.moveTo([0, y, 0]);
  return node;
}

export async function construct(scene) {
  const title = textLine("Bayes: beliefs after evidence", 3.15, 34);
  const cue = textLine("Base rates matter before a positive signal arrives.", 2.55, 24, palette.prior);
  const chart = new BarChart({
    values: [0.01, 0.9, 0.083],
    xLabels: ["prior", "likelihood", "posterior"],
    barColors: [palette.prior, palette.evidence, palette.posterior],
    yRange: [0, 1, 0.25],
    width: 8.5,
    height: 4.6,
    axisColor: palette.ink
  });
  chart.moveTo([0, -0.25, 0]);

  const intuition = new MathTex({
    latex: "posterior \\\\propto prior \\\\times likelihood",
    fontSize: 34,
    color: palette.ink
  });
  intuition.moveTo([0, -2.95, 0]);
  await intuition.waitForRender();

  const formula = new MathTex({
    latex: "P(H|E)=\\\\frac{P(E|H)P(H)}{P(E)}",
    fontSize: 38,
    color: palette.ink
  });
  formula.moveTo([0, -2.95, 0]);
  await formula.waitForRender();

  await scene.play(new Write(title), new FadeIn(cue));
  await scene.play(new Create(chart));
  await scene.play(new Write(intuition));
  await scene.wait(0.6);
  await scene.play(new Transform(intuition, formula));
  await scene.wait(1.2);
}
`;
}

function conceptCardSceneSource(importSpecifier: string, topicName: string, policy: TeacherPolicy): string {
  const topic = resolveTopic(topicName);
  const manifest = buildAnimationManifest(topicName, policy);
  const thesis = topic.formalCore[0] ?? topic.summary;
  const misconception = topic.misconceptions[0] ?? `Avoid flattening ${topic.title} into a slogan.`;
  const bridge = topic.interdisciplinaryHooks[0] ?? "application";

  return `import { Text, FadeIn, Write } from ${JSON.stringify(importSpecifier)};

const palette = {
  ink: "#f8f5ec",
  accent: "#d9b36c",
  warning: "#ff8e72",
  soft: "#87c8be"
};

function textLine(text, y, fontSize = 28, color = palette.ink) {
  const node = new Text({
    text,
    fontSize,
    color,
    fontFamily: "Iowan Old Style, Georgia, serif",
    lineHeight: 1.15
  });
  node.moveTo([0, y, 0]);
  return node;
}

export async function construct(scene) {
  const title = textLine(${JSON.stringify(`${topic.title}: meaning before slogans`)}, 3.05, 34, palette.accent);
  const thesis = textLine(${JSON.stringify(thesis)}, 1.25, 26);
  const warning = textLine(${JSON.stringify(`Misconception: ${misconception}`)}, -0.15, 24, palette.warning);
  const bridge = textLine(${JSON.stringify(`Bridge outward: ${bridge}`)}, -1.65, 24, palette.soft);
  const cue = textLine(${JSON.stringify(manifest.rationale[2] ?? "A concept-card scene keeps the visual grammar explicit while the teaching policy evolves.")}, -2.75, 22);

  await scene.play(new Write(title));
  await scene.play(new FadeIn(thesis), new FadeIn(warning), new FadeIn(bridge), new FadeIn(cue));
  await scene.wait(1.2);
}
`;
}

export function animationSceneSource(topicName: string, policy: TeacherPolicy, importSpecifier: string): string {
  const sceneKind = pickSceneKind(topicName);
  if (sceneKind === "function-graph") return derivativeSceneSource(importSpecifier);
  if (sceneKind === "distribution-bars") return entropySceneSource(importSpecifier);
  if (sceneKind === "belief-update") return bayesSceneSource(importSpecifier);
  return conceptCardSceneSource(importSpecifier, topicName, policy);
}

export function animationStoryboardMarkdown(topicName: string, policy: TeacherPolicy): string {
  const manifest = buildAnimationManifest(topicName, policy);
  const plan = buildLessonPlan(topicName, policy);

  const lines = [
    `# Animation Storyboard: ${manifest.topic}`,
    "",
    `- Scene kind: ${manifest.sceneKind}`,
    `- Domain: ${manifest.domain}`,
    `- Policy: ${policy.name}`,
    "",
    "## Why This Visual",
    ...manifest.rationale.map((item) => `- ${item}`),
    "",
    "## Focus Moments",
    ...manifest.focusMoments.map((item) => `- ${item}`),
    "",
    "## Teaching Beats",
    ...plan.phases.map((phase) => `- ${phase.title}: ${phase.purpose}`),
    ""
  ];

  return `${lines.join("\n").trim()}\n`;
}

export async function writeLessonAnimation(
  cwd: string,
  topicName: string,
  policy: TeacherPolicy
): Promise<AnimationArtifact> {
  const slug = slugify(topicName);
  const topicDir = join(animationsDir(cwd), slug);
  await mkdir(topicDir, { recursive: true });

  const vendorDir = join(topicDir, "_vendor", "manim-web");
  await copyDir(installedManimWebDistDir(), vendorDir);
  const importSpecifier = importSpecifierFrom(topicDir, join(vendorDir, "index.js"));

  const playerPath = join(topicDir, "player.html");
  const scenePath = join(topicDir, "scene.mjs");
  const storyboardPath = join(topicDir, "storyboard.md");
  const manifestPath = join(topicDir, "manifest.json");
  const readmePath = join(topicDir, "README.md");
  const manifest = buildAnimationManifest(topicName, policy);
  const sceneSource = animationSceneSource(topicName, policy, importSpecifier);
  const playerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Keating Animation: ${manifest.topic}</title>
    <style>
      :root {
        color-scheme: dark;
        --paper: #f8f5ec;
        --ink: #07111d;
        --frame: #10223a;
        --muted: #90a3b8;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(121, 168, 255, 0.25), transparent 28rem),
          linear-gradient(180deg, #08111f 0%, #050a12 100%);
        color: var(--paper);
        font-family: "Iowan Old Style", Georgia, serif;
      }
      main {
        width: min(92vw, 1280px);
        display: grid;
        gap: 1rem;
      }
      header {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: end;
      }
      .meta {
        color: var(--muted);
        font-size: 0.95rem;
      }
      #scene {
        height: min(72vh, 760px);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 20px;
        overflow: hidden;
        box-shadow: 0 24px 90px rgba(0, 0, 0, 0.35);
        background: #08111f;
      }
      a { color: #b5d2ff; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <div class="meta">Keating visual artifact</div>
          <h1>${manifest.topic}</h1>
        </div>
        <div class="meta">
          <div><a href="./storyboard.md">storyboard.md</a></div>
          <div><a href="./manifest.json">manifest.json</a></div>
        </div>
      </header>
      <div id="scene"></div>
    </main>
    <script type="module">
      import { Scene } from ${JSON.stringify(importSpecifier)};
      import { construct } from "./scene.mjs";

      const container = document.getElementById("scene");
      const scene = new Scene(container, {
        width: 1280,
        height: 720,
        backgroundColor: "#08111f"
      });

      await construct(scene);
    </script>
  </body>
</html>
`;
  const readme = `# ${manifest.topic} Animation Bundle

- Serve the repository root with a static file server, for example: \`python3 -m http.server 4173\`
- Open: \`http://localhost:4173/${relative(cwd, playerPath).replaceAll("\\", "/")}\`
- Inspect the bundle in \`scene.mjs\`, \`storyboard.md\`, and \`manifest.json\`

This bundle is deterministic source output. Keating does not yet export a video in Node; it generates a browser-runnable \`manim-web\` scene so the visual teaching layer can evolve under versioned prompts and tests.
`;

  await Promise.all([
    writeFile(scenePath, sceneSource, "utf8"),
    writeFile(playerPath, playerHtml, "utf8"),
    writeFile(storyboardPath, animationStoryboardMarkdown(topicName, policy), "utf8"),
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(readmePath, readme, "utf8")
  ]);

  return { topicDir, playerPath, scenePath, storyboardPath, manifestPath };
}
