// Default, --freeze, --wire and --verify are offline. Only --execute can read credentials.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { credential, fileHash, must, read, root, save, sha, total, usd, verifyPrior, withSharedLock } from "../gemini-decision/journal.mjs";
import { runTeachingDrafts } from "../../../../packages/learner-contracts/src/judgement/teaching-drafts.ts";
import { projectTeachingPolicyDecision, TEACHING_POLICY_DECISIONS, TEACHING_POLICY_VERSION } from "../../../../packages/learner-contracts/src/judgement/teaching-policy.ts";
import { createSystemOneCaller } from "../../../../packages/learner-contracts/src/judgement/system-one.ts";
import { createGeminiDecisionCaller, readGeminiDecisionUsage } from "../../../../scripts/openui-diagnostics/gemini-decision.ts";

const here = import.meta.dir;
const dir = name => join(here, name);
const protocol = read(dir("protocol.json"));
const entriesFile = dir("ledger.json");
const providers = ["jev", "google"];
const args = process.argv.slice(2);
const mode = args[0] ?? "--dry";
must(["--dry", "--freeze", "--wire", "--execute", "--verify"].includes(mode)
  && (mode === "--wire" ? args.length === 3 : args.length <= 1), "Use --dry, --freeze, --wire CASE PROVIDER, --execute, or --verify.");
if (mode === "--execute") withSharedLock();
verifyPrior();
const previous = read(dir("../gemini-decision/summary.json")).accounting;
const previousLedger = read(dir("../gemini-decision/ledger.json"));
must(fileHash(dir("../gemini-decision/ledger.json")) === protocol.previousLedgerSha256
  && fileHash(dir("../gemini-decision/summary.json")) === protocol.previousSummarySha256
  && usd(previous.previousBoundUsd + total(previousLedger.entries)) === protocol.previousAccountedUsd
  && previous.allStudyBound === protocol.previousAccountedUsd, "Earlier accounting changed.");
const maximum = usd(protocol.cases.length * providers.reduce((sum, p) => sum + protocol.providers[p].reserveUsd, 0));
must(TEACHING_POLICY_VERSION === protocol.policy && protocol.cases.length === 6 && maximum === protocol.maximumIfAllUsageMissingUsd
  && maximum <= protocol.segmentCapUsd && usd(protocol.previousAccountedUsd + maximum) <= protocol.studyCapUsd, "Invalid planning cohort or budget.");

const toolNames = read(dir("../policy-v2/cohort.json")).historicalToolNames;
const syntheticFailure = {ok: false, error: {code: "backend-unavailable", retryable: false}};
async function captureRequest(turn, model) {
  // Enter the actual draft session and stop at its first judgement boundary, before any generation.
  const requests = [];
  let generated = false;
  await runTeachingDrafts({ turn, judgementModel: {id: model, requestTokens: 64000, stateQuestionTokens: 32000},
    refinement: "ordinary", maxAttempts: 1, maxReasoning: "off",
    judge: async request => { requests.push(structuredClone(request)); return syntheticFailure; },
    generate: async () => { generated = true; throw Error("Tutor generation prohibited"); },
  });
  must(!generated && requests.length === 1 && requests[0].questions.draft_standard && requests[0].questions.learner_response_due, "Expected a single normal application planning request.");
  return requests[0];
}
function caller(provider, apiKey, fetcher, receipt) {
  const p = protocol.providers[provider];
  if (provider === "google") return createGeminiDecisionCaller({apiKey, fetch: fetcher, onReceipt: receipt});
  return createSystemOneCaller({apiKey, model: p.id, endpoint: p.endpoint, requireResolvedModel: true, fetch: fetcher,
    retry: {maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0}});
}
async function encode(provider, request) {
  let body;
  await caller(provider, "offline-placeholder", async (url, init) => {
    must(!body && url === protocol.providers[provider].endpoint && init.method === "POST", "Unexpected provider route.");
    body = init.body;
    return Response.json({}, {status: 503});
  })(request);
  must(typeof body === "string" && Buffer.byteLength(body) < 160000, "Planning request could not be encoded.");
  return body;
}
const jobs = [];
for (const c of protocol.cases) {
  const turn = {learnerMessage: c.learner, conversation: c.context ? [{role: "assistant", content: c.context}] : [],
    learnerEvidence: [], availableTools: toolNames, toolResults: [], sources: [], assessment: "unknown", improvementRuns: null, domain: "unknown"};
  const request = await captureRequest(turn, protocol.providers.jev.id);
  must(isDeepStrictEqual(request, await captureRequest(turn, protocol.providers.google.id)), "Provider received different semantic inputs.");
  const wire = {};
  for (const provider of providers) wire[provider] = await encode(provider, request);
  jobs.push({id: c.id, c, request, requestSha256: sha(request), wire});
}
const previousGoogle = new Set(readdirSync(dir("../gemini-decision/decision-cache")).map(f => f.split(".")[0]));
const previousJev = new Set(["../policy-v2/ledger.json","../policy-v2.1/ledger.json"].flatMap(f => read(dir(f)).entries.map(e => e.requestSha256)));
must(jobs.every(j => !previousGoogle.has(j.requestSha256) && !previousJev.has(sha(j.wire.jev)))
  && new Set(jobs.map(j => j.requestSha256)).size === jobs.length, "Planning inputs overlap an earlier decision or repeat.");
