import assert from "node:assert/strict";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { cohort, repo, startHost, study } from "../../docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/host.mjs";
import { fileSha, read, save, sha, usd } from "../../docs/benchmarks/openui-audit-2026-11-18/final-review/study/common.mjs";
import { amount, cost, createProbeTransport, globalCapUsd, judgeId, phaseCapUsd, priorBoundUsd, tutorId } from "./jev-pair-transport.mjs";
import { createSystemOneCaller } from "../../packages/learner-contracts/src/judgement/system-one.ts";
import { parseOpenUiDiagnosticExport } from "../../packages/learner-contracts/src/openui-diagnostic-turn.ts";
import { pairReviewOverlapMs } from "../../packages/learner-contracts/src/openui-pair-reviews.ts";
import { stripReviewNotice } from "../../web/src/keating/judgement/review-notice.ts";

const parentPath = join(study, "supplement/prediction/receipts/tile-bag--minimax--jev.json");
const old = read(join(study, "classroom-v2.3.8/cohort.json"));
assert.equal(fileSha(parentPath), old.parentReceiptSha256);
const parent = read(parentPath);
const originalCases = [
  {id:"typed-tile-answer", learner:old.learner, parent, baseline:join(study, "classroom-v2.3.8/receipts", old.id + ".json")},
  {id:"copper-symbol", learner:cohort.cases.find(c => c.id === "copper").learner, baseline:join(study, "receipts/copper--minimax--jev.json")},
];
const args = process.argv.slice(2), budgetArg = args.find(v => v.startsWith("--max-additional-usd="));
const [mode, output] = args.filter(v => !["--feedback","--prediction"].includes(v) && v !== budgetArg);
assert(["--preflight","--preflight-controls","--run","--verify"].includes(mode) && (mode.startsWith("--preflight") || output),
  "Use --preflight, --run <new directory>, or --verify <saved directory>.");
const folder = output && resolve(output);
const stored = mode === "--verify" ? read(join(folder, "ledger.json")) : null;
const prediction = args.includes("--prediction") || stored?.protocol === "paired-prediction";
const followup = prediction || args.includes("--feedback") || stored?.protocol === "paired-feedback";
const firstBatch = join(repo, "docs/benchmarks/jev-parallel-pairs-2026-11-18");
const feedbackBatch = join(repo, "docs/benchmarks/jev-paired-feedback-2026-11-18");
const scopeLedger = join(repo, "docs/benchmarks/jev-feedback-scope-2026-11-18/summary.json");
const budget = stored ?? {
  priorBoundUsd:prediction ? 3.070723792 : followup ? 2.861363164 : priorBoundUsd,
  phaseCapUsd:budgetArg ? Number(budgetArg.slice(budgetArg.indexOf("=") + 1)) : phaseCapUsd,
  globalCapUsd,
};
if (followup) {
  assert.equal(read(prediction ? join(feedbackBatch,"summary.json") : scopeLedger).totalBoundUsd, budget.priorBoundUsd);
  if (mode === "--run") assert(budgetArg, "A fresh comparison requires --max-additional-usd=<authorized amount>.");
}
const feedbackCases = [
  ...originalCases.map(c => ({...c, baseline:join(firstBatch, c.id + ".json")})),
  {id:"wrong-tile-answer", parent, learner:"I think square is more likely, because it was dropped in first. Is that right?"},
  {id:"toy-train", learner:"I’m testing a toy train on a straight track for 8 seconds. I’d like to change its speed in metres per second and see straight away how far it travels. No quiz, please."},
  {id:"paper-fold", learner:cohort.cases.find(c => c.id === "paper-fold").learner,
    baseline:join(study,"receipts/paper-fold--minimax--jev.json")},
];
const predictionCases = [
  {id:"paper-fold", learner:cohort.cases.find(c => c.id === "paper-fold").learner,
    baseline:join(feedbackBatch,"paper-fold.json")},
  {id:"sock-draw",learner:"There are two blue socks and one yellow sock in a drawer. I’m going to draw one at random without looking. I’d like to guess which colour I’m more likely to pick before you explain."},
];
const cases = prediction ? predictionCases : followup ? feedbackCases : originalCases;
const localAnswers = {
  "paper-fold":{choice:/^(?:4|four)(?: layers?(?: of paper)?)?[.!]?$/iu, answer:"Four layers. The second fold doubles the two layers."},
  "sock-draw":{choice:/^(?:blue|blue socks?|(?:a |the )?blue sock|blue is (?:more|most) likely)[.!]?$/iu,
    answer:"Blue, because two of the three socks are blue."},
};
const opportunities = {
  "typed-tile-answer":"Confirm that round is more likely because three of four tiles are round. Do not replace the open Question or grade an unsubmitted form.",
  "copper-symbol":"Give the symbol Cu. The learner expressly wants only the symbol.",
  "wrong-tile-answer":"Explain that the first tile dropped in does not determine a random draw and that round has three chances in four. Leave the existing Question available.",
  "toy-train":"The learner expects to vary speed and immediately see distance change over eight seconds. Look for a usable control and a correctly updating distance without an assessment.",
  "paper-fold":cohort.cases.find(c => c.id === "paper-fold").rubric,
  "sock-draw":"Invite a guess about the more likely colour without revealing blue. Provide a visible learner-operable Question or equivalent native input. The known answer is blue because two of the three socks are blue.",
};
function registeredProtocol() {
  return {study:prediction ? "paired-prediction" : "paired-feedback", setting:"Local release-worktree Chromium classroom with live Jev and MiniMax",
    cohort:cases.map(c => ({case:c.id, learner:c.learner, opportunity:opportunities[c.id], historicalReceipt:c.baseline ? relative(repo,c.baseline) : null,
      historicalReceiptSha256:c.baseline ? fileSha(c.baseline) : null, parentQuestionReceiptSha256:c.parent ? fileSha(parentPath) : null})),
    questionAction:prediction ? "On each released Question, select four layers for paper or blue for the sock draw. If the authored control takes text, enter the answer and its reason. Inspect the actual locally saved submission and grading state. Further inference is closed."
      : "On a released paper-fold Question, select four layers or type the answer and attempt one local submission. Further inference is closed.",
    ...(!prediction && {simulationAction:"On a released toy-train slider, change the speed one step and record the rendered input and readouts."}),
    signal:"Four fresh tutor requests, two independently observed overlapping Jev comparisons, public text, selected/rendered controls and budget are recorded for each scheduled turn."};
}

