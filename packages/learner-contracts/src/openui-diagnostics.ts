import {
  ASSESSMENT_CHECKPOINT_SIGNALS, EDITABLE_CODE_LANGUAGES, NATIVE_PAGE_STAGES, OPENUI_DIAGNOSTIC_CUES, OPENUI_DIAGNOSTIC_MODES, isOpenUiDiagnosticInterface, openUiMatchesTargets, parseOpenUiDiagnosticExport,
  type NativePageStage, type OpenUiDiagnosticCueKind, type OpenUiDiagnosticMode, type OpenUiDiagnosticTurn,
} from "./openui-diagnostic-turn.js";
import { pairReviewOverlapMs } from "./openui-pair-reviews.js";

export * from "./openui-diagnostic-turn.js";

export interface OpenUiDiagnosticFilter {
  model?: string;
  decisionModel?: string;
  mode?: OpenUiDiagnosticMode;
  cue?: OpenUiDiagnosticCueKind;
  experimentId?: string;
}
export interface OpenUiDiagnosticRate {
  numerator: number;
  denominator: number;
  unknown: number;
  rate: number | null;
}
type Stage = "selected" | "rendered";
type EvidenceStage = "compiled" | Stage;
type Row = OpenUiDiagnosticTurn;
type Outcome = boolean | null;

function fraction(values: Outcome[]): OpenUiDiagnosticRate {
  const numerator = values.filter(v => v === true).length;
  const unknown = values.filter(v => v === null).length;
  const denominator = values.length - unknown;
  return { numerator, denominator, unknown, rate: denominator ? numerator / denominator : null };
}

function present(components: string[] | null): Outcome {
  return components === null ? null : components.some(isOpenUiDiagnosticInterface);
}

const LOSS_STAGES = { draftToSelection: ["compiled", "selected"], selectionToRender: ["selected", "rendered"] } as const;
export type OpenUiDiagnosticLossStage = keyof typeof LOSS_STAGES;

/** True when a known substantive upstream interface was lost, false when retained, null when ineligible or unobserved. */
export function openUiDiagnosticLoss(row: OpenUiDiagnosticTurn, stage: OpenUiDiagnosticLossStage): boolean | null {
  const [upstream, downstream] = LOSS_STAGES[stage];
  if (present(row[upstream]) !== true || row[downstream] === null) return null;
  return present(row[downstream]) === false;
}

/** True when a learner who opted out of assessment received a checkpoint signal, false when none was seen, null when unobserved. */
export function openUiCheckpointAfterOptOut(row: OpenUiDiagnosticTurn): boolean | null {
  if (row.assessment?.optOut !== true || !row.assessment.checkpoints) return null;
  return row.assessment.checkpoints.length > 0;
}

/** Present only when at least one turn carries the observation, so legacy summaries keep their shape. */
function assessmentOptOutSummary(rows: Row[]) {
  const observed = rows.filter(row => row.assessment);
  if (!observed.length) return undefined;
  const declined = observed.filter(row => row.assessment!.optOut);
  return {
    observedTurns: observed.length, unobservedTurns: rows.length - observed.length, optOuts: declined.length,
    notReleased: declined.filter(row => row.reply !== "released").length,
    checkpointAfterOptOut: fraction(declined.map(openUiCheckpointAfterOptOut)),
    signals: ASSESSMENT_CHECKPOINT_SIGNALS.map(signal => ({ signal, turns: declined.filter(row => row.assessment!.checkpoints?.includes(signal)).length })),
    // Base rate for comparison. A checkpoint with no opt-out is ordinary teaching.
    checkpointWithoutOptOut: fraction(observed.filter(row => !row.assessment!.optOut)
      .map(row => row.assessment!.checkpoints ? row.assessment!.checkpoints.length > 0 : null)),
  };
}

function matches(row: Row, stage: EvidenceStage, targets: string[]): Outcome {
  const components = row[stage];
  const fenced = targets.filter(target => target !== "editable-code");
  return components === null || !fenced.length ? null : openUiMatchesTargets(components, fenced);
}

function either(a: Outcome, b: Outcome): Outcome {
  if (a === true || b === true) return true;
  return a === false && b === false ? false : null;
}

function nativeAt(row: Row, stage: Stage): Outcome {
  return row.nativePage?.[stage === "selected" ? "attached" : "ready"] ?? null;
}

