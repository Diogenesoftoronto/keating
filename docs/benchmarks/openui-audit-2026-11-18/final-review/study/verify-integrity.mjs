// Audit the immutable request/receipt links and upper accounting independently of the web gate.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { here, cohort, fileSha, read, sha, studyCells, total, usd, verifyPrior } from "./common.mjs";

verifyPrior();
const mf=join(here,"manifest.json"), manifest=read(mf);
assert.equal(fileSha(mf),"8ace67ef98fb4a547d419ba3aade84b12fa6f4229a351d9d7bb9a420a2854ce2");
assert.equal(fileSha(join(here,"cohort.json")),manifest.cohortSha256);
for(const [file,hash] of Object.entries(manifest.code)) assert.equal(fileSha(join(here,file)),hash,file);
const ledger=read(join(here,"ledger.json")), summary=read(join(here,"summary.json"));
assert.equal(ledger.manifestSha256,fileSha(mf));assert.equal(summary.protocolSha256,ledger.manifestSha256);
assert.equal(ledger.priorBoundUsd,cohort.priorBoundUsd);
const entryById=new Map(), wires=new Set(), allowedCells=new Set([...studyCells.map(c=>c.id),cohort.classroom.id]);
let activeMaximum=cohort.priorBoundUsd, settled=cohort.priorBoundUsd;
for(const e of ledger.entries){
  assert(!entryById.has(e.id));entryById.set(e.id,e);
  assert(allowedCells.has(e.id.split("/")[0]),e.id);
  assert(e.startedAt && e.finishedAt && Date.parse(e.startedAt)<=Date.parse(e.finishedAt));
  const cfg=Object.values(e.kind==="decision"?cohort.judges:cohort.tutors).find(m=>m.id===e.model);
  assert(cfg && cfg.reserve===e.reservedUsd);
  const file=join(here,"wire",e.wireSha256+".json.gz"), raw=gunzipSync(readFileSync(file));
  assert.equal(sha(raw),e.wireSha256);wires.add(e.wireSha256);
  const payload=JSON.parse(raw.toString("utf8"));
  assert.equal(new URL(cfg.endpoint).host,e.host);
  if(e.kind==="decision"){
    assert.equal(payload.model,cfg.id);assert.equal(sha(e.request),e.requestSha256);
    assert.equal(e.path,new URL(cfg.endpoint).pathname);
    if(e.http===200) assert(e.response.answers && e.response.usage);
  }else{
    assert.equal(e.kind,"tutor");
    assert(raw.length<=cohort.maxTutorBytes);
    if(cfg.provider==="minimax")assert.equal(payload.model,cfg.id); else assert(e.path.endsWith(cfg.id+":streamGenerateContent"));
    if(e.message){assert.equal(e.message.model,cfg.id);assert(e.message.content.every(p=>["text","toolCall"].includes(p.type)));}
  }
  if(e.usage){
    assert(e.usage.inputTokens>=0&&e.usage.outputTokens>=0);
    assert.equal(usd((e.usage.inputTokens*cfg.input+e.usage.outputTokens*cfg.output)/1e6),e.accountedUsd);
  }else assert.equal(e.accountedUsd,e.reservedUsd);
  assert(e.accountedUsd<=e.reservedUsd);
  activeMaximum=Math.max(activeMaximum,usd(settled+e.reservedUsd));settled=usd(settled+e.accountedUsd);
}
assert.deepEqual(readdirSync(join(here,"wire")).sort(),[...wires].map(h=>h+".json.gz").sort());
assert.equal(summary.newBoundUsd,total(ledger.entries));
assert.equal(settled,summary.totalBoundUsd);assert(activeMaximum<=cohort.matrixAndClassroomTotalCeilingUsd);
assert.equal(Object.keys(summary.receipts).length,studyCells.length+Number(summary.classroom.sealed));
const identities={};
for(const [id,digest] of Object.entries(summary.receipts)){
  const file=join(here,"receipts",id+".json"),r=read(file);assert.equal(fileSha(file),digest);assert.equal(r.id,id);
  for(const d of r.drafts){const e=entryById.get(d.entryId);assert(e && e.kind==="tutor");assert.deepEqual(d.message,e.message);}
  for(const ref of r.refs){if(!ref.entryId){assert(!ref.ok);continue;}
    const e=entryById.get(ref.entryId);assert(e&&e.kind==="decision"&&e.requestSha256===ref.requestSha256);}
  if(r.public){assert(["released","ungated"].includes(r.disposition));assert.equal(r.public.message.content.filter(p=>p.type==="text").map(p=>p.text).join("\n"),r.public.text);}
  else assert(!["released","ungated"].includes(r.disposition));
  const complete=r.drafts.filter(d=>d.completed);
  for(const d of complete){const e=entryById.get(d.entryId),t=identities[e.model]??={}; const label=e.reportedModels?.join(",")||"unreported"; t[label]=(t[label]??0)+1;}
}
console.log(JSON.stringify({verifiedReceipts:Object.keys(summary.receipts).length,exactOutgoingWireBodies:wires.size,
  transportRows:ledger.entries.length,reportedTutorModels:identities,maximumSequentialReservedBoundUsd:activeMaximum,
  cumulativeBoundUsd:settled,newProviderCalls:0}));