const requests = {version: 1, policy: protocol.policy, cases: jobs.map(j => ({id:j.id, request:j.request, requestSha256:j.requestSha256,
  wireSha256:Object.fromEntries(providers.map(p => [p, sha(j.wire[p])]))}))};
const sources = [
  "packages/learner-contracts/src/judgement/teaching-drafts.ts", "packages/learner-contracts/src/judgement/teaching-drafts/session.ts",
  "packages/learner-contracts/src/judgement/teaching-drafts/policy.ts", "packages/learner-contracts/src/judgement/teaching-policy.ts",
  "packages/learner-contracts/src/judgement/teaching-policy-catalog.ts", "packages/learner-contracts/src/judgement/interaction-affordances.ts",
  "packages/learner-contracts/src/judgement/system-one.ts", "packages/learner-contracts/src/judgement/wire.ts",
  "scripts/openui-diagnostics/gemini-decision.ts", "docs/benchmarks/openui-audit-2026-11-18/gemini-decision/journal.mjs",
];
const prospective = {version:1, protocolSha256:fileHash(dir("protocol.json")), requestSetSha256:sha(requests), runnerSha256:fileHash(import.meta.path),
  sourceHashes:Object.fromEntries(sources.map(s => [s, fileHash(join(root,s))])), priorAccountedUsd:protocol.previousAccountedUsd,
  scheduled:jobs.flatMap(j => providers.map(p => j.id + "/" + p)), maximumAdditionalUsd:maximum};
