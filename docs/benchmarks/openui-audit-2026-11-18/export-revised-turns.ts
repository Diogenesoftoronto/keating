// Build portable, content-free observations for actual tutor generations in a study.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isOpenUiDiagnosticGateIssue,
  normalizeOpenUiComponent,
  parseOpenUiDiagnosticExport,
} from "../../../packages/learner-contracts/src/openui-diagnostic-turn";
import { inspectOpenUIDiagnosticText } from "../../../web/src/keating/openui/diagnostic-components";
import { inspectEditableCodeEvidence } from "../../../web/src/keating/openui/editable-code-evidence";
import { stripReviewNotice } from "../../../web/src/keating/judgement/review-notice";

const [study, flag] = process.argv.slice(2);
assert(
  ["policy-v2.2", "policy-v2.3"].includes(study) &&
    (!flag || flag === "--verify"),
);
const dir = join(import.meta.dir, study === "policy-v2.3" ? "policy-v2.3-completion" : study);
const read = (file: string) =>
  JSON.parse(readFileSync(join(dir, file), "utf8"));
const cohort = read("cohort.json");
const grading = read("adjudication.json");
const unique = <T>(values: T[]) => [...new Set(values)].sort();
const turns = [];
for (const cell of read("summary.json").rows) {
  if (cell.kind !== "live") continue;
  const row = read("receipts/" + cell.id + ".json");
  const item = cohort.cases.find((c: { id: string }) => c.id === row.caseId);
  assert(
    item && grading[row.id],
    "All actual generated replies need a documented adjudication",
  );
  const answer = row.public;
  const visible = answer ? stripReviewNotice(answer.text) : null;
  const observed = visible === null ? null : inspectOpenUIDiagnosticText(visible);
  const editor = visible === null ? {editableCode:null, editorOutsideWords:null} : inspectEditableCodeEvidence(visible);
  const draftCoverage =
    row.drafts.length > 0 &&
    row.drafts.every((d: { stop: string }) =>
      ["stop", "length", "toolUse"].includes(d.stop),
    );
  const selected = row.drafts.find(
    (_: unknown, i: number) => i + 1 === row.selectedAttempt,
  );
  const targets =
    item.expect === "simulation"
      ? ["simulation"]
      : item.expect === "python"
        ? ["editable-code"]
        : [];
  const issues = row.findings.flatMap(
    (f: { checks: { id: string; applicability?: string }[] }) =>
      f.checks
        .filter(
          (check) =>
            !check.applicability && isOpenUiDiagnosticGateIssue(check.id),
        )
        .map((check) => check.id),
  );
  turns.push({
    schemaVersion: 1,
    conversationId: study + "/" + row.id,
    turnId: row.id,
    turnIndex: 0,
    model: cohort.tutor,
    mode: "guided",
    decisionModel: row.decisionModel,
    cue: {
      kind: targets.length ? "implicit-action" : "direct-text",
      targets,
      ...(item.expect === "python" ? { codeLanguage: "python" } : {}),
    },
    reply: row.status === "provider-error" ? "error" : row.status,
    attempted: draftCoverage
      ? row.drafts.some((d: { attempted: boolean }) => d.attempted)
      : null,
    compiled: draftCoverage
      ? unique(
          row.drafts.flatMap((d: { components: string[] }) => d.components),
        )
      : null,
    selected: observed?.components ?? (row.status === "withheld" ? [] : null),
    rendered: null,
    outsideWords: observed?.outsideWords ?? null,
    ...editor,
    nativePageRequested: answer
      ? answer.tools.includes("interactive_page")
      : null,
    guidance: row.plan
      ? {
          source: row.provider === "jev" ? "jev" : "other",
          action: row.plan.action,
          targets: unique(
            row.plan.offered.map(normalizeOpenUiComponent).filter(Boolean),
          ),
          delivered: selected?.guidanceDelivered ?? null,
          ...(row.plan.reason ? { reason: row.plan.reason } : {}),
          ...(row.plan.codeLanguage
            ? { codeLanguage: row.plan.codeLanguage }
            : {}),
        }
      : null,
    draftAttempts: row.drafts.length,
    gateIssues: unique(issues),
    fit: { source: study + "-case-rubric", passed: grading[row.id].passed },
  });
}
parseOpenUiDiagnosticExport({ schemaVersion: 1, turns });
const encoded = JSON.stringify({ schemaVersion: 1, turns }, null, 2) + "\n";
for (const path of [
  join(dir, "turns.json"),
  join(
    import.meta.dir,
    "../../../web/src/keating/openui/examples",
    study + ".json",
  ),
]) {
  if (flag) assert.equal(readFileSync(path, "utf8"), encoded);
  else writeFileSync(path, encoded);
}
console.log(study + ": " + turns.length + " scheduled tutor turns, source validated");
