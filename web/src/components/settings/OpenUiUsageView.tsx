import { Meter, ChartTable } from "../../design-system/charts";
import { SelectField, Segmented, Button, EmptyState } from "../../design-system/kit";
import { useMemo, useState } from "react";
import { KeatingGlyph } from "../../design-system/glyphs";
import {
  NATIVE_PAGE_STAGES, OPENUI_DIAGNOSTIC_CUES, OPENUI_DIAGNOSTIC_MODES, findUnmetOpenUiCues, isOpenUiDiagnosticInterface, matchesLearnerInterface, matchesOpenUiDecisionModel, matchesOpenUiTutor, matchesSelectedLearnerAction, openUiCheckpointAfterOptOut, openUiDiagnosticLoss, queryOpenUiDiagnosticTurns, summarizeOpenUiDiagnostics,
  type OpenUiDiagnosticFilter, type OpenUiDiagnosticRate, type OpenUiDiagnosticSummary, type OpenUiDiagnosticTurn,
} from "@keating/learner-contracts";
import { downloadTextFile } from "../../lib/browser-download";
import { PairReviewDetails } from "../PairReviewDetails";

export type ObservationStage = "compiled" | "selected" | "rendered";
export const OPENUI_TURN_VIEWS = ["all", "unmet", "combined-unmet", "action-unmet", "native", "editable-code", "selection", "render", "withheld", "error", "assessment-opt-out", "pair-reviews"] as const;
export type OpenUiTurnView = typeof OPENUI_TURN_VIEWS[number];
const STAGES: Record<ObservationStage, string> = { compiled: "In a draft", selected: "In the final reply", rendered: "Shown in chat" };
const CUES = { "implicit-action": "Implicit learning cue", "explicit-interface": "Explicit interface request", "direct-text": "Direct text request", none: "No detected cue", unknown: "Unknown cue" };
const MODES = { guided: "Decision-guided", baseline: "Baseline", "offer-only": "Offer only", unknown: "Unknown guidance" };
const STAGE_NOTES = {
  compiled: "A learner turn counts once if any observed tutor draft contained a valid interface.",
  selected: "Counts learner turns with a known selection outcome, including turns when no reply was released.",
  rendered: "Counts learner turns with a known chat presentation outcome, including turns that ended with a withholding notice.",
};
const percent = (rate: number | null) => rate === null ? "—" : Math.round(rate * 100) + "%";
const fraction = (r: OpenUiDiagnosticRate) => r.denominator ? r.numerator + " / " + r.denominator : "—";
const types = (kinds: string[] | null) => kinds === null ? "Unobserved" : kinds.length ? kinds.join(", ") : "None";
const NATIVE_LABELS = { succeeded: "Tool returned a valid page", failed: "Tool rejected or failed", attached: "Attached to conversation",
  saved: "Saved in transcript", mounted: "Preview card mounted", ready: "Sandbox ready", visible: "Ready frame in viewport", opened: "Opened full screen", frameFailed: "Preview failed" };
const CHECKPOINTS = { "simulation-brief": "Simulation instructions", "question-interface": "Question or quiz interface", "reply-text": "Reply text" };
const measured = (v: boolean | null | undefined) => v == null ? "Unobserved" : v ? "Yes" : "No";
const elapsed = (ms: number) => ms < 1000 ? ms + " ms" : Math.round(ms / 10) / 100 + " s";
const STAGE_METRICS = {
  compiled: ["opportunityCompiled", "directTextCompiled"],
  selected: ["opportunitySelected", "directTextSelected"],
  rendered: ["opportunityRendered", "directTextRendered"],
} as const;

function Metric({ title, value }: { title: string; value: OpenUiDiagnosticRate }) {
  return <div className="ou-metric"><dt>{title}</dt><dd>{percent(value.rate)}</dd>
    <dd className="ou-count">{value.denominator ? fraction(value) + " observed" : "No measured turns"}{value.unknown > 0 && ` · ${value.unknown} unknown`}</dd>
  </div>;
}