function sourceIdentity() {
  const manifest = {};
  for (const path of ["packages/learner-contracts/src/judgement","web/src/keating/judgement","web/src/keating/openui"]) {
    const files = readdirSync(join(repo, path), {recursive:true, encoding:"utf8"}).filter(name => name.endsWith(".ts")).sort();
    for (const name of files) manifest[join(path, name)] = fileSha(join(repo, path, name));
  }
  for (const name of readdirSync(join(repo,"packages/learner-contracts/src")).filter(name => name.startsWith("openui-") && name.endsWith(".ts")).sort()) {
    const path = join("packages/learner-contracts/src", name);
    manifest[path] = fileSha(join(repo, path));
  }
  return {gitHead:Bun.spawnSync(["rtk","proxy","git","rev-parse","HEAD"], {cwd:repo}).stdout.toString().trim(),
    files:manifest, sha256:sha(manifest)};
}
function makeBridge(sample, transport) {
  const token = randomBytes(24).toString("hex");
  let questionReady = !sample.parent;
  let completedTurn = false;
  const failures = [], pending = new Set();
  async function handle(req) {
    const auth = req.headers.get("authorization") ?? "";
    const expected = "Bearer " + token;
    if (auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) return new Response(null, {status:403});
    if (completedTurn) return new Response(null, {status:409});
    try {
      assert(transport && questionReady && req.method === "POST");
      const body = await req.json();
      const path = new URL(req.url).pathname;
      if (path === "/decision") {
        const turn = body.request.state.turn;
        assert(typeof turn.learnerMessage === "string" && turn.learnerMessage.endsWith(sample.learner));
        if (sample.parent && body.request.questions.learning_task) {
          assert.equal(turn.previousQuestionPresentation?.nodeId, "guess");
          assert.equal(turn.previousQuestionPresentation.documentId, turn.activeWork.openInteractions[0].documentId);
          assert.equal(turn.pendingSubmissions.length, 0);
        }
        return Response.json(await transport.decision(sample.id, body.request, req.signal));
      }
      assert.equal(path, "/tutor");
      assert(body.context.messages.some(m => m.role === "user" && JSON.stringify(m.content).includes(sample.learner)));
      return Response.json(await transport.tutor(sample.id, body.context, body.reasoning, req.signal));
    } catch (error) {
      failures.push(error instanceof assert.AssertionError ? "assertion:" + (error.operator ?? "guard") : error.name ?? "Error");
      return Response.json({error:"Probe transport unavailable"}, {status:422});
    }
  }
  const server = Bun.serve({hostname:"127.0.0.1", port:0, idleTimeout:180, maxRequestBodySize:1_000_000,
    fetch(req) {
      const task = handle(req);
      pending.add(task);
      task.finally(() => pending.delete(task));
      return task;
    }});
  return {url:server.url.href, token, failures, staged() { questionReady = true; }, closeInference() { completedTurn = true; },
    async close() { await Promise.allSettled([...pending]); server.stop(true); }};
}