const manifestFile = dir("manifest.json");
if (mode === "--dry") {
  console.log(JSON.stringify({networkRequests:0, ...prospective})); process.exit(0);
}
if (mode === "--freeze" && !existsSync(manifestFile)) {
  must(!existsSync(entriesFile) && !existsSync(dir("results.json")), "A dispatch or results file already exists.");
  save(dir("requests.json"), requests); save(manifestFile, {...prospective, frozenAt:new Date().toISOString()});
}
const manifest = read(manifestFile);
const {frozenAt, ...fields} = manifest;
must(isDeepStrictEqual(fields, prospective) && isDeepStrictEqual(requests, read(dir("requests.json"))), "Frozen protocol, runner, requests or planner source changed.");
if (mode === "--freeze") { console.log(JSON.stringify({frozenAt, requests:jobs.length, scheduled:fields.scheduled.length, maximumAdditionalUsd:maximum})); process.exit(0); }
if (mode === "--wire") {
  const wire = jobs.find(j => j.id === args[1])?.wire[args[2]];
  must(providers.includes(args[2]) && wire, "Unknown frozen case or provider."); console.log(wire); process.exit(0);
}
const ledger = existsSync(entriesFile) ? read(entriesFile) : {version:1, manifestSha256:fileHash(manifestFile), stop:null, entries:[]};
must(ledger.manifestSha256 === fileHash(manifestFile), "Journal belongs to another protocol.");
function usage(provider, data) {
  if (provider === "google") return readGeminiDecisionUsage(data);
  const inputTokens = data?.usage?.input_tokens, outputTokens = data?.usage?.output_tokens;
  return Number.isSafeInteger(inputTokens) && inputTokens >= 0 && Number.isSafeInteger(outputTokens) && outputTokens >= 0 ? {inputTokens, outputTokens} : null;
}
function safeResponse(data, ok) {
  if (!data || typeof data !== "object") return null;
  // Both providers return typed answers and usage. Never store credentials, headers, free-form error messages or account metadata.
  const keep = ["model","model_version","modelVersion","answers","usage"];
  const payload = Object.fromEntries(keep.filter(k => Object.hasOwn(data,k)).map(k => [k,data[k]]));
  if (ok) for (const k of Object.keys(data)) if (!keep.includes(k)) payload[k] = null;
  if (!ok) payload.error = {code: typeof data.error?.code === "number" || /^[a-z0-9_-]{1,64}$/i.test(data.error?.code ?? "") ? data.error.code : null};
  return payload;
}
function modelKey(p) {
  return p === "jev" ? credential("TYPESAFE_API_KEY","typesafe_api_key") : credential("GEMINI_API_KEY","gemini") || process.env.GOOGLE_API_KEY;
}
async function dispatch(j, provider, key) {
  const p = protocol.providers[provider], label = j.id + "/" + provider;
  const entry = {label, requestedModel:p.id, endpoint:p.endpoint, requestSha256:j.requestSha256, wireSha256:sha(j.wire[provider]),
    startedAt:null, finishedAt:null, status:"reserved", http:null, response:null, usage:null, measured:false, reservedUsd:p.reserveUsd, accountedUsd:p.reserveUsd};
  let calls = 0;
  const outcome = await caller(provider, key, async (url, init) => {
    must(++calls === 1 && init.method === "POST" && url === p.endpoint && sha(init.body) === entry.wireSha256
      && !Object.keys(init.headers).some(k => k.toLowerCase().includes("long-context")), "Duplicate, misrouted or changed dispatch.");
    must(!ledger.stop && !ledger.entries.some(e => e.label === label) && ledger.entries.length < 12, "Dispatch already reserved or closed.");
    const exposure = usd(total(ledger.entries) + p.reserveUsd);
    must(exposure <= protocol.segmentCapUsd && usd(protocol.previousAccountedUsd + exposure) <= protocol.studyCapUsd, "Budget exhausted.");
    entry.startedAt = new Date().toISOString();
    ledger.entries.push(entry); save(entriesFile,ledger);
    console.log(JSON.stringify({reserved:label, requestSha256:j.requestSha256, additionalExposureUsd:exposure}));
    try {
      const response = await fetch(url, {...init, redirect:"error"});
      const data = await response.clone().json().catch(() => null);
      entry.http = response.status; entry.response = safeResponse(data,response.ok); entry.usage = usage(provider,data);
      entry.finishedAt = new Date().toISOString(); entry.status = "received";
      if (entry.usage) {
        entry.measured = true; entry.accountedUsd = usd(entry.usage.inputTokens * p.inputUsdPerMillion / 1e6);
      }
      if ([401,402,403].includes(entry.http) || entry.accountedUsd > p.reserveUsd) ledger.stop = "billing-or-reservation";
      save(entriesFile,ledger);
      return response;
    } catch {
      entry.status = "transport-unknown"; entry.finishedAt = new Date().toISOString(); save(entriesFile,ledger);
      throw Error("Transport unavailable");
    }
  })(j.request, AbortSignal.timeout(30000));
  must(calls === 1 && ledger.entries.includes(entry), "Local transport did not dispatch.");
  if (entry.status === "received") entry.status = outcome.ok ? "complete" : "provider-error";
  entry.adapterError = outcome.ok ? null : outcome.error.code;
  save(entriesFile, ledger);
  console.log(JSON.stringify({settled:label,http:entry.http,usage:entry.usage,accountedUsd:entry.accountedUsd,adapterError:entry.adapterError}));
}
if (mode === "--execute" && !ledger.stop && ledger.entries.length < prospective.scheduled.length) {
  const keys = Object.fromEntries(providers.map(p => [p,modelKey(p)]));
  must(providers.every(p => keys[p]), "An authorized decision credential is unavailable.");
  for (const j of jobs) for (const provider of providers) {
    if (ledger.stop || ledger.entries.some(e => e.label === j.id + "/" + provider)) continue;
    const lastGoogle = provider === "google" && ledger.entries.findLast(e => e.requestedModel === protocol.providers.google.id);
    if (lastGoogle) await Bun.sleep(Math.max(0, 15000 - (Date.now() - Date.parse(lastGoogle.startedAt))));
    await dispatch(j,provider,keys[provider]);
  }
}
async function assess(j, outcome) {
  const plan = projectTeachingPolicyDecision(j.request.state.turn, outcome);
  const offered = plan.interaction.families.flatMap(f => f.components);
  let observed = 0, requestCount = 0, tutorPrompt;
  const replay = await runTeachingDrafts({turn:j.request.state.turn, refinement:"ordinary", maxAttempts:1, maxReasoning:"off",
    judgementModel:{id:outcome.response.backend.model,requestTokens:64000,stateQuestionTokens:32000},
    judge:async req => {must(++requestCount === 1 && sha(req) === j.requestSha256,"Unexpected replay decision."); return outcome;},
    generate:async input => {observed++; tutorPrompt = input.systemPrompt; throw Error("Observed prompt boundary; no tutor transport");},
  });
  const sessionPlan = replay.receipt.interaction;
  must(requestCount === 1 && observed === 1 && sessionPlan?.action === plan.interaction.action
    && isDeepStrictEqual(sessionPlan.families.flatMap(f => f.components),offered), "Session offer differs from projected provider answers.");
  const assessmentOffered = offered.some(c => !["Simulation","ConceptMap","LearningImage","Diagram"].includes(c));
  const familyMatches = j.c.expectedComponent ? plan.interaction.action === "create" && offered.includes(j.c.expectedComponent) : plan.interaction.action === "none";
  const genericResponse = TEACHING_POLICY_DECISIONS.find(d => d.id === "learning_task").directive;
  return {plan, sessionPlan, tutorPromptSha256:sha(tutorPrompt), offered, assessmentOffered, familyMatches, dispositionMatches:familyMatches && (!j.c.forbidAssessment || !assessmentOffered),
    learnerResponseDue:plan.features.learner_response_due, responseDueMatches:plan.features.learner_response_due === null ? null : plan.features.learner_response_due === j.c.expectedResponseDue,
    genericLetLearnerRespondDirective:plan.directives.includes(genericResponse) && tutorPrompt.includes(genericResponse), plainReplyRequested:plan.decisions.plain_reply_requested,
    quizOffered:offered.includes("Quiz"), assessmentDeclined:plan.decisions.assessment_declined, tutorReleased:null};
}
const rows = [];
for (const j of jobs) for (const provider of providers) {
  const label = j.id + "/" + provider, entry = ledger.entries.find(e => e.label === label);
  const row = {caseId:j.id, provider, requestedModel:protocol.providers[provider].id, requestSha256:j.requestSha256,
    wireSha256:sha(j.wire[provider]), status:entry?.status ?? "undispatched", http:entry?.http ?? null, modelProvenance:null, outcome:null, assessment:null};
  if (entry?.http) {
    let provenance;
    const outcome = await caller(provider,"offline-placeholder",async (url, init) => {
      must(url === entry.endpoint && init.body === j.wire[provider], "Replay wire differs from submitted request.");
      return Response.json(entry.response, {status:entry.http});
    }, r => {provenance=r;})(j.request);
    const named = outcome.ok && outcome.response.backend.model === row.requestedModel;
    const complete = named && Object.keys(j.request.questions).every(k => Object.hasOwn(outcome.response.answers,k));
    row.modelProvenance = provider === "google" ? provenance?.modelProvenance ?? "unverified" : named ? "response-model" : "unverified";
    row.outcome = outcome;
    if (complete) row.assessment = await assess(j,outcome);
    if (!complete && row.status === "complete") row.status = "incomplete-provider-answer";
    must(entry.adapterError === undefined || (outcome.ok ? null : outcome.error.code) === entry.adapterError, "Saved evidence differs from the original decoder.");
  }
  rows.push(row);
}
let running = 0;
const labels = new Set();
for (const e of ledger.entries) {
  const row = rows.find(r => r.caseId + "/" + r.provider === e.label);
  must(row && !labels.has(e.label) && e.requestSha256 === row.requestSha256 && e.wireSha256 === row.wireSha256 && e.requestedModel === row.requestedModel
    && e.reservedUsd === protocol.providers[row.provider].reserveUsd && e.accountedUsd <= e.reservedUsd && Date.parse(e.startedAt) >= Date.parse(frozenAt), "Invalid journal entry.");
  must(usd(running + e.reservedUsd) <= protocol.segmentCapUsd && usd(protocol.previousAccountedUsd + running + e.reservedUsd) <= protocol.studyCapUsd
    && (e.measured ? e.accountedUsd === usd(e.usage.inputTokens * protocol.providers[row.provider].inputUsdPerMillion / 1e6) : e.accountedUsd === e.reservedUsd), "Accounting mismatch.");
  labels.add(e.label); running = usd(running + e.accountedUsd);
}
const results = {version:1, manifestSha256:fileHash(manifestFile), scope:"planning only", scheduled:rows.length, dispatches:ledger.entries.length,
  measuredUsage:ledger.entries.filter(e=>e.measured).length, inputTokens:ledger.entries.reduce((s,e)=>s+(e.usage?.inputTokens ?? 0),0),
  outputTokens:ledger.entries.reduce((s,e)=>s+(e.usage?.outputTokens ?? 0),0), usagePricedUsd:total(ledger.entries.filter(e=>e.measured)),
  heldForUnknownUsageUsd:total(ledger.entries.filter(e=>!e.measured)), accountedUsd:total(ledger.entries),
  cumulativeBoundUsd:usd(protocol.previousAccountedUsd + total(ledger.entries)), rows};
if (mode === "--execute") save(dir("results.json"), results);
if (mode === "--verify") must(sha(results) === sha(read(dir("results.json"))), "Results differ from offline replay.");
console.log(JSON.stringify({scheduled:results.scheduled, dispatches:results.dispatches,scored:rows.filter(r=>r.assessment).length,
  accountedUsd:results.accountedUsd, cumulativeBoundUsd:results.cumulativeBoundUsd,mode}));
