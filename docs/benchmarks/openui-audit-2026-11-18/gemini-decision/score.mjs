// Offline derivation with the original holdout rubric and denominator conventions.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { recordedDecision, original, protocol, here, fileHash, verifyPrior } from "./journal.mjs";
import {
  isOpenUiDiagnosticGateIssue,
  isOpenUiDiagnosticInterface,
  normalizeOpenUiComponent,
  openUiMatchesTargets,
} from "../../../../packages/learner-contracts/src/openui-diagnostic-turn.ts";
import {
  parseSimulationExpression,
  evaluateSimulationExpression,
} from "../../../../packages/learner-contracts/src/simulation-expression.ts";

const sha = (input) => createHash("sha256").update(input).digest("hex");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const check = (v, message) => {
  if (!v) throw Error(message);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unique = (values) => [...new Set(values)].sort();
const usd = (v) => Number(v.toFixed(9));
const total = (rows) => usd(rows.reduce((sum, row) => sum + row.accountedUsd, 0));
const isFinished = (d) =>
  ["stop", "toolUse"].includes(d.response?.stop) &&
  (d.response.text.trim() || d.response.nativeTools.length > 0);
const count = (arr, predicate) => arr.filter(predicate).length;
const rate = (n, d) => ({ n, d });

function simulationSample(node) {
  const ids = node.parameters.map((p) => p.id);
  const frequency = node.parameters.find((p) =>
    /bus.{0,8}(?:hour|freq)|frequency/i.test(p.id + " " + p.label),
  );
  if (!frequency) return [];
  const defaultValues = Object.fromEntries(node.parameters.map((p) => [p.id, p.value]));
  const initial = frequency.value;
  const comparison = Math.min(frequency.max, initial * 2);
  return [...new Set([initial, comparison])].map((value) => {
    const inputs = { ...defaultValues, [frequency.id]: value };
    const readouts = Object.fromEntries(
      node.readouts.map((r) => {
        const expression = parseSimulationExpression(r.expr, ids);
        return [r.id, expression.ok ? (evaluateSimulationExpression(expression.node, inputs) ?? null) : null];
      }),
    );
    return { inputs, readouts };
  });
}

function makeRecord({ id, m, c }, row, docName, adjudication, receipts, cohort, inspect) {
  const tutorCalls = receipts.filter((e) => e.kind === "tutor" && e.label.startsWith(id + "/"));
  const checked = new Map((row?.checks ?? []).map((item) => [item.attempt, item]));
  const drafts = (row?.drafts ?? []).map((d) => {
    const entry = tutorCalls.find((e) => e.label.endsWith("/tutor-" + d.attempt));
    const host = checked.get(d.attempt);
    const received = entry?.http === 200 && isFinished(d) && host && host.status !== "generation-error";
    const measurement = received ? inspect(d.response.text) : null;
    return {
      attempt: d.attempt,
      submitted: !!entry?.host,
      http: entry?.http ?? null,
      transport: d.status,
      completed: !!received,
      stop: d.response?.stop ?? null,
      responseModel: d.response?.responseModel ?? null,
      providerModel: d.response?.model ?? null,
      provider: d.response?.provider ?? null,
      attempted: measurement?.attempted ?? null,
      compiled: measurement?.components ?? null,
      nodes: measurement?.documents.flat() ?? null,
      outsideWords: measurement?.outsideWords ?? null,
      issues: measurement?.issues ?? null,
      nativeTools: received ? d.response.nativeTools : null,
      promptIncludedGuidance: d.delivered,
      payloadSha256: d.payloadSha256,
      systemSha256: d.systemSha256,
      gate: host?.status ?? null,
      trimmedCheckpointSuffix: host?.trimmedCheckpointSuffix ?? null,
      findings: host?.findings ?? [],
      authoredTextSha256: received ? sha(d.response.text) : null,
      authoredText: received ? d.response.text : null,
    };
  });
  const completed = drafts.filter((d) => d.completed);
  const guidanceEvidence = completed.filter(
    (d) => d.payloadSha256 && typeof d.promptIncludedGuidance === "boolean",
  );
  const decision = row?.decision ?? null;
  const guidance = decision
    ? {
        source: decision.source === "google" && decision.model === cohort.judge.model ? "other" : "unknown",
        action: decision.action,
        delivered: guidanceEvidence.length ? guidanceEvidence.some((d) => d.promptIncludedGuidance) : null,
        targets: unique(decision.targets.map(normalizeOpenUiComponent).filter(Boolean)),
      }
    : null;
  const release = row?.phase === "released" && !!row.public;
  const withheld = row?.public?.notice === "withheld";
  const selected = release ? inspect(row.public.text) : null;
  const nativeTools = release ? row.public.tools : null;
  const nativeOnly = release && nativeTools.length > 0 && !row.public.text.trim();
  const source = adjudication[id];
  if (release) {
    check(
      source && source.publicTextSha256 === sha(row.public.text) && typeof source.passed === "boolean",
      "Adjudication must bind to exact selected text: " + id,
    );
    if (source.passed && c.cue.targets.length) {
      check(
        openUiMatchesTargets(selected.components, c.cue.targets) &&
          !nativeOnly &&
          selected.issues.length === 0,
        "A passing learner action requires its valid selected interface: " + id,
      );
    }
    if (source.passed && c.id === "bus")
      check(
        !selected.components.some((k) => ["quiz", "exam", "question", "question-group"].includes(k)),
        "Bus cannot include an assessed checkpoint",
      );
    if (source.passed && c.id === "perimeter")
      check(
        !selected.attempted &&
          !nativeTools.length &&
          selected.outsideWords <= 15 &&
          !row.public.text.includes("?") &&
          /\b(?:16|sixteen)\b/i.test(row.public.text),
        "Text control failed structural rubric",
      );
  } else check(!source, "An absent released reply has a text-based adjudication: " + id);
  const transportIssue = tutorCalls.find(
    (e) => e.http >= 400 || ["uncertain", "reserved"].includes(e.status),
  );
  const decisionFailed = row?.judgments.some((j) => !j.outcome.ok);
  const fit = release
    ? source.passed
    : withheld && completed.length && !transportIssue && !decisionFailed
      ? false
      : null;
  const eligibility = release
    ? nativeOnly
      ? "released-native-proposal"
      : "released-content"
    : transportIssue
      ? "provider-failure"
      : decisionFailed
        ? "decision-unavailable"
        : withheld && completed.length
          ? "review-withheld"
          : tutorCalls.length
            ? "uncompleted-tutor"
            : row
              ? "undispatched-tutor"
              : "unscheduled-by-budget";
  const directHeld =
    c.id === "perimeter" &&
    completed.length > 0 &&
    row.drafts
      .filter(isFinished)
      .every((d) =>
        /^(?:16(?: units)?|the perimeter of a square with side length four is 16)\.?$/i.test(
          d.response.text.trim(),
        ),
      ) &&
    completed.every((d) =>
      d.findings.some((f) => f.id === "checkpoint_answer_leaked" && f.status === "fail"),
    );
  const note = release
    ? source.note
    : transportIssue && completed.length
      ? `The gate reviewed ${completed.length} completed candidates before a later tutor request returned ${transportIssue.http ?? transportIssue.status}. ${directHeld ? "The earlier candidates answered correctly and were blocked for checkpoint leakage. " : ""}The gate issued a withheld notice. Final learner fit is unknown under the interruption rubric.`
      : transportIssue
        ? `The tutor endpoint returned ${transportIssue.http ?? transportIssue.status} before a complete candidate was available. The gate issued a withheld notice. Learner fit is unknown.`
        : directHeld
          ? "The tutor supplied the correct direct answer in every completed candidate. The planner requested no activity. The decision model marked giving the answer as checkpoint leakage and the gate withheld the turn."
          : eligibility === "review-withheld"
            ? "The gate reviewed completed work and withheld it."
            : "The scheduled tutor result is unavailable.";
  const turn = {
    schemaVersion: 1,
    conversationId: cohort.study + "/" + id,
    turnId: id,
    turnIndex: 0,
    model: m.id,
    mode: guidance ? "guided" : "unknown",
    cue: c.cue,
    reply: release
      ? "released"
      : withheld
        ? "withheld"
        : row?.phase === "cancelled"
          ? "cancelled"
          : "unknown",
    attempted: completed.length ? completed.some((d) => d.attempted) : null,
    nativePageRequested: release
      ? nativeTools.includes("interactive_page")
      : eligibility === "review-withheld"
        ? false
        : null,
    compiled: completed.length ? unique(completed.flatMap((d) => d.compiled)) : null,
    selected: release ? selected.components : withheld ? [] : null,
    rendered: null,
    outsideWords: release && !nativeOnly ? selected.outsideWords : null,
    guidance,
    decisionModel: decision?.model ?? null,
    ...(row
      ? {
          draftAttempts: row.checks.length,
          gateIssues: unique(
            row.checks.flatMap((a) => a.findings.map((f) => f.id).filter(isOpenUiDiagnosticGateIssue)),
          ),
        }
      : {}),
    fit: { source: "v21-prospective-case-rubric", passed: fit },
  };
  const selectedNodes = selected?.documents.flat() ?? null;
  const data = {
    id,
    model: m.id,
    provider: m.provider,
    caseId: c.id,
    source: docName,
    eligibility,
    prompt: c.prompt,
    rubric: c.rubric,
    reply: turn.reply,
    selectedAttempt: row?.selection ?? null,
    gateReason: row?.reason ?? null,
    tutorRequests: tutorCalls.length,
    gateDraftAttempts: turn.draftAttempts ?? null,
    completedCandidates: completed.length,
    authoredValidInterface: completed.length
      ? completed.some((d) => d.compiled.some(isOpenUiDiagnosticInterface))
      : null,
    offered: guidance?.targets ?? null,
    guidanceDelivered: guidance?.delivered ?? null,
    planProvenance:
      row?.judgments
        .filter((j) => j.phase === "plan")
        .map((j) => ({
          requestSha256: j.requestSha256,
          requestedModel: j.receipt?.requestedModel ?? null,
          reportedModel: j.receipt?.reportedModel ?? null,
          modelProvenance: j.receipt?.modelProvenance ?? null,
          source: j.source,
          cacheFile: j.cacheFile,
        })) ?? [],
    selectedComponents: turn.selected,
    selectedNodes,
    selectedOutsideWords: selected?.outsideWords ?? null,
    selectedOutsideText: selected?.outsideText ?? null,
    selectedText: release ? row.public.text : null,
    selectedNativeTools: nativeTools,
    nativeOnly: release ? nativeOnly : null,
    verdict: fit,
    note,
    simulationSamples:
      selectedNodes
        ?.filter((n) => n.type === "simulation")
        .map((n) => ({ id: n.id, samples: simulationSample(n) })) ?? [],
    drafts,
  };
  return { turn, data };
}

function tally(rows) {
  const known = rows.filter((r) => r.verdict !== null);
  const opportunities = rows.filter((r) => r.caseId !== "perimeter");
  const knownOpportunities = opportunities.filter((r) => r.verdict !== null);
  const controls = rows.filter((r) => r.caseId === "perimeter");
  const knownControls = controls.filter((r) => r.verdict !== null);
  const seen = rows.filter((r) => r.authoredValidInterface !== null);
  return {
    scheduled: rows.length,
    tutorDispatched: count(rows, (r) => r.tutorRequests > 0),
    completedCandidates: rows.reduce((s, r) => s + r.completedCandidates, 0),
    released: count(rows, (r) => r.reply === "released"),
    withholdNotices: count(rows, (r) => r.reply === "withheld"),
    providerFailures: count(rows, (r) => r.eligibility === "provider-failure"),
    nativeOnly: count(rows, (r) => r.nativeOnly === true),
    knownFit: rate(
      count(known, (r) => r.verdict),
      known.length,
    ),
    missingFit: rows.length - known.length,
    authoredInterfaceAmongObserved: rate(
      count(seen, (r) => r.authoredValidInterface),
      seen.length,
    ),
    requestedInterfacesScheduled: opportunities.length,
    knownRequestedInterfaceFit: rate(
      count(knownOpportunities, (r) => r.verdict),
      knownOpportunities.length,
    ),
    controlsScheduled: controls.length,
    knownTextControlFit: rate(
      count(knownControls, (r) => r.verdict),
      knownControls.length,
    ),
  };
}

function verifyObservation(observation, cache, entries) {
  const fileId = observation.requestSha256 + (cache.previousCacheFile ? ".quota-recovery" : "");
  const label = "decision/" + fileId,
    ledger = entries.find((e) => e.label === label);
  check(
    ledger &&
      cache.requestSha256 === observation.requestSha256 &&
      observation.cacheFile === "decision-cache/" + fileId + ".json" &&
      cache.http === ledger.http &&
      cache.endpoint === protocol.judge.endpoint &&
      cache.requestedModel === protocol.judge.model,
    "Decision receipt mismatch",
  );
  if (observation.outcome.ok) {
    const actual = observation.outcome.response,
      raw = cache.payload;
    check(
      ledger.http === 200 &&
        actual.backend.model === protocol.judge.model &&
        observation.receipt.provider === "google" &&
        observation.receipt.requestedModel === protocol.judge.model &&
        observation.receipt.httpStatus === 200 &&
        (observation.reportedModel
          ? observation.receipt.modelProvenance === "response-model"
          : observation.receipt.modelProvenance === "documented-request-model") &&
        raw &&
        same(Object.keys(actual.answers).sort(), Object.keys(raw.answers).sort()),
      "Incomplete or unattributed Google decision",
    );
    for (const [id, a] of Object.entries(actual.answers)) {
      const r = raw.answers[id];
      if (a.type === "noul") check(r.type === "noul" && r.noul === a.noul, "Stored Noul differs from Google");
      else check(isDeepStrictEqual(r, a), "Stored choice or score differs from Google");
    }
    check(
      observation.usage.inputTokens === raw.usage.total_input_tokens &&
        observation.usage.outputTokens === 0 &&
        raw.usage.total_output_tokens === 0,
      "Decision tokens differ from provider",
    );
  }
}
export async function verify({ cells, inspect, baseline, parseOpenUiDiagnosticExport }) {
  verifyPrior();
  const frozen = read(join(here, "manifest.json"));
  const { frozenAt, ...pins } = frozen;
  check(frozenAt && same(pins, baseline), "Frozen source, policy, or cases differ");
  const ledger = read(join(here, "ledger.json")),
    entries = ledger.entries;
  const used = new Set(),
    dispatch = new Set();
  let amount = 0;
  for (const e of entries) {
    check(
      !dispatch.has(e.label) && e.host && e.finishedAt && e.status !== "reserved",
      "Duplicate or unsettled call",
    );
    dispatch.add(e.label);
    check(usd(amount + e.reservedUsd) <= protocol.incrementalLimitUsd, "Dispatch exceeded reserved budget");
    check(
      e.accountedUsd >= 0 &&
        e.accountedUsd <= e.reservedUsd &&
        (e.measured || e.accountedUsd === e.reservedUsd),
      "Incomplete accounting",
    );
    amount = usd(amount + e.accountedUsd);
    if (e.kind === "decision") {
      const id = e.label.slice("decision/".length),
        cache = read(join(here, "decision-cache", id + ".json"));
      const baseId = cache.requestSha256 + (cache.previousCacheFile ? ".quota-recovery" : "");
      check(
        id === baseId &&
          e.reservedUsd === protocol.judge.reserveUsd &&
          cache.endpoint === protocol.judge.endpoint &&
          e.host === new URL(protocol.judge.endpoint).host &&
          e.path === new URL(protocol.judge.endpoint).pathname &&
          cache.http === e.http &&
          /^[a-f0-9]{64}$/.test(cache.wireSha256),
        "Unverified decision route",
      );
      if (e.measured)
        check(
          usd((cache.payload.usage.total_input_tokens * protocol.judge.inputPerMillionUsd) / 1e6) ===
            e.accountedUsd,
          "Decision accounting differs",
        );
      if (e.http === 200)
        check(
          sha(JSON.stringify(cache.payload)) === cache.responseSha256,
          "Captured Google envelope changed",
        );
    }
  }
  const adjudication = read(join(here, "adjudication.json")),
    rows = [],
    turns = [];
  const style = { ...original, study: protocol.study, judge: protocol.judge };
  const inspectOriginal = (text) => {
    const r = inspect(text);
    return { ...r, documents: [r.nodes], issues: r.errors };
  };
  for (const { id, c, model: m } of cells) {
    const name = "turn-receipts/" + id + ".json",
      src = join(here, name),
      row = existsSync(src) ? read(src) : null;
    if (row) {
      check(
        row.finishedAt &&
          row.id === id &&
          row.caseId === c.id &&
          row.configuredModel === m.id &&
          row.provider === m.provider,
        "Turn source mismatch",
      );
      for (const obs of row.judgments) {
        const cache = read(join(here, obs.cacheFile));
        verifyObservation(obs, cache, entries);
        used.add("decision/" + obs.requestSha256);
      }
      for (const d of row.drafts) {
        const label = id + "/tutor-" + d.attempt,
          e = entries.find((e) => e.label === label);
        if (!e && !d.payloadSha256) continue;
        check(
          e &&
            !used.has(label) &&
            e.model === m.id &&
            e.host === new URL(m.endpoint).host &&
            e.reservedUsd === protocol.tutorReserveUsd,
          "Unlinked or repeated tutor request",
        );
        used.add(label);
        if (e.measured) {
          const u = d.response?.usage;
          check(
            u &&
              usd(
                ((u.input + u.cacheRead + u.cacheWrite) * m.inputPerMillionUsd +
                  u.output * m.outputPerMillionUsd) /
                  1e6,
              ) === e.accountedUsd,
            "Tutor cost differs",
          );
        }
      }
    }
    const { data, turn } = makeRecord(
      { id, c, m },
      row,
      row ? name : null,
      adjudication,
      entries,
      style,
      inspectOriginal,
    );
    if (turn.guidance)
      check(
        turn.guidance.source === "other" && turn.decisionModel === protocol.judge.model,
        "Wrong planning source",
      );
    if (data.nativeOnly || turn.reply !== "released")
      check(turn.outsideWords === null, "No natural reply must retain null outside words");
    if (turn.reply === "released")
      check(
        turn.nativePageRequested === row.public.tools.includes("interactive_page"),
        "Native page observation differs",
      );
    rows.push(data);
    turns.push(turn);
  }
  check(
    Object.keys(adjudication).length === rows.filter((r) => r.reply === "released").length,
    "Adjudication contains unexpected ratings",
  );
  const matchedInput = read(join(here, "frozen/requests.json")),
    matchedOutput = read(join(here, "frozen/google-outcomes.json"));
  check(
    matchedOutput.sourceSha256 === protocol.matchedDecisionInputsSha256 &&
      fileHash(join(here, "frozen/requests.json")) === matchedOutput.sourceSha256 &&
      matchedOutput.cases.length === matchedInput.cases.length &&
      matchedInput.cases.length === 15,
    "Incomplete separate fixed-decision panel",
  );
  async function verifyReplay(c, saved) {
    const cache = read(join(here, saved.cacheFile));
    verifyObservation(saved, cache, entries);
    used.add("decision/" + saved.requestSha256 + (cache.previousCacheFile ? ".quota-recovery" : ""));
    check(
      saved.caseId === c.id &&
        c.requestSha256 === saved.requestSha256 &&
        sha(JSON.stringify(c.request)) === c.requestSha256,
      "Frozen case input changed",
    );
    // The caller validates the complete wire hash before returning the captured response. No real fetch or key exists on this path.
    const replay = await recordedDecision({
      request: c.request,
      label: c.id,
      apiKey: null,
      journal: null,
      offline: true,
      quotaRecovery: !!cache.previousCacheFile,
    });
    check(
      isDeepStrictEqual(JSON.parse(JSON.stringify(replay.outcome)), saved.outcome),
      "Offline Google decoder produced different answers",
    );
  }
  for (const [index, c] of matchedInput.cases.entries()) await verifyReplay(c, matchedOutput.cases[index]);
  const quota = read(join(here, "quota-disposition.json")),
    initialPath = join(here, "frozen/first-pass-google-outcomes.json"),
    initial = read(initialPath);
  check(
    fileHash(initialPath) === quota.firstPassFileSha256 &&
      initial.cases.filter((c) => c.outcome.ok).length === quota.initiallySuccessful,
    "Initial panel snapshot changed",
  );
  for (const [index, c] of matchedInput.cases.entries()) {
    const firstAttempt = initial.cases[index],
      finalAttempt = matchedOutput.cases[index];
    if (!quota.eligible.includes(c.requestSha256)) {
      check(same(firstAttempt, finalAttempt), "Untouched successful result was rewritten");
      continue;
    }
    await verifyReplay(c, firstAttempt);
    if (!finalAttempt.quotaDisposition) continue;
    const previous = entries.find((e) => e.label === "decision/" + c.requestSha256),
      newIndex = entries.findIndex((e) => e.label === "decision/" + c.requestSha256 + ".quota-recovery");
    const next = entries[newIndex],
      latest = entries
        .slice(0, newIndex)
        .filter((e) => e.kind === "decision")
        .at(-1);
    check(
      previous.http === 429 &&
        !previous.measured &&
        previous.accountedUsd === previous.reservedUsd &&
        next &&
        Date.parse(next.startedAt) - Date.parse(previous.finishedAt) >= quota.minimumDelayAfterOriginalMs &&
        Date.parse(next.startedAt) - Date.parse(latest.startedAt) >= quota.minimumGapBetweenNewDecisionsMs,
      "Quota recovery or retained reserve differs",
    );
  }
  let posthoc = null;
  const postPath = join(here, "frozen/perimeter-google-outcome.json");
  if (existsSync(postPath)) {
    const extra = read(postPath),
      amendment = read(join(here, "posthoc-protocol.json")),
      input = read(join(here, "frozen/perimeter-request.json"));
    check(
      extra.sourceSha256 === amendment.inputFileSha256 &&
        fileHash(join(here, "frozen/perimeter-request.json")) === extra.sourceSha256,
      "Posthoc source changed",
    );
    await verifyReplay(input.case, extra.case);
    posthoc = {
      caseId: extra.case.caseId,
      source: extra.case.source,
      requestSha256: extra.case.requestSha256,
    };
  }
  check(
    used.size === entries.length && entries.every((e) => used.has(e.label)),
    "Unattributed billed dispatch",
  );
  const exported = { schemaVersion: 1, turns };
  check(
    parseOpenUiDiagnosticExport(exported).length === 6 && new Set(turns.map((t) => t.turnId)).size === 6,
    "Diagnostic export failed",
  );
  const scopes = { fresh: [], frozen: [], posthoc: [] };
  for (const e of entries) {
    if (e.kind === "tutor") {
      scopes.fresh.push(e);
      continue;
    }
    const first = read(join(here, "decision-cache", e.label.split("/")[1] + ".json")).label;
    if (cells.some((c) => first.startsWith(c.id + "/"))) scopes.fresh.push(e);
    else if (matchedInput.cases.some((c) => c.id === first)) scopes.frozen.push(e);
    else if (first === posthoc?.caseId) scopes.posthoc.push(e);
    else throw Error("Unassigned decision scope");
  }
  const stats = (arr) => ({
    dispatches: arr.length,
    tutor: count(arr, (e) => e.kind === "tutor"),
    googleDecision: count(arr, (e) => e.kind === "decision"),
    accountedUsd: total(arr),
    usageBasedUpperUsd: total(arr.filter((e) => e.measured)),
    heldForUnknownUsageUsd: total(arr.filter((e) => !e.measured)),
  });
  const summary = {
    version: 1,
    study: protocol.study,
    policy: protocol.policy,
    releaseSystemAndTools: protocol.release,
    requestedDecision: protocol.judge.model,
    casesSha256: protocol.casesSha256,
    total: tally(rows),
    byModel: Object.fromEntries(
      original.models.map((m) => [m.id, tally(rows.filter((r) => r.model === m.id))]),
    ),
    byCase: Object.fromEntries(
      original.cases.map((c) => [c.id, tally(rows.filter((r) => r.caseId === c.id))]),
    ),
    accounting: {
      currency: "USD",
      ...stats(entries),
      previousBoundUsd: protocol.previousBoundUsd,
      allStudyBound: usd(protocol.previousBoundUsd + amount),
      userCap: protocol.allStudyLimitUsd,
      byScope: Object.fromEntries(Object.entries(scopes).map(([k, v]) => [k, stats(v)])),
      note: "Reported tokens at published list rates. Cached tutor tokens use the full input price. A call without usage retains its full reserve. Invoice amounts were unavailable.",
    },
    matchedDecisionPanel: {
      scheduled: 15,
      initialKnown: quota.initiallySuccessful,
      initialRateLimited: quota.initiallyRateLimited,
      furtherAttempts: count(matchedOutput.cases, (c) => !!c.quotaDisposition),
      known: count(matchedOutput.cases, (c) => c.outcome.ok),
    },
    posthoc,
    records: rows,
  };
  for (const [name, data] of [
    ["turns.json", exported],
    ["summary.json", summary],
  ]) {
    const target = join(here, name),
      text = JSON.stringify(data, null, 2) + "\n";
    if (existsSync(target) && readFileSync(target, "utf8") === text) continue;
    if (!process.argv.includes("--write-derived"))
      throw Error("Missing or changed " + name + "; regenerate derived files with --verify --write-derived");
    writeFileSync(target + ".tmp", text);
    renameSync(target + ".tmp", target);
  }
  console.log(
    JSON.stringify({
      verified: true,
      networkRequests: 0,
      rows: turns.length,
      summary: summary.total,
      accounting: summary.accounting,
    }),
  );
}
