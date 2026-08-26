// Executable contract for docs/artifact-atlas.html.
//
// The atlas is a design catalogue with working miniatures, so a broken demo looks
// exactly like a working one in a diff. This runs the page's inline script in a VM
// against a stub DOM and asserts the behaviour each archetype claims to have.
//
// Run with bun (it imports the .ts contract directly): bun scripts/check-artifact-atlas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { WEB_OPENUI_COMPONENTS } from "../packages/learner-contracts/src/rendering.ts";

const html = await readFile(new URL("../docs/artifact-atlas.html", import.meta.url), "utf8");
const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(source, "artifact atlas must include an inline script");

const elements = new Map();
const element = (id) => {
  if (!elements.has(id))
    elements.set(id, {
      id,
      dataset: {},
      style: { setProperty() {} },
      classList: { add() {}, remove() {}, toggle() {} },
      innerHTML: "",
      textContent: "",
      value: "",
      disabled: false,
      setAttribute() {},
      focus() {},
      scrollIntoView() {},
      closest: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    });
  return elements.get(id);
};

const sandbox = {
  console,
  Math,
  Set,
  Map,
  Number,
  String,
  Array,
  Object,
  JSON,
  Boolean,
  Date,
  devicePixelRatio: 1,
  requestAnimationFrame: () => 0,
  setTimeout: () => 0,
  document: {
    documentElement: element("html"),
    getElementById: element,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  },
  window: { addEventListener: () => {} },
};
sandbox.globalThis = sandbox;
sandbox.window.AudioContext = undefined;
vm.createContext(sandbox);

const exportsSource = `${source}
;globalThis.__atlas = {
  archetypes, folded, state, demoMarkup, demoBodyMarkup, modeFor, presetFor,
  simPresets, simulate, stepTrace, scenarioDelta, sweep, assumptionEffects, faultDivergence, effectiveSimulationOptions,
  annotatedPresets, spanAudit, canReveal, spanRoles,
  casePresets, caseLedger, commitDecision, branchState, caseRankingFor, moveCaseRanking,
  buildPresets, boardCheck, swapBoardItems, edgeTypes,
  signalPresets, signalModePresets, signalSchedule, euclidean, drillRound, submitDrillAnswer, counterpointWarnings
};`;
new vm.Script(exportsSource, { filename: "artifact-atlas.inline.js" }).runInContext(sandbox);
const atlas = sandbox.__atlas;

// --- Catalogue shape ---------------------------------------------------------
assert.equal(atlas.archetypes.length, 5, "the catalogue consolidates to five archetypes");

const modeMarkup = new Map();
const presetMarkup = new Map();
let modeCount = 0;
let presetCount = 0;

for (const archetype of atlas.archetypes) {
  const where = archetype.id;
  assert(archetype.modes.length >= 4, `${where} carries at least four modes`);
  assert(archetype.actions.length >= 8, `${where} carries at least eight actions`);
  assert(archetype.presets.length >= 4, `${where} carries at least four domain presets`);
  assert(archetype.shippedGap.length > 40, `${where} names the gap against the shipped surface`);
  assert(archetype.limit.length > 40, `${where} states an honest limit`);
  assert(archetype.foldsIn.length >= 1, `${where} accounts for at least one retired specimen`);

  const domains = new Set(archetype.presets.map((preset) => preset.domain));
  assert(domains.size >= 3, `${where} presets span at least three domains, not one subject`);

  const basePreset = atlas.presetFor(where);
  for (const mode of archetype.modes) {
    modeCount += 1;
    atlas.state.modes[where] = mode.id;
    atlas.state.presets[where] = where === "signal" ? atlas.signalModePresets[mode.id][0] : basePreset;
    const markup = atlas.demoBodyMarkup(where, false);
    assert(markup.length > 120, `${where}:${mode.id} renders a real interface`);
    modeMarkup.set(`${where}:${mode.id}`, markup);
  }

  for (const preset of archetype.presets) {
    presetCount += 1;
    atlas.state.modes[where] = where === "signal"
      ? Object.entries(atlas.signalModePresets).find(([, presetIds]) => presetIds.includes(preset.id))[0]
      : archetype.modes[0].id;
    atlas.state.presets[where] = preset.id;
    presetMarkup.set(`${where}:${preset.id}`, atlas.demoBodyMarkup(where, false));
  }
  atlas.state.modes[where] = archetype.modes[0].id;
  atlas.state.presets[where] = basePreset;
}