/** The native tool accepts arbitrary learning pages. Its lifecycle cannot identify a requested teaching component. */
export function matchesLearnerInterface(row: Row, stage: Stage, targets: string[]): Outcome {
  const fenced = matches(row, stage, targets);
  const native = nativeAt(row, stage);
  if (targets.includes("any")) return either(fenced, native);
  if (fenced === true) return true;
  return native === false ? fenced : null;
}

/** Selected reply evidence for the requested action; the editor language is observable even without a browser mount. */
export function matchesSelectedLearnerAction(row: Row, cue: Pick<Row["cue"], "targets" | "codeLanguage"> = row.cue): Outcome {
  const { targets, codeLanguage } = cue;
  const acceptsEditor = targets.includes("editable-code") || targets.includes("any");
  const typedChallenge = !!codeLanguage && targets.includes("coding-challenge");
  if (!acceptsEditor && !typedChallenge) return matchesLearnerInterface(row, "selected", targets);
  let matched: Outcome = false;
  // A recorded withholding notice with no selected reply cannot contain an editable Markdown fence.
  const withheldEmpty = row.reply === "withheld" && row.selected?.length === 0;
  if (acceptsEditor) matched = withheldEmpty ? false : row.editableCode == null ? null
    : codeLanguage ? row.editableCode.includes(codeLanguage) : row.editableCode.length > 0;
  if (typedChallenge) {
    // A historical selected challenge certifies its component, not its JS vs TS language.
    const challenge = codeLanguage === "python" || row.selected?.includes("coding-challenge") === false
      ? false : row.codingChallengeLanguages?.includes(codeLanguage) ?? null;
    matched = either(matched, challenge);
  }
  // The earlier classifier recorded generic JS/TS practice as editor-only. With only an old
  // selected component name, its suitability cannot be recovered from this content-free row.
  if (!typedChallenge && matched === false && codeLanguage && codeLanguage !== "python"
    && row.codingChallengeLanguages == null && row.selected?.includes("coding-challenge")) matched = null;
  // A separate attached or unresolved native page may allow coding. Its language is unmeasured.
  if (matched === false && (row.nativePage?.attached === true || (row.nativePageRequested === true && row.nativePage?.attached == null))) matched = null;
  const otherTargets = targets.filter(target => target !== "editable-code" && !(typedChallenge && target === "coding-challenge"));
  return otherTargets.length ? either(matched, matchesLearnerInterface(row, "selected", otherTargets)) : matched;
}

function learnerInterfaces(rows: Row[], stage: Stage) {
  let fencedOnly = 0, nativeOnly = 0, both = 0, otherSourceUnknown = 0;
  const values = rows.map(row => {
    const fenced = present(row[stage]), native = nativeAt(row, stage);
    if (fenced === true && native === true) both++;
    else if (fenced === true && native === false) fencedOnly++;
    else if (native === true && fenced === false) nativeOnly++;
    else if (either(fenced, native) === true) otherSourceUnknown++;
    return either(fenced, native);
  });
  return { any: fraction(values), fencedOnly, nativeOnly, both, otherSourceUnknown };
}

function opportunity(row: Row): boolean {
  return row.cue.kind === "explicit-interface" || row.cue.kind === "implicit-action";
}

function appropriate(row: Row, stage: EvidenceStage): Outcome {
  if (opportunity(row)) return matches(row, stage, row.cue.targets);
  if (row.cue.kind !== "direct-text" || row[stage] === null || (stage !== "compiled" && row.reply !== "released")) return null;
  return present(row[stage]) === false;
}

function selectRows(rows: Row[], filter: OpenUiDiagnosticFilter): Row[] {
  return rows.filter(row => (!filter.model || (row.model ?? "unknown") === filter.model)
    && (!filter.decisionModel || (row.decisionModel ?? "unknown") === filter.decisionModel)
    && (!filter.mode || row.mode === filter.mode) && (!filter.cue || row.cue.kind === filter.cue)
    && (!filter.experimentId || row.experiment?.experimentId === filter.experimentId));
}

function groups<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const existing = grouped.get(id);
    if (existing) existing.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableValue).sort().join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ":" + stableValue(v)).join(",") + "}";
  }
  return JSON.stringify(value);
}

