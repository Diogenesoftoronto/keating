import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { cohort, repo, startHost, study } from "./host.mjs";

const {values} = parseArgs({options:{
  product:{type:"string"}, id:{type:"string"}, out:{type:"string"}, phase:{type:"string"}, "live-lease":{type:"string"}, "demonstrate-grade":{type:"boolean"},
}});
if (!values.product || !values.out || !values.id || !/^[a-z0-9-]+$/u.test(values.id)) {
  throw Error("Usage: bun run.mjs --product <restored study checkout> --id <study receipt id> --out <new output directory> [--live-lease <file>]");
}
const digest = value => createHash("sha256").update(value).digest("hex");
const json = (file) => readFile(file,"utf8").then(JSON.parse);
const output = resolve(values.out);
const live = !!values["live-lease"];
const phase = values.phase;
if (phase) assert(!live && ["prediction","addendum"].includes(phase),"Supplement phases accept recorded releases only");
const batch = phase ? join(study,"supplement",phase) : study;
const studyFile = join(batch,"receipts",values.id+".json");
if (values["demonstrate-grade"]) assert(!live && values.id==="paper-fold--flash--jev");
let source = null;
let sourceSha256 = null;
let bridge;
let sample;
if (live) {
  assert.equal(values.id, cohort.classroom.id);
  const path = values["live-lease"];
  assert.equal((await stat(path)).mode & 0o077, 0, "Classroom lease must be private");
  const lease = await json(path);
  assert.equal(lease.cellId,values.id);
  assert.equal(new URL(lease.baseUrl).protocol,"http:");
  assert.equal(new URL(lease.baseUrl).hostname,"127.0.0.1");
  bridge = {url:lease.baseUrl,token:lease.token};
  const health = await fetch(new URL("/health",bridge.url), {headers:{Authorization:"Bearer "+bridge.token},redirect:"error"});
  assert(health.ok);
  const availability = await health.json();
  assert.equal(availability.id,values.id);
  assert.equal(availability.finished,false);
  assert.equal(availability.pending,false);
  const tutor = cohort.tutors[cohort.classroom.tutor];
  sample = {provider:tutor.provider,model:tutor.id,learner:cohort.classroom.learner,caseId:"classroom-stage-light"};
} else {
  const bytes = await readFile(studyFile);
  source = JSON.parse(bytes); sourceSha256 = digest(bytes);
  assert.equal(source.disposition,"released");
  const registration = phase ? await json(join(study,"supplement",phase === "addendum" ? "addendum/cohort.json" : "cohort.json")) : cohort;
  if (phase) {
    const summary = await json(join(batch,"summary.json"));
    assert.equal(summary.receipts[values.id],sourceSha256,"The receipt must match the sealed study digest");
    assert.equal(source.policy, (await json(join(batch,"manifest.json"))).policy);
  }
  const registered = source.kind==="classroom" ? cohort.classroom : registration.cases.find(item => item.id === source.caseId);
  assert(registered && source.prompt === registered.learner, "Receipt does not match the frozen learner prompt");
  const envelope = source.publicEnvelope ?? source.public;
  assert(envelope && envelope.message?.role === "assistant");
  const message = envelope.message;
  assert.deepEqual(message.content.filter(p => p.type === "text").map(p=>p.text).join("\n"),envelope.text);
  assert(message.content.every(p=>p.type==="text" || p.type==="toolCall"),"Use only the public release envelope");
  const tutor = cohort.tutors[source.tutor];
  assert.equal(tutor.id,message.model); assert.equal(tutor.provider,message.provider);
  sample = {provider:tutor.provider,model:tutor.id,learner:source.prompt,caseId:source.caseId,message,gradeDemo:values["demonstrate-grade"]};
}
// A failed or completed live session is evidence. Never overwrite it and never
// retry paid requests; use a new directory for independent offline replays.
await mkdir(output, {recursive:false});
const save = (name, data) => writeFile(join(output,name),JSON.stringify(data,null,2)+"\n",{flag:"wx"});
const host = await startHost({product:resolve(values.product),sample,bridge});
const page = await host.context.newPage();
page.setDefaultTimeout(15_000);
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message.slice(0,240)));
let sealed;
const paperResponse = "Four layers. The second fold doubles the two layers.";
const isTile = sample.caseId === "tile-bag";
try {
  await page.goto(host.origin);
  await page.waitForFunction(() => window.classroom?.ready || window.classroom?.startupError,null,{timeout:100_000});
  assert.equal(await page.evaluate(() => window.classroom.startupError),undefined);
  const composer = page.getByPlaceholder("Message Keating",{exact:true});
  await composer.fill(sample.learner);
  assert.equal(await composer.inputValue(),sample.learner);
  const submittedAt = new Date().toISOString();
  await page.getByRole("button",{name:"Send message",exact:true}).click();
  await eventually(page,async()=> (await window.classroom.rows()).some(row=>row.reply!=="pending"),
    live ? 225_000 : 60_000);
  const completedAt = new Date().toISOString();
  const first = await page.evaluate(()=>window.classroom.report());
  assert.equal(first.rows.length,1);
  const row = first.rows[0];
  const learner = first.transcript.find(m=>m.role==="user");
  const actualMessage = first.transcript.find(m=>m.role==="assistant" &&
    (!live || !first.gateReceipt || m.timestamp === first.gateReceipt.messageTimestamp));
  assert(learner && actualMessage,"Join the actual submit and public release using the real transcript");
  const userParts = typeof learner.content === "string" ? [learner.content] : learner.content.filter(p=>p.type==="text").map(p=>p.text);
  assert(userParts.includes(sample.learner));
  const review = first.gateReceipt?.snapshot ?? null;
  if (live) {
    assert(review);
    const body = {snapshot:review, message:actualMessage, conversationId:row.conversationId, turnId:row.turnId,
      browser:{sessionId:first.sessionId, execution:first.execution}};
    await save("browser-gate.json",body);
    const resp = await fetch(new URL("/receipt",bridge.url), {method:"POST",redirect:"error",
      headers:{Authorization:"Bearer "+bridge.token,"Content-Type":"application/json"},body:JSON.stringify(body)});
    if (!resp.ok) throw Error("The paid gate completed, but its receipt could not be sealed (HTTP "+resp.status+").");
    sealed = await resp.json();
    assert.equal(sealed.sealed,true);
    const bytes = await readFile(studyFile);
    sourceSha256 = digest(bytes); assert.equal(sourceSha256,sealed.sha256);
    source = JSON.parse(bytes);
  } else {
    assert.deepEqual(actualMessage.content,sample.message.content);
    assert.equal(actualMessage.model,sample.message.model);
    assert.equal(actualMessage.provider,sample.message.provider);
  }
  assert(source && sourceSha256);
  // Wait for the application's already-committed text part to supply its independent
  // renderer confirmation. Pure native or withheld output can legitimately remain unknown.
  if (row.reply==="released" && actualMessage.content.some(p=>p.type==="text" && p.text.trim())) {
    await eventually(page,async()=>(await window.classroom.rows())[0]?.rendered!=null,20_000);
  }
  await page.screenshot({path:join(output,"classroom-desktop.png"),animations:"disabled"});
  const stages = await page.locator("[data-openui-diagnostic-nodes]").evaluateAll(nodes =>
    nodes.map(n=>n.getAttribute("data-openui-diagnostic-nodes")));
  const actions = [];
  if ((sample.caseId === "paper-fold" || isTile) && /question/.test(stages.join(" "))) {
    const field = page.locator("[data-question-kind]:visible").first();
    for (let i=0;i<5;i++) {
      await field.waitFor();
      const radios = field.getByRole("radio");
      const prompt = (await field.locator("legend").innerText()).trim();
      if (await radios.count()) {
        const correct = field.locator("label.shared-activity__choice").filter({
          has:page.getByText(isTile ? /^Round$/i : /^(4|four)(?: layers)?$/i,{exact:true}),
        });
        assert.equal(await correct.count(),1,"Expected exactly one matching answer in the actual choices");
        await correct.click();
        assert(await radios.evaluateAll(inputs=>inputs.some(input=>input.checked)));
        actions.push({step:"select",prompt,choice:(await correct.innerText()).trim()});
      } else if (await field.locator("textarea").count()) {
        const answer = isTile ? "Round, because three of the four tiles are round." : paperResponse;
        await field.locator("textarea").fill(answer);
        actions.push({step:"type",prompt,answer});
      } else throw Error("Unrecognized paper-fold input; inspect the actual authored control.");
      const next = page.getByRole("button",{name:/^Next$/i});
      if (await next.count()) { await next.click(); continue; }
      const submit = page.getByRole("button",{name:/^(Send answer|Finish check)$/});
      await submit.click();
      await eventually(page,async()=>{const r=await window.classroom.report();return r.localActions.some(a=>a.status==="completed") &&
        r.transcript.filter(m=>m.role==="user").length>=2 && r.stoppedFollowups>0;});
      actions.push({step:"submit",receipt:(await page.evaluate(()=>window.classroom.report())).localActions.at(-1)});
      break;
    }
  }
  const ranges = page.locator(".simulation input[type=range], [data-simulation-parameter] input[type=range]");
  const simulationSlider = await ranges.count() ? ranges.first() : page.locator("input[type=range]:visible").first();
  if ((sample.caseId==="classroom-stage-light" || sample.caseId==="irrigation") && /simulation/.test(stages.join(" "))) {
    const before = await readSlider(page,simulationSlider);
    const delta = before.value + before.step <= before.max ? "ArrowRight" : "ArrowLeft";
    await simulationSlider.focus(); await simulationSlider.press(delta);
    const after = await readSlider(page,simulationSlider);
    assert.notEqual(after.value,before.value);
    const multiplier = sample.caseId === "classroom-stage-light" ? 12 : 6;
    const match = before.readouts.findIndex((r,i)=>r.number===before.value*multiplier && after.readouts[i]?.number===after.value*multiplier);
    actions.push({step:"change-slider",before,after,expectedMultiplier:multiplier,correctReadout:match>=0});
  }
  if (["python-sum","multiples-loop"].includes(sample.caseId) && await page.getByRole("button",{name:"Edit",exact:true}).count()) {
    await page.getByRole("button",{name:"Edit",exact:true}).first().click();
    const editor = page.getByRole("textbox",{name:"Editable code"});
    const code = await editor.inputValue();
    assert(code.trim().length);
    const fix = sample.caseId === "multiples-loop";
    if (fix) assert.equal(code.split("if i % 3 == 0:").length,2,"The frozen starter contains the exact condition the demonstration edits");
    const changed = fix ? code.replace("if i % 3 == 0:","if numbers[i] % 3 == 0:") : code+"\n# Classroom edit";
    await editor.fill(changed); assert.equal(await editor.inputValue(),changed);
    actions.push({step:"edit-python",originalCodeSha256:digest(code),changedCodeSha256:digest(changed),reset: true,executed:false,
      ...(fix ? {beforeCondition:"if i % 3 == 0:",afterCondition:"if numbers[i] % 3 == 0:"} : {})});
    await page.screenshot({path:join(output,"classroom-edit.png"),animations:"disabled"});
    await page.getByRole("button",{name:"Reset code"}).click();
    assert.equal(await editor.inputValue(),code);
  }
  if (actions.length) await page.screenshot({path:join(output,"classroom-after-action.png"),animations:"disabled"});
  if (isTile) {
    assert(actions.some(action => action.step === "submit" && action.receipt?.status === "completed"));
    const saved = await page.evaluate(()=>window.classroom.readSavedAnswers());
    assert.equal(saved.length,1); assert.equal(saved[0].answer,"Round"); assert.equal(saved[0].score,null);
    actions.push({step:"read-saved-answer",...saved[0]});
  }
  if (sample.caseId === "multiples-loop") assert(actions.some(action => action.step === "edit-python"));
  if (sample.gradeDemo) {
    const recorded = await page.evaluate(()=>window.classroom.checkSavedPaperAnswer());
    await save("deterministic-grading.json",{id:values.id,receiptSha256:sourceSha256,scope:"Independent offline re-enactment after genuine classroom submission",
      conversationId:row.conversationId,turnId:row.turnId,...recorded});
  }
  const final = await page.evaluate(()=>window.classroom.report());
  assert(final.savedMessages.some(m=>m.role==="user"),"The classroom persisted the original learner turn");
  assert(final.savedMessages.some(m=>m.role==="assistant" && m.timestamp===actualMessage.timestamp),"The released tutor turn was saved");
  assert.equal(final.rows.find(r=>r.turnId===row.turnId)?.turnIndex,0);
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(200);
  const mobile = await page.evaluate(()=>({viewport:innerWidth,body:document.body.scrollWidth,
    overflow:Math.max(0,document.body.scrollWidth-innerWidth)}));
  await page.screenshot({path:join(output,"classroom-mobile.png"),animations:"disabled"});

  const inspector = await host.context.newPage();
  await inspector.goto(host.origin+"/?inspector");
  await inspector.getByRole("heading",{name:"Interface use"}).waitFor();
  await inspector.getByRole("button",{name:"Export trace"}).waitFor();
  const mcp = await inspector.evaluate(()=>window.classroom.queryWebMcp());
  const downloadPromise = inspector.waitForEvent("download");
  await inspector.getByRole("button",{name:"Export trace"}).click();
  await (await downloadPromise).saveAs(join(output,"settings-export.json"));
  const storeExport = await json(join(output,"settings-export.json"));
  assert.deepEqual(storeExport.turns,final.rows);
  const cli = Bun.spawn(["rtk","proxy","bun",join(repo,"src/cli/main.ts"),"openui-diagnostics",join(output,"settings-export.json")],
    {cwd:repo,stdout:"pipe",stderr:"pipe"});
  const [stdout,err,exit] = await Promise.all([new Response(cli.stdout).text(),new Response(cli.stderr).text(),cli.exited]);
  assert.equal(exit,0,err.slice(0,140));
  assert.deepEqual(JSON.parse(stdout),mcp,"CLI and actual locally registered WebMCP callback must agree");
  await save("webmcp-and-cli.json",mcp);
  if (phase) {
    const winner = await inspector.evaluate(()=>window.classroom.queryWebMcp({view:"released-drafts",limit:1}));
    assert.equal(winner.matchingTurns,0); assert.equal(winner.unknownSelections,1);
    await save("replay-selection-query.json",winner);
  }
  await inspector.screenshot({path:join(output,"settings-inspector.png"),animations:"disabled"});
  const evidence = {schemaVersion:1, id:values.id, caseId:sample.caseId, source:live?"live-classroom":"released-message-replay",
    receipt:"../../study/"+(phase ? "supplement/"+phase+"/" : "")+"receipts/"+values.id+".json",receiptSha256:sourceSha256,
    sourceDisposition:source.disposition,sourceDecision:source.plan,sourceSelectedAttempt:source.selectedAttempt,
    ...(phase ? {sourcePolicy:source.policy,sourceSelectionRule:source.selectionRule,sourceReview:source.attempts.find(a=>a.attempt===source.selectedAttempt)?.status??null,
      sourceDecisionModel:source.refs.find(ref=>ref.label.endsWith("/plan"))?.model??null} : {}),
    submittedAt,completedAt, rawSessionId:first.sessionId, measuredTurn:final.rows.find(r=>r.turnId===row.turnId),
    originatingLearner:sample.learner,publicTextSha256:digest(actualMessage.content.filter(p=>p.type==="text").map(p=>p.text).join("\n")),
    sourcePublicTextMatches:(source.publicEnvelope??source.public)?.text===actualMessage.content.filter(p=>p.type==="text").map(p=>p.text).join("\n"),
    actualTutor:{provider:actualMessage.provider,model:actualMessage.model,responseModel:actualMessage.responseModel??null},
    gatePhases:final.progress,transport:host.traffic, rendererNodeMarkers:stages, actions,mobile,blockedExternalOrigins:[...host.external],
    transcriptPersisted:true, originalOrdinal:row.turnIndex, savedLearnerCount:final.savedMessages.filter(m=>m.role==="user").length,
    preventedModelFollowups:final.stoppedFollowups, settingsExportMatches:true, locallyRegisteredWebMcpMatchesCli:true,
    pageErrors, screenshots:["classroom-desktop.png","classroom-mobile.png","settings-inspector.png",
      ...(actions.length?["classroom-after-action.png"]:[]), ...(actions.some(a=>a.step==="edit-python")?["classroom-edit.png"]:[])]};
  await save("evidence.json",evidence);
  console.log(JSON.stringify({id:values.id,source:evidence.source,stages,actions,liveSealed:sealed?.sealed??null,
    guided:evidence.measuredTurn?.guidance,exportRows:storeExport.turns.length,output}));
} catch (error) {
  const local = await page.evaluate(async()=>{try {const r=await window.classroom.report();return {rows:r.rows,
    gateReceipt:r.gateReceipt,transcript:r.transcript,execution:r.execution,localActions:r.localActions};}catch{return null}}).catch(()=>null);
  await save("incomplete.json",{error:String(error).slice(0,800),traffic:host.traffic,pageErrors,local});
  await page.screenshot({path:join(output,"incomplete.png")}).catch(()=>{});
  throw error;
} finally { await host.close(); }

async function readSlider(page, input) {
  const info = await input.evaluate(e=>({label:e.closest("label")?.innerText?.trim().replace(/\s+/g," ")??"",
    value:Number(e.value),min:Number(e.min),max:Number(e.max),step:Number(e.step)||1}));
  const readouts = await page.locator("[data-simulation-readout]").evaluateAll(nodes=>nodes.map(n=>{
    const text = n.querySelector("dd")?.textContent?.trim()??"";
    const match = text.replaceAll(",","").match(/[-+]?\d+(?:\.\d+)?/);
    return {label:n.querySelector("dt")?.textContent?.trim()??"",text,number:match?Number(match[0]):null};
  }));
  return {...info,readouts};
}

async function eventually(page, condition, timeout=20_000) {
  const until=Date.now()+timeout;
  do {
    if (await page.evaluate(condition)) return;
    await new Promise(resolve=>setTimeout(resolve,150));
  } while (Date.now()<until);
  throw Error("Timed out waiting for the actual browser observation");
}
