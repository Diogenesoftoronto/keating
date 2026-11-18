// Offline derivation from the frozen schedule, both paid ledgers and synthetic turn receipts.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isOpenUiDiagnosticGateIssue, isOpenUiDiagnosticInterface, normalizeOpenUiComponent,
  openUiMatchesTargets,
} from "../../../../packages/learner-contracts/src/openui-diagnostic-turn.ts";
import { parseSimulationExpression, evaluateSimulationExpression } from "../../../../packages/learner-contracts/src/simulation-expression.ts";

const sha = input => createHash("sha256").update(input).digest("hex");
const read = path => JSON.parse(readFileSync(path, "utf8"));
const check = (v, message) => { if (!v) throw Error(message); };
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const unique = values => [...new Set(values)].sort();
const usd = v => Number(v.toFixed(9));
const total = rows => usd(rows.reduce((sum, row) => sum + row.accountedUsd, 0));
const isFinished = d => ["stop", "toolUse"].includes(d.response?.stop) && (d.response.text.trim() || d.response.nativeTools.length > 0);
const count = (arr, predicate) => arr.filter(predicate).length;
const rate = (n,d) => ({n,d});

function simulationSample(node) {
  const ids = node.parameters.map(p => p.id);
  const frequency = node.parameters.find(p => /bus.{0,8}(?:hour|freq)|frequency/i.test(p.id + " " + p.label));
  if (!frequency) return [];
  const defaultValues = Object.fromEntries(node.parameters.map(p => [p.id, p.value]));
  const initial = frequency.value;
  const comparison = Math.min(frequency.max, initial * 2);
  return [...new Set([initial, comparison])].map(value => {
    const inputs = {...defaultValues, [frequency.id]:value};
    const readouts = Object.fromEntries(node.readouts.map(r => {
      const expression = parseSimulationExpression(r.expr, ids);
      return [r.id, expression.ok ? evaluateSimulationExpression(expression.node, inputs) ?? null : null];
    }));
    return {inputs, readouts};
  });
}