function uniqueTurns(input: readonly Row[]): Row[] {
  const byId = new Map<string, Row>();
  const positions = new Set<string>();
  for (const row of input) {
    const id = JSON.stringify([row.conversationId, row.turnId]);
    const previous = byId.get(id);
    if (previous) {
      if (stableValue(previous) !== stableValue(row)) throw new Error("Conflicting observations for one conversation turn. Export a final snapshot.");
      continue;
    }
    const position = JSON.stringify([row.conversationId, row.turnIndex]);
    if (positions.has(position)) throw new Error("Two different turn IDs share a conversation position.");
    positions.add(position);
    byId.set(id, row);
  }
  return [...byId.values()];
}

type Delay = number | "unknown" | "superseded" | "unresolved";
type Episode = { outcome: Delay; reminders: number };
type Delays = Record<Stage | "combinedSelected" | "combinedRendered" | "learnerActionSelected", Map<Row, Episode>>;

function sharedTargets(original: string[], requested: string[]): string[] {
  if (original.includes("any")) return requested;
  if (requested.includes("any")) return original;
  return original.filter(kind => requested.includes(kind) || openUiMatchesTargets([kind], requested));
}

function measureConversationDelays(conversations: Map<string, Row[]>, stage: Stage, source: "fenced" | "combined" | "action" = "fenced"): Map<Row, Episode> {
  const result = new Map<Row, Episode>();
  for (const conversation of conversations.values()) {
    let episode: Episode | undefined;
    let previous: Row | undefined;
    let targets: string[] = [];
    let codeLanguage: Row["cue"]["codeLanguage"];
    let replies = 0;
    for (const row of conversation) {
      if (previous && (row.turnIndex !== previous.turnIndex + 1 || !row.model || previous.model !== row.model
        || previous.mode !== row.mode)) {
        if (episode?.outcome === "unresolved") episode.outcome = "unknown";
        episode = undefined;
      }
      previous = row;
      if (row.cue.kind !== "none") {
        const sameLanguage = !codeLanguage || !row.cue.codeLanguage || codeLanguage === row.cue.codeLanguage;
        const overlap = episode && row.cue.repeat && sameLanguage ? sharedTargets(targets, row.cue.targets) : [];
        if (episode && overlap.length) {
          targets = overlap;
          codeLanguage ??= row.cue.codeLanguage;
          episode.reminders++;
        } else {
          if (episode?.outcome === "unresolved") episode.outcome = row.cue.kind === "unknown" ? "unknown" : "superseded";
          episode = undefined;
          if (opportunity(row)) {
            episode = { outcome: "unresolved", reminders: 0 };
            result.set(row, episode);
            targets = row.cue.targets;
            codeLanguage = row.cue.codeLanguage;
            replies = 0;
          }
        }
      }
      if (episode?.outcome !== "unresolved") continue;
      // A public tool result can precede a withheld or failed final prose reply.
      const publicPage = source !== "fenced" && nativeAt(row, stage) === true;
      const unknownNativeResponse = source !== "fenced" && row.reply !== "released" && nativeAt(row, stage) === null && row.nativePageRequested !== false;
      if (!publicPage && (row.reply === "unknown" || row.reply === "pending" || unknownNativeResponse)) {
        episode.outcome = "unknown";
        continue;
      }
      if (!publicPage && row.reply !== "released") continue;
      replies++;
      const match = source === "action" ? matchesSelectedLearnerAction(row, { targets, codeLanguage })
        : source === "combined" ? matchesLearnerInterface(row, stage, targets) : matches(row, stage, targets);
      if (match !== false) episode.outcome = match === null ? "unknown" : replies;
    }
  }
  return result;
}