function ReplyDelays({ summary, stage }: {summary: OpenUiDiagnosticSummary; stage: ObservationStage}) {
  const endpoint = stage === "rendered" ? "rendered" : "selected";
  const data = summary.delays[endpoint];
  const time = summary.overall.replyElapsedMs;
  const eligible = time.observed + time.unknown;
  const cues = summary.byCue.filter(group => group.key === "implicit-action" || group.key === "explicit-interface")
    .map(group => ({ name: group.key === "implicit-action" ? "Implicit" : "Explicit", delay: group.metrics.delays[endpoint] }))
    .filter(group => group.delay.opportunities > 0);
  return <section className="ou-section">
    <h4>Replies until a matching interface</h4>
    {stage === "compiled" ? <p>Choose a final reply or chat presentation to count replies until delivery.</p>
      : !data.opportunities ? <p>No explicit requests or implicit learning cues in this selection.</p>
      : <>
        <p>{data.opportunities} cues · {data.firstResponse} matched on the first reply · {data.later} matched later</p>
        {cues.length === 1 && <p className="ou-muted">{cues[0]!.name === "Implicit" ? "All these cues were inferred from the learner’s requested action." : "Each learner named an interface in their request."}</p>}
        {cues.length > 1 && <div className="ou-pair"><table aria-label="Reply delay by learner cue"><thead><tr>
          <th scope="col">Learner cue</th><th scope="col">Cues</th><th scope="col">First reply</th><th scope="col">Later</th><th scope="col">Unresolved</th>
        </tr></thead><tbody>{cues.map(({name, delay}) => <tr key={name}><th scope="row">{name}</th><td>{delay.opportunities}</td>
          <td>{delay.firstResponse}</td><td>{delay.later}</td><td>{delay.unresolved}</td></tr>)}</tbody></table></div>}
        {data.byResponse.length > 0 && <ul className="ou-bars" aria-label="Distribution by reply number">
          {data.byResponse.map(b => <li key={b.responseNumber}><span>Reply {b.responseNumber}</span>
            <Meter label={`Reply ${b.responseNumber}`} value={b.count} max={data.opportunities} valueText={`${b.count} of ${data.opportunities} cues`}/></li>)}
        </ul>}
        {data.byResponse.length > 3 && <ChartTable caption="Distribution by reply number" columns={["Reply", "Matched", "Cues"]} rows={data.byResponse.map(b => [b.responseNumber, b.count, data.opportunities])}/>}
        <p className="ou-muted">{data.unresolved} still waiting · {data.superseded} superseded by another cue · {data.unknown} unknown · {data.reminders} reminders</p>
      </>}
    {eligible > 0 && <>
      <h4>Time to reply or withholding</h4>
      {time.median !== null && time.p90 !== null ? <>
        <p>Median {elapsed(time.median)} · 90th percentile {elapsed(time.p90)}</p>
        <p className="ou-muted">The browser timed {time.observed} of {eligible} released or withheld {eligible === 1 ? "turn" : "turns"}, from the start of the current attempt to its completed public message.</p>
      </> : <p>Timing unavailable for {time.unknown} released or withheld {time.unknown === 1 ? "turn" : "turns"}.</p>}
    </>}
  </section>;
}

function PairedResults({ comparisons, stage }: { comparisons: OpenUiDiagnosticSummary["comparisons"]; stage: ObservationStage }) {
  return <section className="ou-section">
    <h4>Does decision guidance help on the same case?</h4>
    {!comparisons.length ? <p>Choose the paired benchmark or import a trace with matched guided and comparison runs.</p> : <>
      <p>Compare the same tutor, case and repetition. Cue fit rewards a matching interface, or a plain answer when requested.</p>
      {comparisons.map(c => <div className="ou-pair" key={JSON.stringify([c.experimentId, c.model, c.decisionModel, c.control])}>
        <strong>{c.model} · {c.decisionModel ?? "Decision version unrecorded"}</strong>
        <table><caption className="ou-visually-hidden">{c.model} matched comparison with {c.decisionModel ?? "unrecorded decision version"}</caption>
          <thead><tr><th>Measure</th><th>Guided</th><th>{MODES[c.control]}</th><th>Pairs</th><th>Unknown</th></tr></thead>
          <tbody>{([["Cue fit", c[stage]], ["Teaching assessment", c.fit]] as const).map(([label, d]) =>
            <tr key={label}><th scope="row">{label}</th><td>{percent(d.guidedRate)}</td><td>{percent(d.controlRate)}</td><td>{d.pairs}</td><td>{d.unknown}</td></tr>)}</tbody>
        </table>
        <p className="ou-muted">Cue fit improved on {c[stage].guidedOnly} pairs and declined on {c[stage].controlOnly}. {c.unpaired + c.ambiguous} unmatched or ambiguous. {c.ineligibleGuidance} had unconfirmed guidance or a guided baseline.</p>
      </div>)}
    </>}
  </section>;
}