async function runClassroom(sample, transport) {
  const bridge = makeBridge(sample, transport);
  const host = await startHost({product:repo, useGateDefaults:true, bridge, sample:{
    provider:"minimax", model:tutorId, learner:sample.parent?.prompt ?? sample.learner,
    followup:!!sample.parent, message:sample.parent?.public.message,
  }});
  try {
    const page = await host.context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.name));
    await page.goto(host.origin, {waitUntil:"domcontentloaded", timeout:95_000});
    await page.waitForFunction(() => window.classroom?.ready || window.classroom?.startupError, null, {timeout:110_000});
    assert.equal(await page.evaluate(() => window.classroom.startupError), undefined);
    const box = page.getByPlaceholder("Message Keating", {exact:true});
    const send = page.getByRole("button", {name:"Send message",exact:true});
    let previous = null;
    if (sample.parent) {
      await box.fill(sample.parent.prompt);
      await send.click();
      await page.getByRole("radio").first().waitFor();
      await observation(page, async () => (await window.classroom.rows())[0]?.rendered?.includes("question-group")
        && (await window.classroom.readQuestionState()).open.length === 1, null, 25_000);
      const state = await page.evaluate(() => window.classroom.readQuestionState());
      assert.equal(state.open[0].nodeId, "guess");
      assert.equal(state.pending, 0);
      previous = {documentId:state.open[0].documentId, nodeId:state.open[0].nodeId, rendered:"question-group", pending:state.pending};
      bridge.staged();
    }
    if (!transport) return {case:sample.id, previous, browserReady:true, newProviderRequests:0};
    const turn = sample.parent ? 1 : 0;
    await box.fill(sample.learner);
    const startedAt = Date.now();
    await send.click();
    const current = await observation(page, async index => {
      const state = await window.classroom.report();
      return state.gateReceipt && state.rows.some(row => row.turnIndex === index && row.reply !== "pending")
        && state.transcript.some(m => m.role === "assistant" && m.timestamp === state.gateReceipt.messageTimestamp) && state;
    }, turn, 205_000);
    bridge.closeInference();
    const receivedAt = Date.now();
    const message = current.transcript.find(m => m.role === "assistant" && m.timestamp === current.gateReceipt.messageTimestamp);
    const snapshot = current.gateReceipt.snapshot;
    const bubble = page.locator(".keating-bubble").nth(turn);
    await bubble.waitFor();
    if (followup && snapshot.phase === "released" && message.content.some(p => p.type === "text" && p.text.trim())) {
      await observation(page, async index => {
        const row = (await window.classroom.rows()).find(item => item.turnIndex === index);
        return row && row.rendered !== null && row.rendered !== undefined;
      }, turn, 12_000).catch(() => {});
    }
    const visibleText = (await bubble.innerText()).trim();
    const text = message.content.filter(p => p.type === "text").map(p => p.text).join("\n");
    const toolCalls = message.content.filter(p => p.type === "toolCall").map(({name,arguments:args}) => ({name,arguments:args}));
    const inspector = await host.context.newPage();
    await inspector.goto(host.origin + "/?inspector");
    const file = inspector.waitForEvent("download");
    await inspector.getByRole("button", {name:"Export trace"}).click();
    const trace = await Bun.file(await (await file).path()).json();
    const row = trace.turns.find(r => r.turnIndex === turn);
    assert(row);
    const before = sample.baseline && read(sample.baseline);
    const record = {id:sample.id, learner:sample.learner, startedAt, receivedAt, previous,
      prior:before ? {receipt:relative(repo, sample.baseline), sha256:fileSha(sample.baseline),
        disposition:before.disposition ?? before.snapshot?.phase ?? null, publicText:before.public?.text ?? null} : null,
      snapshot, public:{text, toolCalls, visibleText, rendered:row.rendered}, observation:row,
      browserErrors:pageErrors, blockedExternalOrigins:[...host.external], transportErrors:bridge.failures};
    if (followup) {
      await page.bringToFront();
      if (folder) await page.screenshot({path:join(folder,sample.id + "-classroom.png"),animations:"disabled"}).catch(() => {});
      const beforeAction = prediction && transport.ledger?.entries.length;
      try { record.controls = await exerciseControls(bubble,sample); }
      catch (error) { record.controls = {observation:"interaction-incomplete", reason:error.name}; }
      if (prediction && typeof beforeAction === "number") {
        record.controls.newProviderRequestsDuringAction = transport.ledger.entries.length - beforeAction;
        assert.equal(record.controls.newProviderRequestsDuringAction, 0);
      }
      if (folder && (record.controls.adjustment || record.controls.questionActions?.length)) {
        await page.screenshot({path:join(folder,sample.id + "-after-action.png"),animations:"disabled"}).catch(() => {});
      }
    }
    if (folder) save(join(folder, sample.id + ".json"), record);
    return record;
  } finally { await host.close(); await bridge.close(); }
}