assert.equal(new Set(modeMarkup.values()).size, modeCount, "every mode body renders a distinct interface");
assert.equal(
  new Set(presetMarkup.values()).size,
  presetCount,
  "every preset changes the interface body, not only its generated header",
);

// Signal modes expose only presets with the data their interface consumes.
const signalArchetype = atlas.archetypes.find((archetype) => archetype.id === "signal");
for (const mode of signalArchetype.modes) {
  for (const preset of signalArchetype.presets) {
    atlas.state.modes.signal = mode.id;
    atlas.state.presets.signal = preset.id;
    const compatible = atlas.signalModePresets[mode.id].includes(preset.id);
    assert.equal(atlas.presetFor("signal") === preset.id, compatible, `${mode.id}:${preset.id} compatibility is enforced`);
    if (compatible) {
      const body = atlas.demoBodyMarkup("signal", false);
      assert(body.length > 120, `${mode.id}:${preset.id} renders a substantive body`);
      if (mode.id === "grid") assert(body.includes('data-action="signal-step"'), `${mode.id}:${preset.id} renders editable steps`);
      if (mode.id === "sections") assert(body.includes("track-slot"), `${mode.id}:${preset.id} renders authored sections`);
    }
  }
}

// --- The folded table stays honest against the shipped surface ---------------
const retired = [
  "music", "rhythm", "sonic", "ear", "counterpoint", "arrangement",
  "annotated", "simulation", "counterfactual", "debugger", "proof",
  "argument", "case", "concept", "sort", "field", "teachback",
];
assert.deepEqual(
  atlas.folded.map((entry) => entry.id).sort(),
  [...retired].sort(),
  "all seventeen retired specimens are accounted for",
);
for (const entry of atlas.folded) {
  if (entry.into) {
    const target = atlas.archetypes.find((archetype) => archetype.id === entry.into);
    assert(target, `${entry.id} folds into a real archetype`);
    assert(target.modes.some((mode) => mode.id === entry.mode), `${entry.id} names a real mode of ${entry.into}`);
  }
  if (entry.ships) {
    assert(
      WEB_OPENUI_COMPONENTS.includes(entry.ships),
      `${entry.id} names a component that actually ships: ${entry.ships}`,
    );
    assert(entry.gap.length > 30, `${entry.id} states what the shipped component still lacks`);
  }
  assert(entry.into || entry.ships, `${entry.id} lands somewhere`);
}

// --- Simulation Lab: one model, six interrogations ---------------------------
for (const presetId of Object.keys(atlas.simPresets)) {
  const preset = atlas.simPresets[presetId];
  const run = atlas.simulate(presetId);
  assert.equal(run.history.length, preset.horizon + 1, `${presetId} runs its full horizon`);
  assert(Number.isFinite(run.outcome), `${presetId} produces a finite outcome`);

  const trace = atlas.stepTrace(presetId);
  assert.equal(trace.length, preset.horizon + 1, `${presetId} traces every transition`);

  for (const param of preset.params) {
    const result = atlas.sweep(presetId, param.id);
    assert(result.span > 0, `${presetId} is sensitive to ${param.id} somewhere in its range`);
  }

  for (const fault of preset.faults) {
    const divergence = atlas.faultDivergence(presetId, fault.id);
    assert(
      Math.abs(divergence.delta) > 0,
      `${presetId} fault ${fault.id} actually moves the outcome it is measured against`,
    );
    assert.equal(divergence.divergesAt, fault.at, `${presetId} reports where ${fault.id} was injected`);
  }

  const allHeld = atlas.assumptionEffects(presetId, preset.assumptions.map((item) => item.id));
  const noneHeld = atlas.assumptionEffects(presetId, []);
  assert.equal(allHeld.contested, 0, `${presetId} with every assumption held contests nothing`);
  assert.equal(allHeld.confidence, "HIGH", `${presetId} is confident when nothing is contested`);
  assert.equal(allHeld.weakenedClaims.length, 0, `${presetId} weakens no claim while assumptions hold`);
  assert(noneHeld.contested > 0, `${presetId} contests assumptions when none are held`);
  assert(
    noneHeld.weakenedClaims.length > allHeld.weakenedClaims.length,
    `${presetId} weakens claims once its assumptions are contested`,
  );
  assert.notEqual(noneHeld.confidence, "HIGH", `${presetId} loses confidence as assumptions fall`);

  const first = preset.params[0];
  const delta = atlas.scenarioDelta(presetId, { [first.id]: first.min }, { [first.id]: first.max });
  assert(Math.abs(delta) > 0, `${presetId} reports a non-zero delta between distinct scenarios`);
}