function describeUnmetCue(row: OpenUiDiagnosticTurn) {
  const expected = row.cue.targets.includes("any") ? "any interface" : row.cue.targets.join(" or ");
  const selected = types(row.selected?.filter(isOpenUiDiagnosticInterface) ?? null).toLowerCase();
  const native = row.nativePage?.attached ? (row.cue.targets.includes("any") ? "native page fulfilled generic request" : "native page attached, type unassessed")
    : row.nativePage?.failed ? "native page failed" : row.nativePageRequested ? "native page requested" : null;
  return `Expected ${expected} · selected ${selected}${native ? " · " + native : ""}`;
}

function NativeDelivery({ summary, stage }: { summary: OpenUiDiagnosticSummary; stage: ObservationStage }) {
  const metrics = summary.overall;
  const endpoint = stage === "rendered" ? "rendered" : "selected";
  const combined = metrics.learnerInterfaces[endpoint];
  const delays = metrics.delays[endpoint === "rendered" ? "combinedRendered" : "combinedSelected"];
  return <details className="ou-drill"><summary>Native pages and combined delivery</summary>
    <p>{endpoint === "rendered" ? "Chat component or ready native preview" : "Selected component or attached native page"} · {fraction(combined.any)} measured turns · {combined.any.unknown} unknown.</p>
    {combined.any.numerator > 0 && <p className="ou-muted">OpenUI only {combined.fencedOnly} · native only {combined.nativeOnly} · both {combined.both} · other source unobserved {combined.otherSourceUnknown}.</p>}
    <div className="ou-pair"><table><caption className="ou-visually-hidden">Native page stages per turn</caption>
      <thead><tr><th>Native page stage</th><th>Yes / observed</th><th>Unknown</th></tr></thead><tbody>
        <tr><th scope="row">Public tool request</th><td>{fraction(metrics.nativePageRequested)}</td><td>{metrics.nativePageRequested.unknown}</td></tr>
        {NATIVE_PAGE_STAGES.map(key => <tr key={key}><th scope="row">{NATIVE_LABELS[key]}</th><td>{fraction(metrics.nativePage[key])}</td><td>{metrics.nativePage[key].unknown}</td></tr>)}
      </tbody></table></div>
    <p className="ou-muted">Viewport exposure requires a ready frame intersecting a foreground tab. Opening full screen is a separate action.</p>
    {delays.opportunities > 0 && <p>Across both sources, {delays.firstResponse} cues matched on the first reply, {delays.later} later, {delays.unresolved} are still waiting, {delays.superseded} were superseded and {delays.unknown} are unknown. Native pages can fulfill a request for any interface. Their component family is unassessed.</p>}
  </details>;
}

function AssessmentOptOuts({ data }: { data: NonNullable<OpenUiDiagnosticSummary["assessmentOptOut"]> }) {
  const pressed = data.checkpointAfterOptOut;
  return <details className="ou-drill"><summary>Assessment opt-outs <b>{data.optOuts}</b></summary>
    {data.optOuts === 0 ? <p>No learner in this selection explicitly declined a quiz, test or prediction.</p> : <>
      <dl className="ou-metrics"><Metric title="Checkpoint signal after an opt-out" value={pressed} /></dl>
      <ul>{data.signals.map(({signal, turns}) => <li key={signal}>{CHECKPOINTS[signal]} · {turns}</li>)}</ul>
      {data.notReleased > 0 && <p className="ou-muted">{data.notReleased} opted-out {data.notReleased === 1 ? "turn has" : "turns have"} no released reply to inspect.</p>}
    </>}
    {data.checkpointWithoutOptOut.denominator > 0 && <p className="ou-muted">For comparison, {fraction(data.checkpointWithoutOptOut)} released replies without an opt-out carried a signal. That is ordinary teaching.</p>}
    <p className="ou-muted">Read from {data.observedTurns} {data.observedTurns === 1 ? "turn" : "turns"} with readable learner words · {data.unobservedTurns} unobserved. The opt-out rule recognises explicit English wording only. A signal marks an instruction to predict or answer, or a question interface. A reply with no signal can still be a poor fit, and the learner’s intent is never inferred.</p>
  </details>;
}

