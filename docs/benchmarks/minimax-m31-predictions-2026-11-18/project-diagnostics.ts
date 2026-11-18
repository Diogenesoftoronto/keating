// Reconstruct dispatch provenance omitted by the original browser. Inputs are the sealed synthetic run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { parseOpenUiDiagnosticExport } from "../../../packages/learner-contracts/src/openui-diagnostic-turn.js";
import { TUTOR_RATE_LIMIT_REASON } from "../../../packages/learner-contracts/src/judgement/teaching-drafts/generation-failure.js";

const hashes = {
  "ledger.json": "260cda4d857ab618b58e8e134d8347cf1f1b6b58766cbd1e9033eb20dcd4ab10",
  "settings-export.json": "249cfc29f34190683d63a2645d11b0da008fd9813ba265a86f070db047977882",
  "paper-fold.json": "644fad8f4ad6851e8b413bc41798e5d5c8c3472ceedac97fc36c7ded01aac2cf",
  "sock-draw.json": "d129dc81fae6e9a41eebb44879417ae60ae121a4a976691eda83f36e2d5ccadc",
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function read(name: keyof typeof hashes) {
  const bytes = readFileSync(join(import.meta.dir, name));
  assert.equal(sha(bytes), hashes[name]);
  return JSON.parse(bytes.toString());
}
const mode = process.argv[2];
assert(process.argv.length === 3 && (mode === "--verify" || mode === "--write"));
const source = parseOpenUiDiagnosticExport(read("settings-export.json"));
type Entry = {cell:string; kind:string; model:string; http:number; status:string; url:string; wireSha256:string};
const entries: Entry[] = read("ledger.json").entries;
const turns = (["paper-fold", "sock-draw"] as const).map(id => {
  const capture = read(id === "paper-fold" ? "paper-fold.json" : "sock-draw.json");
  const row = source.find(turn => turn.conversationId === capture.observation.conversationId && turn.turnId === capture.observation.turnId);
  assert(row && capture.id === id);
  assert.deepEqual(row, capture.observation);
  const calls = entries.filter(e => e.cell === id && e.kind === "tutor");
  assert.equal(calls.length, 4);
  for (const call of calls) {
    const wire = gunzipSync(readFileSync(join(import.meta.dir, "wire", call.wireSha256 + ".json.gz")));
    assert.equal(sha(wire), call.wireSha256);
    assert.equal(call.url, "https://api.minimax.io/v1/chat/completions");
    assert.equal(JSON.parse(wire.toString()).model, call.model);
  }
  assert.equal(new Set(calls.map(call => call.model)).size, 1);
  const requestedModel = "minimax/" + calls[0]!.model;
  if (calls.every(call => call.http === 429 && call.status === "error")) {
    assert(row.reply === "withheld" && row.model === null);
    return {...row, requestedModel, gateIssues:[...new Set([...(row.gateIssues ?? []), TUTOR_RATE_LIMIT_REASON])]};
  }
  assert(calls.every(call => call.http === 200) && row.reply === "released" && row.model === requestedModel);
  return {...row, requestedModel};
});
const output = JSON.stringify({schemaVersion:1, turns:parseOpenUiDiagnosticExport(turns)}, null, 2) + "\n";
for (const path of ["review-projection.json", "../../../web/src/keating/openui/examples/flash-prediction.json"]) {
  const dest = join(import.meta.dir, path);
  if (mode === "--write") writeFileSync(dest, output);
  else assert.equal(readFileSync(dest,"utf8"), output);
}
console.log(JSON.stringify({turns:turns.length, sha256:sha(Buffer.from(output)), newProviderRequests:0}));