async function exerciseControls(bubble, sample) {
  const inputs = bubble.getByRole("slider");
  const page = bubble.page();
  const controls = {components:await bubble.locator("[data-openui-diagnostic-nodes]").evaluateAll(
    ns => ns.map(n => n.getAttribute("data-openui-diagnostic-nodes"))),
    sliders:await inputs.count(), questions:await bubble.locator("[data-question-kind]").count(), adjustment:null};
  const learnerAnswer = localAnswers[sample.id];
  if (prediction && learnerAnswer) {
    controls.nativePages = [];
    const containers = page.locator("[data-interactive-page]:visible");
    for (const node of await containers.all()) {
      const native = {status:await node.getAttribute("data-native-page-status"), choiceSelected:false};
      controls.nativePages.push(native);
      const iframe = await node.locator("iframe:visible").elementHandles();
      const frame = iframe.length === 1 && await iframe[0].contentFrame();
      if (!frame) continue;
      native.controls = await frame.locator("button:visible, input:visible, select:visible, textarea:visible").count();
      const radio = frame.getByRole("radio",{name:learnerAnswer.choice});
      const button = frame.getByRole("button",{name:learnerAnswer.choice});
      if (await radio.count() === 1) {
        await radio.check(); native.choiceSelected = await radio.isChecked();
      } else if (await button.count() === 1) {
        native.choice = (await button.innerText()).trim();
        await button.click(); native.choiceSelected = true;
      }
      if (native.choiceSelected) {
        const submit = frame.getByRole("button",{name:/^(?:commit|lock in|submit|check)(?: (?:your |my )?(?:answer|guess|prediction))?$/iu});
        if (await submit.count() === 1 && await submit.isEnabled()) {
          await submit.click(); native.submitActivated = true;
        }
        native.afterAction = (await frame.locator("body").innerText()).trim().slice(0,700);
      }
    }
  }
  if (learnerAnswer && controls.questions) {
    const actions = controls.questionActions = [];
    try {
      for (let i=0; i<5; ++i) {
        const field = bubble.locator("[data-question-kind]:visible").first();
        if (!await field.count()) break;
        const prompt = (await field.locator("legend").innerText()).trim();
        if (await field.getByRole("radio").count()) {
          const choice = field.locator("label.shared-activity__choice").filter({has:page.getByText(learnerAnswer.choice,{exact:true})});
          if (await choice.count() !== 1) { actions.push({step:"unmatched-choice",prompt}); break; }
          await choice.click();
          actions.push({step:"select",prompt,answer:(await choice.innerText()).trim()});
        } else {
          const form = field.getByRole("textbox");
          if (await form.count() !== 1) { actions.push({step:"unrecognized-field",prompt}); break; }
          await form.fill(learnerAnswer.answer);
          actions.push({step:"type",prompt,answer:learnerAnswer.answer});
        }
        const next = bubble.getByRole("button",{name:/^Next$/i});
        if (await next.count()) { await next.click(); continue; }
        const submit = bubble.getByRole("button",{name:/^(Send answer|Finish check)$/i});
        if (await submit.count() !== 1) { actions.push({step:"unrecognized-submit"}); break; }
        await submit.click();
        const answers = await observation(page,async () => {
          const records = await window.classroom.readSavedAnswers();
          return records.length && records;
        },null,8_000);
        const detail = await page.evaluate(async () => {
          const report = await window.classroom.report();
          const state = await window.classroom.readQuestionState();
          return {localActions:report.localActions, pendingSubmissions:state.pending, stoppedFollowupTurns:report.stoppedFollowups};
        });
        actions.push({step:"submit",savedAnswers:answers,...detail});
        break;
      }
    } catch (error) { actions.push({step:"interaction-incomplete",reason:error.name}); }
  }
  if (sample.id !== "toy-train" || !controls.sliders) return controls;
  const speed = bubble.getByRole("slider", {name:/speed|velocity/i});
  const slider = await speed.count() ? speed.first() : inputs.first();
  const readouts = bubble.locator("[data-simulation-readout]");
  const readings = () => readouts.evaluateAll(nodes => nodes.map(n => ({
    label:n.querySelector("dt")?.textContent ?? "", value:n.querySelector("dd")?.textContent ?? "",
  })));
  const before = {input:await slider.inputValue(), readings:await readings()};
  const {label,max} = await slider.evaluate(element => ({label:element.getAttribute("aria-label") ??
    element.closest("label")?.innerText.trim() ?? element.labels?.[0]?.innerText.trim() ?? null, max:element.getAttribute("max")}));
  await slider.press(max !== null && Number(before.input) >= Number(max) ? "ArrowLeft" : "ArrowRight");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const after = {input:await slider.inputValue(), readings:await readings()};
  const number = value => Number(value.replaceAll(",","").match(/[-+]?\d+(?:\.\d+)?/u)?.[0] ?? NaN);
  controls.adjustment = {label,before,after, inputChanged:before.input !== after.input,
    distanceMatchesEightSeconds:before.input !== after.input && before.readings.some((r,i) =>
      number(r.value) === 8 * Number(before.input) && number(after.readings[i]?.value ?? "") === 8 * Number(after.input))};
  return controls;
}

