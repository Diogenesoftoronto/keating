// Build the human showcase and portable trace from verified, synthetic receipts. Offline only.
import { deepStrictEqual, ok } from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseOpenUiDiagnosticExport,
  openUiMatchesTargets,
} from "../../../../packages/learner-contracts/src/openui-diagnostic-turn.ts";

const read = (file) =>
  JSON.parse(readFileSync(resolve(import.meta.dir, file), "utf8"));
const cohort = read("../policy-holdout/cohort.json");
const sources = { jev: "../policy-holdout/", gemini: "./" };
const ids = { jev: "jev-1.14.0", gemini: "gemini-decision-1" };
const combined = [];
const arms = {};
for (const [arm, folder] of Object.entries(sources)) {
  const turns = parseOpenUiDiagnosticExport(read(folder + "turns.json"));
  const records = read(folder + "summary.json").records;
  ok(
    turns.length === records.length &&
      records.length === cohort.models.length * cohort.cases.length,
    "Incomplete schedule for " + arm,
  );
  const cells = new Map();
  for (const record of records) {
    const turn = turns.find(
      (t) => t.turnId === record.id && t.model === record.model,
    );
    ok(turn, "Missing turn for " + record.id);
    ok(
      !turn.decisionModel || turn.decisionModel === ids[arm],
      "Mixed decision provenance for " + record.id,
    );
    ok(
      turn.guidance?.source !== (arm === "jev" ? "other" : "jev"),
      "Mislabeled decision source for " + record.id,
    );
    const spec = cohort.cases.find((c) => c.id === record.caseId);
    ok(
      spec && cohort.models.some((m) => m.id === record.model),
      "Unscheduled cell",
    );
    deepStrictEqual(turn.cue, spec.cue);
    const key = JSON.stringify([record.model, record.caseId]);
    ok(!cells.has(key), "Duplicate tutor/case");
    const firstCompleted = record.completedCandidates > 0;
    const match =
      turn.selected === null || !spec.cue.targets.length
        ? null
        : openUiMatchesTargets(turn.selected, spec.cue.targets);
    cells.set(key, {
      source: folder + record.source,
      decisionModel: turn.decisionModel ?? null,
      offered: turn.guidance?.targets ?? null,
      action: turn.guidance?.action ?? null,
      guidanceDelivered: turn.guidance?.delivered ?? null,
      compiled: turn.compiled,
      selected: turn.selected,
      rendered: turn.rendered,
      reply: turn.reply,
      eligibility: record.eligibility,
      completedCandidates: record.completedCandidates,
      selectedAttempt: record.selectedAttempt,
      opportunityMatch: match,
      opportunityMatchOnCompleted: firstCompleted ? match : null,
      followedOffer:
        turn.guidance?.action === "create" &&
        turn.guidance.delivered === true &&
        turn.guidance.targets.length &&
        turn.selected !== null
          ? openUiMatchesTargets(turn.selected, turn.guidance.targets)
          : null,
      fit: record.verdict,
      note: record.note,
      outsideWords: turn.outsideWords ?? null,
      nativePageRequested: turn.nativePageRequested ?? null,
      selectedText: record.selectedText,
      selectedOutsideText: record.selectedOutsideText,
      nodes: record.selectedNodes ?? [],
      simulationSamples: record.simulationSamples ?? [],
      reviewIssues: turn.gateIssues ?? [],
      directDrafts:
        spec.cue.kind === "direct-text" && turn.reply === "withheld"
          ? record.drafts
              .filter((d) => d.completed && typeof d.authoredText === "string")
              .map((d) => ({
                attempt: d.attempt,
                text: d.authoredText,
                findings: d.findings,
              }))
          : [],
    });
    combined.push(turn);
  }
  arms[arm] = cells;
}
ok(
  new Set(combined.map((t) => JSON.stringify([t.conversationId, t.turnId])))
    .size === combined.length,
  "Turn identities collide across arms",
);
const fresh = [];
for (const model of [...cohort.models].sort((a, b) =>
  a.provider === b.provider ? 0 : a.provider === "minimax" ? -1 : 1,
)) {
  for (const c of cohort.cases) {
    const key = JSON.stringify([model.id, c.id]);
    fresh.push({
      tutor: model.id,
      caseId: c.id,
      prompt: c.prompt,
      cue: c.cue,
      rubric: c.rubric,
      jev: arms.jev.get(key),
      gemini: arms.gemini.get(key),
    });
  }
}
function pairs(cells, score) {
  const result = {
    scheduled: cells.length,
    bothObserved: 0,
    bothPass: 0,
    bothFail: 0,
    jevOnlyPass: 0,
    geminiOnlyPass: 0,
    unknown: 0,
  };
  for (const c of cells) {
    const a = score(c.jev),
      b = score(c.gemini);
    if (a == null || b == null) {
      result.unknown++;
      continue;
    }
    result.bothObserved++;
    result[
      a && b
        ? "bothPass"
        : a
          ? "jevOnlyPass"
          : b
            ? "geminiOnlyPass"
            : "bothFail"
    ]++;
  }
  return result;
}
const frozen = read("frozen/comparison.json");
const requests = read("frozen/requests.json");
const frozenCases = frozen.cases.map((c) => {
  const input = requests.cases.find(
    (r) =>
      r.id === c.id &&
      r.stage === c.stage &&
      r.requestSha256 === c.requestSha256,
  );
  ok(input, "Missing frozen input for " + c.id);
  return {
    ...c,
    learner: input.request.state.turn.learnerMessage,
    ...(c.stage === "review" ? { draft: input.request.state.reply.text } : {}),
  };
});
const comparison = {
  schemaVersion: 1,
  policy: cohort.policy,
  judges: ids,
  fresh,
  matched: {
    fit: pairs(fresh, (r) => r.fit),
    implicitInterfaceOnCompleted: pairs(
      fresh.filter((c) => c.cue.kind === "implicit-action"),
      (r) => r.opportunityMatchOnCompleted,
    ),
    directTextFit: pairs(
      fresh.filter((c) => c.cue.kind === "direct-text"),
      (r) => r.fit,
    ),
  },
  frozen: { ...frozen, cases: frozenCases },
  directAnswerCheck: read("frozen/perimeter-check.json"),
  sources: {
    jevTurns: sources.jev + "turns.json",
    geminiTurns: "turns.json",
    frozen: "frozen/comparison.json",
    directAnswer: "frozen/perimeter-check.json",
    ledger: "ledger.json",
  },
};
const portable = { schemaVersion: 1, turns: combined };
parseOpenUiDiagnosticExport(portable);
const data = JSON.stringify(comparison, null, 2) + "\n";
const template = readFileSync(
  resolve(import.meta.dir, "comparison.template.html"),
  "utf8",
);
ok(
  template.includes("/* RECORDED_DATA */ null"),
  "Missing showcase data placeholder",
);
const html = template.replace("/* RECORDED_DATA */ null", () =>
  JSON.stringify(comparison).replaceAll("<", "\\u003c"),
);
const outputs = [
  ["comparison.json", data],
  ["comparison.html", html],
  [
    "../../../../web/src/keating/openui/examples/decision-models.json",
    JSON.stringify(portable, null, 2) + "\n",
  ],
];
for (const [file, content] of outputs) {
  const path = resolve(import.meta.dir, file);
  if (process.argv.includes("--verify"))
    deepStrictEqual(readFileSync(path, "utf8"), content, "Stale " + file);
  else writeFileSync(path, content);
}
console.log(
  JSON.stringify({
    freshPairs: fresh.length,
    fit: comparison.matched.fit,
    frozenInputs: frozenCases.length,
    portableTurns: combined.length,
  }),
);
