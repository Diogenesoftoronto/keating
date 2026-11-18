// Offline. Recompute the assessment opt-out observation from the saved irrigation receipts.
// Writes a content-free four-turn export and its evidence. No learner or tutor words are copied.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyOpenUiCue, observeAssessmentOptOut, parseOpenUiDiagnosticExport, queryOpenUiDiagnosticTurns, summarizeOpenUiDiagnostics,
  type OpenUiDiagnosticTurn,
} from "../../../../../packages/learner-contracts/src/openui-diagnostics.ts";
import { inspectAssessmentCheckpoints, inspectSelectedOpenUIDiagnosticText } from "../../../../../web/src/keating/openui/diagnostic-components.ts";
import { inspectEditableCodeEvidence } from "../../../../../web/src/keating/openui/editable-code-evidence.ts";

const here = import.meta.dir;
const review = join(here, "..");
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const saved = new Map<string, OpenUiDiagnosticTurn>(
  parseOpenUiDiagnosticExport(read(join(review, "turns.json"))).map(row => [row.conversationId, row]));
const unobservedPage = Object.fromEntries(["succeeded", "failed", "attached", "saved", "mounted", "ready", "visible", "opened", "frameFailed"].map(key => [key, false]));

const ids = ["irrigation--flash--none", "irrigation--minimax--none", "irrigation--minimax--google", "irrigation--minimax--jev",
  "irrigation--flash--google", "irrigation--flash--jev"];
const receipts = ids.map(id => {
  const file = join(review, "study/receipts", id + ".json");
  return { id, file, receipt: read(file) };
});

const turns: OpenUiDiagnosticTurn[] = [];
const notReleased: Array<{ id: string; reply: string; optOut: boolean | null; checkpoints: null }> = [];
const provenance: Record<string, string> = {};
for (const { id, file, receipt } of receipts) {
  provenance["study/receipts/" + id + ".json"] = sha(file);
  const optOut = observeAssessmentOptOut(receipt.prompt);
  assert.equal(typeof optOut, "boolean", "the learner prompt must be readable");
  const text: string | undefined = receipt.public?.text;
  if (!text) {
    notReleased.push({ id, reply: saved.get(id)?.reply ?? "unknown", optOut, checkpoints: null });
    continue;
  }
  const checkpoints = inspectAssessmentCheckpoints(text);
  const recorded = saved.get(id);
  if (recorded) {
    assert.equal(recorded.reply, "released");
    turns.push({ ...recorded, assessment: { optOut: optOut!, checkpoints } });
    continue;
  }
  // The portable review recording keeps guided turns only. Rebuild the unguided row with the same observers.
  assert.equal(receipt.arm, "none");
  const output = inspectSelectedOpenUIDiagnosticText(text);
  const editor = inspectEditableCodeEvidence(text);
  turns.push({
    schemaVersion: 1, conversationId: id, turnId: id, turnIndex: 0, model: receipt.public.message.model, mode: "baseline",
    cue: classifyOpenUiCue(receipt.prompt), reply: "released", attempted: output.attempted, compiled: output.components,
    selected: output.components, rendered: null, nativePageRequested: false, nativePage: unobservedPage as OpenUiDiagnosticTurn["nativePage"],
    guidance: null, outsideWords: output.outsideWords, editableCode: editor.editableCode,
    codingChallengeLanguages: output.codingChallengeLanguages, editorOutsideWords: editor.editorOutsideWords,
    assessment: { optOut: optOut!, checkpoints },
  });
}

const exported = { schemaVersion: 1 as const, turns: parseOpenUiDiagnosticExport(turns) };
const summary = summarizeOpenUiDiagnostics(exported.turns);
const query = queryOpenUiDiagnosticTurns(exported.turns, { view: "assessment-opt-out" });
const text = JSON.stringify(exported, null, 2) + "\n";
// A content-free export carries neither party's words.
for (const { receipt } of receipts) {
  for (const words of [receipt.prompt, receipt.public?.text]) {
    for (const phrase of String(words ?? "").split(/[.\n]/).map(part => part.trim()).filter(part => part.length > 24)) {
      assert.ok(!text.includes(phrase), "export contains source prose");
    }
  }
}
writeFileSync(join(here, "turns.json"), text);
writeFileSync(join(here, "evidence.json"), JSON.stringify({
  schemaVersion: 1,
  claim: "Each of the four released irrigation replies has a slider. The learner declined a quiz. Both unguided replies told the learner to predict inside the simulation instructions. Neither guided reply did.",
  method: "bun docs/benchmarks/openui-audit-2026-11-18/final-review/assessment-opt-out/compute.ts",
  inputs: { ...provenance, "turns.json": sha(join(review, "turns.json")) },
  perTurn: exported.turns.map(row => ({ id: row.conversationId, model: row.model, mode: row.mode, selected: row.selected,
    optOut: row.assessment!.optOut, checkpoints: row.assessment!.checkpoints })),
  notReleased,
  summary: summary.assessmentOptOut,
  query: { view: query.view, matchingTurns: "matchingTurns" in query ? query.matchingTurns : null,
    observedOptOuts: "observedOptOuts" in query ? query.observedOptOuts : null,
    unknownOptOuts: "unknownOptOuts" in query ? query.unknownOptOuts : null,
    turnIds: "turns" in query ? query.turns.map(row => row.conversationId) : [] },
  knownMisses: [
    "The unguided MiniMax reply also closes its prose by asking the learner to report settings back so the tutor can see how they are thinking. That request sits mid-sentence after a conditional clause. The rule reads only an instruction that opens a sentence, so reply-text is not signalled for that turn. The turn is still flagged through its simulation instructions.",
  ],
  limits: [
    "The opt-out rule recognises explicit English wording. False means no recognised decline, not consent to be tested.",
    "A reply with no signal is not shown to be a good fit. A signal is not shown to be harmful.",
    "Four synthetic replies to one prompt. No rate for real learners follows from them.",
  ],
  output: { "turns.json": createHash("sha256").update(text).digest("hex") },
}, null, 2) + "\n");
console.log(JSON.stringify({ turns: exported.turns.length, summary: summary.assessmentOptOut, query: { matchingTurns: (query as { matchingTurns: number }).matchingTurns } }));
