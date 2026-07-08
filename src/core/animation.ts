import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { artifactScenePalette, prepareArtifactTheme } from "./artifact-theme.js";
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

import { piComplete } from "./pi-agent.js";

function stripMarkdownFences(value: string): string {
  return value.replace(/^```(?:html|javascript|js)?\n?/gim, "").replace(/```$/gm, "").trim();
}

function normalizeHyperframesDocument(source: string, topicTitle: string): string {
  const trimmed = stripMarkdownFences(source);
  if (trimmed.toLowerCase().startsWith("<!doctype") || trimmed.toLowerCase().startsWith("<html")) {
    return trimmed;
  }
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Keating Animation: ${topicTitle}</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
</head>
<body>
${trimmed}
</body>
</html>`;
}

function fallbackHyperframesDocument(topicName: string, policy: TeacherPolicy): string {
  const topic = resolveTopic(topicName);
  const manifest = buildAnimationManifest(topicName, policy);
  const thesis = topic.formalCore[0] ?? topic.summary;
  const misconception = topic.misconceptions[0] ?? `Avoid flattening ${topic.title} into a slogan.`;
  const bridge = topic.interdisciplinaryHooks[0] ?? "application";
  const nodes = topic.diagramNodes.slice(0, 5);
  const palette = artifactScenePalette;
  const cards = nodes.map((node, index) => `<article class="node" id="node-${index}" style="--i:${index}">${node}</article>`).join("\n      ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Keating Animation: ${topic.title}</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <style>
    :root {
      color-scheme: dark;
      --bg: ${palette.background};
      --ink: ${palette.ink};
      --accent: ${palette.accent};
      --support: ${palette.support};
      --soft: ${palette.soft};
      --warning: ${palette.warning};
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: var(--bg); color: var(--ink); }
    body { font-family: "Iowan Old Style", Georgia, serif; }
    .stage { position: relative; width: 100vw; height: 100vh; padding: 6vh 7vw; display: grid; grid-template-columns: 0.95fr 1.05fr; gap: 5vw; align-items: center; }
    .stage::before { content: ""; position: absolute; inset: 0; background: linear-gradient(135deg, rgb(255 122 89 / 0.18), transparent 36%), linear-gradient(315deg, rgb(123 176 255 / 0.2), transparent 42%); pointer-events: none; }
    .copy, .diagram { position: relative; z-index: 1; }
    .eyebrow { margin: 0 0 1rem; color: var(--soft); font: 700 0.8rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: 0.08em; }
    h1 { margin: 0; font-size: clamp(2.4rem, 6vw, 5.8rem); line-height: 0.94; max-width: 9ch; }
    .thesis { margin: 1.5rem 0 0; max-width: 38rem; font-size: clamp(1.05rem, 2vw, 1.45rem); line-height: 1.45; color: rgb(248 245 236 / 0.82); }
    .misconception { margin-top: 1rem; color: var(--warning); font: 600 0.9rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .diagram { min-height: 68vh; display: grid; place-items: center; }
    .orbit { position: relative; width: min(42vw, 34rem); aspect-ratio: 1; border: 1px solid rgb(248 245 236 / 0.16); border-radius: 999px; }
    .core { position: absolute; inset: 28%; display: grid; place-items: center; border-radius: 999px; background: rgb(248 245 236 / 0.1); border: 1px solid rgb(248 245 236 / 0.2); text-align: center; padding: 1.2rem; color: var(--ink); font-weight: 700; }
    .node { position: absolute; left: 50%; top: 50%; width: 11rem; min-height: 4rem; display: grid; place-items: center; padding: 0.75rem; border: 1px solid rgb(248 245 236 / 0.2); background: rgb(0 0 0 / 0.34); backdrop-filter: blur(12px); color: var(--ink); text-align: center; font: 600 0.82rem/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; transform: rotate(calc(var(--i) * 72deg)) translateX(15rem) rotate(calc(var(--i) * -72deg)); }
    .bridge { position: absolute; left: 7vw; right: 7vw; bottom: 5vh; z-index: 2; color: var(--support); font: 600 0.9rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
  </style>
</head>
<body>
  <main class="stage">
    <section class="copy">
      <p class="eyebrow">${manifest.sceneKind} / ${topic.domain}</p>
      <h1>${topic.title}</h1>
      <p class="thesis">${thesis}</p>
      <p class="misconception">Common trap: ${misconception}</p>
    </section>
    <section class="diagram" aria-label="Animated concept structure">
      <div class="orbit">
        <div class="core">${topic.title}</div>
        ${cards}
      </div>
    </section>
    <div class="bridge">Transfer hook: ${bridge}</div>
  </main>
  <script>
    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
    tl.from(".eyebrow", { y: 16, opacity: 0, duration: 0.5 })
      .from("h1", { y: 42, opacity: 0, duration: 0.75 }, "-=0.25")
      .from(".thesis", { y: 24, opacity: 0, duration: 0.6 }, "-=0.25")
      .from(".orbit", { scale: 0.82, opacity: 0, rotate: -12, duration: 0.8 }, "-=0.25")
      .from(".node", { scale: 0.3, opacity: 0, stagger: 0.12, duration: 0.55 }, "-=0.25")
      .from(".misconception", { x: -18, opacity: 0, duration: 0.55 })
      .from(".bridge", { y: 18, opacity: 0, duration: 0.55 }, "-=0.2")
      .to(".orbit", { rotate: 360, duration: 18, repeat: -1, ease: "none" }, 0.8)
      .to(".node", { rotate: "-=360", duration: 18, repeat: -1, ease: "none" }, 0.8);
  </script>
</body>
</html>`;
}

