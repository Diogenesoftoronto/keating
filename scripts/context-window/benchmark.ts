import type { BenchmarkProvider, ProviderResult } from "./providers.js";
import { digest, type Trial, type LabelValue } from "./cases.js";

export interface Receipt {
  version: 1; trialId: string; providerId: string; providerKind: BenchmarkProvider["kind"];
  requestedModel: string; requestSha256: string; outcome: ProviderResult;
  status: "completed" | "provider-error" | "not-dispatched";
  reason?: string; repetition: number;
}
export interface TapeEntry { trialId: string; providerId: string; requestedModel: string; requestSha256: string; repetition: number; outcome: ProviderResult }
export interface ScheduledProvider extends BenchmarkProvider { evaluateTrial?: (trial: Trial, repetition: number, signal?: AbortSignal) => Promise<ProviderResult> }
export interface RunOptions {
  trials: readonly Trial[]; providers: readonly ScheduledProvider[]; maxCalls: number;
  maxEstimatedInputTokens: number; repetitions?: number; timeoutMs?: number;
  onReceipt?: (receipt: Receipt) => Promise<void>;
}

/** Balance providers within each fixed case; never retry until a favorable answer. */
export async function runSuite(options: RunOptions): Promise<Receipt[]> {
  const repetitions = options.repetitions ?? 1;
  if (!Number.isInteger(options.maxCalls) || options.maxCalls < 0 || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10
    || !Number.isFinite(options.maxEstimatedInputTokens) || options.maxEstimatedInputTokens < 0) throw Error("invalid_run_budget");
  if (new Set(options.trials.map(row => row.id)).size !== options.trials.length || new Set(options.providers.map(row => row.id)).size !== options.providers.length) throw Error("duplicate_trial_or_provider");
  const receipts: Receipt[] = [];
  let calls = 0, tokenReservation = 0;
  for (let repetition = 0; repetition < repetitions; repetition++) for (const [index, trial] of options.trials.entries()) {
    const offset = (index + repetition) % Math.max(1, options.providers.length);
    const providers = [...options.providers.slice(offset), ...options.providers.slice(0, offset)];
    for (const provider of providers) {
      let reason: string | undefined;
      const estimate = trial.after.estimatedRequestTokens;
      if (calls >= options.maxCalls) reason = "call-limit";
      else if (tokenReservation + estimate > options.maxEstimatedInputTokens) reason = "input-token-reservation-limit";
      let outcome: ProviderResult;
      if (reason) outcome = { status: "error", error: reason, latencyMs: 0 };
      else {
        calls++; tokenReservation += estimate;
        const controller = new AbortController(), timeout = options.timeoutMs ?? 120_000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          outcome = await Promise.race([
            provider.evaluateTrial ? provider.evaluateTrial(trial, repetition, controller.signal) : provider.evaluate(trial.request, controller.signal),
            new Promise<ProviderResult>(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ status: "error", error: "timeout", latencyMs: timeout }); }, timeout); }),
          ]);
        } catch { outcome = { status: "error", error: "provider-threw", latencyMs: 0 }; }
        finally { if (timer) clearTimeout(timer); }
      }
      const receipt: Receipt = { version: 1, trialId: trial.id, providerId: provider.id, providerKind: provider.kind, requestedModel: provider.model,
        requestSha256: trial.requestSha256, outcome, status: reason ? "not-dispatched" : outcome.status === "ok" ? "completed" : "provider-error",
        ...(reason ? { reason } : {}), repetition };
      receipts.push(receipt); await options.onReceipt?.(receipt);
    }
  }
  return receipts;
}

export function replayProvider(id: string, model: string, entries: readonly TapeEntry[], kind: BenchmarkProvider["kind"] = "system-one"): ScheduledProvider {
  const byKey = new Map<string, TapeEntry>();
  for (const entry of entries.filter(row => row.providerId === id && row.requestedModel === model)) {
    const key = `${entry.trialId}|${entry.repetition}`;
    if (byKey.has(key)) throw Error("duplicate_tape_entry");
    byKey.set(key, entry);
  }
  const missing = (): ProviderResult => ({ status: "error", error: "tape-missing", latencyMs: 0 });
  return { id, model, kind,
    async evaluateTrial(trial, repetition) {
      const key = `${trial.id}|${repetition}`, row = byKey.get(key);
      if (!row || row.requestSha256 !== digest(trial.request)) return missing();
      byKey.delete(key); return structuredClone(row.outcome);
    },
    async evaluate(request) {
      const matching = [...byKey].filter(([, row]) => row.requestSha256 === digest(request));
      if (!matching.length) return missing();
      if (matching.length !== 1) return { status: "error", error: "tape-ambiguous-use-trial-identity", latencyMs: 0 };
      const [key, row] = matching[0]!; byKey.delete(key); return structuredClone(row.outcome);
    },
  };
}

