import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(
  new URL("../docs/artifact-atlas.html", import.meta.url),
  "utf8",
);
const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(source, "artifact atlas must include an inline script");

const elements = new Map();
const element = (id) => {
  if (!elements.has(id))
    elements.set(id, {
      dataset: {},
      focus() {},
      innerHTML: "",
      querySelectorAll: () => [],
      setAttribute() {},
      textContent: "",
    });
  return elements.get(id);
};
const document = {
  addEventListener() {},
  getElementById: element,
  querySelectorAll: () => [],
};
const sandbox = {
  Blob,
  console,
  document,
  navigator: {},
  requestAnimationFrame() {},
  setTimeout() {},
  URL,
};
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
vm.createContext(sandbox);

const exportsSource = `${source}\n;globalThis.__atlas = {
  artifacts,
  state,
  demoMarkup,
  alternateDemoMarkup,
  debugTrace,
  debugMarkup,
  caseEvidence,
  assumptionEffects,
  toggleArrangementTrack,
  counterpointFifthWarnings,
  playSteps,
  playBankArrangement
};`;
new vm.Script(exportsSource, {
  filename: "artifact-atlas.inline.js",
}).runInContext(sandbox);

const atlas = sandbox.__atlas;
assert.equal(atlas.artifacts.length, 17, "all 17 artifacts remain present");
assert.deepEqual(
  Array.from(
    atlas.artifacts.find((item) => item.id === "arrangement").variants,
  ),
  ["Stem lanes", "Section blocks"],
  "arrangement labels match their rendered interfaces",
);

const variants = new Set();
for (const artifact of atlas.artifacts) {
  for (const index of [0, 1]) {
    atlas.state.variants[artifact.id] = index;
    variants.add(`${artifact.id}:${atlas.demoMarkup(artifact.id, false)}`);
  }
}
assert.equal(variants.size, 34, "every artifact variant renders a distinct UI");

const emittedActions = new Set(
  Array.from(
    html.matchAll(/data-action="([^"]+)"/g),
    (match) => match[1],
  ).filter((action) => !action.includes("${")),
);
const handledActions = new Set(
  Array.from(source.matchAll(/action === "([^"]+)"/g), (match) => match[1]),
);
assert.deepEqual(
  Array.from(emittedActions).filter((action) => !handledActions.has(action)),
  [],
  "every rendered action has a click handler",
);

const patterns = Object.values(atlas.state.musicPatterns).map((pattern) =>
  Array.from(pattern).join(","),
);
assert.equal(new Set(patterns).size, 4, "sound banks keep separate patterns");
assert.match(
  atlas.playBankArrangement.toString(),
  /Object\.entries\(state\.musicPatterns\)/,
  "arrangement playback reads every bank",
);
assert.match(
  atlas.playSteps.toString(),
  /demoRoot[\s\S]*stepAction/,
  "sequencer playheads are scoped to their initiating demo and action",
);

const traces = ["dns", "timeout", "cache"].map((fault) =>
  JSON.stringify(atlas.debugTrace(fault)),
);
assert.equal(new Set(traces).size, 3, "each injected fault alters the trace");
assert.match(
  source,
  /action === "debug-reset"[\s\S]*?state\.fault = null/,
  "clearing the debugger also clears its fault",
);

atlas.state.casePath = "inspect";
atlas.state.caseStage = 2;
const inspectEvidence = atlas.caseEvidence();
atlas.state.casePath = "act";
const actEvidence = atlas.caseEvidence();
assert.notEqual(
  inspectEvidence,
  actEvidence,
  "case choices produce different evidence",
);

atlas.state.counterAssumptions = [true, true, false, false];
const assumptionsBefore = atlas.assumptionEffects();
atlas.state.counterAssumptions[2] = true;
const assumptionsAfter = atlas.assumptionEffects();
assert.notEqual(
  assumptionsBefore.contested,
  assumptionsAfter.contested,
  "assumptions persist and change the contested count",
);
assert.notEqual(
  assumptionsBefore.confidence,
  assumptionsAfter.confidence,
  "assumptions change downstream confidence",
);

atlas.state.earTarget = null;
atlas.state.earRoundReady = false;
atlas.state.variants.ear = 0;
assert.match(
  atlas.demoMarkup("ear", false),
  /data-action="ear-answer"[^>]*disabled/,
  "ear answers stay disabled before playback",
);

atlas.state.markedSpan = "items.map";
atlas.state.annotationDraft = "map returns promises without awaiting them";
atlas.state.learnerAnnotations.push({
  span: atlas.state.markedSpan,
  text: atlas.state.annotationDraft,
});
atlas.state.variants.annotated = 0;
assert.match(
  atlas.demoMarkup("annotated", false),
  /map returns promises without awaiting them/,
  "saved learner annotations survive rerenders and variant changes",
);

atlas.state.variants.rhythm = 1;
const rhythmSteps = atlas
  .demoMarkup("rhythm", false)
  .match(/data-action="rhythm-step"/g);
assert.equal(
  rhythmSteps?.length,
  16,
  "phase view renders all sixteen rhythm steps",
);

atlas.state.arrangement = new Set(["bass-0", "bass-3"]);
atlas.state.arrangementSnapshots = {};
assert.equal(atlas.toggleArrangementTrack("bass"), "muted");
assert.equal(atlas.state.arrangement.size, 0);
assert.equal(atlas.toggleArrangementTrack("bass"), "restored");
assert.deepEqual(
  Array.from(atlas.state.arrangement).sort(),
  ["bass-0", "bass-3"],
  "muted tracks restore their previous sections",
);

assert.deepEqual(
  Array.from(
    atlas.counterpointFifthWarnings([
      [60, 60],
      [66, 67],
    ]),
  ),
  [],
  "an isolated perfect fifth is not reported as exposed motion",
);
assert.match(
  atlas
    .counterpointFifthWarnings([
      [60, 62],
      [67, 69],
    ])
    .join(" "),
  /parallel fifth/,
  "parallel fifths are detected from successive voice motion",
);

assert.match(
  source,
  /input\.dataset\.control === "voice-balance"[\s\S]*state\.voiceBalance/,
  "listening focus is stored",
);
assert.match(
  source,
  /lowerGain[\s\S]*upperGain[\s\S]*state\.counterpoint/,
  "listening focus changes counterpoint playback gains",
);
assert.match(
  source,
  /querySelectorAll\("\.artifact-card"\)[\s\S]*card\.dataset\.active/,
  "catalogue selection updates the active card",
);

console.log("artifact atlas: 14 reviewed interaction contracts passed");
