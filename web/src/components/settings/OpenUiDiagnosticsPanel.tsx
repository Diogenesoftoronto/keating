import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import {
  OPENUI_DIAGNOSTIC_CUES, parseOpenUiDiagnosticExport, summarizeOpenUiDiagnostics, type OpenUiDiagnosticTurn,
} from "@keating/learner-contracts";
import { getOpenUIDiagnosticTurns, subscribeOpenUIDiagnosticTurns } from "../../keating/openui/turn-diagnostics";
import { downloadTextFile } from "../../lib/browser-download";
import { hostedNavigationHref, TEACHING_INTERFACES_REPORT_PATH } from "../../lib/hosted-navigation";
import { OPENUI_TURN_VIEWS, OpenUiUsageView, type ObservationStage, type OpenUiTurnView } from "./OpenUiUsageView";
import "./openui-diagnostics.css";

const recordings = {
  review: { label: "Final review · selected tutor replies", stage: "selected", load: () => import("../../keating/openui/examples/final-review.json") },
  "assessment-opt-out": { label: "When the learner declined a quiz", stage: "selected", load: () => import("../../keating/openui/examples/assessment-opt-out.json") },
  "review-first": { label: "Final review · original drafts with two decision models", stage: "compiled", load: () => import("../../keating/openui/examples/final-review-first.json") },
  audit: { label: "Recorded tutor audit", stage: "selected", load: () => import("../../keating/openui/examples/november-audit.json") },
  holdout: { label: "Revised policy check", stage: "selected", load: () => import("../../keating/openui/examples/policy-holdout.json") },
  decisions: { label: "Jev and Gemini Decision 1", stage: "selected", load: () => import("../../keating/openui/examples/decision-models.json") },
  revised: { label: "Hands-on and direct replies · policy 2.2", stage: "selected", load: () => import("../../keating/openui/examples/policy-v2.2.json") },
  final: { label: "Sliders and Python editors · policy 2.3", stage: "selected", load: () => import("../../keating/openui/examples/policy-v2.3.json") },
  paired: { label: "Paired Jev benchmark", stage: "compiled", load: () => import("../../keating/openui/examples/paired-benchmark.json") },
  episodes: { label: "Multi-turn teaching episodes", stage: "selected", load: () => import("../../keating/openui/examples/terminal-episodes.json") },
} as const;
type RecordedSource = keyof typeof recordings;
type Source = "browser" | RecordedSource | "file";
type Recording = {
  source: RecordedSource;
  turns: OpenUiDiagnosticTurn[];
  initialView?: OpenUiTurnView;
  initialCue?: OpenUiDiagnosticTurn["cue"]["kind"];
};
const EMPTY: OpenUiDiagnosticTurn[] = [];

export async function loadOpenUiRecordingLink(params: URLSearchParams, fallback?: RecordedSource): Promise<Recording | null> {
  const requested = params.get("source");
  const source = requested && Object.hasOwn(recordings, requested) ? requested as RecordedSource : fallback;
  if (!source) return null;
  const name = params.get("view");
  const view = name === "draft-loss" ? "selection" : name === "render-loss" ? "render" : name;
  const data = await recordings[source].load();
  return {
    source, turns: parseOpenUiDiagnosticExport(data.default),
    initialView: OPENUI_TURN_VIEWS.find(key => key === view),
    initialCue: OPENUI_DIAGNOSTIC_CUES.find(key => key === params.get("cue")),
  };
}
const descriptions: Record<Source, string> = {
  "assessment-opt-out": "Four released simulations for a learner who asked to change the flow and declined a quiz. Inspect which replies still asked for a prediction.",
  review: "Guided replies and eligible follow-ups in the final synthetic comparison. Switch to original drafts to compare either decision model with the same unguided tutor.",
  "review-first": "The first response to each of 24 assigned tutor and prompt combinations. Includes a blind assessment and matched unguided controls. Private draft and classroom delivery are measured separately.",
  browser: "The latest 500 teaching turns on this browser. Cue labels are estimated from the learner’s wording.",
  audit: "November 18 · 20 synthetic teaching turns from Keating 4.2.0. The expected actions were labelled before generation. Browser mounts were unobserved.",
  holdout: "November 18 · New prediction, exploration and direct-answer cases for the two audit tutors under the revised policy. The expected actions were labelled before generation. Browser mounts were unobserved.",
  decisions: "November 18 · The same three learner prompts and two tutors with either Jev or Gemini Decision 1. Each decision model planned the turn and reviewed the drafts. Browser mounts were unobserved.",
  revised: "November 18 · Four MiniMax replies to a short-answer request and a hands-on exploration, with Jev or Gemini Decision. The provider run ended at selection. Local sandbox replays are available in the field guide.",
  final: "November 18 · Four scheduled turns with MiniMax as tutor. Three returned teaching material. A filling-rate simulation and two Python editors can be tried in the showcase. One tutor request timed out.",
  paired: "September 21 · Archived first drafts on matched cases with and without Jev’s guidance. The benchmark recorded a blind teaching assessment. Classroom delivery was unobserved.",
  episodes: "September 7 · Multiple learner turns from completed terminal teaching episodes. The terminal adapter recorded final components. Browser mounts were unobserved.",
  file: "Imported observations stay in this view. Exported rows contain categories and identifiers.",
};

function firstMeasuredStage(rows: readonly OpenUiDiagnosticTurn[]): ObservationStage {
  if (rows.some(row => row.rendered !== null)) return "rendered";
  if (rows.some(row => row.selected !== null)) return "selected";
  return "compiled";
}