// step and back are exactly inverse
atlas.state.modes.simulation = "trace";
const traceBefore = atlas.demoMarkup("simulation", false);
atlas.state.simStep[atlas.presetFor("simulation")] = 3;
const stepped = atlas.demoMarkup("simulation", false);
atlas.state.simStep[atlas.presetFor("simulation")] = 0;
assert.notEqual(stepped, traceBefore, "stepping the trace changes what is rendered");
assert.equal(atlas.demoMarkup("simulation", false), traceBefore, "stepping back restores the prior state exactly");

// the prediction gate holds the run closed
atlas.state.modes.simulation = "bench";
const locked = atlas.demoMarkup("simulation", false);
assert(locked.includes("Commit a prediction"), "the bench asks for a prediction before it will run");
assert(locked.includes("disabled"), "the run control stays disabled until a prediction is committed");
atlas.state.simPrediction[atlas.presetFor("simulation")] = "it peaks near day twelve";
const unlocked = atlas.demoMarkup("simulation", false);
assert(unlocked.includes("PREDICTION LOCKED"), "a committed prediction is shown back to the learner");
assert(!unlocked.includes("Commit a prediction"), "the gate closes once a prediction exists");
assert(unlocked.includes("Outcome hidden"), "committing a prediction does not reveal the result");
assert(!unlocked.includes("actual peak infected"), "the outcome remains hidden until Run");
const simulationPreset = atlas.presetFor("simulation");
atlas.state.simRun[simulationPreset] = atlas.simulate(
  simulationPreset,
  atlas.state.simParams[simulationPreset],
  atlas.effectiveSimulationOptions(simulationPreset),
);
const completed = atlas.demoMarkup("simulation", false);
assert(completed.includes("actual peak infected"), "a completed run reveals the measured result");
delete atlas.state.simRun[simulationPreset];
delete atlas.state.simPrediction[atlas.presetFor("simulation")];
atlas.state.modes.simulation = "bench";

// Every simulation mode uses the same held-assumption scaling.
for (const presetId of Object.keys(atlas.simPresets)) {
  atlas.state.simAssumptions[presetId] = atlas.simPresets[presetId].assumptions.map((item) => item.id);
  const options = atlas.effectiveSimulationOptions(presetId);
  assert.deepEqual(options.assumptions, atlas.state.simAssumptions[presetId], `${presetId} derives one effective assumption set`);
  const first = atlas.simPresets[presetId].params[0];
  const left = { [first.id]: first.min };
  const right = { [first.id]: first.max };
  const expectedDelta = atlas.simulate(presetId, right, options).outcome - atlas.simulate(presetId, left, options).outcome;
  assert.equal(atlas.scenarioDelta(presetId, left, right, options), expectedDelta, `${presetId} compare uses effective parameters`);
  const fault = atlas.simPresets[presetId].faults[0];
  const expectedNominal = atlas.simulate(presetId, {}, options).outcome;
  assert.equal(atlas.faultDivergence(presetId, fault.id, {}, options).nominal, expectedNominal, `${presetId} fault mode uses effective parameters`);
}

// --- Annotated Source: reveal is gated on the learner's own attempt ----------
for (const presetId of Object.keys(atlas.annotatedPresets)) {
  const marks = atlas.annotatedPresets[presetId].segments.filter((segment) => segment.mark);
  assert(marks.length >= 3, `${presetId} anchors at least three spans`);
  for (const mark of marks) {
    assert(atlas.spanRoles.includes(mark.role), `${presetId} span ${mark.id} carries a known role`);
    assert(mark.expert.length > 30, `${presetId} span ${mark.id} carries a real expert reading`);
  }

  const empty = atlas.spanAudit(presetId, {});
  assert.equal(empty.labelled, 0, `${presetId} starts with nothing labelled`);
  assert.equal(empty.unlabelled.length, marks.length, `${presetId} reports every span as unaccounted`);
  assert.equal(empty.nextUnlabelled, marks[0].id, `${presetId} points at the next unlabelled span`);
  assert.equal(atlas.canReveal(presetId, {}, marks[0].id), false, `${presetId} refuses to reveal before an attempt`);

  const partial = { [marks[0].id]: { role: "claim" } };
  assert.equal(
    atlas.canReveal(presetId, partial, marks[0].id),
    false,
    `${presetId} refuses to reveal on a role with no written reading`,
  );

  const full = {};
  marks.forEach((mark) => { full[mark.id] = { role: mark.role, text: "a committed reading" }; });
  assert.equal(atlas.canReveal(presetId, full, marks[0].id), true, `${presetId} reveals once the learner has committed`);

  const audited = atlas.spanAudit(presetId, full);
  assert.equal(audited.labelled, marks.length, `${presetId} counts every labelled span`);
  assert.equal(audited.nextUnlabelled, null, `${presetId} reports full coverage`);
  assert.equal(audited.agreed.length, marks.length, `${presetId} records role agreement`);

  const disagreed = {};
  marks.forEach((mark) => {
    const other = atlas.spanRoles.find((role) => role !== mark.role);
    disagreed[mark.id] = { role: other, text: "a different reading" };
  });
  assert.equal(
    atlas.spanAudit(presetId, disagreed).agreed.length,
    0,
    `${presetId} distinguishes agreement from mere coverage`,
  );
}

