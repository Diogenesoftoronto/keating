// Independent read-only verification of phase budgets, exact provider requests and turn receipts.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { cohort as primary, fileSha, read, sha, total, usd } from "../common.mjs";

const here = import.meta.dir;
const cohort = read(join(here, "cohort.json"));
const only = process.argv[2];
assert(process.argv.length <= 3 && (!only || only === "coding" || only === "prediction"));
let priorFile = join(here, "..", "summary.json");

for (const phase of cohort.phases) {
  const dir = join(here, phase.id);
  const summaryFile = join(dir, "summary.json");
  if (!only || only === phase.id) verify();
  priorFile = summaryFile;

  function verify() {
    const summary = read(summaryFile);
    const manifestFile = join(dir, "manifest.json");
    const manifest = read(manifestFile);
    const ledger = read(join(dir, "ledger.json"));
    assert.equal(fileSha(manifestFile), summary.protocolSha256);
    assert.equal(ledger.manifestSha256, summary.protocolSha256);
    assert.equal(fileSha(priorFile), manifest.priorSummarySha256);
    assert.equal(fileSha(join(dir, "source-delta.json.gz")), manifest.sourceDeltaSha256);
    assert.equal(ledger.priorBoundUsd, read(priorFile).totalBoundUsd);
    assert.equal(ledger.capUsd, cohort.studyCapUsd);
    assert.equal(ledger.hardStop, null);
    const scheduled = new Set(phase.schedule.map(([item, arm]) => [item, "minimax", arm].join("--")));
    assert.deepEqual(new Set(Object.keys(summary.receipts)), scheduled);
    const ids = new Map();
    const wires = new Set();
    let settled = ledger.priorBoundUsd;
    let peak = settled;
    const identities = {};
    for (const entry of ledger.entries) {
      assert(scheduled.has(entry.id.split("/")[0]));
      assert(!ids.has(entry.id));
      ids.set(entry.id, entry);
      assert(entry.finishedAt && Date.parse(entry.finishedAt) >= Date.parse(entry.startedAt));
      const configs = Object.values(entry.kind === "tutor" ? primary.tutors : primary.judges);
      const cfg = configs.find(v => v.id === entry.model);
      const wire = gunzipSync(readFileSync(join(dir, "wire", entry.wireSha256 + ".json.gz")));
      assert.equal(sha(wire), entry.wireSha256);
      wires.add(entry.wireSha256);
      assert(cfg && cfg.reserve === entry.reservedUsd);
      assert.equal(new URL(cfg.endpoint).host, entry.host);
      assert.equal(JSON.parse(wire.toString("utf8")).model, cfg.id);
      if (entry.kind === "decision") {
        assert.equal(new URL(cfg.endpoint).pathname, entry.path);
        assert.equal(sha(entry.request), entry.requestSha256);
        if (entry.http === 200) assert(entry.response?.answers && entry.response.usage);
      } else {
        assert.equal(entry.kind, "tutor");
        assert.equal(entry.path, "/anthropic/v1/messages");
        assert(wire.length <= primary.maxTutorBytes);
        if (entry.message) {
          assert.equal(entry.message.model, cfg.id);
          assert(entry.message.content.every(p => ["toolCall", "text"].includes(p.type)));
          const model = entry.reportedModels?.join(",") || "unreported";
          identities[model] = (identities[model] ?? 0) + 1;
        }
      }
      const expected = entry.usage
        ? usd((entry.usage.inputTokens * cfg.input + entry.usage.outputTokens * cfg.output) / 1e6)
        : entry.reservedUsd;
      assert.equal(expected, entry.accountedUsd);
      assert(expected <= entry.reservedUsd && expected >= 0);
      peak = Math.max(peak, usd(settled + entry.reservedUsd));
      settled = usd(settled + expected);
    }
    assert.deepEqual(readdirSync(join(dir, "wire")).sort(), [...wires].map(s => s + ".json.gz").sort());
    const linked = new Set();
    for (const [id, hash] of Object.entries(summary.receipts)) {
      const path = join(dir, "receipts", id + ".json");
      const row = read(path);
      assert.equal(fileSha(path), hash);
      assert.equal(row.id, id);
      assert.equal(row.prompt, cohort.cases.find(c => c.id === row.caseId).learner);
      assert.equal(row.policy, manifest.policy);
      assert.equal(row.public !== null, row.disposition === "released");
      for (const draft of row.drafts) {
        const entry = ids.get(draft.entryId);
        assert(entry && entry.kind === "tutor");
        assert.deepEqual(entry.message, draft.message);
        if (draft.availableToolNames) {
          const wire = gunzipSync(readFileSync(join(dir, "wire", entry.wireSha256 + ".json.gz")));
          assert.deepEqual((JSON.parse(wire.toString("utf8")).tools ?? []).map(t => t.name), draft.availableToolNames);
        }
        linked.add(entry.id);
      }
      for (const ref of row.refs) {
        if (!ref.entryId) { assert(!ref.ok); continue; }
        const entry = ids.get(ref.entryId);
        assert(entry && entry.kind === "decision" && entry.requestSha256 === ref.requestSha256);
        linked.add(entry.id);
      }
    }
    assert.deepEqual(linked, new Set(ids.keys()));
    assert.equal(summary.newBoundUsd, total(ledger.entries));
    assert.equal(summary.totalBoundUsd, settled);
    assert(peak <= cohort.studyCapUsd);
    console.log(JSON.stringify({phase:phase.id, verifiedReceipts:scheduled.size, exactRequests:wires.size,
      reportedTutors:identities, usageMissing:ledger.entries.filter(e => !e.usage).length,
      peakReservationUsd:peak, cumulativeBoundUsd:settled, newProviderCalls:0}));
  }
}