async function observation(page, predicate, arg, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await page.evaluate(predicate, arg);
    if (value) return value;
    await page.waitForTimeout(120);
  }
  throw Error("Classroom observation timed out");
}

// A short HTTP interval can finish before its sibling starts even if the gate
// schedules both concurrently. Report the measured overlap, including zero.
function overlap(rows) {
  if (rows.length < 2 || rows.some(r => r.sentAt === null || r.receivedAt === null)) return null;
  return Math.max(0, Math.min(...rows.map(r => r.receivedAt)) - Math.max(...rows.map(r => r.sentAt)));
}

function candidateStrategy(system) {
  const text = Array.isArray(system) ? system.map(part => part.text ?? "").join("\n") : system ?? "";
  if (text.includes("Reply to the existing question in the conversation.")) return "reply-to-question";
  if (text.includes("Stay with the learner's reasoning on the existing question.")) return "respond-to-reasoning";
  if (text.includes("Collect the learner's own answer in one OpenUI Question.")) return "collect-prediction";
  return "ordinary";
}

function summarize() {
  const receipt = read(join(folder, "ledger.json"));
  assert.equal(sha(receipt.source.files), receipt.source.sha256);
  const wires = new Map();
  for (const entry of receipt.entries) {
    const bytes = gunzipSync(readFileSync(join(folder, "wire", entry.wireSha256 + ".json.gz")));
    assert.equal(sha(bytes), entry.wireSha256);
    const wire = JSON.parse(bytes);
    assert.equal(wire.model, entry.model);
    assert.equal(entry.model, entry.kind === "tutor" ? tutorId : judgeId);
    assert.equal(entry.accountedUsd, amount(entry.kind, entry.usage));
    wires.set(entry, wire);
  }
  const rows = cases.map(sample => {
    const file = read(join(folder, sample.id + ".json"));
    const entries = receipt.entries.filter(x => x.cell === sample.id);
    const tutors = entries.filter(x => x.kind === "tutor");
    const pairCalls = entries.filter(x => x.stage === "pair");
    if (file.unobserved) return {case:sample.id, learner:sample.learner, disposition:"observation-unavailable",
      reason:file.reason, actualTutorRequests:tutors.length, individualReviews:entries.filter(e => e.stage === "review").length,
      pairRequests:pairCalls.length, concurrentPairReviewsMs:pairCalls.length === 2 ? overlap(pairCalls) : null,
      visibleText:null, rendered:null, elapsedMs:null, controls:null};
    const pairs = pairCalls.map(e => {
      const body = wires.get(e);
      const numbers = Object.keys(body.state.candidates).map(key => Number(key.replace(/^draft_/u, ""))).sort();
      assert.deepEqual(numbers, numbers[0] === 1 ? [1,2] : [3,4]);
      assert.deepEqual(Object.keys(body.questions), ["draft_pair_choice"]);
      const reviewed = file.snapshot.pairReviews?.find(row => row.pair === (numbers[0] === 1 ? 1 : 2));
      assert.deepEqual(reviewed?.candidateAttempts, numbers);
      if (reviewed.status === "compared") {
        assert.equal(e.response?.model, judgeId);
        assert.equal(reviewed.model, judgeId);
        const choice = e.response.answers.draft_pair_choice;
        assert.equal("draft_" + reviewed.preferredAttempt, choice.choice);
      }
      return {candidateAttempts:numbers, wire:e.wireSha256, status:reviewed.status,
        preferredAttempt:reviewed.preferredAttempt, eligibleAttempts:reviewed.eligibleAttempts ?? [],
        finalistAttempt:reviewed.finalistAttempt ?? null, sentAt:e.sentAt, receivedAt:e.receivedAt,
        ...(prediction ? {predictionQuestionAttempts:reviewed.predictionQuestionAttempts ?? null} : {})};
    }).sort((a,b) => a.candidateAttempts[0] - b.candidateAttempts[0]);
    // The native snapshots contain per-option probabilities; content-free exports
    // intentionally carry the disposition/nominees and measured interval only.
    const trace = file.observation;
    if (sample.baseline) assert.equal(file.prior.sha256, fileSha(sample.baseline));
    assert.deepEqual(trace.pairReviews ?? [], (file.snapshot.pairReviews ?? []).map(({probabilities, ...rest}) => rest));
    const reviewed = entries.filter(e => e.stage === "review").map(e => wires.get(e).state.reply);
    const pairAnswers = Object.fromEntries(pairCalls.flatMap(e => Object.entries(wires.get(e).state.candidates)));
    if (reviewed.length === 4 && Object.keys(pairAnswers).length === 4) {
      assert.deepEqual(reviewed.map(sha).sort(), Object.values(pairAnswers).map(sha).sort());
    }
    const published = pairAnswers["draft_" + file.snapshot.selectedAttempt];
    if (file.snapshot.phase === "released" && published) {
      assert.deepEqual({text:stripReviewNotice(file.public.text), toolCalls:file.public.toolCalls}, published);
    }
    return {case:sample.id, learner:sample.learner, previousDisposition:file.prior?.disposition ?? null, disposition:file.snapshot.phase,
      actualTutorRequests:tutors.length, completeTutorMessages:tutors.filter(e => ["stop","toolUse"].includes(e.message?.stopReason)).length,
      fourTutorRequestsOverlapMs:tutors.length === 4 ? overlap(tutors) : null,
      individualReviews:entries.filter(e => e.stage === "review").length, pairRequests:pairCalls.length,
      concurrentPairReviewsMs:pairCalls.length === 2 ? overlap(pairCalls) : null, pairs,
      selectedAttempt:file.snapshot.selectedAttempt ?? null, visibleText:file.public.visibleText, rendered:trace.rendered,
      elapsedMs:file.receivedAt - file.startedAt, recordedSnapshotPairCount:file.snapshot.pairReviews?.length ?? 0,
      diagnosticPairCount:trace.pairReviews?.length ?? 0,
      ...(followup ? {runtimePairOverlapMs:pairReviewOverlapMs(trace.pairReviews ?? []), controls:file.controls,
        checkpointReplyMode:entries.find(e => e.stage === "plan")?.response?.answers?.checkpoint_reply_mode?.choice ?? null,
        interactionPlan:file.snapshot.interaction, delivery:{guidance:trace.guidance, attempted:trace.attempted,
          compiled:trace.compiled,selected:trace.selected,rendered:trace.rendered,nativePage:trace.nativePage},
        candidateStrategies:file.snapshot.attempts.map(a => ({attempt:a.attempt, variant:a.variant, feedbackOnly:a.feedbackOnly === true,
          ...(prediction ? {predictionQuestionOnly:a.predictionQuestionOnly === true} : {})})),
        tutorPromptShapes:tutors.map(e => {
        const wire = wires.get(e);
        return {dispatch:e.request, strategy:candidateStrategy(wire.system), wireSha256:e.wireSha256,
          toolNames:(wire.tools ?? []).map(t => t.name),
          ...(prediction ? {hasSingleQuestionGrammar:JSON.stringify(wire.system).includes("root = LearningSurface([response])")} : {})};
      })} : {})};
  });
  const newBoundUsd = cost(receipt.entries);
  assert(newBoundUsd <= receipt.phaseCapUsd && usd(receipt.priorBoundUsd + newBoundUsd) <= globalCapUsd);
  return {rows, requests:receipt.entries.length, metered:receipt.entries.filter(e => e.usage).length,
    priorBoundUsd:receipt.priorBoundUsd, newBoundUsd, totalBoundUsd:usd(receipt.priorBoundUsd + newBoundUsd), phaseCapUsd:receipt.phaseCapUsd, globalCapUsd,
    invoiceUsd:null, sourceSha256:receipt.source.sha256};
}

