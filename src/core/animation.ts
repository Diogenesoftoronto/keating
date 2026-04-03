import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { buildLessonPlan } from "./lesson-plan.js";
import { animationsDir } from "./paths.js";
import { resolveTopic } from "./topics.js";
import { TeacherPolicy } from "./types.js";
import { slugify } from "./util.js";

export type AnimationSceneKind =
  | "function-graph"
  | "distribution-bars"
  | "belief-update"
  | "concept-card"
  | "code-trace"
  | "timeline"
  | "case-diagram"
  | "mind-map";

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
  // Canonical slug overrides for backward compatibility
  if (topic.slug === "derivative") return "function-graph";
  if (topic.slug === "entropy") return "distribution-bars";
  if (topic.slug === "bayes-rule") return "belief-update";
  // Route by domain
  switch (topic.domain) {
    case "math": return "function-graph";
    case "science": return "distribution-bars";
    case "code": return "code-trace";
    case "history": return "timeline";
    case "law":
    case "politics": return "case-diagram";
    case "psychology":
    case "arts": return "mind-map";
    case "medicine": return "distribution-bars";
    default: return "concept-card";
  }
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
        ? "A bar chart makes multiplicity, relative weight, and statistical relationships legible before symbol manipulation."
        : sceneKind === "belief-update"
          ? "A belief-update chart makes prior, evidence, and posterior shifts visible instead of purely verbal."
          : sceneKind === "code-trace"
            ? "A code-trace scene shows execution flow, variable state, and call-stack evolution step by step."
            : sceneKind === "timeline"
              ? "A timeline scene places events in chronological order so causal relationships and periodization become visible."
              : sceneKind === "case-diagram"
                ? "A case-diagram scene structures arguments as premises leading to conclusions, making reasoning transparent."
                : sceneKind === "mind-map"
                  ? "A mind-map scene radiates concepts from a central idea, revealing connections and clustering."
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

export function animationSceneSource(topicName: string, policy: TeacherPolicy, importSpecifier: string): string {
  const topic = resolveTopic(topicName);
  const manifest = buildAnimationManifest(topicName, policy);
  const thesis = topic.formalCore[0] ?? topic.summary;
  const misconception = topic.misconceptions[0] ?? `Avoid flattening ${topic.title} into a slogan.`;
  const bridge = topic.interdisciplinaryHooks[0] ?? "application";

  const palette = {
    background: "#08111f",
    ink: "#f8f5ec",
    accent: "#ff7a59",
    support: "#7bb0ff",
    soft: "#9dd7c8",
    warning: "#ff8e72"
  };

  const commonHelpers = `
const palette = ${JSON.stringify(palette, null, 2)};

function textLine(text, y, fontSize = 28, color = palette.ink, fontFamily = "Iowan Old Style, Georgia, serif") {
  const node = new Text({
    text,
    fontSize,
    color,
    fontFamily,
    lineHeight: 1.15
  });
  node.moveTo([0, y, 0]);
  return node;
}
`;

  let sceneLogic = "";

  switch (manifest.sceneKind) {
    case "function-graph":
      sceneLogic = `
  const axes = new Axes({
    xRange: [-2, 3, 1],
    yRange: [-1, 6, 1],
    xLength: 10,
    yLength: 5.5,
    color: palette.support
  });
  axes.moveTo([0, -0.2, 0]);

  const plot = axes.plot((x) => x * x, {
    xRange: [-1.8, 2.2],
    color: palette.accent,
    strokeWidth: 5
  });

  const formula = new MathTex({
    latex: ${JSON.stringify(topic.formalCore[0] || "f(x)")},
    fontSize: 42,
    color: palette.ink
  });
  formula.moveTo([0, -3.05, 0]);

  await scene.play(new Create(axes), new Create(plot));
  await scene.play(new Write(formula));
`;
      break;

    case "distribution-bars":
    case "belief-update":
      sceneLogic = `
  const chart = new BarChart({
    values: [0.2, 0.5, 0.8],
    xLabels: ["initial", "mid", "target"],
    barColors: [palette.support, palette.soft, palette.accent],
    yRange: [0, 1, 0.2],
    width: 8.5,
    height: 4.6,
    axisColor: palette.ink
  });
  chart.moveTo([0, -0.25, 0]);

  const label = textLine(${JSON.stringify(topic.summary)}, -3.0, 24, palette.soft);

  await scene.play(new Create(chart));
  await scene.play(new FadeIn(label));
`;
      break;

    case "code-trace":
      sceneLogic = `
  const code = textLine(${JSON.stringify(topic.examples[0] || "// example code")}, 0, 24, palette.soft, "'Fira Code', monospace");
  const state = textLine("State: evolving...", -2.0, 24, palette.accent);
  await scene.play(new Write(code));
  await scene.play(new FadeIn(state));
`;
      break;

    case "timeline":
      sceneLogic = `
  const events = ${JSON.stringify(topic.diagramNodes.slice(0, 4))};
  for (let i = 0; i < events.length; i++) {
    const node = textLine(events[i], 1.5 - i * 1.0, 28, i % 2 === 0 ? palette.accent : palette.support);
    await scene.play(new FadeIn(node));
    await scene.wait(0.2);
  }
`;
      break;

    case "case-diagram":
      sceneLogic = `
  const premise = textLine(${JSON.stringify(topic.formalCore[0] || "Premise")}, 1.0, 26, palette.soft);
  const conclusion = textLine(${JSON.stringify(topic.summary)}, -1.0, 30, palette.accent);
  await scene.play(new Write(premise));
  await scene.wait(0.5);
  await scene.play(new Transform(premise, conclusion));
`;
      break;

    case "mind-map":
      sceneLogic = `
  const center = textLine(${JSON.stringify(topic.title)}, 0, 42, palette.accent);
  await scene.play(new Write(center));
  const nodes = ${JSON.stringify(topic.diagramNodes.slice(0, 4))};
  const positions = [[-4, 2], [4, 2], [-4, -2], [4, -2]];
  for (let i = 0; i < nodes.length; i++) {
    const node = textLine(nodes[i], 0, 24, palette.support);
    node.moveTo([...positions[i], 0]);
    await scene.play(new FadeIn(node));
  }
`;
      break;

    default: // concept-card
      sceneLogic = `
  const thesis = textLine(${JSON.stringify(thesis)}, 1.25, 26);
  const warning = textLine(${JSON.stringify(`Misconception: ${misconception}`)}, -0.15, 24, palette.warning);
  const hook = textLine(${JSON.stringify(`Bridge: ${bridge}`)}, -1.65, 24, palette.soft);

  await scene.play(new FadeIn(thesis), new FadeIn(warning), new FadeIn(hook));
`;
  }

  return `import { 
  Scene, Text, MathTex, Axes, BarChart, 
  Create, Write, FadeIn, FadeOut, Transform 
} from ${JSON.stringify(importSpecifier)};

${commonHelpers}

export async function construct(scene) {
  const title = textLine(${JSON.stringify(`${topic.title}: ${manifest.sceneKind}`)}, 3.2, 34, palette.accent);
  await scene.play(new Write(title));

  ${sceneLogic}

  await scene.wait(2.0);
}
`;
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