function delaySummary(rows: Row[], outcomes: Map<Row, Episode>) {
  const byNumber = new Map<number, number>();
  let opportunities = 0, reminders = 0, later = 0, unknown = 0, unresolved = 0, superseded = 0;
  for (const row of rows) {
    const episode = outcomes.get(row);
    if (!episode) continue;
    opportunities++;
    reminders += episode.reminders;
    const delay = episode.outcome;
    if (delay === "unknown") unknown++;
    else if (delay === "unresolved") unresolved++;
    else if (delay === "superseded") superseded++;
    else {
      byNumber.set(delay, (byNumber.get(delay) ?? 0) + 1);
      if (delay > 1) later++;
    }
  }
  const byResponse = [...byNumber.entries()].sort(([a], [b]) => a - b)
    .map(([responseNumber, count]) => ({ responseNumber, count }));
  const firstResponse = byNumber.get(1) ?? 0;
  const n = firstResponse + later;
  function rank(target: number): number {
    let count = 0;
    for (const bucket of byResponse) {
      count += bucket.count;
      if (count > target) return bucket.responseNumber;
    }
    throw new Error("Invalid delay rank");
  }
  const medianResponseNumber = n ? (rank(Math.floor((n - 1) / 2)) + rank(Math.floor(n / 2))) / 2 : null;
  return { opportunities, reminders, firstResponse, later, unknown, unresolved, superseded, byResponse, medianResponseNumber };
}

function measuredDistribution(values: Array<number | null | undefined>) {
  const counts = values.filter((value): value is number => value != null).sort((a, b) => a - b);
  const observed = counts.length, unknown = values.length - observed;
  if (!observed) return { observed, unknown, median: null, p90: null };
  const lowerMiddle = counts[Math.floor((observed - 1) / 2)]!, upperMiddle = counts[Math.floor(observed / 2)]!;
  return { observed, unknown, median: lowerMiddle + (upperMiddle - lowerMiddle) / 2, p90: counts[Math.ceil(0.9 * observed) - 1]! };
}

function metrics(rows: Row[], delays: Delays) {
  const opportunities = rows.filter(opportunity);
  const text = rows.filter(row => row.cue.kind === "direct-text");
  const offered = rows.filter(row => row.guidance && row.guidance.source !== "unknown" && row.guidance.action === "create" && row.guidance.delivered === true);
  const advised = offered.filter(row => row.guidance!.source === "jev");
  const jev = rows.filter(row => row.guidance?.source === "jev");
  const overuse = (row: Row, stage: EvidenceStage): Outcome => stage === "compiled" || row.reply === "released" ? present(row[stage]) : null;
  const lost = (stage: OpenUiDiagnosticLossStage) => fraction(rows
    .filter(row => present(row[LOSS_STAGES[stage][0]]) === true)
    .map(row => openUiDiagnosticLoss(row, stage)));
  return {
    turns: rows.length,
    attempted: fraction(rows.map(row => row.attempted)), compiled: fraction(rows.map(row => present(row.compiled))),
    selected: fraction(rows.map(row => present(row.selected))), rendered: fraction(rows.map(row => present(row.rendered))),
    nativePageRequested: fraction(rows.map(row => row.nativePageRequested ?? null)),
    nativePage: Object.fromEntries(NATIVE_PAGE_STAGES.map(key => [key, fraction(rows.map(row => row.nativePage?.[key] ?? null))])) as Record<NativePageStage, OpenUiDiagnosticRate>,
    learnerInterfaces: { selected: learnerInterfaces(rows, "selected"), rendered: learnerInterfaces(rows, "rendered") },
    editableCode: { any: fraction(rows.map(row => row.editableCode == null ? null : row.editableCode.length > 0)),
      outsideWords: measuredDistribution(rows.filter(row => row.editableCode?.length).map(row => row.editorOutsideWords)),
      languages: EDITABLE_CODE_LANGUAGES.map(language => ({ language, selected: fraction(rows.map(row => row.editableCode?.includes(language) ?? null)) })) },
    learnerActionSelected: fraction(opportunities.map(row => matchesSelectedLearnerAction(row))),
    offeredCodeLanguageSelected: fraction(rows.filter(row => row.guidance?.delivered === true && row.guidance.codeLanguage)
      .map(row => matchesSelectedLearnerAction(row, {targets:["coding-challenge", "editable-code"], codeLanguage:row.guidance!.codeLanguage!}))),
    combinedOpportunitySelected: fraction(opportunities.map(row => matchesLearnerInterface(row, "selected", row.cue.targets))),
    combinedOpportunityRendered: fraction(opportunities.map(row => matchesLearnerInterface(row, "rendered", row.cue.targets))),
    guidanceReasons: [...groups(rows.filter(row => row.guidance?.reason), row => row.guidance!.reason!)].map(([reason, turns]) => ({ reason, turns: turns.length })),
    losses: { draftToSelection: lost("draftToSelection"), selectionToRender: lost("selectionToRender") },
    proseBesideInterface: measuredDistribution(rows.filter(row => present(row.selected) === true).map(row => row.outsideWords)),
    replyElapsedMs: measuredDistribution(rows.filter(row => row.reply === "released" || row.reply === "withheld").map(row => row.replyElapsedMs)),
    opportunityCompiled: fraction(opportunities.map(row => matches(row, "compiled", row.cue.targets))),
    opportunitySelected: fraction(opportunities.map(row => matches(row, "selected", row.cue.targets))),
    opportunityRendered: fraction(opportunities.map(row => matches(row, "rendered", row.cue.targets))),
    directTextCompiled: fraction(text.map(row => overuse(row, "compiled"))),
    directTextSelected: fraction(text.map(row => overuse(row, "selected"))),
    directTextRendered: fraction(text.map(row => overuse(row, "rendered"))),
    offeredType: {
      compiled: fraction(offered.map(row => matches(row, "compiled", row.guidance!.targets))),
      selected: fraction(offered.map(row => matches(row, "selected", row.guidance!.targets))),
      rendered: fraction(offered.map(row => matches(row, "rendered", row.guidance!.targets))),
    },
    jevGuidanceDelivered: fraction(jev.map(row => row.guidance!.delivered)),
    jevCompiled: fraction(advised.map(row => matches(row, "compiled", row.guidance!.targets))),
    jevSelected: fraction(advised.map(row => matches(row, "selected", row.guidance!.targets))),
    jevRendered: fraction(advised.map(row => matches(row, "rendered", row.guidance!.targets))),
    fit: fraction(rows.map(row => row.fit?.passed ?? null)),
    delays: { selected: delaySummary(rows, delays.selected), rendered: delaySummary(rows, delays.rendered),
      combinedSelected: delaySummary(rows, delays.combinedSelected), combinedRendered: delaySummary(rows, delays.combinedRendered),
      learnerActionSelected: delaySummary(rows, delays.learnerActionSelected) },
  };
}

