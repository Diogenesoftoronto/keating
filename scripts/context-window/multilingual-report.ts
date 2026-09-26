#!/usr/bin/env bun
/** Score frozen multilingual receipts without inference or label remapping. */
import { readFile, writeFile } from "node:fs/promises";
import { digest, type Trial } from "./cases.js";
import { completeSchedule, summarize, type Receipt } from "./benchmark.js";

type LocalizedTrial = Trial & { language: string; sourceTrialId: string };
const [planPath, tapePath, output] = process.argv.slice(2);
if (!planPath || !tapePath || !output) throw Error("requires plan receipts output");
const plan = JSON.parse(await readFile(planPath, "utf8"));
const { sha256, ...body } = plan;
if (sha256 !== digest(body)) throw Error("plan-integrity-failed");
const trials: LocalizedTrial[] = plan.trials;
const original = new Map(trials.filter(t => t.language === "en").map(t => [t.sourceTrialId, t]));
if (new Set(trials.map(t => `${t.language}|${t.sourceTrialId}`)).size !== trials.length) throw Error("duplicate-language-source-pair");
for (const trial of trials) {
  const english = original.get(trial.sourceTrialId);
  if (!english || digest(trial.expected) !== digest(english.expected)
    || digest(trial.fullExpected) !== digest(english.fullExpected)
    || digest(trial.request.questions) !== digest(english.request.questions)
    || trial.requestSha256 !== digest(trial.request)) throw Error("labels-or-request-integrity-failed");
}
const saved: Receipt[] = (await readFile(tapePath, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
const strict = completeSchedule(trials, plan.providers, plan.repetitions, saved);
const argmax = structuredClone(strict);
for (const row of argmax) if (row.outcome.status === "ok") for (const answer of Object.values(row.outcome.answers)) {
  const p = answer.probabilities;
  if (p && Object.keys(p).length === 2 && Object.hasOwn(p, "true") && Object.hasOwn(p, "false")) answer.value = p.true! > 0.5;
}
const languages = [...new Set(trials.map(t => t.language))];
const byLanguage = Object.fromEntries(languages.map(language => {
  const selected = trials.filter(t => t.language === language), ids = new Set(selected.map(t => t.id));
  return [language, { strict: summarize(selected, strict.filter(r => ids.has(r.trialId))),
    argmax: summarize(selected, argmax.filter(r => ids.has(r.trialId))) }];
}));
const times = (rows: Receipt[]) => {
  const successful = rows.filter(r => r.outcome.status === "ok");
  const ms = successful.map(r => r.outcome.latencyMs).sort((a,b) => a-b);
  const attemptedMs = rows.filter(r => r.status !== "not-dispatched").reduce((n,r) => n+r.outcome.latencyMs,0);
  const questions = successful.reduce((n,r) => n+(r.outcome.status === "ok" ? Object.keys(r.outcome.answers).length : 0),0);
  return { successfulRequests: ms.length, completedQuestions: questions,
    p50Ms: ms.length ? (ms[Math.floor((ms.length-1)/2)]!+ms[Math.floor(ms.length/2)]!)/2 : null,
    p95Ms: ms.length ? ms[Math.ceil(ms.length*.95)-1] : null,
    summedAttemptMs: attemptedMs, questionsPerSummedAttemptSecond: attemptedMs ? questions/(attemptedMs/1000) : null };
};
const performance = Object.fromEntries(plan.providers.map((p: {id:string}) => [p.id,
  Object.fromEntries(languages.map(language => {
    const ids = new Set(trials.filter(t => t.language === language).map(t => t.id));
    return [language,times(strict.filter(r => r.providerId === p.id && ids.has(r.trialId)))];
  }))]));
const rowMap = new Map(argmax.map(r => [`${r.providerId}|${r.trialId}|${r.repetition}`,r]));
const correct = (row: Receipt | undefined, question: string, expected: unknown) =>
  Number(row?.outcome.status === "ok" && row.outcome.answers[question]?.value === expected);
let randomState = 20260924;
const random = () => { randomState = (Math.imul(1664525,randomState)+1013904223)>>>0; return randomState/4294967296; };
const paired = Object.fromEntries(plan.providers.map((p: {id:string}) => [p.id,
  Object.fromEntries(languages.filter(l => l !== "en").map(language => {
    const families = new Map<string,{difference:number;labels:number}>();
    let englishCorrectForeignWrong=0, englishWrongForeignCorrect=0;
    for (const trial of trials.filter(t => t.language === language)) {
      const english = original.get(trial.sourceTrialId)!;
      const group = families.get(trial.family) ?? {difference:0,labels:0};
      for (let repetition=0; repetition<plan.repetitions; repetition++) for (const [q,label] of Object.entries(trial.expected)) {
        const a=correct(rowMap.get(`${p.id}|${trial.id}|${repetition}`),q,label);
        const b=correct(rowMap.get(`${p.id}|${english.id}|${repetition}`),q,label);
        group.difference+=a-b;group.labels++;
        englishCorrectForeignWrong+=Number(b===1&&a===0); englishWrongForeignCorrect+=Number(b===0&&a===1);
      }
      families.set(trial.family,group);
    }
    const values=[...families.values()], draws:number[]=[];
    for(let iteration=0;iteration<5000;iteration++) {
      let delta=0,n=0;
      for(let i=0;i<values.length;i++){const v=values[Math.floor(random()*values.length)]!;delta+=v.difference;n+=v.labels;}
      draws.push(delta/n);
    }
    draws.sort((a,b)=>a-b);
    return [language,{independentFamilies:values.length,englishCorrectForeignWrong,englishWrongForeignCorrect,
      accuracyDifference:values.reduce((n,v)=>n+v.difference,0)/values.reduce((n,v)=>n+v.labels,0),
      descriptiveFamilyBootstrap95:[draws[124],draws[4874]],bootstrapDraws:5000}];
  }))]));
await writeFile(output,JSON.stringify({parentPlanSha256:sha256,
  notes:["Exact original labels; no language-dependent label mapping or threshold fitting.",
    "Argmax uses false at p<=0.5 and true at p>0.5. Choice/Score and hard-label references unchanged. Failures remain in denominator.",
    "Translations share 25 source families, not 150 independent families. Bootstrap intervals are descriptive, unadjusted for multiple comparisons.",
    "Timings include each model's native transport and preflight. Throughput uses summed request durations, not concurrent wall time or saturation capacity. Model loading and downloads excluded.",
    "Translation and semantic review are model-assisted, without native-speaker validation. English instructions and identifiers are preserved; content localization is not a fully localized harness."],
  byLanguage,performance,pairedAgainstEnglish:paired},null,2),{flag:"wx",mode:0o600});
console.log(JSON.stringify({output,scheduled:strict.length,saved:saved.length,modelCalls:0}));
