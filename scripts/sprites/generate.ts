#!/usr/bin/env bun
/**
 * Draft a stop-motion sprite sheet for a new KeatingBot state via `codex exec`.
 *
 * Two things about this pipeline are non-obvious and cost a run each if missed:
 *
 *  - Reference images are mandatory. Without `-i`, the model invents a generic
 *    blue robot rather than the cream-and-green CRT-headed mascot the app ships.
 *  - The prompt must arrive on stdin from a file. A backgrounded `codex exec`
 *    with no stdin reads empty input and exits 0 having drawn nothing, which
 *    looks like success.
 *
 * The generated sheet is never used directly: `codex` ignores any output path
 * and any size asked for in the prompt, and its frame registration drifts. Hand
 * the result to `normalize.ts`, which is what makes the output shippable.
 *
 *   bun scripts/sprites/generate.ts greeting --variant body
 *   bun scripts/sprites/generate.ts greeting --variant body --normalize
 */
import { $ } from "bun";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";

const ATLAS_DIR = "web/public/brand/stop-motion-v1";
/**
 * References are shipped sheets only. The logo mark in mobile/assets is an owl,
 * not the mascot; handed to the model it wins over everything else and the run
 * comes back as an owl robot. And the sheets are AVIF, which the image pipeline
 * does not accept, so they are transcoded to PNG first — passing the .avif
 * silently drops the reference and invites the same substitution.
 */
const STYLE_SHEETS = (variant: string) => [
	`${ATLAS_DIR}/keatingbot-${variant}-waving.avif`,
	`${ATLAS_DIR}/keatingbot-${variant}-idle.avif`,
];

/** What each new scene should depict, in the mascot's own idiom. */
export const SCENE_BRIEFS: Readonly<Record<string, string>> = Object.freeze({
  greeting: "the robot raising one hand in an open, unhurried hello, weight shifting slightly between feet",
  "listening-voice": "the robot leaning in attentively with one hand cupped near the side of its screen-head, small concentric sound arcs pulsing beside it",
  importing: "the robot lifting a stack of index cards out of an open box and setting them down in a neat pile",
  sorting: "the robot arranging three floating labelled cards into a tidy row, tilting its head as it compares them",
  settled: "the robot seated comfortably and at rest, breathing gently, occasionally blinking",
});

function prompt(state: string, variant: string, brief: string): string {
  const framing = variant === "head"
    ? "Draw only the head and shoulders, filling each cell the way the reference sheet does."
    : "Draw the full body, standing on an implied ground line, filling each cell the way the reference sheet does.";
  return [
    "Generate one image: a stop-motion sprite sheet of the robot character shown in the attached references.",
    "",
    "The attached references are existing sheets from this same series, plus one frame enlarged. Copy the character exactly: a small rounded robot with a cream-white body and limbs, a boxy cream head housing a bright green CRT screen showing a simple smiling face, green ear discs, a thin antenna, and dark grey joints. Match its palette, proportions, line weight and soft shading.",
    "Do not redesign the character. Do not substitute an owl, a bird, or any other mascot.",
    "",
    "Layout: exactly 8 frames in a 4 by 4-wide, 2-tall grid, read left to right then top to bottom, as one continuous loop where frame 8 leads back into frame 1.",
    `Subject: ${brief}.`,
    framing,
    "",
    "Every frame must place the character at the same scale and on the same baseline. Do not zoom, crop differently, or move the character between frames except for the motion described.",
    "",
    "Background: pure white (#FFFFFF), completely flat, no shadow, gradient, texture, border or grid lines. The white is keyed out afterwards, so nothing else in the drawing may be pure white.",
    "",
    `This is the "${state}" state.`,
  ].join("\n");
}

async function newestGeneratedImage(since: number): Promise<string | null> {
  const root = join(homedir(), ".codex", "generated_images");
  if (!existsSync(root)) return null;
  // codex writes to ~/.codex/generated_images/<uuid>/exec-<uuid>.png regardless
  // of any path named in the prompt, so the file is found by time, not by name.
  const listing = await $`find ${root} -name '*.png' -newermt ${`@${Math.floor(since / 1000)}`} -printf '%T@ %p\n'`.nothrow().text();
  const newest = listing.trim().split("\n").filter(Boolean)
    .map(line => { const [time, ...rest] = line.split(" "); return { time: Number(time), path: rest.join(" ") }; })
    .sort((left, right) => right.time - left.time)[0];
  return newest?.path ?? null;
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const state = argv.find(arg => !arg.startsWith("--"));
  if (!state) {
    throw new Error(`usage: generate.ts <state> [--variant body|head] [--normalize]\nknown scenes: ${Object.keys(SCENE_BRIEFS).join(", ")}`);
  }
  const variantIndex = argv.indexOf("--variant");
  const variant = variantIndex === -1 ? "body" : argv[variantIndex + 1];
  if (variant !== "body" && variant !== "head") throw new Error(`--variant must be body or head, got ${variant}`);

  const brief = SCENE_BRIEFS[state];
  if (!brief) throw new Error(`no brief for "${state}". Add one to SCENE_BRIEFS, or describe it there first.`);

  const sheets = STYLE_SHEETS(variant).filter(path => existsSync(path));
  if (sheets.length === 0) throw new Error(`no shipped ${variant} sheet to copy from; codex invents an unrelated character without one`);

  const work = await mkdtemp(join(tmpdir(), "keating-sprite-gen-"));
  const references: string[] = [];
  for (const [index, sheet] of sheets.entries()) {
    const png = join(work, `reference-${index}.png`);
    await $`magick ${sheet} PNG32:${png}`.quiet();
    references.push(png);
  }
  // A single frame at full size shows the face, palette and proportions far more
  // legibly than the same character shrunk into one eighth of a sheet.
  const closeUp = join(work, "reference-close.png");
  await $`magick ${references[0]!} -crop 256x256+0+0 +repage -resize 512x512 ${closeUp}`.quiet();
  references.push(closeUp);
  const promptFile = join(work, "prompt.txt");
  await writeFile(promptFile, prompt(state, variant, brief), "utf8");

  const started = Date.now();
  const flags = references.flatMap(path => ["-i", path]);
  console.log(`generating ${variant}/${state} with ${references.length} reference image(s)…`);
  await $`codex exec --skip-git-repo-check -C ${work} ${flags} < ${promptFile}`;

  const generated = await newestGeneratedImage(started);
  if (!generated) throw new Error("codex reported no new image; check that the prompt reached it on stdin");
  console.log(`generated ${generated}`);

  if (argv.includes("--normalize")) {
    const { normalizeSheet } = await import("./normalize.ts");
    await normalizeSheet({
      input: generated,
      out: resolve(`${ATLAS_DIR}/keatingbot-${variant}-${state}.avif`),
      anchor: "bottom-center", fuzz: 8, keepAlpha: false, quality: 82,
    });
  } else {
    console.log(`next: bun scripts/sprites/normalize.ts ${generated} --state ${state} --variant ${variant}`);
  }
}

if (import.meta.main) {
  // These messages are the documentation for the pipeline's two sharp edges;
  // a stack trace buries them.
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