async function checkOfflineQuestionForms() {
  const oldPaper = read(join(study,"receipts/paper-fold--flash--jev.json"));
  const examples = [];
  for (const sample of predictionCases) {
    const message = structuredClone(oldPaper.public.message);
    if (sample.id === "sock-draw") {
      message.content = [{type:"text",text:[
        "```openui lifecycle=ephemeral id=offline-socks","",
        "root = LearningSurface([response])",
        'response = Question([{ question: "Which colour do you think a random sock will be?", type: "text" }])',"```",
      ].join("\n")}];
    }
    const host = await startHost({product:repo,useGateDefaults:true,sample:{provider:message.provider,model:message.model,learner:sample.learner,message}});
    try {
      const page = await host.context.newPage();
      await page.goto(host.origin,{waitUntil:"domcontentloaded",timeout:95_000});
      await page.waitForFunction(() => window.classroom?.ready || window.classroom?.startupError,null,{timeout:110_000});
      await page.getByPlaceholder("Message Keating",{exact:true}).fill(sample.learner);
      await page.getByRole("button",{name:"Send message",exact:true}).click();
      const bubble = page.locator(".keating-bubble").first();
      await bubble.locator("[data-question-kind]").first().waitFor();
      const controls = await exerciseControls(bubble,sample);
      const submit = controls.questionActions?.find(action => action.step === "submit");
      assert.equal(submit?.savedAnswers.length,1,JSON.stringify(controls));
      assert.equal(submit.savedAnswers[0].answer,sample.id === "paper-fold" ? "4" : localAnswers[sample.id].answer);
      examples.push({case:sample.id,source:sample.id === "paper-fold" ? "Earlier saved Flash/Jev Question" : "Explicit synthetic free-text Question",
        answer:submit.savedAnswers[0].answer,grading:submit.savedAnswers[0].grading,score:submit.savedAnswers[0].score});
    } finally { await host.close(); }
  }
  return examples;
}

