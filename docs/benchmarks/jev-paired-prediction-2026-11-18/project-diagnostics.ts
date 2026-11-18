/** Offline reconstruction for the inspector's jev-pairs-review example. The original Settings export predates these fields. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { TeachingDraftSnapshot } from "../../../packages/learner-contracts/src/judgement/teaching-drafts.js";
import { observedPairCandidateIssues } from "../../../packages/learner-contracts/src/judgement/teaching-drafts/pair-review.js";
import type { TeachingPolicyReply } from "../../../packages/learner-contracts/src/judgement/teaching-policy-types.js";
import { parseOpenUiDiagnosticExport } from "../../../packages/learner-contracts/src/openui-diagnostic-turn.js";
import { projectOpenUiFinalComparison, projectOpenUiPairReviews } from "../../../packages/learner-contracts/src/openui-pair-reviews.js";
import { stripReviewNotice } from "../../../web/src/keating/judgement/review-notice.js";

// The version-1 public format allows only schemaVersion and turns. Keep the reconstruction
// provenance here and in the example's source label, without changing either captured turn.
const sourceHashes = {
  "settings-export.json": "4bbb1ad2f986d95f5a0c2cf516adebd9c4468630daab000f220b666a2c7ec3a1",
  "ledger.json": "f55dbb53a2f8c9f58af50f1f8ca1cd35eb31ebfef6f5756a090a187ec27fb768",
  "paper-fold.json": "e4106809f2fa8b1b124ac72ae374834b014dba02bd5c5bfa515a55d2eb8edc08",
  "sock-draw.json": "87b9a43422e91ae6923f152cd4f0d601e7561d62873701315fcf439f9ad96b66",
};
const cases = ["paper-fold", "sock-draw"] as const;
const local = (name: string) => new URL(name, import.meta.url);
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function readSource<T>(name: keyof typeof sourceHashes): T {
  const bytes = readFileSync(local(name));
  assert.equal(digest(bytes), sourceHashes[name], name + " differs from the recorded source");
  return JSON.parse(bytes.toString("utf8"));
}

interface Capture {
  id: string;
  observation: unknown;
  snapshot: TeachingDraftSnapshot;
  public: TeachingPolicyReply;
}
interface Decision {
  cell: string; kind: string; stage: string; model: string; url: string; http: number; status: string; wireSha256: string;
  response?: { model: string; answers: Record<string, { type: string; choice: string; confidence?: number; probabilities: Record<string, number> }> };
}
interface FinalRequest {
  model: string;
  questions: { draft_choice: { type: string; criteria: Record<string, string> } };
  state: { candidates: Record<string, TeachingPolicyReply> };
}

const mode = process.argv[2];
assert(process.argv.length === 3 && (mode === "--verify" || mode === "--write"), "Use --verify or --write.");
const original = parseOpenUiDiagnosticExport(readSource("settings-export.json"));
const ledger = readSource<{ entries: Decision[] }>("ledger.json");
assert.equal(original.length, cases.length);
const turns = cases.map((id, index) => {
  const row = original[index]!;
  const capture = readSource<Capture>(`${id}.json`);
  assert.equal(capture.id, id);
  assert.deepEqual(row, capture.observation);
  const snapshot = capture.snapshot;
  assert.equal(snapshot.phase, "released");
  assert.equal(snapshot.reason, null);
  assert.equal(row.selection?.review, "verified");
  assert.equal(row.selection?.attempt, snapshot.selectedAttempt);
  assert.equal(row.finalComparison, undefined);
  const pairs = snapshot.pairReviews;
  assert(pairs && pairs.length === 2 && pairs.every(p => p.status === "compared" && p.candidateIssueIds === undefined));
  assert.deepEqual(projectOpenUiPairReviews(pairs), row.pairReviews);
  assert.deepEqual(snapshot.attempts.map(a => a.attempt), pairs.flatMap(p => p.candidateAttempts));
  const pairReviews = projectOpenUiPairReviews(pairs.map(pair => ({
    ...pair, candidateIssueIds: observedPairCandidateIssues(pair.candidateAttempts, snapshot.attempts),
  })));
  assert(pairReviews);

  const votes = ledger.entries.filter(e => e.cell === id && e.stage === "final-choice" && e.kind === "decision");
  assert.equal(votes.length, 1);
  const vote = votes[0]!;
  assert.equal(vote.status, "received");
  assert.equal(vote.http, 200);
  assert.equal(vote.url, "https://api.typesafe.ai/v1/systemone");
  assert(vote.response && vote.response.model === row.decisionModel && vote.model === vote.response.model);
  assert.match(vote.wireSha256, /^[0-9a-f]{64}$/);
  const wire = gunzipSync(readFileSync(local(`wire/${vote.wireSha256}.json.gz`)));
  assert.equal(digest(wire), vote.wireSha256);
  const request: FinalRequest = JSON.parse(wire.toString("utf8"));
  assert.equal(request.model, vote.model);
  assert.deepEqual(Object.keys(request.questions), ["draft_choice"]);
  assert.equal(request.questions.draft_choice.type, "choice");
  const keys = Object.keys(request.state.candidates);
  assert.deepEqual(keys, Object.keys(request.questions.draft_choice.criteria));
  const nominees = pairs.map(pair => {
    assert(pair.finalistAttempt && pair.eligibleAttempts?.includes(pair.finalistAttempt));
    return "draft_" + pair.finalistAttempt;
  });
  assert.deepEqual([...keys].sort(), nominees.sort());
  const answer = vote.response.answers.draft_choice;
  assert(answer && answer.type === "choice" && keys.includes(answer.choice));
  assert.equal(answer.choice, "draft_" + snapshot.selectedAttempt);
  assert.deepEqual(request.state.candidates[answer.choice], { text: stripReviewNotice(capture.public.text), toolCalls: capture.public.toolCalls });
  const finalComparison = projectOpenUiFinalComparison({
    model: vote.response.model, candidateAttempts: keys.map(key => Number(key.slice("draft_".length))),
    preferredAttempt: snapshot.selectedAttempt, probabilities: answer.probabilities,
    ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }),
  });
  assert(finalComparison, "The recorded vote must satisfy the same closed, content-free schema as a live vote.");
  return { ...row, pairReviews, finalComparison };
});

const encoded = Buffer.from(JSON.stringify({ schemaVersion: 1, turns }, null, 2) + "\n");
assert.deepEqual(parseOpenUiDiagnosticExport(JSON.parse(encoded.toString("utf8"))), turns);
const outputs = [local("review-projection.json"), local("../../../web/src/keating/openui/examples/jev-pairs-review.json")];
for (const output of outputs) {
  if (mode === "--write") writeFileSync(output, encoded);
  assert(readFileSync(output).equals(encoded), output.pathname + " differs from the offline reconstruction");
}
console.log(JSON.stringify({ source: "jev-pairs-review", reconstructed: true, turns: turns.length,
  sha256: digest(encoded), sourceHashes, providerRequests: 0 }));
