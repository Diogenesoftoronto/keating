#!/usr/bin/env bun
/** Source-grounded harness scenarios -> reproducible policy states -> independent Jev labels.
 * Preparation is offline. --execute explicitly calls TypeSafe; successful receipts resume by request hash.
 * Original evaluation-only futures never enter judge requests. No learner records are fabricated.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { DecisionPolicySnapshot, DecisionPolicyTarget } from "../../packages/learner-contracts/src/judgement/decision-policy-data.js";

const MODEL = "jev-1.13.0";
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const DAY = 86_400_000, AS_OF = Date.UTC(2026, 8, 1);
const TARGETS = ["mastery", "retention", "urgency"] as const;
const RUBRICS = {
  mastery: "Given only this source-grounded learner context and explicitly simulated or trajectory-derived prior state, would the learner correctly answer a new independent objective question on this topic without hints? Judge a synthetic prediction, not demonstrated human mastery.",
  retention: "Given only this source-grounded learner context and explicitly simulated or trajectory-derived prior state, would the learner recall the selected card correctly without seeing its answer after the stated delay? Judge a synthetic recall prediction, not observed delayed human retention.",
  urgency: "Given only this source-grounded learner context and explicitly simulated or trajectory-derived prior state, would the learner fail to recall a currently due card from the selected deck without help if reviewed now? Judge synthetic lapse risk, not causal benefit from prioritizing a review.",
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
interface Scenario { id: string; family: string; actor: unknown; learner: unknown; source: { dataset: string; revision: string; [key: string]: unknown } }
interface Original { ref: string; sha256: string; text: string }
interface Prepared {
  id: string; family: string; split: "fit" | "validation"; dataset: string; revision: string; original: Original;
  snapshot: DecisionPolicySnapshot; selection: { deckId: string; cardId: string };
  state: { kind: "simulated-harness"; seed: string; assumptions: string[]; evidenceRefs: string[] };
  requestText: string; requestSha256: string;
}
function random(seed: string) { let counter = 0; return () => parseInt(hash(`${seed}:${counter++}`).slice(0, 8), 16) / 2 ** 32; }

/** Counterfactual practice histories are declared separately from the unchanged source context. */
export function prepareSyntheticDecisionPolicies(scenarios: Scenario[], sourcePath: string, sourceSha256: string): Prepared[] {
  const selected: Scenario[] = [];
  for (const dataset of [...new Set(scenarios.map(row => row.source.dataset))].sort()) {
    const families = new Map<string, Scenario>();
    for (const row of [...scenarios].sort((a, b) => a.id.localeCompare(b.id))) if (row.source.dataset === dataset && !families.has(row.family)) families.set(row.family, row);
    // Predeclared selection and split use identifiers only, before any judgement is requested.
    selected.push(...[...families.values()].sort((a, b) => hash(`policy-source-v1:${a.family}`).localeCompare(hash(`policy-source-v1:${b.family}`))).slice(0, 16));
  }
  return selected.flatMap(scenario => {
    const text = JSON.stringify({ id: scenario.id, family: scenario.family, actor: scenario.actor, learner: scenario.learner, source: scenario.source });
    const original = { ref: `${sourcePath}#${scenario.id}:pre-action`, text, sha256: hash(text) };
    const split = parseInt(hash(`policy-split-v1:${scenario.family}`).slice(0, 8), 16) % 4 === 0 ? "validation" : "fit";
    return Array.from({ length: 8 }, (_, variant): Prepared => {
      const id = `${scenario.id}:state-${variant}`, seed = `decision-policy-state-v1:${id}`, rng = random(seed);
      const count = 2 + Math.floor(rng() * 23), correct = Math.floor(rng() * (count + 1));
      const objectiveMean = correct / count, objectiveLast = correct === 0 ? 0 : correct === count ? 1 : Number(rng() < objectiveMean);
      const reviewCount = 2 + Math.floor(rng() * 23), recalled = Math.floor(rng() * (reviewCount + 1));
      const lapses = Math.floor(rng() * (reviewCount - recalled + 1));
      const recallRate = recalled / reviewCount, lapseRate = lapses / reviewCount;
      const lastRating = recalled === reviewCount ? 2 / 3 : lapses === reviewCount ? 0 : recalled > 0 ? 2 / 3 : 1 / 3;
      const intervalDays = 1 + Math.floor(rng() * 21), reviewAgeDays = intervalDays + Math.floor(rng() * 22);
      const evidenceIds = Array.from({ length: reviewCount }, (_, i) => `sim:${id}:r${i}`);
      const history = { priorReviewCount: reviewCount, recallRate, lapseRate, lastRating, reviewAgeDays, intervalDays,
        lastReviewedAt: AS_OF - reviewAgeDays * DAY, evidenceIds };
      const deckId = `sim:${id}:deck`, cardId = `sim:${id}:card`, nextDueAt = history.lastReviewedAt + intervalDays * DAY;
      const retention = (recalled * 2 + reviewCount - recalled - lapses) / (3 * reviewCount);
      const confidence = Math.min(1, (count * .8 + reviewCount * (.3 + Math.min(.7, intervalDays / 21))) / 5);
      const status = objectiveMean < .45 || retention < .45 ? "needs-review" : confidence >= .35 && objectiveMean >= .75 && retention >= .65 ? "strong" : "developing";
      const snapshot: DecisionPolicySnapshot = { topic: scenario.family, asOf: AS_OF,
        objective: { count, mean: objectiveMean, last: objectiveLast, ageDays: 1 + Math.floor(rng() * 28), evidenceIds: Array.from({ length: count }, (_, i) => `sim:${id}:q${i}`) },
        progress: { mastery: objectiveMean, retention, confidence, status },
        cards: [{ ...history, deckId, cardId, nextDueAt }],
        decks: [{ ...history, deckId, title: `Practice ${variant + 1}`, cardCount: 1, knownCardCount: 1, scheduleComplete: true,
          dueCount: 1, overdueCount: Number(nextDueAt < AS_OF - DAY), oldestDueDays: reviewAgeDays - intervalDays, nextDueAt: null }],
        reconstruction: "explicit-simulated-harness-state" };
      const state: Prepared["state"] = { kind: "simulated-harness", seed, evidenceRefs: [original.ref], assumptions: [
        "The source supplies the task, learner context and pre-action utterances. Evaluation-only future responses are excluded.",
        "Counts, scores, ratings, schedules and dates are reproducible hypothetical subsequent practice in that task domain, not observed source history.",
        "Interpret each variant as a counterfactual harness learner state following the source starting point; judge from this stated evidence without inventing later outcomes.",
        "The selected card asks for independent recall/application of the source task's skill, without showing the answer. Variants are comparable due-deck risk candidates within one family.",
        `Parent scenario file SHA-256: ${sourceSha256}.`,
      ] };
      const selection = { deckId, cardId };
      // Exact serialized blocks are retained in the source verifier, including all judge-visible context.
      const requestText = JSON.stringify({ model: MODEL, state: { original: original.text, snapshot: JSON.stringify(snapshot),
        simulation: JSON.stringify(state), selection }, questions: Object.fromEntries(TARGETS.map(target => [target, { type: "noul", instructions: RUBRICS[target] }])) });
      return { id, family: scenario.family, split, dataset: scenario.source.dataset, revision: scenario.source.revision,
        original, snapshot, selection, state, requestText, requestSha256: hash(requestText) };
    });
  });
}
async function exactFile(path: string, contents: string) {
  try { await writeFile(path, contents, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(path, "utf8") !== contents) throw Error("decision_policy_output_conflict"); }
}
async function main() {
  const [input, output, mode, extra] = process.argv.slice(2);
  if (!input || !output || extra || mode && mode !== "--execute") throw Error("Usage: bun scripts/training/prepare-synthetic-decision-policies.ts scenarios.json output-directory [--execute]");
  const raw = await readFile(input, "utf8"), sourceSha256 = hash(raw), source = JSON.parse(raw);
  if (!Array.isArray(source.scenarios)) throw Error("decision_policy_scenario_source_invalid");
  const prepared = prepareSyntheticDecisionPolicies(source.scenarios, input, sourceSha256);
  await mkdir(output, { mode: 0o700, recursive: true });
  await mkdir(join(output, "receipts"), { mode: 0o700, recursive: true });
  const acquisition = { schemaVersion: 1, model: MODEL, sourcePath: input, sourceSha256, seed: "decision-policy-state-v1",
    selection: "first-16-families-per-dataset-by-sha256-policy-source-v1", split: "sha256-policy-split-v1-family-mod4-zero-validation",
    requests: prepared.map(({ id, family, split, dataset, requestSha256 }) => ({ id, family, split, dataset, requestSha256 })) };
  await exactFile(join(output, "preparation.json"), JSON.stringify(acquisition, null, 2) + "\n");
  if (!mode) { console.log(JSON.stringify({ status: "prepared", requests: prepared.length, families: new Set(prepared.map(row => row.family)).size })); return; }
  let key = process.env.TYPESAFE_API_KEY?.trim();
  if (!key) {
    const result = Bun.spawnSync(["rtk", "proxy", "skate", "get", "typesafe_api_key@secrets"], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode === 0) key = new TextDecoder().decode(result.stdout).trim();
  }
  if (!key) throw Error("decision_policy_judge_credential_unavailable");
  const receiptFor = (row: Prepared) => join(output, "receipts", `${row.requestSha256}.json`);
  const validate = (value: any) => {
    if (value?.response?.model !== MODEL || typeof value.receivedAt !== "string") throw Error("decision_policy_judge_response_invalid");
    for (const target of TARGETS) { const answer = value.response.answers?.[target];
      if (answer?.type !== "noul" || typeof answer.noul !== "number" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw Error("decision_policy_judge_response_invalid"); }
    return value;
  };
  let next = 0, completed = 0;
  const responses = new Map<string, ReturnType<typeof validate>>();
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < prepared.length) {
      const row = prepared[next++]!; let receipt;
      try { receipt = validate(JSON.parse(await readFile(receiptFor(row), "utf8"))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (receipt && receipt.requestSha256 !== row.requestSha256) throw Error("decision_policy_receipt_mismatch");
      if (!receipt) {
        let response: Response | undefined;
        for (let attempt = 0; attempt < 4; attempt++) {
          response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: row.requestText, signal: AbortSignal.timeout(60_000) });
          if (![429, 529, 503].includes(response.status)) break;
          await response.body?.cancel(); await Bun.sleep(1000 * 2 ** attempt);
        }
        if (!response?.ok) throw Error(`decision_policy_judge_http_${response?.status ?? "unavailable"}`);
        receipt = validate({ requestSha256: row.requestSha256, receivedAt: new Date().toISOString(), response: await response.json() });
        await exactFile(receiptFor(row), JSON.stringify(receipt) + "\n");
      }
      responses.set(row.id, receipt); completed++;
      if (completed % 32 === 0) console.log(JSON.stringify({ completed, total: prepared.length }));
    }
  }));
  if (hash(await readFile(input, "utf8")) !== sourceSha256) throw Error("decision_policy_source_changed");
  const sources: unknown[] = [];
  for (const family of [...new Set(prepared.map(row => row.family))]) {
    const rows = prepared.filter(row => row.family === family), first = rows[0]!;
    const payload = { schemaVersion: 1, format: "synthetic-decision-policy-source-v1", familyId: family, originals: [first.original], records: rows.flatMap(row => TARGETS.map((target: DecisionPolicyTarget) => {
      const receipt = responses.get(row.id)!;
      return { id: `${row.id}:${target}`, target, snapshot: row.snapshot, selection: row.selection, state: row.state,
        judgement: { model: MODEL, rubric: RUBRICS[target], requestText: row.requestText, rawResponse: receipt.response,
          responsePath: ["answers", target, "noul"], probability: receipt.response.answers[target].noul, receivedAt: receipt.receivedAt } };
    })) };
    const contents = JSON.stringify(payload) + "\n", path = resolve(output, `source-${hash(family).slice(0, 16)}.json`);
    await exactFile(path, contents);
    sources.push({ path, sha256: hash(contents), learnerId: `synthetic:${family}`, groupId: family, split: first.split,
      provenance: { origin: "synthetic-judgement", dataset: `keating-native-development-v1/${first.dataset}`, revision: first.revision,
        schedule: "simulated-harness", notes: "Original source-grounded pre-action scenarios; explicit deterministic simulated subsequent practice; independent target-specific Jev probabilities. Source license retained in originals." } });
  }
  await exactFile(join(output, "manifest.json"), JSON.stringify({ schemaVersion: 1, sources }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "labelled", requests: completed, rows: completed * 3, families: sources.length }));
}
if (import.meta.main) main().catch(error => { console.error(error instanceof Error && /^(decision_policy_|Usage:)/u.test(error.message) ? error.message : "decision_policy_preparation_failed"); process.exitCode = 1; });