async function replayPredictionRouting() {
  const archive = read(join(feedbackBatch,"ledger.json"));
  const wire = entry => JSON.parse(gunzipSync(readFileSync(join(feedbackBatch,"wire",entry.wireSha256 + ".json.gz"))));
  const offers = [], source = sourceIdentity();
  for (const sample of feedbackCases) {
    assert.equal(sourceIdentity().sha256, source.sha256);
    const records = archive.entries.filter(r => r.cell === sample.id);
    const plan = records.find(r => r.stage === "plan");
    const tutors = records.filter(r => r.kind === "tutor");
    const reviews = new Map(records.filter(r => r.stage === "review").map(entry => [sha(wire(entry).state.reply),entry.response]));
    const generations = [];
    const clonedPlan = structuredClone(plan.response);
    const intervals = [];
    const double = {
      async tutor(cell,context) {
        generations.push({strategy:candidateStrategy(context.systemPrompt),toolCount:context.tools?.length ?? 0});
        return structuredClone(tutors[generations.length - 1].message);
      },
      async decision(cell,request,signal) {
        const caller = createSystemOneCaller({model:judgeId,apiKey:"offline",retry:{maxAttempts:1,initialDelayMs:0,maxDelayMs:0},
          fetch:async () => {
            if (request.questions.learning_task) return Response.json(clonedPlan);
            const choice = Object.keys(request.questions).find(k => ["draft_pair_choice","draft_choice"].includes(k));
            if (choice) {
              const keys = Object.keys(request.questions[choice].criteria);
              const clock = {sentAt:Date.now()};
              if (choice === "draft_pair_choice") intervals.push(clock);
              await Bun.sleep(40);
              clock.receivedAt = Date.now();
              return Response.json({model:judgeId,answers:{[choice]:{type:"choice",choice:keys[0],confidence:1,
                probabilities:Object.fromEntries(keys.map((k,i) => [k,i === 0 ? 1 : 0]))}}});
            }
            const saved = reviews.get(sha(request.state.reply));
            assert(saved, "A current candidate no longer matches an archived per-candidate review.");
            return Response.json(saved);
          }});
        return caller(request,signal);
      },
    };
    const result = await runClassroom(sample,double);
    assert.equal(generations.length,4);
    assert.equal(result.observation.pairReviews?.length,2);
    assert.equal(intervals.length,2);
    assert(overlap(intervals) > 0);
    assert.deepEqual(result.transportErrors,[], "The archive-backed local decision replay must settle every observed call.");
    const expected = sample.id === "paper-fold" ? ["ordinary","collect-prediction","ordinary","collect-prediction"]
      : sample.parent ? ["reply-to-question","ordinary","respond-to-reasoning","ordinary"]
      : ["ordinary","ordinary","ordinary","ordinary"];
    assert.deepEqual(generations.map(g => g.strategy),expected);
    assert(generations.every(g => g.strategy === "ordinary" ? g.toolCount > 0 : g.toolCount === 0));
    if (sample.id !== "paper-fold") {
      const prior = read(join(feedbackBatch,sample.id + ".json"));
      assert.equal(result.snapshot.phase,prior.snapshot.phase);
      assert.deepEqual(result.observation.rendered,prior.observation.rendered);
    }
    offers.push({case:sample.id,planWireSha256:plan.wireSha256,generations,fixturePairOverlapMs:overlap(intervals),
      review:"Archived matching candidate answers; local pair-choice double",exportedPairs:result.observation.pairReviews.length,
      replayedDisposition:result.snapshot.phase,replayedRendered:result.observation.rendered});
  }
  const locallySubmittedForms = await checkOfflineQuestionForms();
  console.log(JSON.stringify({sourceSha256:source.sha256,archive:"jev-paired-feedback-2026-11-18",
    expectedDecisionRouting:true,newProviderRequests:0,cases:offers,locallySubmittedForms}));
}