export async function animationSceneSource(cwd: string, topicName: string, policy: TeacherPolicy): Promise<string> {
  const topic = resolveTopic(topicName);
  const manifest = buildAnimationManifest(topicName, policy);
  const thesis = topic.formalCore[0] ?? topic.summary;
  const misconception = topic.misconceptions[0] ?? `Avoid flattening ${topic.title} into a slogan.`;
  const bridge = topic.interdisciplinaryHooks[0] ?? "application";

  const palette = artifactScenePalette;

  const prompt = `You are an expert Hyperframes animation developer. Output one complete, browser-runnable HTML document for an animation explaining the academic topic: "${topic.title}".
  
Domain: ${topic.domain}
Focus: ${manifest.sceneKind}
Topic Details:
- Thesis: ${thesis}
- Misconception to avoid: ${misconception}
- Application: ${bridge}
- Diagram Nodes available: ${JSON.stringify(topic.diagramNodes)}

Environment Context:
We are using Hyperframes: one self-contained HTML document with semantic sections, CSS, and a GSAP timeline loaded from https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js.
Use these colors: ${JSON.stringify(palette)}.

Respond ONLY with the complete HTML document. Do NOT wrap it in markdown fences. Do not provide a preamble or explanation. The animation must use GSAP timelines for real motion, be 16:9 friendly, and visibly teach the exact topic instead of showing a generic title card.`;

  try {
    const html = await piComplete(cwd, prompt, { thinking: "medium" });
    return normalizeHyperframesDocument(html, topic.title);
  } catch (error) {
    console.error("Failed to dynamically generate Hyperframes scene, falling back to deterministic stub:", error);
    return fallbackHyperframesDocument(topicName, policy);
  }
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

  const playerPath = join(topicDir, "player.html");
  const scenePath = join(topicDir, "scene.html");
  const storyboardPath = join(topicDir, "storyboard.md");
  const manifestPath = join(topicDir, "manifest.json");
  const readmePath = join(topicDir, "README.md");
  const manifest = buildAnimationManifest(topicName, policy);
  const sceneSource = await animationSceneSource(cwd, topicName, policy);
  const theme = await prepareArtifactTheme(cwd, topicDir);
  const playerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Keating Animation: ${manifest.topic}</title>
    <link rel="stylesheet" href="${theme.href}" data-keating-artifact-theme="${theme.source}" />
    <style>
      body {
        display: grid;
        align-items: center;
      }
      #scene {
        height: min(72vh, 760px);
        background: ${JSON.stringify(artifactScenePalette.background)};
        border: 0;
        width: 100%;
      }
      .keating-animation-player {
        display: grid;
        gap: 0.75rem;
      }
      .keating-animation-controls {
        display: grid;
        grid-template-columns: auto auto minmax(8rem, 1fr) auto;
        gap: 0.5rem;
        align-items: center;
        border: 1px solid color-mix(in srgb, var(--colors-border, #d7cbb6) 70%, transparent);
        border-radius: 8px;
        padding: 0.5rem;
        background: color-mix(in srgb, var(--colors-background, #f8f1df) 72%, transparent);
      }
      .keating-animation-controls button {
        min-height: 2rem;
        border: 1px solid color-mix(in srgb, var(--colors-border, #d7cbb6) 80%, transparent);
        border-radius: 6px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
        padding: 0 0.65rem;
      }
      .keating-animation-controls button[aria-pressed="true"] {
        border-color: var(--colors-accent, #1e9b50);
        color: var(--colors-accent, #1e9b50);
      }
      .keating-animation-controls input {
        min-width: 0;
        accent-color: var(--colors-accent, #1e9b50);
      }
    </style>
  </head>
  <body>
    <main class="keating-artifact keating-artifact-shell">
      <header class="keating-artifact-header">
        <div>
          <div class="keating-artifact-meta">Keating visual artifact</div>
          <h1 class="keating-artifact-title">${manifest.topic}</h1>
        </div>
        <div class="keating-artifact-links keating-artifact-meta">
          <div><a href="./storyboard.md">storyboard.md</a></div>
          <div><a href="./manifest.json">manifest.json</a></div>
        </div>
      </header>
      <section class="keating-animation-player">
        <iframe id="scene" class="keating-crt-panel" src="./scene.html" title="${manifest.topic} Hyperframes animation" allow="fullscreen"></iframe>
        <div class="keating-animation-controls">
          <button type="button" data-action="toggle">Pause</button>
          <button type="button" data-action="replay">Replay</button>
          <input type="range" min="0" max="1000" value="0" aria-label="Animation progress" />
          <button type="button" data-action="loop" aria-pressed="true">Loop</button>
        </div>
      </section>
    </main>
    <script>
      const frame = document.getElementById("scene");
      const toggle = document.querySelector('[data-action="toggle"]');
      const replay = document.querySelector('[data-action="replay"]');
      const loop = document.querySelector('[data-action="loop"]');
      const range = document.querySelector('input[type="range"]');
      let playing = true;
      let looping = true;
      let scrubbing = false;
      function timeline() {
        return frame.contentWindow && frame.contentWindow.gsap && frame.contentWindow.gsap.globalTimeline;
      }
      function duration(tl) {
        const total = typeof tl.totalDuration === "function" ? tl.totalDuration() : tl.duration();
        return Number.isFinite(total) && total > 0 && total < 100000 ? total : 0;
      }
      function setPlaying(next) {
        playing = next;
        toggle.textContent = playing ? "Pause" : "Play";
        const tl = timeline();
        if (!tl) return;
        if (playing) tl.play();
        else tl.pause();
      }
      function restart() {
        const tl = timeline();
        if (!tl) return;
        tl.pause(0);
        tl.play();
        setPlaying(true);
      }
      toggle.addEventListener("click", () => setPlaying(!playing));
      replay.addEventListener("click", restart);
      loop.addEventListener("click", () => {
        looping = !looping;
        loop.setAttribute("aria-pressed", String(looping));
      });
      range.addEventListener("input", () => {
        const tl = timeline();
        if (!tl) return;
        const total = duration(tl);
        if (!total) return;
        scrubbing = true;
        tl.pause((Number(range.value) / 1000) * total);
        setPlaying(false);
        scrubbing = false;
      });
      function tick() {
        const tl = timeline();
        if (tl) {
          const total = duration(tl);
          if (total) {
            const progress = Math.max(0, Math.min(1, tl.time() / total));
            if (!scrubbing) range.value = String(Math.round(progress * 1000));
            if (looping && playing && progress >= 0.995) restart();
          }
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    </script>
  </body>
</html>
`;
  const readme = `# ${manifest.topic} Animation Bundle

- Serve the repository root with a static file server, for example: \`python3 -m http.server 4173\`
- Open: \`http://localhost:4173/${relative(cwd, playerPath).replaceAll("\\", "/")}\`
- Inspect the bundle in \`scene.html\`, \`storyboard.md\`, and \`manifest.json\`

This bundle is deterministic source output. Keating does not yet export a video in Node; it generates a browser-runnable Hyperframes scene so the visual teaching layer can evolve under versioned prompts and tests.
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