function groupedMetrics(rows: Row[], key: (row: Row) => string, delays: Delays) {
  return [...groups(rows, key)].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, set]) => ({ key, metrics: metrics(set, delays) }));
}

type Pair = { guided: Row; control: Row };

function pairedRate(pairs: Pair[], score: (pair: Pair) => [Outcome, Outcome]) {
  let both = 0, guidedOnly = 0, controlOnly = 0, neither = 0, unknown = 0;
  for (const pair of pairs) {
    const [guided, control] = score(pair);
    if (guided === null || control === null) unknown++;
    else if (guided && control) both++;
    else if (guided) guidedOnly++;
    else if (control) controlOnly++;
    else neither++;
  }
  const n = pairs.length - unknown;
  return { pairs: n, unknown, both, guidedOnly, controlOnly, neither,
    guidedRate: n ? (both + guidedOnly) / n : null, controlRate: n ? (both + controlOnly) / n : null,
    difference: n ? (guidedOnly - controlOnly) / n : null };
}

function compareArms(rows: Row[], control: "baseline" | "offer-only", decisionModel: string | null) {
  const relevant = rows.filter(row => row.mode === "guided"
    ? (row.decisionModel ?? null) === decisionModel
    : row.mode === control && (control === "baseline" || !row.decisionModel || row.decisionModel === decisionModel));
  const byCase = groups(relevant, row => JSON.stringify([row.experiment!.caseId, row.experiment!.pairId, row.turnIndex]));
  const pairs: Pair[] = [];
  let ambiguous = 0, unpaired = 0, ineligibleGuidance = 0;
  for (const set of byCase.values()) {
    const guided = set.filter(row => row.mode === "guided");
    const controls = set.filter(row => row.mode === control);
    if (guided.length > 1 || controls.length > 1) { ambiguous++; continue; }
    if (guided.length !== 1 || controls.length !== 1) { unpaired++; continue; }
    if (stableValue({ repeat: false, ...guided[0]!.cue }) !== stableValue({ repeat: false, ...controls[0]!.cue })) { ambiguous++; continue; }
    const guidance = guided[0]!.guidance;
    // Legacy Jev rows can identify their provider without recording a model ID.
    // Other providers need a named identity for an attributable comparison.
    const identified = guidance?.source === "jev" || (guidance?.source === "other" && decisionModel !== null && decisionModel !== "unknown");
    if (!identified || guidance?.delivered !== true || (control === "baseline" && controls[0]!.guidance?.delivered === true)) {
      ineligibleGuidance++;
      continue;
    }
    pairs.push({ guided: guided[0]!, control: controls[0]! });
  }
  const stageRates = (stage: EvidenceStage) => pairedRate(pairs, pair => [appropriate(pair.guided, stage), appropriate(pair.control, stage)]);
  return {
    experimentId: rows[0]!.experiment!.experimentId, model: rows[0]!.model!, decisionModel, control, matchedPairs: pairs.length,
    unpaired, ambiguous, ineligibleGuidance,
    compiled: stageRates("compiled"), selected: stageRates("selected"), rendered: stageRates("rendered"),
    fit: pairedRate(pairs, pair => {
      if (!pair.guided.fit || pair.guided.fit.source !== pair.control.fit?.source) return [null, null];
      return [pair.guided.fit.passed, pair.control.fit.passed];
    }),
  };
}

