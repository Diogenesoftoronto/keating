/** Inspect the normal saved presentation while typing the already-registered tile confirmation. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cohort, startHost, study } from "./host.mjs";

if (!process.argv[2]) throw Error("Pass the restored v2.3.5 checkout");
const receipts = async (phase, id) => {
  const folder = join(study, "supplement", phase);
  const bytes = await readFile(join(folder,"receipts",id+".json"));
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash, JSON.parse(await readFile(join(folder,"summary.json"),"utf8")).receipts[id]);
  return { hash, row:JSON.parse(bytes) };
};
const parent = await receipts("prediction", "tile-bag--minimax--jev");
const typed = await receipts("addendum", "tile-bag-confirm--minimax--jev");
assert.equal(typed.row.parentReceiptSha256,parent.hash);
const tutor = cohort.tutors[parent.row.tutor];
const probe = process.argv.includes("--verify-witness");
const host = await startHost({product:resolve(process.argv[2]),sample:{provider:tutor.provider,model:tutor.id,
  learner:parent.row.prompt,message:parent.row.public.message,followup:probe}});
try {
  const page=await host.context.newPage();
  const until=async condition=>{
    const stop=Date.now()+25_000;
    while(Date.now()<stop) { if (await page.evaluate(condition)) return; await page.waitForTimeout(100); }
    const status=await page.evaluate(async()=>{const r=await window.classroom.report();return {phases:r.progress,rows:r.rows,plan:r.plannedFollowup};});
    throw Error("Classroom observation unavailable: "+JSON.stringify(status));
  };
  await page.goto(host.origin);
  await page.waitForFunction(()=>window.classroom?.ready,null,{timeout:100_000});
  const box=page.getByPlaceholder("Message Keating",{exact:true});
  const send=page.getByRole("button",{name:"Send message",exact:true});
  await box.fill(parent.row.prompt); await send.click();
  await page.getByRole("radio").first().waitFor();
  await until(async()=> (await window.classroom.rows())[0]?.rendered?.includes("question-group"));
  const before=await page.evaluate(()=>window.classroom.readQuestionState());
  await box.fill(typed.row.prompt); await send.click();
  if (probe) await until(async()=>!!(await window.classroom.report()).plannedFollowup);
  else await until(async()=> (await window.classroom.report()).stoppedFollowups>0);
  const after=await page.evaluate(()=>window.classroom.readQuestionState());
  const report=await page.evaluate(()=>window.classroom.report());
  assert.deepEqual(host.traffic,[{kind:"recorded-public-message",status:200}]);
  assert.equal(before.pending,0);assert.equal(after.pending,0);
  assert.equal(report.localActions.length,0);
  const compact=state=>({openInteractions:state.open.map(({documentId,nodeId,component,state})=>({documentId,nodeId,component,state})),pendingSubmissions:state.pending});
  assert.equal(before.open.length,1);assert.equal(before.open[0].nodeId,"guess");
  assert.equal(before.open[0].component,"question-group");assert.equal(before.open[0].state,"awaiting");
  assert.deepEqual(compact(before),compact(after));
  if (probe) assert.deepEqual(report.plannedFollowup.previousQuestionPresentation,{
    assistantTurnIndex:report.plannedFollowup.conversationTurns-1,documentId:before.open[0].documentId,nodeId:before.open[0].nodeId,
  });
  console.log(JSON.stringify({policy:parent.row.policy,parentReceiptSha256:parent.hash,typedReceiptSha256:typed.hash,
    beforeTyping:compact(before),afterTyping:compact(after),questionSubmits:report.localActions.length,followupDispatches:0,
    canceledBeforeModel:report.stoppedFollowups,transport:host.traffic,...(probe?{actualPlanningInput:report.plannedFollowup}:{})},null,2));
} finally { await host.close(); }