interface Counts { planned: number; completed: number; errors: number; undispatched: number; labelled: number; answered: number; correct: number; correctAnswered: number; requestedQuestions: number; unlabelledQuestions: number; batchLabelled: number; batchAllLabelsCorrect: number; unknownLabels: number; correctAbstentions: number; falsePositive: number; falseNegative: number; fullContextCorrect: number; abstentions: number; brierSum: number; brierN: number; latency: number[]; selectedPass: number; selectionN: number; randomPassSum: number; firstPass: number; oraclePass: number; positive: number; negative: number; truePositive: number; trueNegative: number }
const empty = (): Counts => ({ planned: 0, completed: 0, errors: 0, undispatched: 0, labelled: 0, answered: 0, correct: 0, correctAnswered: 0, requestedQuestions: 0, unlabelledQuestions: 0, batchLabelled: 0, batchAllLabelsCorrect: 0, unknownLabels: 0, correctAbstentions: 0, falsePositive: 0, falseNegative: 0, fullContextCorrect: 0, abstentions: 0, brierSum: 0, brierN: 0, latency: [], selectedPass: 0, selectionN: 0, randomPassSum: 0, firstPass: 0, oraclePass: 0, positive: 0, negative: 0, truePositive: 0, trueNegative: 0 });
const ratio = (a: number, b: number) => b ? a / b : null;
function finish(c: Counts) {
  const times = [...c.latency].sort((a, b) => a - b);
  const { latency: _, brierSum, ...counts } = c;
  return { ...counts, accuracyAllPlannedLabels: ratio(c.correct, c.labelled), accuracyAnswered: ratio(c.correctAnswered, c.answered), labelCoverage: ratio(c.labelled, c.requestedQuestions), exactLabelledBatchAccuracy: ratio(c.batchAllLabelsCorrect, c.batchLabelled), abstentionRecall: ratio(c.correctAbstentions, c.unknownLabels), fullContextAgreement: ratio(c.fullContextCorrect, c.labelled),
    responseCoverage: ratio(c.completed, c.planned), brier: ratio(brierSum, c.brierN), medianMs: times.length ? (times[Math.floor((times.length - 1) / 2)]! + times[Math.floor(times.length / 2)]!) / 2 : null,
    p90Ms: times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.9))]! : null,
    positiveRecall: ratio(c.truePositive, c.positive), negativeRecall: ratio(c.trueNegative, c.negative), balancedAccuracy: c.positive && c.negative ? (c.truePositive / c.positive + c.trueNegative / c.negative) / 2 : null, alwaysNegativeAccuracy: ratio(c.negative, c.positive + c.negative), selectedPassRate: ratio(c.selectedPass, c.selectionN), randomCandidatePassRate: ratio(c.randomPassSum, c.selectionN), firstCandidatePassRate: ratio(c.firstPass, c.selectionN), oraclePassRate: ratio(c.oraclePass, c.selectionN) };
}