function pairedComparisons(rows: Row[], decisionFilter?: string) {
  const declared = rows.filter(row => row.experiment && row.model !== null && row.mode !== "unknown");
  const results: ReturnType<typeof compareArms>[] = [];
  for (const set of groups(declared, row => JSON.stringify([row.experiment!.experimentId, row.model])).values()) {
    const controls = (["baseline", "offer-only"] as const).filter(mode => set.some(row => row.mode === mode));
    const decisions = new Set(set.filter(row => row.mode === "guided").map(row => row.decisionModel ?? null));
    if (!decisions.size && !decisionFilter) decisions.add(null);
    for (const decision of decisions) {
      if (decisionFilter && (decision ?? "unknown") !== decisionFilter) continue;
      for (const control of controls) results.push(compareArms(set, control, decision));
    }
  }
  return results.sort((a, b) => a.experimentId.localeCompare(b.experimentId) || a.model.localeCompare(b.model)
    || (a.decisionModel ?? "").localeCompare(b.decisionModel ?? "") || a.control.localeCompare(b.control));
}

/** Pure analysis of content-free local exports. A missing component measurement stays null. */
export function summarizeOpenUiDiagnostics(input: readonly Row[], filter: OpenUiDiagnosticFilter = {}) {
  const unique = uniqueTurns(parseOpenUiDiagnosticExport(input));
  const conversations = groups(unique, row => row.conversationId);
  for (const rows of conversations.values()) rows.sort((a, b) => a.turnIndex - b.turnIndex);
  const delays = {
    selected: measureConversationDelays(conversations, "selected"),
    rendered: measureConversationDelays(conversations, "rendered"),
    combinedSelected: measureConversationDelays(conversations, "selected", "combined"),
    combinedRendered: measureConversationDelays(conversations, "rendered", "combined"),
    learnerActionSelected: measureConversationDelays(conversations, "selected", "action"),
  };
  const rows = selectRows(unique, filter);
  const comparisonRows = filter.decisionModel ? selectRows(unique, {...filter, decisionModel:undefined}) : rows;
  const observed = new Set<string>();
  for (const row of rows) for (const stage of [row.compiled, row.selected, row.rendered]) for (const kind of stage ?? []) observed.add(kind);
  const components = [...observed].sort().map(key => {
    const componentRate = (stage: "compiled" | Stage) => fraction(rows.map(row => row[stage]?.includes(key) ?? null));
    return { key, compiled: componentRate("compiled"), selected: componentRate("selected"), rendered: componentRate("rendered") };
  });
  const overall = metrics(rows, delays);
  const experimentRows = rows.filter(row => row.experiment);
  const experimentGroups = groups(experimentRows, row => JSON.stringify([row.experiment!.experimentId, row.model]));
  const noComparator = [...experimentGroups.values()].filter(set => !set.some(row => row.mode === "baseline" || row.mode === "offer-only"));
  const assessmentOptOut = assessmentOptOutSummary(rows);
  return {
    ...(assessmentOptOut && { assessmentOptOut }),
    schemaVersion: 1 as const, overall, byModel: groupedMetrics(rows, row => row.model ?? "unknown", delays),
    byDecisionModel: groupedMetrics(rows, row => row.decisionModel ?? "unknown", delays),
    byMode: groupedMetrics(rows, row => row.mode, delays), byCue: groupedMetrics(rows, row => row.cue.kind, delays),
    components, delays: overall.delays, comparisons: pairedComparisons(comparisonRows, filter.decisionModel),
    coverage: {
      inputRows: input.length, uniqueTurns: unique.length, duplicateRows: input.length - unique.length, includedTurns: rows.length,
      conversations: new Set(rows.map(row => row.conversationId)).size,
      unknownCue: rows.filter(row => row.cue.kind === "unknown").length, missingModel: rows.filter(row => row.model === null).length,
      experimentTurns: experimentRows.length, experimentTurnsWithoutControlArm: noComparator.reduce((n, set) => n + set.length, 0),
      experimentTurnsMissingModel: experimentRows.filter(row => row.model === null).length,
      unknownGuidance: rows.filter(row => row.guidance === null || row.guidance.source === "unknown").length,
    },
  };
}
export type OpenUiDiagnosticSummary = ReturnType<typeof summarizeOpenUiDiagnostics>;