function describeUnmetCoverage({ matchingTurns, observedOpportunities, unknownOpportunities }: ReturnType<typeof findUnmetOpenUiCues>) {
  if (observedOpportunities > 0) {
    return `${matchingTurns} missed on this turn out of ${observedOpportunities} with observed selection · ${unknownOpportunities} with unknown selection.`;
  }
  if (unknownOpportunities > 0) return `No observed selections. Unknown selection for ${unknownOpportunities} cued ${unknownOpportunities === 1 ? "turn" : "turns"}.`;
  return "No implicit learning cues or explicit interface requests in this selection.";
}

function TurnDetails({ row, unmet }: {row: OpenUiDiagnosticTurn; unmet: boolean}) {
  const lost = openUiDiagnosticLoss(row, "draftToSelection") === true;
  const outcome = lost ? <>{types(row.compiled)} <KeatingGlyph name="right" /> no interface</> : CUES[row.cue.kind];
  return <details className="ou-turn"><summary>
    <span>{row.experiment?.caseId ?? `Turn ${row.turnIndex + 1}`}</span>
    <span>{row.model ?? (row.requestedModel ? "Requested " + row.requestedModel : "Unknown tutor")}</span>
    <span>{row.decisionFailure ? "Decision planning failed" : unmet ? describeUnmetCue(row) : outcome}</span><span>{row.reply}</span>
  </summary><dl>
    <dt>Observed tutor</dt><dd>{row.model ?? "Unknown"}</dd>
    {row.requestedModel && row.requestedModel !== row.model && <><dt>Requested tutor</dt><dd>{row.requestedModel}</dd></>}
    <dt>Guidance</dt><dd>{MODES[row.mode]}{row.decisionModel && " · " + row.decisionModel}</dd>
    {row.decisionFailure && <><dt>Planning failure</dt><dd>{row.decisionFailure.reason}{row.decisionFailure.detail && " · " + row.decisionFailure.detail}</dd>
      {row.decisionFailure.configuredModel && <><dt>Configured decision model</dt><dd>{row.decisionFailure.configuredModel}</dd></>}</>}
    {unmet && <><dt>Learner cue</dt><dd>{CUES[row.cue.kind]}</dd></>}
    <dt>Expected types</dt><dd>{types(row.cue.targets)}</dd>
    {row.cue.codeLanguage && <><dt>Requested code language</dt><dd>{row.cue.codeLanguage}</dd></>}
    <dt>Offered types</dt><dd>{row.guidance ? types(row.guidance.targets) : "Unobserved"}</dd>
    {row.guidance && <><dt>Guidance delivered</dt><dd>{row.guidance.delivered === null ? "Unobserved" : row.guidance.delivered ? "Yes" : "No"}</dd></>}
    {row.guidance?.reason && <><dt>Decision reason</dt><dd>{row.guidance.reason}</dd></>}
    {row.guidance?.codeLanguage && <><dt>Offered code language</dt><dd>{row.guidance.codeLanguage}</dd></>}
    <dt>Private drafts</dt><dd>{row.draftAttempts ?? "Unobserved"}</dd>
    {row.earlierPairReviewRounds?.map(round => <div key={round.round} style={{ display: "contents" }}>
      <dt>Jev pair reviews · round {round.round}</dt><dd>
        {round.model && <p>Tutor · {round.model}</p>}
        <PairReviewDetails reviews={round.pairReviews} finalComparison={round.finalComparison} />
        {round.releasedAttempt !== undefined && <p>Released draft · {round.releasedAttempt}</p>}
      </dd>
    </div>)}
    {row.pairReviews && <><dt>{row.earlierPairReviewRounds?.length ? "Jev pair reviews · final round" : "Jev pair reviews"}</dt><dd><PairReviewDetails reviews={row.pairReviews} finalComparison={row.finalComparison} /></dd></>}
    <dt>Released draft</dt><dd>{row.selection
      ? `Attempt ${row.selection.attempt} · ${row.selection.review === "verified" ? "Passed review" : "Best effort, unverified"}`
      : row.reply === "withheld" ? "None · reply withheld" : "Unobserved"}</dd>
    {row.selection && <><dt>Prediction selection rule</dt><dd>{row.selection.rule === "requested-prediction-over-prose"
      ? "The requested answer field took precedence over a prose question."
      : row.selection.rule === "presentation-only-checkpoint-retained" ? "The answer field was retained after a presentation-only review finding."
      : row.selection.rule === "none" ? "Neither prediction rule applied." : "Unobserved"}</dd></>}
    <dt>Compiled</dt><dd>{types(row.compiled)}</dd>
    <dt>Selected</dt><dd>{types(row.selected)}</dd>
    <dt>Rendered</dt><dd>{types(row.rendered)}</dd>
    {(row.editableCode != null || row.cue.targets.includes("editable-code")) && <><dt>Editable code in final reply</dt><dd>{types(row.editableCode ?? null)}</dd></>}
    {row.selected?.includes("coding-challenge") && <><dt>Coding challenge language</dt><dd>{types(row.codingChallengeLanguages ?? null)}</dd></>}
    {!!row.editableCode?.length && <><dt>Words around editable code</dt><dd>{row.editorOutsideWords ?? "Unobserved"}</dd></>}
    {(row.cue.codeLanguage || row.cue.targets.includes("editable-code")) && <><dt>Matched learner action</dt><dd>{measured(matchesSelectedLearnerAction(row))}</dd></>}
    {row.nativePageRequested != null && <><dt>Native page requested</dt><dd>{row.nativePageRequested ? "Yes" : "No"}</dd></>}
    {(row.nativePageRequested || row.nativePage?.attached) && NATIVE_PAGE_STAGES.map(key => <div key={key} style={{display:"contents"}}><dt>{NATIVE_LABELS[key]}</dt><dd>{measured(row.nativePage?.[key])}</dd></div>)}
    {row.outsideWords != null && <><dt>{row.editableCode?.length ? "Words outside OpenUI, including code" : "Words outside OpenUI"}</dt><dd>{row.outsideWords}</dd></>}
    {(row.reply === "released" || row.reply === "withheld") && <><dt>Time to reply or withholding</dt>
      <dd>{row.replyElapsedMs == null ? "Unobserved" : elapsed(row.replyElapsedMs)}</dd></>}
    {row.assessment && <><dt>Learner declined assessment</dt><dd>{row.assessment.optOut ? "Yes, explicitly" : "No explicit opt-out recognised"}</dd>
      <dt>Checkpoint signals in reply</dt><dd>{row.assessment.checkpoints === null ? "Unobserved" : row.assessment.checkpoints.length
        ? row.assessment.checkpoints.map(signal => CHECKPOINTS[signal]).join(", ") : "None"}</dd></>}
    {row.gateIssues && <><dt>Review issues across all drafts</dt><dd>{row.gateIssues.length ? row.gateIssues.map(issue => {
      if (issue === "question_feedback_format") return "The feedback draft lacked a standalone text reply (" + issue + ")";
      if (issue === "prediction_question_format") return "The prediction draft lacked one standalone Question without hints or an answer key (" + issue + ")";
      if (issue === "submitted_grade_scope") return "The grading draft exceeded the scope of the saved answer (" + issue + ")";
      return issue;
    }).join(", ") : row.decisionFailure && row.draftAttempts === 0 ? "No draft was available to review" : "None"}</dd></>}
    {row.fit && <><dt>Assessment</dt><dd>{row.fit.passed === null ? "Unknown" : row.fit.passed ? "Passed" : "Failed"} · {row.fit.source}</dd></>}
    <dt>Conversation</dt><dd><code>{row.conversationId}</code></dd><dt>Turn ID</dt><dd><code>{row.turnId}</code></dd>
  </dl></details>;
}

