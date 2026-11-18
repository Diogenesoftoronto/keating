/** One authorized typed follow-up in the web classroom. The parent is always replayed locally. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { cohort, repo, startHost, study } from "./host.mjs";

const {values}=parseArgs({options:{product:{type:"string"},lease:{type:"string"},out:{type:"string"},phase:{type:"string",default:"classroom-v2.3.7"}}});
if (!values.product || !values.lease || !values.out) throw Error("Use --product <verified frozen checkout> --lease <private bridge file> --out <new directory>");
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const read=async file=>JSON.parse(await readFile(file,"utf8"));
assert(["classroom-v2.3.7","classroom-v2.3.8"].includes(values.phase));
const folder=join(study,values.phase), registered=await read(join(folder,"cohort.json"));
assert.equal(registered.maxOutputTokens,3072);
const parentFile=resolve(folder,registered.parentReceipt);
const parentBytes=await readFile(parentFile), parent=JSON.parse(parentBytes);
assert.equal(hash(parentBytes),registered.parentReceiptSha256);
assert.equal((await stat(values.lease)).mode&0o077,0);
const lease=await read(values.lease), base=new URL(lease.baseUrl);
assert.equal(lease.cellId,registered.id);assert.equal(base.hostname,"127.0.0.1");assert.equal(base.protocol,"http:");
async function bridgeCall(path,body) {
  const res=await fetch(new URL(path,base),{method:body?"POST":"GET",redirect:"error",
    headers:{Authorization:"Bearer "+lease.token,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert(res.ok,"Guarded classroom "+path+" returned HTTP "+res.status);return res.json();
}
const health=await bridgeCall("/health");
assert.deepEqual(health,{id:registered.id,staged:false,finished:false,pending:false});
const output=resolve(values.out);await mkdir(output,{recursive:false});
const save=(name,data)=>writeFile(join(output,name),JSON.stringify(data,null,2)+"\n",{flag:"wx"});
const tutor=cohort.tutors[parent.tutor];
const host=await startHost({product:resolve(values.product),bridge:{url:base.href,token:lease.token},
  sample:{provider:tutor.provider,model:tutor.id,learner:parent.prompt,message:parent.public.message,followup:true}});
const page=await host.context.newPage(),errors=[];
page.on("pageerror",error=>errors.push(error.message.slice(0,200)));
const until=async (condition,timeout=25_000)=>{
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await page.evaluate(condition))return;await page.waitForTimeout(140);}
  throw Error("Classroom observation deadline");
};
try {
  await page.goto(host.origin);
  await page.waitForFunction(()=>window.classroom?.ready,null,{timeout:90_000});
  const box=page.getByPlaceholder("Message Keating",{exact:true}),send=page.getByRole("button",{name:"Send message",exact:true});
  await box.fill(parent.prompt);await send.click();
  await page.getByRole("radio").first().waitFor();
  await until(async()=> (await window.classroom.rows())[0]?.rendered?.includes("question-group") &&
    (await window.classroom.readQuestionState()).open.length===1);
  const stagedState=await page.evaluate(()=>window.classroom.readQuestionState());
  const initial=await page.evaluate(()=>window.classroom.report());
  const shown=initial.transcript.find(m=>m.role==="assistant");assert.deepEqual(shown.content,parent.public.message.content);
  assert.deepEqual(host.traffic,[{kind:"recorded-public-message",status:200}]);
  const stage={parentReceiptSha256:hash(parentBytes),parentPublicTextSha256:hash(parent.public.text),pendingSubmissions:stagedState.pending,
    openInteractions:stagedState.open.map(({documentId,nodeId,component,state})=>({documentId,nodeId,component,state}))};
  const acknowledgement=await bridgeCall("/stage",stage);assert.equal(acknowledgement.staged,true);
  await save("staged-question.json",{...stage,bridgeStageSha256:acknowledgement.sha256});
  console.log(JSON.stringify({stage:"real-classroom-question-confirmed",stageSha256:acknowledgement.sha256}));
  await page.screenshot({path:join(output,"staged-question.png"),animations:"disabled"});
  await box.fill(registered.learner);assert.equal(await box.inputValue(),registered.learner);
  const sentAt=new Date().toISOString();await send.click();
  await until(async()=>{const r=await window.classroom.report();return r.rows.some(row=>row.turnIndex===1&&row.reply!=="pending")&&r.gateReceipt;},220_000);
  const completedAt=new Date().toISOString(), r=await page.evaluate(()=>window.classroom.report());
  const target=r.rows.find(row=>row.turnIndex===1),snapshot=r.gateReceipt.snapshot;
  const message=r.transcript.find(m=>m.role==="assistant"&&m.timestamp===r.gateReceipt.messageTimestamp);
  assert(message&&target);assert.equal(r.plannedFollowup.previousQuestionPresentation.documentId,stage.openInteractions[0].documentId);
  const body={snapshot,message,conversationId:target.conversationId,turnId:target.turnId,browserEvidence:{
    activeWork:r.gateReceipt.activeWork,planning:r.plannedFollowup,staging:acknowledgement.sha256}};
  await save("browser-gate.json",body);
  const sealed=await bridgeCall("/receipt",body);assert.equal(sealed.sealed,true);
  const receiptBytes=await readFile(join(folder,"receipts",registered.id+".json"));assert.equal(hash(receiptBytes),sealed.sha256);
  const receipt=JSON.parse(receiptBytes),learnerText=message.content.filter(p=>p.type==="text").map(p=>p.text).join("\n");
  assert.equal(receipt.publicEnvelope.text,learnerText);
  if(target.reply==="released"&&learnerText.trim())await until(async()=> (await window.classroom.rows()).find(row=>row.turnIndex===1)?.rendered!=null).catch(()=>{});
  const bubbles=page.locator(".keating-bubble");
  await until(()=>{const els=[...document.querySelectorAll(".keating-bubble")];return els.length>=2 && !!els[1].innerText.trim();});
  const finalBubble=bubbles.nth(1);await finalBubble.scrollIntoViewIfNeeded();
  assert.equal(await page.getByText(registered.learner,{exact:true}).count(),1);
  const visibleAssistant={text:(await finalBubble.innerText()).trim(),alertLabels:await finalBubble.getByRole("alert").evaluateAll(els=>els.map(el=>el.getAttribute("aria-label")))};
  const finalQuestionState=await page.evaluate(()=>window.classroom.readQuestionState());
  await page.screenshot({path:join(output,"classroom-desktop.png"),animations:"disabled"});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(120);
  await finalBubble.scrollIntoViewIfNeeded();await page.waitForTimeout(120);
  await page.screenshot({path:join(output,"classroom-mobile.png"),animations:"disabled"});
  const mobile=await page.evaluate(()=>({viewport:innerWidth,body:document.body.scrollWidth}));
  const inspector=await host.context.newPage();await inspector.goto(host.origin+"/?inspector");
  const exporter=inspector.getByRole("button",{name:"Export trace"});await exporter.waitFor();
  const dl=inspector.waitForEvent("download");await exporter.click();await(await dl).saveAs(join(output,"settings-export.json"));
  const trace=await read(join(output,"settings-export.json")),row=trace.turns.find(item=>item.turnId===target.turnId);
  const view=receipt.disposition==="withheld"?"withheld":"released-drafts";
  const mcp=await inspector.evaluate(v=>window.classroom.queryWebMcp({view:v,mode:"guided",limit:3}),view);
  const cli=Bun.spawnSync([process.execPath,join(repo,"src/cli/main.ts"),"openui-diagnostics",join(output,"settings-export.json"),"--view",view,"--mode","guided","--limit","3"],{cwd:repo,stdout:"pipe",stderr:"pipe"});
  assert.equal(cli.exitCode,0);assert.deepEqual(JSON.parse(cli.stdout.toString()),mcp);await save("webmcp-and-cli.json",mcp);
  await inspector.screenshot({path:join(output,"settings-inspector.png"),animations:"disabled"});
  await save("evidence.json",{schemaVersion:1,cell:registered.id,policy:registered.policy,source:"live-typed-classroom-followup",parentStage:"released-message-replay",
    parentReceiptSha256:stage.parentReceiptSha256,parentPublicTextSha256:stage.parentPublicTextSha256,stageSha256:acknowledgement.sha256,
    receipt:"../../study/"+values.phase+"/receipts/"+registered.id+".json",receiptSha256:sealed.sha256,sourcePublicTextMatches:true,
    sentAt,completedAt,typedLearner:registered.learner,publicText:learnerText,publicTextSha256:hash(learnerText),plannedFollowup:r.plannedFollowup,
    actualTutor:{provider:message.provider,model:message.model,responseModel:message.responseModel??null},
    visibleAssistant,finalQuestionState,gatePhases:r.progress,disposition:receipt.disposition,sourceSelectionRule:receipt.selectionRule,sourceSelectedAttempt:receipt.selectedAttempt,
    measuredTurn:row,localQuestionSubmits:r.localActions.length,transport:host.traffic,blockedExternalOrigins:[...host.external],mobile,pageErrors:errors,
    settingsExportRows:trace.turns.length,locallyRegisteredWebMcpMatchesCli:true,screenshots:["staged-question.png","classroom-desktop.png","classroom-mobile.png","settings-inspector.png"]});
  console.log(JSON.stringify({id:registered.id,disposition:receipt.disposition,receiptSha256:sealed.sha256,selection:row.selection??null,
    selected:row.selected,rendered:row.rendered,output}));
} catch(error) {
  await save("incomplete.json",{error:String(error).slice(0,400),transport:host.traffic,pageErrors:errors});
  await page.screenshot({path:join(output,"incomplete.png")}).catch(()=>{});throw error;
} finally {await host.close();}