// --- Decision Case: looking costs, and a decision needs a reason -------------
for (const presetId of Object.keys(atlas.casePresets)) {
  const preset = atlas.casePresets[presetId];
  const start = atlas.caseLedger(presetId, [], []);
  assert.equal(start.spent, 0, `${presetId} starts unspent`);
  assert.equal(start.remaining, preset.budget, `${presetId} starts with its full budget`);
  assert(start.available.length > 0, `${presetId} offers affordable evidence at the start`);

  const firstId = preset.evidence[0].id;
  const afterSpend = atlas.caseLedger(presetId, [firstId], []);
  assert.equal(afterSpend.spent, preset.evidence[0].cost, `${presetId} charges for evidence`);
  assert(afterSpend.remaining < start.remaining, `${presetId} reduces the budget when evidence is bought`);
  assert(
    afterSpend.available.length + afterSpend.revealed.length + afterSpend.unaffordable.length ===
      preset.evidence.length,
    `${presetId} accounts for every piece of evidence`,
  );

  const everything = atlas.caseLedger(presetId, preset.evidence.map((item) => item.id), []);
  assert(everything.remaining < 0 || everything.available.length === 0, `${presetId} bounds the budget`);

  const refused = atlas.commitDecision(presetId, preset.choices[0].id, "", 3);
  assert.equal(refused.ok, false, `${presetId} refuses a decision with no reason`);
  assert(refused.message.length > 20, `${presetId} says why the decision was refused`);
  assert.equal(
    atlas.commitDecision(presetId, "not-a-choice", "a good reason here", 3).ok,
    false,
    `${presetId} refuses an unavailable action`,
  );
  const accepted = atlas.commitDecision(presetId, preset.choices[0].id, "the evidence points here", 4);
  assert.equal(accepted.ok, true, `${presetId} accepts a reasoned decision`);
  assert.equal(accepted.decision.confidence, 4, `${presetId} records stated confidence`);
  assert(accepted.decision.consequence.length > 20, `${presetId} carries an authored consequence`);

  const onPath = atlas.caseLedger(presetId, [preset.expertPath[0]], []);
  assert.equal(onPath.divergesAt, null, `${presetId} keeps a correct partial path on course`);
  assert.equal(atlas.caseLedger(presetId, [], []).divergesAt, null, `${presetId} does not treat an empty path as divergence`);
  const offPath = atlas.caseLedger(presetId, [], [{ choice: "wandered" }]);
  assert.equal(offPath.divergesAt, 0, `${presetId} names the first divergence from the expert path`);

  const opening = atlas.branchState(presetId, []);
  assert.deepEqual(opening.choices, preset.choices, `${presetId} branching opens with the authored decisions`);
  const firstBranch = atlas.commitDecision(presetId, opening.choices[0].id, "this changes the current state", 4, opening.choices);
  const consequence = atlas.branchState(presetId, [firstBranch.decision]);
  assert.equal(consequence.stage, 1, `${presetId} advances after the first branch decision`);
  assert.notDeepEqual(consequence.choices, opening.choices, `${presetId} changes the available moves after a decision`);
  assert.equal(consequence.brief, firstBranch.decision.consequence, `${presetId} makes the consequence the next case state`);
  const secondBranch = atlas.commitDecision(presetId, consequence.choices[0].id, "resolve the new state", 3, consequence.choices);
  assert.equal(atlas.branchState(presetId, [firstBranch.decision, secondBranch.decision]).complete, true, `${presetId} closes a two-step branch`);

  const authoredOrder = preset.choices.map((choice) => choice.id);
  atlas.state.caseRanking[presetId] = [...authoredOrder];
  assert.equal(atlas.moveCaseRanking(presetId, authoredOrder[1], "up"), true, `${presetId} moves a learner ranking`);
  assert.deepEqual(preset.choices.map((choice) => choice.id), authoredOrder, `${presetId} ranking never mutates authored preset data`);
  atlas.state.caseRanking[presetId] = [...authoredOrder];
  assert.deepEqual(atlas.caseRankingFor(presetId), authoredOrder, `${presetId} restart restores the initial ranking`);
}