export function OpenUiDiagnosticsPanel() {
  const local = useSyncExternalStore(subscribeOpenUIDiagnosticTurns, getOpenUIDiagnosticTurns, () => EMPTY);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [linkError, setLinkError] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.has("source")) void loadOpenUiRecordingLink(params).then(
      result => { if (current) setRecording(result); },
      () => { if (current) setLinkError(true); },
    );
    return () => { current = false; };
  }, []);
  const reportHref = hostedNavigationHref(
    TEACHING_INTERFACES_REPORT_PATH, typeof window === "undefined" ? "" : window.location.hostname,
    import.meta.env?.KEATING_WEB_BUILD_TARGET === "app",
  );
  return <>{linkError && <p role="status">The linked recording could not be loaded.</p>}
    <OpenUiDiagnosticsExplorer key={recording?.source ?? "browser"} recording={recording ?? undefined} local={local} reportHref={reportHref} /></>;
}

/** The exported showcase uses the same inspector as Settings, with its recording loaded locally. */
export function OpenUiDiagnosticsExplorer({ local, recording, reportHref }: {
  local?: readonly OpenUiDiagnosticTurn[]; recording?: Recording; reportHref?: string;
}) {
  const [source, setSource] = useState<Source>(recording?.source ?? "browser");
  const [imported, setImported] = useState<OpenUiDiagnosticTurn[] | null>(null);
  const [example, setExample] = useState<OpenUiDiagnosticTurn[]>(recording?.turns ?? EMPTY);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialStage, setInitialStage] = useState<ObservationStage>(recording ? recordings[recording.source].stage : "rendered");
  const request = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const turns = source === "browser" ? local ?? EMPTY : source === "file" ? imported ?? EMPTY : example;

  async function choose(next: Source) {
    const id = ++request.current;
    setStatus("");
    setLoading(next !== "browser" && next !== "file");
    try {
      if (next !== "browser" && next !== "file") {
        const data = await recordings[next].load();
        if (id !== request.current) return;
        setExample(parseOpenUiDiagnosticExport(data.default));
        setInitialStage(recordings[next].stage);
      } else {
        setInitialStage(next === "file" ? firstMeasuredStage(imported ?? EMPTY) : "rendered");
      }
      setSource(next);
      setVersion(v => v + 1);
    } catch {
      if (id === request.current) setStatus("The recording could not be loaded. Try selecting it again.");
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  async function importTrace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const id = ++request.current;
    setLoading(true);
    setStatus("");
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error("Use the CLI to inspect traces larger than 25 MB.");
      const rows = parseOpenUiDiagnosticExport(JSON.parse(await file.text()));
      summarizeOpenUiDiagnostics(rows); // Reject conflicting turn identities before replacing the current view.
      if (id !== request.current) return;
      setImported(rows);
      setSource("file");
      setInitialStage(firstMeasuredStage(rows));
      setVersion(v => v + 1);
      setStatus(`Imported ${rows.length} observations.`);
    } catch (e) {
      if (id === request.current) setStatus(e instanceof SyntaxError ? "The file is not valid JSON." : e instanceof Error ? e.message : "Could not read that trace.");
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  return <section className="openui-diagnostics" aria-labelledby="openui-diagnostics-heading">
    <header>
      <h3 id="openui-diagnostics-heading">Interface use</h3>
      <p>Trace a learner’s cue from the tutor’s draft to the control shown in chat.</p>
      {reportHref && <p><a href={reportHref} target="_blank" rel="noopener noreferrer">How Keating chooses a teaching interface</a></p>}
    </header>
    <div className="ou-tools">
      <label>Data source
        <select aria-label="Data source" value={source} onChange={event => void choose(event.currentTarget.value as Source)}>
          {local && <option value="browser">This browser</option>}
          {Object.entries(recordings).map(([value, entry]) => <option value={value} key={value}>{entry.label}</option>)}
          {imported && <option value="file">Imported trace</option>}
        </select>
      </label>
      <button type="button" onClick={() => input.current?.click()}>Import JSON</button>
      <input hidden ref={input} aria-label="Import diagnostic trace" type="file" accept=".json,application/json" onChange={event => void importTrace(event)} />
      <button type="button" onClick={() => downloadTextFile("keating-openui-" + source + ".json", JSON.stringify({schemaVersion: 1, turns}))}>Export trace</button>
    </div>
    <p className="ou-muted">{descriptions[source]}</p>
    {(loading || status) && <p role="status">{loading ? "Reading observations…" : status}</p>}
    {turns.length || source !== "browser"
      ? <OpenUiUsageView key={version} turns={turns} initialStage={initialStage}
          initialView={version === 0 ? recording?.initialView : undefined}
          initialCue={version === 0 ? recording?.initialCue : undefined} />
      : <div className="ou-empty"><strong>No teaching turns recorded on this browser yet.</strong>
          <p>Send a message in Chat and return here, or inspect a recorded run now.</p>
          <button type="button" onClick={() => void choose("audit")}>Open recorded audit</button>
        </div>}
    <details className="ou-machine"><summary>Query from a model or the CLI</summary>
      <p>Call <code>keating.openui_diagnostics</code> through Keating’s WebMCP connection to filter counts and inspect dropped interfaces. To query an exported trace, run</p>
      <code>keating openui-diagnostics trace.json --cue implicit-action</code>
    </details>
  </section>;
}