/** Misses on the triggering physical turn. A later match has its own delay measurement. */
export function findUnmetOpenUiCues(input: readonly OpenUiDiagnosticTurn[], filter: OpenUiDiagnosticFilter = {}) {
  const scoped = selectRows(uniqueTurns(parseOpenUiDiagnosticExport(input)), filter);
  const turns: OpenUiDiagnosticTurn[] = [];
  let observedOpportunities = 0;
  let unknownOpportunities = 0;
  for (const row of scoped) {
    if (!opportunity(row)) continue;
    const matched = matches(row, "selected", row.cue.targets);
    if (matched === null) {
      unknownOpportunities++;
      continue;
    }
    observedOpportunities++;
    if (!matched) turns.push(row);
  }
  return { matchingTurns: turns.length, observedOpportunities, unknownOpportunities, turns };
}

export const openUiDiagnosticQuerySchema = {
  type: "object",
  properties: {
    model: { type: "string", description: "Exact tutor ID from the byModel summary." },
    decisionModel: { type: "string", description: "Exact decision model ID from byDecisionModel, or unknown when unrecorded." },
    cue: { type: "string", enum: OPENUI_DIAGNOSTIC_CUES },
    mode: { type: "string", enum: OPENUI_DIAGNOSTIC_MODES },
    view: { type: "string", enum: ["summary", "unmet", "combined-unmet", "action-unmet", "native", "editable-code", "draft-loss", "render-loss", "withheld", "released-drafts", "assessment-opt-out", "pair-reviews"], default: "summary",
      description: "Pair-reviews lists recorded candidate pairs, preferences, finalists and review overlap. Assessment-opt-out lists released replies with a checkpoint signal after the learner explicitly declined assessment. Unmet finds same-turn fenced OpenUI misses. Combined-unmet includes native pages. Action-unmet also checks requested editable code languages. Native lists page proposals and stages. Editable-code lists replies with supported editor fences. Released-drafts lists recorded winners, review disposition and selection rule." },
    limit: { type: "integer", minimum: 1, maximum: 50, default: 10, description: "Maximum returned turn examples." },
  },
  additionalProperties: false,
};