// --- Build Board: the check names the FIRST wrong element --------------------
for (const presetId of Object.keys(atlas.buildPresets)) {
  const preset = atlas.buildPresets[presetId];
  assert(preset.rule.length > 30, `${presetId} states the ordering rule behind the hint`);

  const correct = atlas.boardCheck(presetId, "sequence", preset.sequence);
  assert.equal(correct.ok, true, `${presetId} accepts the warranted order`);

  const scrambled = preset.scrambled.map((index) => preset.sequence[index]);
  const wrong = atlas.boardCheck(presetId, "sequence", scrambled);
  assert.equal(wrong.ok, false, `${presetId} rejects the scrambled order`);
  assert.equal(
    wrong.firstWrongIndex,
    scrambled.findIndex((item, index) => item !== preset.sequence[index]),
    `${presetId} names the FIRST wrong position, not a score`,
  );
  assert(wrong.message.includes(wrong.item), `${presetId} names the offending item`);

  const repair = preset.repair.map((index) => preset.sequence[index]);
  assert.equal(atlas.boardCheck(presetId, "repair", repair).ok, false, `${presetId} repair mode starts from a wrong board`);

  const groups = {};
  Object.entries(preset.bins).forEach(([bin, items]) => items.forEach((item) => { groups[item] = bin; }));
  assert.equal(atlas.boardCheck(presetId, "groups", groups).ok, true, `${presetId} accepts the correct grouping`);
  const misplaced = { ...groups };
  const firstItem = Object.keys(groups)[0];
  misplaced[firstItem] = Object.keys(preset.bins).find((bin) => bin !== groups[firstItem]);
  assert.equal(atlas.boardCheck(presetId, "groups", misplaced).ok, false, `${presetId} catches a misplaced item`);

  const edges = preset.graph.edges.map(([from, to, type]) => ({ from, to, type }));
  assert.equal(atlas.boardCheck(presetId, "graph", edges).ok, true, `${presetId} accepts the typed graph`);
  const repeated = Array.from({ length: edges.length }, () => ({ ...edges[0] }));
  assert.equal(atlas.boardCheck(presetId, "graph", repeated).ok, false, `${presetId} rejects repeated copies of one valid edge`);
  const untyped = atlas.boardCheck(presetId, "graph", [{ from: edges[0].from, to: edges[0].to }]);
  assert.equal(untyped.ok, false, `${presetId} rejects an unlabelled edge`);
  assert(untyped.message.includes("asserts nothing"), `${presetId} says why an unlabelled edge is rejected`);
  const mistyped = atlas.boardCheck(presetId, "graph", [
    { from: edges[0].from, to: edges[0].to, type: atlas.edgeTypes.find((type) => type !== edges[0].type) },
  ]);
  assert.equal(mistyped.ok, false, `${presetId} rejects a wrongly typed edge`);
  assert.equal(
    atlas.boardCheck(presetId, "graph", []).ok,
    false,
    `${presetId} does not accept an empty graph as complete`,
  );

  atlas.state.modes.build = "sequence";
  atlas.state.presets.build = presetId;
  delete atlas.state.boardOrder[presetId];
  atlas.demoMarkup("build", false);
  const order = atlas.state.boardOrder[presetId];
  atlas.state.boardLocked[presetId] = [order[0]];
  const beforeSwap = [...order];
  assert.equal(atlas.swapBoardItems(presetId, order[0], order[1]), false, `${presetId} rejects a swap involving a locked item`);
  assert.deepEqual(order, beforeSwap, `${presetId} lock freezes the sequence`);
}