function makeRecord({id,m,c}, row, docName, adjudication, receipts, cohort, inspect) {
  const tutorCalls = receipts.filter(e => e.kind === "tutor" && e.label.startsWith(id + "/"));
  const checked = new Map((row?.checks ?? []).map(item => [item.attempt,item]));
  const drafts = (row?.drafts ?? []).map(d => {
    const entry = tutorCalls.find(e => e.label.endsWith("/tutor-" + d.attempt));
    const host = checked.get(d.attempt);
    const received = entry?.http === 200 && isFinished(d) && host && host.status !== "generation-error";
    const measurement = received ? inspect(d.response.text) : null;
    return {
      attempt:d.attempt, submitted:!!entry?.host, http:entry?.http ?? null, transport:d.status,
      completed:!!received, stop:d.response?.stop ?? null, responseModel:d.response?.responseModel ?? null,
      providerModel:d.response?.model ?? null, provider:d.response?.provider ?? null,
      attempted:measurement?.attempted ?? null, compiled:measurement?.components ?? null,
      nodes:measurement?.documents.flat() ?? null, outsideWords:measurement?.outsideWords ?? null,
      issues:measurement?.issues ?? null, nativeTools:received ? d.response.nativeTools : null,
      promptIncludedGuidance:d.delivered, payloadSha256:d.payloadSha256, systemSha256:d.systemSha256,
      gate:host?.status ?? null, trimmedCheckpointSuffix:host?.trimmedCheckpointSuffix ?? null,
      findings:host?.findings ?? [], authoredTextSha256:received ? sha(d.response.text) : null,
    };
  });
  const completed = drafts.filter(d=>d.completed);
  const guidanceEvidence = completed.filter(d => d.payloadSha256 && typeof d.promptIncludedGuidance === "boolean");
  const decision = row?.decision ?? null;
  const guidance = decision ? {
    source:decision.model === cohort.judge.model ? "jev" : "unknown", action:decision.action,
    delivered:guidanceEvidence.length ? guidanceEvidence.some(d => d.promptIncludedGuidance) : null,
    targets:unique(decision.targets.map(normalizeOpenUiComponent).filter(Boolean)),
  } : null;
  const release = row?.phase === "released" && !!row.public;
  const withheld = row?.public?.notice === "withheld";
  const selected = release ? inspect(row.public.text) : null;
  const nativeTools = release ? row.public.tools : null;
  const nativeOnly = release && nativeTools.length > 0 && !row.public.text.trim();
  const source = adjudication[id];
  if (release) {
    check(source && source.publicTextSha256 === sha(row.public.text) && typeof source.passed === "boolean", "Adjudication must bind to exact selected text: " + id);
    if (source.passed && c.cue.targets.length) {
      check(openUiMatchesTargets(selected.components, c.cue.targets) && !nativeOnly && selected.issues.length === 0,
        "A passing learner action requires its valid selected interface: " + id);
    }
    if (source.passed && c.id === "bus") check(!selected.components.some(k => ["quiz","exam","question","question-group"].includes(k)), "Bus cannot include an assessed checkpoint");
    if (source.passed && c.id === "perimeter") check(!selected.attempted && !nativeTools.length && selected.outsideWords <= 15
      && !row.public.text.includes("?") && /\b(?:16|sixteen)\b/i.test(row.public.text), "Text control failed structural rubric");
  } else check(!source, "An absent released reply has a text-based adjudication: "+id);
  const transportIssue = tutorCalls.find(e => e.http >= 400 || ["uncertain","reserved"].includes(e.status));
  const fit = release ? source.passed : withheld && completed.length && !transportIssue ? false : null;
  const eligibility = release ? nativeOnly ? "released-native-proposal" : "released-content"
    : transportIssue ? "provider-failure" : withheld && completed.length ? "review-withheld"
    : tutorCalls.length ? "uncompleted-tutor" : row ? "undispatched-tutor" : "unscheduled-by-budget";
  const note = release ? source.note : transportIssue
    ? `The tutor endpoint returned ${transportIssue.http ?? transportIssue.status}. No complete candidate or learner-fit rating is available. The gate issued a withheld notice.`
    : eligibility === "review-withheld" ? "The gate reviewed completed work and withheld it."
    : "The scheduled tutor result is unavailable.";
  const turn = {
    schemaVersion:1, conversationId:cohort.study + "/" + id, turnId:id, turnIndex:0,
    model:m.id, mode:guidance ? "guided" : "unknown", cue:c.cue,
    reply:release ? "released" : withheld ? "withheld" : row?.phase === "cancelled" ? "cancelled" : "unknown",
    attempted:completed.length ? completed.some(d=>d.attempted) : null,
    nativePageRequested:release ? nativeTools.includes("interactive_page") : null,
    compiled:completed.length ? unique(completed.flatMap(d=>d.compiled)) : null,
    selected:release ? selected.components : withheld ? [] : null, rendered:null,
    outsideWords:release && !nativeOnly ? selected.outsideWords : null, guidance, decisionModel:decision?.model ?? null,
    ...(row ? {draftAttempts:row.checks.length, gateIssues:unique(row.checks.flatMap(a => a.findings.map(f=>f.id).filter(isOpenUiDiagnosticGateIssue)))} : {}),
    fit:{source:"v21-prospective-case-rubric", passed:fit},
  };
  const selectedNodes = selected?.documents.flat() ?? null;
  const data = {id, model:m.id, provider:m.provider, caseId:c.id, source:docName, eligibility, prompt:c.prompt, rubric:c.rubric,
    reply:turn.reply, selectedAttempt:row?.selection ?? null, gateReason:row?.reason ?? null,
    tutorRequests:tutorCalls.length, gateDraftAttempts:turn.draftAttempts ?? null, completedCandidates:completed.length,
    authoredValidInterface:completed.length ? completed.some(d=>d.compiled.some(isOpenUiDiagnosticInterface)) : null,
    offered:guidance?.targets ?? null, guidanceDelivered:guidance?.delivered ?? null,
    planProvenance:row?.judgments.filter(j=>j.phase==="plan").map(j=>({requestSha256:j.hash,model:j.model,reusedFrom:j.reusedFrom??null})) ?? [],
    selectedComponents:turn.selected, selectedNodes, selectedOutsideWords:selected?.outsideWords ?? null,
    selectedOutsideText:selected?.outsideText ?? null, selectedText:release ? row.public.text : null,
    selectedNativeTools:nativeTools, nativeOnly:release ? nativeOnly : null, verdict:fit, note,
    simulationSamples:selectedNodes?.filter(n=>n.type==="simulation").map(n=>({id:n.id,samples:simulationSample(n)})) ?? [],
    drafts};
  return {turn, data};
}