/** Query locally recorded evidence. Export readers can also scope the query to a declared experiment. */
export function queryOpenUiDiagnosticTurns(rows: readonly OpenUiDiagnosticTurn[], args: Record<string, unknown>, experimentId?: string) {
  const { model, decisionModel, mode, cue, view = "summary", limit = 10 } = args;
  if (Object.keys(args).some(key => !Object.hasOwn(openUiDiagnosticQuerySchema.properties, key))) throw new Error("Unknown diagnostics option.");
  if (model !== undefined && (typeof model !== "string" || !model || model.length > 160)) throw new Error("Use an exact tutor ID.");
  if (decisionModel !== undefined && (typeof decisionModel !== "string" || !decisionModel || decisionModel.length > 160)) throw new Error("Use an exact decision model ID.");
  if (mode !== undefined && !OPENUI_DIAGNOSTIC_MODES.includes(mode as OpenUiDiagnosticMode)) throw new Error("Unknown decision mode.");
  if (cue !== undefined && !OPENUI_DIAGNOSTIC_CUES.includes(cue as OpenUiDiagnosticCueKind)) throw new Error("Unknown learner cue.");
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Limit must be 1–50.");
  const filter: OpenUiDiagnosticFilter = { model, decisionModel, mode: mode as OpenUiDiagnosticMode | undefined, cue: cue as OpenUiDiagnosticCueKind | undefined, experimentId };
  if (view === "summary") return summarizeOpenUiDiagnostics(rows, filter);
  if (view === "unmet") {
    const unmet = findUnmetOpenUiCues(rows, filter);
    return { schemaVersion: 1 as const, view, ...unmet, turns: unmet.turns.slice(0, limit) };
  }
  if (view === "combined-unmet" || view === "action-unmet") {
    const cued = selectRows(uniqueTurns(parseOpenUiDiagnosticExport(rows)), filter).filter(opportunity);
    const score = (row: Row) => view === "action-unmet" ? matchesSelectedLearnerAction(row) : matchesLearnerInterface(row, "selected", row.cue.targets);
    const unmatched = cued.filter(row => score(row) === false);
    const unknownOpportunities = cued.filter(row => score(row) === null).length;
    return { schemaVersion: 1 as const, view, matchingTurns: unmatched.length, observedOpportunities: cued.length - unknownOpportunities,
      unknownOpportunities, turns: unmatched.slice(0, limit) };
  }
  if (view === "released-drafts") {
    const releases = selectRows(uniqueTurns(parseOpenUiDiagnosticExport(rows)), filter).filter(row => row.reply === "released");
    const observed = releases.filter(row => row.selection !== undefined);
    return { schemaVersion: 1 as const, view, matchingTurns: observed.length, unknownSelections: releases.length - observed.length,
      turns: observed.slice(0, limit) };
  }
  if (view === "pair-reviews") {
    const scoped = selectRows(uniqueTurns(parseOpenUiDiagnosticExport(rows)), filter);
    const observed = scoped.filter(row => row.pairReviews !== undefined);
    const reviews = observed.flatMap(row => row.pairReviews!);
    const intervals = observed.map(row => pairReviewOverlapMs(row.pairReviews!)).filter(ms => ms !== null);
    return { schemaVersion: 1 as const, view, matchingTurns: observed.length, turnsWithoutPairRecords: scoped.length - observed.length,
      comparedPairs: reviews.filter(pair => pair.status === "compared").length,
      incompletePairs: reviews.filter(pair => pair.status === "incomplete").length,
      unavailablePairs: reviews.filter(pair => pair.status === "unavailable").length,
      unrecordedPairs: 2 * observed.length - reviews.length,
      turnsWithMeasuredOverlap: intervals.length, turnsWithConcurrentReviews: intervals.filter(ms => ms > 0).length,
      turns: observed.slice(0, limit) };
  }
  if (view === "assessment-opt-out") {
    const scoped = selectRows(uniqueTurns(parseOpenUiDiagnosticExport(rows)), filter);
    const declined = scoped.filter(row => row.assessment?.optOut === true);
    const pressed = declined.filter(row => openUiCheckpointAfterOptOut(row) === true);
    const unknownOptOuts = declined.filter(row => openUiCheckpointAfterOptOut(row) === null).length;
    return { schemaVersion: 1 as const, view, matchingTurns: pressed.length, observedOptOuts: declined.length - unknownOptOuts, unknownOptOuts,
      unobservedTurns: scoped.filter(row => !row.assessment).length, turns: pressed.slice(0, limit) };
  }
  if (view !== "draft-loss" && view !== "render-loss" && view !== "withheld" && view !== "native" && view !== "editable-code") throw new Error("Unknown diagnostics view.");
  const stage = view === "draft-loss" ? "draftToSelection" : "selectionToRender";
  const unique = uniqueTurns(parseOpenUiDiagnosticExport(rows));
  const matches = selectRows(unique, filter).filter(row => {
    if (view === "native") return row.nativePageRequested === true || NATIVE_PAGE_STAGES.some(key => row.nativePage?.[key] === true);
    if (view === "editable-code") return !!row.editableCode?.length;
    return view === "withheld" ? row.reply === "withheld" : openUiDiagnosticLoss(row, stage) === true;
  });
  return { schemaVersion: 1 as const, view, matchingTurns: matches.length, turns: matches.slice(0, limit) };
}