// --- Signal Lab: the schedule is real, and the drill adapts ------------------
for (const presetId of Object.keys(atlas.signalPresets)) {
  const preset = atlas.signalPresets[presetId];
  assert(preset.question.length > 20, `${presetId} asks the learner to name what changed`);

  if (preset.lanes) {
    const lanes = {};
    preset.lanes.forEach((lane) => { lanes[lane.id] = atlas.euclidean(lane.pulses); });
    const all = atlas.signalSchedule(presetId, "grid", { lanes });
    assert(all.length > 0, `${presetId} schedules audible steps`);
    const muted = atlas.signalSchedule(presetId, "grid", { lanes, muted: [preset.lanes[0].id] });
    assert(muted.length < all.length, `${presetId} muting a lane removes its events`);
    assert(
      muted.every((event) => event.lane !== preset.lanes[0].id),
      `${presetId} muting removes exactly the muted lane`,
    );
  }
  if (preset.harmonics) {
    const full = atlas.signalSchedule(presetId, "spectrum", { harmonics: preset.harmonics });
    const cut = atlas.signalSchedule(presetId, "spectrum", {
      harmonics: preset.harmonics.map((value, index) => (index === 1 ? 0 : value)),
    });
    assert.equal(cut.length, full.length - 1, `${presetId} removing a harmonic removes a partial`);
  }
  if (preset.sampleRate) {
    const nyquist = preset.sampleRate / 2;
    const clean = atlas.signalSchedule(presetId, "spectrum", { frequency: nyquist - 50 });
    const folded = atlas.signalSchedule(presetId, "spectrum", { frequency: nyquist + 200 });
    const cleanHeard = clean.find((event) => event.lane === "heard");
    const foldedHeard = folded.find((event) => event.lane === "heard");
    assert.equal(cleanHeard.aliased, false, `${presetId} below Nyquist is heard as requested`);
    assert.equal(foldedHeard.aliased, true, `${presetId} above Nyquist reports aliasing`);
    assert(
      foldedHeard.frequency < cleanHeard.frequency,
      `${presetId} folds back down: raising the tone lowers what is heard`,
    );
  }
  if (preset.pair) {
    const defaultEvents = atlas.signalSchedule(presetId, "spectrum", {});
    assert.equal(
      Math.abs(defaultEvents[1].frequency - defaultEvents[0].frequency),
      8,
      `${presetId} playback uses the same default detune as the meter`,
    );
    const events = atlas.signalSchedule(presetId, "spectrum", { detune: 6 });
    assert.equal(events.length, 2, `${presetId} sounds both tones`);
    assert.equal(
      Math.abs(events[1].frequency - events[0].frequency),
      Math.abs(preset.pair[1] + 6 - preset.pair[0]),
      `${presetId} beat rate follows the frequency difference`,
    );
  }
  if (preset.drill) {
    const easy = atlas.drillRound(presetId, 0);
    const hard = atlas.drillRound(presetId, 6);
    assert(hard.width > easy.width, `${presetId} widens the pool as the streak grows`);
    assert(hard.width <= preset.drill.length, `${presetId} never exceeds its authored pool`);
    atlas.state.drillTarget[presetId] = easy.pool[0];
    assert.equal(atlas.submitDrillAnswer(presetId, easy.pool[0].id, "").ok, false, `${presetId} keeps the answer hidden until the learner names a difference`);
    const submitted = atlas.submitDrillAnswer(presetId, easy.pool[0].id, "the upper note moved higher");
    assert.equal(submitted.ok, true, `${presetId} accepts a named difference before grading`);
    assert.equal(atlas.state.signalDifference[presetId], "the upper note moved higher", `${presetId} persists the learner's listening claim`);
  }
}

assert.deepEqual(
  atlas.counterpointWarnings([[60, 62, 64, 65], [67, 69, 71, 72]]),
  ["beats 1–2: parallel fifth", "beats 2–3: parallel fifth", "beats 3–4: parallel fifth"],
  "voice lanes report parallel fifths as they are edited",
);
assert.deepEqual(
  atlas.counterpointWarnings([[60, 62, 64, 65], [67, 65, 64, 62]]),
  [],
  "contrary motion produces no collision warning",
);
assert.deepEqual([...atlas.euclidean(5, 16)], [0, 3, 6, 9, 12], "pulses distribute evenly across the cycle");
assert.equal(atlas.euclidean(0, 16).size, 0, "zero pulses schedule nothing");

console.log(
  `artifact atlas ok: ${atlas.archetypes.length} archetypes, ${modeCount} modes, ${presetCount} presets, ${atlas.folded.length} retired specimens accounted for`,
);