function tally(rows) {
  const known = rows.filter(r=>r.verdict !== null);
  const opportunities = rows.filter(r=>r.caseId !== "perimeter");
  const knownOpportunities = opportunities.filter(r=>r.verdict !== null);
  const controls = rows.filter(r=>r.caseId === "perimeter");
  const knownControls = controls.filter(r=>r.verdict !== null);
  const seen = rows.filter(r=>r.authoredValidInterface !== null);
  return {scheduled:rows.length, tutorDispatched:count(rows,r=>r.tutorRequests>0), completedCandidates:rows.reduce((s,r)=>s+r.completedCandidates,0),
    released:count(rows,r=>r.reply==="released"), withholdNotices:count(rows,r=>r.reply==="withheld"),
    providerFailures:count(rows,r=>r.eligibility==="provider-failure"), nativeOnly:count(rows,r=>r.nativeOnly===true),
    knownFit:rate(count(known,r=>r.verdict),known.length), missingFit:rows.length-known.length,
    authoredInterfaceAmongObserved:rate(count(seen,r=>r.authoredValidInterface),seen.length),
    requestedInterfacesScheduled:opportunities.length, knownRequestedInterfaceFit:rate(count(knownOpportunities,r=>r.verdict),knownOpportunities.length),
    controlsScheduled:controls.length, knownTextControlFit:rate(count(knownControls,r=>r.verdict),knownControls.length)};
}

