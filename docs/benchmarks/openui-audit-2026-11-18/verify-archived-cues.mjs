import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyOpenUiCue } from "../../../packages/learner-contracts/src/openui-diagnostic-turn.ts";

const study = import.meta.dir, root = resolve(study, "../../..");
const json = path => JSON.parse(readFileSync(path, "utf8"));
const terminal = json(join(root, "web/public/reports/learning-to-teach/benchmark-v3-results.json")).cases;
const audit = json(join(study, "scenarios.json"));
const holdout = json(join(study, "policy-holdout/cohort.json")).cases;
const probes = json(join(study, "policy-v2.1/probes.json"));
const fixtures = new Map(json(join(root, probes.source)).cases.map(fixture => [fixture.id, fixture]));
// Count only learner messages. Labels, rubrics, titles and preceding tutor context are separate inputs.
const groups = {
  terminal: terminal.flatMap(row => row.steps.filter(step => step.kind === "message").map(step => step.text)),
  audit: audit.map(row => row.prompt),
  holdout: holdout.map(row => row.prompt),
  planning: probes.cases.map(probe => {
    const last = fixtures.get(probe.fixture).messages.at(-1);
    assert.equal(last.role, "user");
    return probe.replace ? last.content.replace(probe.replace.before, probe.replace.after) : last.content;
  }),
};
const snapshot = join(study, "replay-source/openui-diagnostic-turn.ts");
const pinned = json(join(study, "gemini-decision/manifest.json")).sourceHashes["packages/learner-contracts/src/openui-diagnostic-turn.ts"];
assert.equal(createHash("sha256").update(readFileSync(snapshot)).digest("hex"), pinned);

const temp = mkdtempSync(join(tmpdir(), "keating-cue-replay-"));
try {
  const entry = join(temp, "openui-diagnostic-turn.ts");
  copyFileSync(snapshot, entry);
  symlinkSync(join(root, "packages/learner-contracts/src/judgement"), join(temp, "judgement"), "dir");
  const before = (await import(pathToFileURL(entry).href)).classifyOpenUiCue;
  for (const [name, messages] of Object.entries(groups)) {
    for (const [index, text] of messages.entries()) {
      assert.equal(typeof text, "string");
      assert.deepEqual(classifyOpenUiCue(text), before(text), `Changed cue label in ${name} learner message ${index + 1}`);
    }
  }
  const all = Object.values(groups).flat();
  console.log(`Retained labels on ${all.length} archived learner messages (${new Set(all).size} distinct wordings).`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