export function OpenUiUsageView({ turns, initialStage = "rendered", initialView, initialCue }: {
  turns: readonly OpenUiDiagnosticTurn[];
  initialStage?: ObservationStage;
  initialView?: OpenUiTurnView;
  initialCue?: OpenUiDiagnosticTurn["cue"]["kind"];
}) {
  const [stage, setStage] = useState<ObservationStage>(initialStage);
  const [filter, setFilter] = useState<OpenUiDiagnosticFilter>(() => initialCue ? {cue: initialCue} : {});
  const [limit, setLimit] = useState(10);
  const [loss, setLoss] = useState<OpenUiTurnView>(initialView ?? "all");
  const summary = useMemo(() => summarizeOpenUiDiagnostics(turns, filter), [turns, filter]);
  const models = useMemo(() => [...new Set(turns.flatMap(r => [r.model, r.requestedModel]).filter((m): m is string => Boolean(m)))].sort(), [turns]);
  const decisionModels = useMemo(() => [...new Set(turns.flatMap(r => [r.decisionModel ?? "unknown",
    ...(r.decisionFailure?.configuredModel ? [r.decisionFailure.configuredModel] : [])]))].sort(), [turns]);
  const visible = useMemo(() => {
    const seen = new Set<string>();
    return turns.filter(r => {
      const key = JSON.stringify([r.conversationId, r.turnId]);
      if (seen.has(key)) return false;
      seen.add(key);
      return matchesOpenUiTutor(r, filter.model) && matchesOpenUiDecisionModel(r, filter.decisionModel)
        && (!filter.mode || r.mode === filter.mode) && (!filter.cue || r.cue.kind === filter.cue);
    }).slice().reverse();
  }, [turns, filter]);
  function changeFilter(update: Partial<OpenUiDiagnosticFilter>) {
    setFilter(previous => ({...previous, ...update}));
    setLimit(10);
  }
  const [opportunity, overuse] = STAGE_METRICS[stage];
  const componentRates = summary.components.filter(c => isOpenUiDiagnosticInterface(c.key) && c[stage].numerator)
    .sort((a, b) => b[stage].numerator - a[stage].numerator);
  const unmet = useMemo(() => loss === "unmet" ? findUnmetOpenUiCues(turns, filter) : null, [loss, turns, filter]);
  const pairs = useMemo(() => {
    if (loss !== "pair-reviews") return null;
    const result = queryOpenUiDiagnosticTurns(turns, { ...filter, view: loss, limit: 1 });
    return "comparedPairs" in result ? result : null;
  }, [loss, turns, filter]);
  const drillRows = unmet?.turns ?? (loss === "all" ? visible : visible.filter(row => {
    if (loss === "native") return row.nativePageRequested === true || NATIVE_PAGE_STAGES.some(key => row.nativePage?.[key] === true);
    if (loss === "pair-reviews") return row.pairReviews !== undefined || Boolean(row.earlierPairReviewRounds?.length);
    if (loss === "editable-code") return !!row.editableCode?.length;
    if (loss === "assessment-opt-out") return openUiCheckpointAfterOptOut(row) === true;
    if (loss === "combined-unmet" || loss === "action-unmet") return (row.cue.kind === "explicit-interface" || row.cue.kind === "implicit-action")
      && (loss === "action-unmet" ? matchesSelectedLearnerAction(row) : matchesLearnerInterface(row, "selected", row.cue.targets)) === false;
    if (loss === "withheld" || loss === "error") return row.reply === loss;
    return openUiDiagnosticLoss(row, loss === "selection" ? "draftToSelection" : "selectionToRender") === true;
  }));
  return <div className="ou-view">
    <div className="ou-filters">
      <SelectField label="Tutor" value={filter.model ?? ""} onValueChange={value => changeFilter({model: value || undefined})}><option value="">All tutors</option>
        {models.map(m => <option key={m}>{m}</option>)}</SelectField>
      {decisionModels.length > 1 && <SelectField label="Decision model" value={filter.decisionModel ?? ""} onValueChange={value => changeFilter({decisionModel: value || undefined})}>
        <option value="">All decision models</option>{decisionModels.map(id => <option key={id} value={id}>{id === "unknown" ? "Unrecorded" : id}</option>)}</SelectField>}
      <SelectField label="Learner cue" value={filter.cue ?? ""} onValueChange={value => changeFilter({cue: value as OpenUiDiagnosticFilter["cue"] || undefined})}><option value="">All cues</option>
        {OPENUI_DIAGNOSTIC_CUES.map(k => <option value={k} key={k}>{CUES[k]}</option>)}</SelectField>
      <SelectField label="Decision mode" value={filter.mode ?? ""} onValueChange={value => changeFilter({mode: value as OpenUiDiagnosticFilter["mode"] || undefined})}><option value="">All guidance</option>
        {OPENUI_DIAGNOSTIC_MODES.map(k => <option value={k} key={k}>{MODES[k]}</option>)}</SelectField>
    </div>
    {summary.decisionPlanningFailures && <p className="ou-muted">Recorded decision planning failures · {summary.decisionPlanningFailures.turns}</p>}
    <Segmented<ObservationStage> className="ou-stages" label="Observation stage" value={stage} onChange={setStage}
      options={(Object.keys(STAGES) as ObservationStage[]).map(value => ({value, label: STAGES[value]}))}/>
    <p className="ou-muted">{STAGE_NOTES[stage]} {summary.coverage.includedTurns} {summary.coverage.includedTurns === 1 ? "turn" : "turns"} in scope.</p>
    <dl className="ou-metrics">
      <Metric title="Learner turns with OpenUI" value={summary.overall[stage]} />
      <Metric title="Matched the cued component type" value={summary.overall[opportunity]} />
      <Metric title="UI on a text-only request" value={summary.overall[overuse]} />
    </dl>
    {stage === "compiled" && <p className="ou-muted">{summary.overall.attempted.denominator
      ? <>The tutor attempted OpenUI on <strong>{fraction(summary.overall.attempted)}</strong> learner turns with measured draft content.</>
      : "No tutor draft content was measured."}
      {summary.overall.attempted.unknown > 0 && ` Authoring attempts unobserved on ${summary.overall.attempted.unknown} ${summary.overall.attempted.unknown === 1 ? "turn" : "turns"}.`}</p>}
    {summary.overall.fit.denominator > 0 && <p className="ou-muted">Passed the recorded assessment · {fraction(summary.overall.fit)} scored turns{summary.overall.fit.unknown > 0 && ` · ${summary.overall.fit.unknown} unscored`}</p>}
    {summary.overall.proseBesideInterface.observed > 0 ? <p className="ou-muted">
      Words outside the interface in final replies · median {summary.overall.proseBesideInterface.median},
      90th percentile {summary.overall.proseBesideInterface.p90} across {summary.overall.proseBesideInterface.observed} measured replies.
      {summary.overall.proseBesideInterface.unknown > 0 && ` Another ${summary.overall.proseBesideInterface.unknown} have no recorded word count.`}
    </p> : summary.overall.proseBesideInterface.unknown > 0 && <p className="ou-muted">
      Outside word count unavailable for {summary.overall.proseBesideInterface.unknown} final replies with an interface.
    </p>}
    {summary.byModel.length > 1 && <section className="ou-section ou-pair"><h4>By tutor</h4>
      <table><thead><tr><th>Tutor</th><th>Turns with OpenUI</th><th>Matched cue</th><th>Unobserved</th></tr></thead>
        <tbody>{summary.byModel.map(({key, metrics}) => <tr key={key}><th scope="row">{key}</th>
          <td>{fraction(metrics[stage])}</td><td>{fraction(metrics[opportunity])}</td><td>{metrics[stage].unknown}</td></tr>)}</tbody>
      </table>
    </section>}
    <section className="ou-section"><h4>Component types</h4>
      {componentRates.length ? <ul className="ou-bars" aria-label="Turns containing a component">
        {componentRates.map(c => <li key={c.key}><span>{c.key}</span>{c[stage].denominator ? <Meter label={c.key} value={c[stage].numerator} max={c[stage].denominator} valueText={fraction(c[stage]) + " observed turns"}/> : <span>Unobserved</span>}</li>)}
      </ul> : <EmptyState heading={summary.overall[stage].denominator ? "No components recorded at this stage." : "No observations at this stage."}/>}
      {componentRates.length > 3 && <ChartTable caption="Turns containing a component" columns={["Component", "Turns / observed"]} rows={componentRates.map(c => [c.key, fraction(c[stage])])}/>}
      <p className="ou-muted">Offered type present at this stage · {fraction(summary.overall.offeredType[stage])}</p>
      {summary.overall.nativePageRequested.denominator > 0 && <p className="ou-muted">
        Native interactive page requested · {fraction(summary.overall.nativePageRequested)} observed turns
        {summary.overall.nativePageRequested.unknown > 0 && ` · ${summary.overall.nativePageRequested.unknown} unknown`}.
      </p>}
    </section>
    <NativeDelivery summary={summary} stage={stage} />
    <details className="ou-drill"><summary>Editable code in final replies</summary>
      <dl className="ou-metrics"><Metric title="Replies with an editable code block" value={summary.overall.editableCode.any} />
        <Metric title="Matched learner action in the selected reply" value={summary.overall.learnerActionSelected} /></dl>
      {summary.overall.editableCode.any.denominator > 0 && <ul>{summary.overall.editableCode.languages.map(({language,selected}) =>
        <li key={language}>{language} · {fraction(selected)} measured replies</li>)}</ul>}
      {summary.overall.editableCode.any.numerator > 0 && <p className="ou-muted">Words around editable code · median {summary.overall.editableCode.outsideWords.median ?? "unobserved"} · {summary.overall.editableCode.outsideWords.observed} measured editor replies · {summary.overall.editableCode.outsideWords.unknown} unknown.</p>}
      {summary.overall.offeredCodeLanguageSelected.denominator > 0 && <p>Used the offered code language · {fraction(summary.overall.offeredCodeLanguageSelected)}</p>}
      <p className="ou-muted">The count covers complete Python, JavaScript and TypeScript fences in the selected reply. Opening the editor and running code require separate observations.</p>
    </details>
    {summary.assessmentOptOut && <AssessmentOptOuts data={summary.assessmentOptOut} />}
    {summary.overall.losses.draftToSelection.denominator > 0 && <p>
      <strong>{fraction(summary.overall.losses.draftToSelection)}</strong> turns with a valid draft lost the interface before selection.
    </p>}
    {summary.overall.losses.selectionToRender.denominator > 0 && <p>
      <strong>{fraction(summary.overall.losses.selectionToRender)}</strong> selected interfaces were absent at observed presentation.
    </p>}
    <ReplyDelays summary={summary} stage={stage} />
    <PairedResults comparisons={summary.comparisons} stage={stage} />
    <details className="ou-drill" open={initialView && initialView !== "all" || undefined}><summary>Inspect turns <b>{visible.length}</b></summary>
      <SelectField label="Show turns" value={loss} onValueChange={value => { setLoss(value as typeof loss); setLimit(10); }}>
        <option value="all">All matching turns</option>
        <option value="unmet">Missed learner cue</option>
        <option value="combined-unmet">Missed cue across both interface sources</option>
        <option value="native">Native page activity</option>
        <option value="editable-code">Final reply with editable code</option>
        <option value="action-unmet">Missed learner action</option>
        <option value="withheld">Reply withheld</option>
        <option value="error">Reply ended with an error</option>
        <option value="pair-reviews">Jev pair reviews</option>
        <option value="assessment-opt-out">Checkpoint after an assessment opt-out</option>
        <option value="selection">Interface compiled, then dropped</option>
        <option value="render">Interface selected, then missing at presentation</option>
      </SelectField>
      {unmet ? <p className="ou-muted">{describeUnmetCoverage(unmet)}
        {unmet.matchingTurns > 0 && " Later matches appear under “Replies until a matching interface”."}</p>
        : loss === "action-unmet" ? <p className="ou-muted">{drillRows.length} missed on this turn out of {summary.overall.learnerActionSelected.denominator} with a known outcome · {summary.overall.learnerActionSelected.unknown} unknown.</p>
        : pairs ? <div className="ou-muted" aria-label="Pair review coverage">
          <p>Compared pairs · {pairs.comparedPairs}. Concurrent reviews · {pairs.turnsWithConcurrentReviews} of {pairs.turnsWithMeasuredOverlap} timed turns.</p>
          {pairs.roundsWithPairRecords !== undefined && pairs.roundsWithPairRecords > pairs.matchingTurns && <p>{pairs.roundsWithPairRecords} recorded tutor rounds across {pairs.matchingTurns} learner turns.</p>}
          {Boolean(pairs.incompletePairs || pairs.unavailablePairs || pairs.unrecordedPairs || pairs.turnsWithoutPairRecords) &&
            <p>{[
              pairs.incompletePairs && `Incomplete pairs · ${pairs.incompletePairs}`,
              pairs.unavailablePairs && `Unavailable comparisons · ${pairs.unavailablePairs}`,
              pairs.unrecordedPairs && `Missing pair results · ${pairs.unrecordedPairs}`,
              pairs.turnsWithoutPairRecords && `Turns without pair records · ${pairs.turnsWithoutPairRecords}`,
            ].filter(Boolean).join(". ")}.</p>}
        </div> : <p className="ou-muted">{drillRows.length} matching {drillRows.length === 1 ? "turn" : "turns"}</p>}
      {drillRows.slice(0, limit).map(r => <TurnDetails key={JSON.stringify([r.conversationId, r.turnId])} row={r} unmet={unmet !== null} />)}
      {limit < drillRows.length && <Button variant="ghost" onClick={() => setLimit(n => n + 25)}>Show more turns</Button>}
    </details>
    <Button variant="ghost" className="ou-save" onClick={() => downloadTextFile("keating-openui-summary.json", JSON.stringify({filter, ...summary}, null, 2))}>Download filtered summary</Button>
  </div>;
}