export async function verify({here, cohort, cells, inspect, manifest, parseOpenUiDiagnosticExport}) {
  const frozen = read(join(here,"manifest.json")), amendment = read(join(here,"budget-amendment.json"));
  // The post-study export contract added only the optional native page tool flag. Both
  // byte revisions are pinned; the original dispatch manifest and runtime pins stay intact.
  const contract = "packages/learner-contracts/src/openui-diagnostic-turn.ts";
  const earlierContract = "9f67092fec8b70cc3167ea4b7cd0eec443dd328533f89ae399ad5b4c2d4b568a";
  const enrichedContract = "992ab5730cec0e1f78a6f380676e35147fc19d2ba9cf5f2a3d40d5ff04aeb700";
  check(frozen.sourceHashes[contract]===earlierContract && manifest.sourceHashes[contract]===enrichedContract,
    "Unexpected export contract revision");
  const exportManifest={...frozen,frozenAt:null,sourceHashes:{...frozen.sourceHashes,[contract]:enrichedContract}};
  check(same(exportManifest,manifest),"Current measured source or frozen schedule differs from the study manifest");
  for (const [file,digest] of Object.entries(amendment.provenance)) check(sha(readFileSync(join(here,file)))===digest,"First segment changed: "+file);
  const ledgers = ["ledger.json","segment-two-ledger.json"].map(f => read(join(here,f)));
  const [first,second] = ledgers;
  check(first.stopReason==="budget" && second.amendmentHash===sha(readFileSync(join(here,"budget-amendment.json")))
    && Math.abs(total(first.entries)-amendment.firstHoldoutAccountedUsd)<1e-9,"Segment origins changed");
  const entries = ledgers.flatMap(l=>l.entries), labels = new Set();
  for(const e of entries){
    check(!labels.has(e.label),"Duplicate billed dispatch: "+e.label); labels.add(e.label);
    check(e.status!=="reserved" && e.finishedAt && e.host && Number.isFinite(e.accountedUsd) && e.accountedUsd>=0 && e.accountedUsd<=e.reservedUsd, "Unsettled dispatch: "+e.label);
    check(e.measured || e.accountedUsd===e.reservedUsd,"Unknown usage must retain its whole reserve");
  }
  let running=0;
  for(const [i,ledger] of ledgers.entries()) {
    running=0;
    for(const e of ledger.entries) {
      const opening=i===0?cohort.protocol.priorFollowupAccountedUsd:0;
      const cap=i===0?cohort.protocol.followupLimitUsd:amendment.secondIncrementalLimitUsd;
      check(opening+running+e.reservedUsd<=cap+1e-10,"A dispatch exceeded the then-applicable cap");
      check(amendment.priorAllBeforeHoldoutUsd+(i===0?0:total(first.entries))+running+e.reservedUsd<=amendment.userStudyLimitUsd+1e-10,"A dispatch exceeded the study cap");
      running+=e.accountedUsd;
    }
  }
  const adjudication=read(join(here,"adjudication.json")), rows=[], turns=[], allReceipts=new Map();
  for(const {id} of cells) {
    for(const name of [id+".json","segment-two--"+id+".json"]) {
      if(existsSync(join(here,name))) allReceipts.set(name,read(join(here,name)));
    }
  }
  const used = new Set();
  for(const [file,row] of allReceipts) {
    check(row.cohortSha256===manifest.cohortSha256 && cells.some(c=>c.id===row.id),"Receipt outside frozen cohort");
    for(const [index,j] of row.judgments.entries()) {
      if(j.reusedFrom) {
        const [name,reference]=j.reusedFrom.split("#judge-"), source=allReceipts.get(name)?.judgments[Number(reference)-1];
        check(source?.hash===j.hash && j.model===cohort.judge.model && j.model===source.model && same(j.answers,source.answers) && same(j.usage,source.usage), "Jev replay boundary changed: "+file);
        continue;
      }
      const label=row.id+"/judge-"+(index+1), e=entries.find(x=>x.label===label);
      if (!e && j.error) continue;
      check(e?.kind==="jev" && e.model===cohort.judge.model && e.host===new URL(cohort.judge.endpoint).host,"Missing Jev dispatch: "+label);used.add(label);
      if(e.measured) check(Math.abs(e.accountedUsd-j.usage.inputTokens*cohort.judge.inputPerMillionUsd/1e6)<1e-10, "Jev accounting differs from usage");
    }
    for(const d of row.drafts){
      if(!d.response && !d.payloadSha256) continue;
      const label=row.id+"/tutor-"+d.attempt, e=entries.find(x=>x.label===label), m=cohort.models.find(m=>m.id===row.configuredModel);
      check(e?.kind==="tutor" && e.model===m.id && e.host===new URL(m.endpoint).host, "Missing official tutor dispatch: "+label);
      check(!used.has(label), "Repeated tutor turn: "+label);used.add(label);
      if(e.measured) { const u=d.response.usage;
        check(Math.abs(e.accountedUsd-((u.input+u.cacheRead+u.cacheWrite)*m.inputPerMillionUsd+u.output*m.outputPerMillionUsd)/1e6)<1e-10,"Tutor accounting differs from usage"); }
    }
  }
  check(used.size===entries.length && entries.every(e=>used.has(e.label)), "Unlinked dispatch");
  for (const cell of cells) {
    const later="segment-two--"+cell.id+".json", earlier=cell.id+".json";
    const name=allReceipts.has(later)?later:allReceipts.has(earlier)?earlier:null;
    const {turn,data}=makeRecord(cell,allReceipts.get(name),name,adjudication,entries,cohort,inspect);
    rows.push(data);turns.push(turn);
  }
  check(Object.keys(adjudication).length===rows.filter(r=>r.reply==="released").length, "Unexpected adjudication");
  const exported={schemaVersion:1,turns};
  check(parseOpenUiDiagnosticExport(exported).length===cells.length && new Set(turns.map(t=>t.turnId)).size===cells.length,"Diagnostic schema or denominator failed");
  for(const [index,turn] of turns.entries()) {
    const row=rows[index];
    if(row.nativeOnly || row.reply!=="released") check(turn.outsideWords===null,"Missing natural reply must have unknown outside-word count");
    else check(turn.outsideWords===row.selectedOutsideWords,"Outside-word observations differ");
    const publicTools=allReceipts.get(row.source)?.public?.tools;
    const expectedPageRequest=row.reply==="released" && Array.isArray(publicTools) ? publicTools.includes("interactive_page") : null;
    check(turn.nativePageRequested===expectedPageRequest,"Native page observation differs from public tool calls: "+row.id);
  }
  const summary={version:1, study:cohort.study, policy:cohort.policy, releaseSystemAndTools:cohort.releasePromptSource,
    cohortSha256:manifest.cohortSha256, total:tally(rows), byModel:Object.fromEntries(cohort.models.map(m=>[m.id,tally(rows.filter(r=>r.model===m.id))])),
    byCase:Object.fromEntries(cohort.cases.map(c=>[c.id,tally(rows.filter(r=>r.caseId===c.id))])),
    accounting:{currency:"USD", paidTutorDispatches:count(entries,e=>e.kind==="tutor"), paidJevDispatches:count(entries,e=>e.kind==="jev"),
      missingUsage:count(entries,e=>!e.measured), knownUsageListPriceUpper:total(entries.filter(e=>e.measured)),
      heldForMissingUsage:total(entries.filter(e=>!e.measured)), segmentOneBound:total(first.entries), segmentTwoBound:total(second.entries),
      holdoutBound:total(entries), priorStudyAndFollowupBound:amendment.priorAllBeforeHoldoutUsd,
      allStudyBound:usd(amendment.priorAllBeforeHoldoutUsd+total(entries)), userCap:amendment.userStudyLimitUsd,
      note:"Measured token counts use published list prices, conservatively charging cached input at the full input rate. An HTTP 503 without token usage retains its full US$0.12 tutor reservation. This is a cost upper bound, not a provider invoice."},
    records:rows};
  for(const [name,value] of [["turns.json",exported],["summary.json",summary]]) {
    const path=join(here,name), bytes=JSON.stringify(value,null,2)+"\n";
    if(existsSync(path) && readFileSync(path,"utf8")===bytes) continue;
    if(process.argv.includes("--write-derived")) {writeFileSync(path+".tmp",bytes);renameSync(path+".tmp",path);}
    else throw Error("Missing or different "+name+". To regenerate derived outputs from frozen receipts run --verify --write-derived.");
  }
  console.log(JSON.stringify({verified:true,networkRequests:0,diagnosticRows:turns.length,total:summary.total,accounting:summary.accounting}));
}