if (mode === "--preflight-controls") {
  console.log(JSON.stringify({locallySubmittedForms:await checkOfflineQuestionForms(),newProviderRequests:0}));
} else if (mode === "--preflight" && prediction) {
  await replayPredictionRouting();
} else if (mode === "--preflight") {
  const saved = read(join(study, "classroom-v2.3.8/ledger.json")).entries;
  const intervals = [];
  const generations = [];
  const double = {
    async tutor(cell, context) {
      generations.push({strategy:candidateStrategy(context.systemPrompt), toolCount:context.tools?.length ?? 0});
      return structuredClone(saved.filter(e => e.kind === "tutor").at(-1).message);
    },
    async decision(cell, request, signal) {
      const selection = Object.keys(request.questions).find(k => ["draft_pair_choice","draft_choice"].includes(k));
      const caller = createSystemOneCaller({model:judgeId, apiKey:"offline",
        retry:{maxAttempts:1,initialDelayMs:0,maxDelayMs:0}, fetch:async () => {
          if (!selection) {
            const source = request.questions.learning_task ? saved[0] : saved.at(-1);
            const response = structuredClone(source.response);
            // This choice was added after the saved fixture. Exercise its feedback
            // branch locally, separately from the model's choice in the paid run.
            if (request.questions.checkpoint_reply_mode) response.answers.checkpoint_reply_mode = {
              type:"choice", choice:"feedback", confidence:1, probabilities:{feedback:1,new_action:0,unclear:0}};
            return Response.json(response);
          }
          const keys = Object.keys(request.questions[selection].criteria);
          const interval = {sentAt:Date.now()};
          if (selection === "draft_pair_choice") intervals.push(interval);
          await Bun.sleep(60);
          interval.receivedAt = Date.now();
          // Explicit local test double. The historical three-draft run had no pair choice.
          return Response.json({model:judgeId, answers:{[selection]:{type:"choice",choice:keys[0],
            probabilities:Object.fromEntries(keys.map((k,i) => [k,i === 0 ? 1 : 0])),confidence:1}}});
        }});
      return caller(request, signal);
    },
  };
  const result = await runClassroom(cases[0], double);
  assert.equal(generations.length, 4);
  if (followup) {
    const focused = generations.filter(g => g.strategy !== "ordinary");
    assert.deepEqual(focused.map(g => g.strategy).sort(), ["reply-to-question", "respond-to-reasoning"]);
    assert(focused.every(g => g.toolCount === 0));
    assert(generations.filter(g => g.strategy === "ordinary").every(g => g.toolCount > 0));
  }
  assert.equal(intervals.length, 2);
  assert(overlap(intervals) > 0);
  assert.equal(result.snapshot.pairReviews?.length, 2);
  assert.equal(result.observation.pairReviews?.length, 2);
  console.log(JSON.stringify({case:result.id, previous:result.previous, source:"historical fixtures and local pair-choice double",
    candidateCount:generations.length, strategies:generations, pairCount:intervals.length, overlapMs:overlap(intervals), exportedPairs:result.observation.pairReviews.length,
    newProviderRequests:0}));
} else if (mode === "--verify") {
  const result = summarize();
  assert.deepEqual(result, read(join(folder, "summary.json")));
  const trace = read(join(folder, "settings-export.json"));
  assert.deepEqual(parseOpenUiDiagnosticExport(trace), cases.map(c => read(join(folder, c.id + ".json")).observation).filter(Boolean));
  if (followup) assert.deepEqual(read(join(folder,"protocol.json")), registeredProtocol());
  const command = Bun.spawnSync(["rtk","proxy",process.execPath,join(repo,"src/cli/main.ts"),"openui-diagnostics",join(folder,"settings-export.json"),
    "--view","pair-reviews","--limit","10"], {cwd:repo, stdout:"pipe", stderr:"pipe"});
  assert.equal(command.exitCode, 0, command.stderr.toString().slice(0,200));
  const cli = JSON.parse(command.stdout.toString());
  assert.equal(cli.matchingTurns, trace.turns.filter(t => t.pairReviews).length);
  console.log(JSON.stringify({verified:true, rows:result.rows.length, cliMatchingTurns:cli.matchingTurns, comparedPairs:cli.comparedPairs,
    observedProviderRequests:result.requests, newProviderRequests:0}));
} else {
  assert(!existsSync(folder), "An existing run (including an incomplete one) cannot be dispatched again.");
  mkdirSync(folder, {mode:0o700});
  const source = sourceIdentity();
  if (followup) save(join(folder,"protocol.json"), registeredProtocol());
  const transport = await createProbeTransport(repo,folder,source,budget,prediction ? "paired-prediction" : followup ? "paired-feedback" : undefined);
  try {
    for (const sample of cases) {
      assert.equal(sourceIdentity().sha256, source.sha256, "The measured source changed during the comparison.");
      if (!followup) { await runClassroom(sample,transport); continue; }
      try {
        assert(!transport.ledger.stop,"The paid session is closed.");
        await runClassroom(sample,transport);
      } catch (error) {
        const reason = transport.ledger.stop ? "budget-or-provider-stop" :
          error.name === "TimeoutError" || String(error.message).includes("timed out") ? "timed-out" : error.name;
        save(join(folder, sample.id + ".json"), {id:sample.id, unobserved:true, observation:null, reason});
        console.error(JSON.stringify({case:sample.id, observation:"unavailable", reason}));
      }
    }
    const turns = cases.map(c => read(join(folder, c.id + ".json")).observation).filter(Boolean);
    assert.equal(new Set(turns.map(r => r.conversationId)).size, turns.length);
    save(join(folder, "settings-export.json"), {schemaVersion:1, turns});
    const result = summarize();
    save(join(folder, "summary.json"), result);
    console.log(JSON.stringify(result));
  } finally { transport.close(); }
}
