/** Check the browser-to-receipt chain on disk. Accepts a single saved classroom folder. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const phases={
  "live-tile-confirm":"classroom-v2.3.7",
  "linked-tile-confirm":"classroom-v2.3.8",
};
const sample=process.argv[2];
assert(Object.hasOwn(phases,sample),"Pass a saved live-tile-confirm or linked-tile-confirm folder name");
const dir=join(import.meta.dirname,sample),study=resolve(dir,"../../study",phases[sample]);
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const read=async file=>JSON.parse(await readFile(file,"utf8"));
const [evidence,trace,gate,stage,registered]=await Promise.all([
  read(join(dir,"evidence.json")),read(join(dir,"settings-export.json")),read(join(dir,"browser-gate.json")),
  read(join(dir,"staged-question.json")),read(join(study,"cohort.json")),
]);
const receiptBytes=await readFile(join(study,"receipts",registered.id+".json"));
const receipt=JSON.parse(receiptBytes),parentBytes=await readFile(resolve(study,registered.parentReceipt));
assert.equal(hash(receiptBytes),evidence.receiptSha256);
assert.equal(hash(parentBytes),registered.parentReceiptSha256);
assert.equal(hash(parentBytes),evidence.parentReceiptSha256);
assert.equal(hash(JSON.parse(parentBytes).public.text),evidence.parentPublicTextSha256);
assert.equal(hash(await readFile(join(study,"stage.json"))),stage.bridgeStageSha256);
assert.equal(evidence.stageSha256,stage.bridgeStageSha256);
assert.equal(stage.openInteractions.length,1);assert.equal(stage.pendingSubmissions,0);
const prior=stage.openInteractions[0],projected=evidence.plannedFollowup.previousQuestionPresentation;
assert.deepEqual(prior,receipt.stagedPresentation.openInteractions[0]);
assert.equal(projected.documentId,prior.documentId);assert.equal(projected.nodeId,prior.nodeId);
assert.equal(evidence.typedLearner,registered.learner);assert.equal(evidence.localQuestionSubmits,0);
assert.equal(evidence.publicText,receipt.publicEnvelope.text);assert.equal(hash(evidence.publicText),evidence.publicTextSha256);
assert.deepEqual(gate.message.content,receipt.publicEnvelope.message.content);
assert.equal(gate.snapshot.phase,receipt.disposition);assert.equal(evidence.disposition,receipt.disposition);
const matched=trace.turns.filter(row=>row.conversationId===gate.conversationId&&row.turnId===gate.turnId);
assert.deepEqual(matched,[evidence.measuredTurn]);assert.equal(matched[0].turnIndex,1);
assert.equal(matched[0].reply,receipt.disposition);
for(const image of evidence.screenshots)assert((await stat(join(dir,image))).size>0);
const visible=evidence.visibleAssistant?.text??(await read(join(dir,"read-only-replay.json"))).visibleNotice;
console.log(JSON.stringify({sample,receiptSha256:evidence.receiptSha256,disposition:receipt.disposition,
  publicSourceVerified:true,priorCardBound:true,turnIndex:matched[0].turnIndex,
  selected:matched[0].selected,rendered:matched[0].rendered,visible,
  visibleEvidence:evidence.visibleAssistant?"live browser DOM":"sealed conversation DOM replay and original desktop screenshot"},null,2));