/** Every scheduled row remains in the denominator, including failures and stop-loss rows. */
export function summarize(trials: readonly Trial[], receipts: readonly Receipt[]) {
  const lookup = new Map(trials.map(row => [row.id, row]));
  const cells = new Map<string, Counts>(), total = new Map<string, Counts>();
  const disagreements: { trialId: string; question: string; model: string; value: LabelValue | null; expected: LabelValue }[] = [];
  const reference = new Map<string, Receipt>();
  for (const row of receipts) if (row.providerKind === "reference" && row.outcome.status === "ok") reference.set(`${row.trialId}/${row.repetition}/${row.providerId}`, row);
  const referenceAgreement: Record<string, { equal: number; compared: number }> = {};
  for (const row of receipts) {
    const trial = lookup.get(row.trialId);
    if (!trial || trial.requestSha256 !== row.requestSha256) throw Error("receipt_request_mismatch");
    const key = [row.providerId, trial.kind, trial.labelSource, trial.split, trial.placement, trial.path, trial.stage ? "native" : trial.targetFill, trial.stage ?? (trial.labelSource === "deterministic-gate" ? (trial.caseId.includes("openui_valid") ? "underspecified-diagnostic" : "recorded-gate") : trial.caseId.startsWith("hard-") ? "multi-step" : "control")].join("|");
    if (!cells.has(key)) cells.set(key, empty());
    if (!total.has(row.providerId)) total.set(row.providerId, empty());
    for (const counts of [cells.get(key)!, total.get(row.providerId)!]) {
      counts.planned++;
      const labels = Object.entries(trial.expected);
      counts.requestedQuestions += Object.keys(trial.request.questions).length;
      counts.unlabelledQuestions += Object.keys(trial.request.questions).filter(key => !Object.hasOwn(trial.expected, key)).length;
      if (labels.length) {
        counts.batchLabelled++;
        counts.batchAllLabelsCorrect += Number(row.status === "completed" && row.outcome.status === "ok" && labels.every(([key, value]) => row.outcome.status === "ok" && !!row.outcome.answers[key] && row.outcome.answers[key]!.value === value));
      }
      if (row.status === "not-dispatched") counts.undispatched++;
      else if (row.outcome.status === "error") counts.errors++;
      else { counts.completed++; counts.latency.push(row.outcome.latencyMs); }
      for (const [id, label] of Object.entries(trial.expected)) {
        counts.labelled++;
        if (label === null) counts.unknownLabels++;
        if (label === true) counts.positive++;
        if (label === false) counts.negative++;
        const answer = row.outcome.status === "ok" ? row.outcome.answers[id] : undefined;
        if (!answer) continue;
        if (label !== null && answer.probabilities && Object.hasOwn(answer.probabilities, String(label))) {
          const terms = Object.entries(answer.probabilities).map(([value, p]) => (p - Number(value === String(label))) ** 2);
          if (terms.every(Number.isFinite)) { counts.brierSum += terms.reduce((a, b) => a + b, 0); counts.brierN++; }
        }
        if (answer.value === null) {
          counts.abstentions++;
          if (label === null) { counts.correct++; counts.correctAbstentions++; counts.fullContextCorrect += Number(trial.fullExpected[id] === null); }
          continue;
        }
        counts.answered++;
        counts.correct += Number(answer.value === label);
        counts.correctAnswered += Number(answer.value === label);
        counts.falsePositive += Number(label === false && answer.value === true);
        counts.falseNegative += Number(label === true && answer.value === false);
        counts.truePositive += Number(label === true && answer.value === true);
        counts.trueNegative += Number(label === false && answer.value === false);
        counts.fullContextCorrect += Number(answer.value === trial.fullExpected[id]);
        if (answer.value === "insufficient_context" || answer.value === "none_acceptable") counts.abstentions++;

      }
      if (trial.candidatePass && Object.keys(trial.candidatePass).length ) {
        const chosen = row.outcome.status === "ok" ? row.outcome.answers.best_rollout?.value : null;
        const labels = Object.values(trial.candidatePass), firstKey = Object.keys(trial.request.questions.best_rollout && trial.request.questions.best_rollout.type === "choice" ? trial.request.questions.best_rollout.criteria : {})[0];
        counts.selectionN++; counts.selectedPass += Number(typeof chosen === "string" && trial.candidatePass[chosen]);
        counts.randomPassSum += labels.filter(Boolean).length / labels.length;
        counts.firstPass += Number(!!firstKey && trial.candidatePass[firstKey]); counts.oraclePass += Number(labels.some(Boolean));
      }
    }
    for (const [id, label] of Object.entries(trial.expected)) {
      const value = row.outcome.status === "ok" ? row.outcome.answers[id]?.value ?? null : null;
      if (row.outcome.status !== "ok" || !row.outcome.answers[id] || value !== label) disagreements.push({ trialId: trial.id, question: id, model: row.providerId, value, expected: label });
    }
    if (row.providerKind !== "reference" && row.outcome.status === "ok") for (const ref of reference.values()) {
      if (ref.trialId !== row.trialId || ref.repetition !== row.repetition || ref.outcome.status !== "ok") continue;
      const name = `${row.providerId}|${ref.providerId}`, value = referenceAgreement[name] ??= { equal: 0, compared: 0 };
      for (const [id, answer] of Object.entries(row.outcome.answers)) if (answer.value !== null && ref.outcome.answers[id]?.value != null) {
        value.compared++; value.equal += Number(answer.value === ref.outcome.answers[id]!.value);
      }
    }
  }
  return { schemaVersion: 1, notice: "Authored and deterministic-gate labels are separate. Reference-model agreement is not truth. Context variants are correlated; no human learning is measured.",
    independentFamilies: [...new Set(trials.map(row => row.family))].length, models: Object.fromEntries([...total].map(([key, c]) => [key, finish(c)])),
    cells: [...cells].map(([key, c]) => ({ key, ...finish(c) })), referenceAgreement, disagreements };
}

/** Recover interrupted runs without silently shrinking their planned denominator. */
export function completeSchedule(trials: readonly Trial[], providers: readonly Pick<BenchmarkProvider, "id" | "kind" | "model">[], repetitions: number, receipts: readonly Receipt[]): Receipt[] {
  const keys = new Set<string>(), trialIds = new Set(trials.map(row => row.id));
  for (const row of receipts) {
    const key = `${row.trialId}|${row.providerId}|${row.repetition}`;
    if (keys.has(key) || !trialIds.has(row.trialId) || !providers.some(provider => provider.id === row.providerId && provider.model === row.requestedModel && provider.kind === row.providerKind) || !Number.isInteger(row.repetition) || row.repetition < 0 || row.repetition >= repetitions) throw Error("unexpected-or-duplicate-receipt");
    keys.add(key);
  }
  const result = [...receipts];
  for (let repetition = 0; repetition < repetitions; repetition++) for (const trial of trials) for (const provider of providers) {
    if (!keys.has(`${trial.id}|${provider.id}|${repetition}`)) result.push({ version: 1, trialId: trial.id, providerId: provider.id, providerKind: provider.kind, requestedModel: provider.model, requestSha256: trial.requestSha256, repetition, status: "not-dispatched", reason: "missing-receipt", outcome: { status: "error", error: "missing-receipt", latencyMs: 0 } });
  }
  return result;
}
