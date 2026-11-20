import { useEffect, useRef, useState } from "react";
import { labCheckpointMatches, type UiLabNode, type UiActionReceipt, type UiLabObservation } from "@keating/learner-contracts";
import { KeatingGlyph } from "../design-system/glyphs";
import { runSystemSnippet, systemSnippetEnvironment, SYSTEM_ENVIRONMENT_LABELS } from "../keating/system-snippet";
import type { SharedUiActionEvent } from "../keating/openui/shared-renderer";
import { CodeLanguageIcon } from "./CodeLanguageIcon";
import { MidiLabInput, midiNoteName as pitch } from "./labs/MidiLabInput";
import { HardwareLabInput } from "./labs/HardwareLabInput";
import { LessonFrame } from "./lesson/LessonFrame";
import "./labs/teaching-lab.css";

interface TeachingLabProps {
  node: UiLabNode;
  disabled?: boolean;
  receipts?: readonly UiActionReceipt[];
  documentId?: string;
  documentRevision?: number;
  onAction?: (event: SharedUiActionEvent) => boolean;
}

export function TeachingLab(props: TeachingLabProps) {
  return <Practice key={JSON.stringify([props.documentId, props.node])} {...props} />;
}

function Practice({ node, disabled = false, receipts = [], onAction }: TeachingLabProps) {
  const { adapter, checkpoints } = node;
  const [source, setSource] = useState(adapter.kind === "code" ? adapter.source : "");
  const [trace, setTrace] = useState(false);
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [reading, setReading] = useState("");
  const [localMarks, setLocalMarks] = useState<string[]>([]);
  const [pending, setPending] = useState<SharedUiActionEvent | null>(null);
  const [phrase, setPhrase] = useState<number[]>([]);
  // Device messages can arrive several times before React paints the next note.
  const played = useRef<{ note: number; input: "screen" | "device" }[]>([]);
  const sent = useRef(new Set<string>());
  const controller = useRef<AbortController | null>(null);
  const marks = new Set(localMarks);
  const observed = new Set<string>();
  for (const receipt of receipts) {
    if (receipt.state === "rejected") continue;
    const action = receipt.action;
    if (action.type !== "observe-lab" || action.nodeId !== node.id) continue;
    if (action.passed) marks.add(action.checkpointId);
    observed.add(action.checkpointId + ":" + action.passed);
  }
  const checkpoint = checkpoints.find(item => !marks.has(item.id));
  const environment = adapter.kind === "code" ? systemSnippetEnvironment(adapter.language, source) : null;
  const inactive = disabled || !checkpoint || Boolean(pending);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (disabled) {
      controller.current?.abort();
      played.current = [];
      setPhrase([]);
    }
  }, [disabled]);

  function deliver(event: SharedUiActionEvent) {
    try { setPending(onAction?.(event) === false ? event : null); }
    catch { setPending(event); }
  }

  function mark(observation: UiLabObservation, evidence: string, diagnostic: string) {
    if (!checkpoint || inactive) return;
    const passed = labCheckpointMatches(node, checkpoint, observation);
    const key = checkpoint.id + ":" + passed;
    setFeedback(passed ? checkpoint.title + " — complete." : [diagnostic, checkpoint.hint].filter(Boolean).join(" "));
    if (passed) setLocalMarks(previous => previous.includes(checkpoint.id) ? previous : [...previous, checkpoint.id]);
    // One hint request and one completion per checkpoint. Every attempt still gets local feedback.
    if (!onAction || observed.has(key) || sent.current.has(key)) return;
    sent.current.add(key);
    deliver({
      intent: { type: "observe-lab", nodeId: node.id, checkpointId: checkpoint.id,
        attemptId: crypto.randomUUID(), passed, observation, evidence: evidence.slice(0, 4096) },
      humanFriendlyMessage: `${node.title} · ${checkpoint.title} · ${passed ? "checkpoint met" : "help with this attempt"}`,
    });
  }

  async function runCode() {
    if (inactive || controller.current || !environment || adapter.kind !== "code" || checkpoint?.check.kind !== "output") return;
    const abort = new AbortController();
    controller.current = abort;
    setWorking(true);
    setReading("");
    setFeedback("");
    try {
      const result = await runSystemSnippet(environment, source, abort.signal, {
        trace, ...(adapter.language === "wat" ? { exportName: adapter.exportName, args: adapter.args } : {}),
      });
      if (abort.signal.aborted) return;
      const output = [`Exit ${result.exitCode}`, result.stdout, result.stderr && `stderr\n${result.stderr}`].filter(Boolean).join("\n");
      setReading(output);
      const expected = checkpoint.check;
      const diagnostic = result.exitCode !== expected.exitCode
        ? `The program exited with ${result.exitCode}. The target was ${expected.exitCode}.`
        : "The program exited as expected. Compare its output with the checkpoint.";
      mark({ kind: "output", stdout: result.stdout.slice(0, 8194), exitCode: result.exitCode, truncated: result.stdout.length > 8194 },
        `${SYSTEM_ENVIRONMENT_LABELS[environment]}\nObserved:\n${output.slice(0, 1400)}\nExpected exit ${expected.exitCode}, stdout: ${expected.stdout.slice(0, 500)}\nSource:\n${source.slice(0, 1900)}`, diagnostic);
    } catch (error) {
      if (!abort.signal.aborted) setFeedback(error instanceof Error ? error.message : String(error));
    } finally { controller.current = null; setWorking(false); }
  }

  function noteOn(note: number, input: "device" | "screen") {
    if (inactive || adapter.kind !== "midi" || checkpoint?.check.kind !== "notes") return;
    const target = checkpoint.check.notes;
    const sequence = [...played.current, { note, input }];
    played.current = sequence;
    setPhrase(sequence.map(entry => entry.note));
    if (sequence.length < target.length) return;
    played.current = [];
    const inputs = sequence.every(entry => entry.input === "device") ? "device"
      : sequence.every(entry => entry.input === "screen") ? "screen" : "mixed";
    const origin = { device: "MIDI device", screen: "On-screen keyboard", mixed: "Mixed MIDI and on-screen input" }[inputs];
    const actual = sequence.map(entry => pitch(entry.note)).join(" ");
    const observation = `${origin}: ${actual}. Target: ${target.map(pitch).join(" ")}.`;
    setReading(observation);
    if (adapter.requireDevice && inputs !== "device") {
      setFeedback("Practice phrase recorded. Play the phrase on the connected keyboard to mark this checkpoint.");
      return;
    }
    const mismatch = sequence.findIndex((entry, i) => entry.note !== target[i]);
    const diagnostic = mismatch < 0 ? "" : `Note ${mismatch + 1} was ${pitch(sequence[mismatch].note)}. Aim for ${pitch(target[mismatch])}.`;
    mark({ kind: "notes", notes: sequence.map(entry => entry.note), input: inputs }, observation, diagnostic);
  }

  function sample(value: number, input: "device" | "manual") {
    if (inactive || adapter.kind !== "serial" || checkpoint?.check.kind !== "range" || !Number.isFinite(value)) return;
    const { min, max } = checkpoint.check;
    const observation = `${input === "device" ? "Serial port" : "Manual sample"}: ${value} ${adapter.unit}. Target: ${min}–${max} ${adapter.unit}.`;
    setReading(observation);
    if (adapter.requireDevice && input === "manual") { setFeedback("Practice reading recorded. Check a connected sensor reading to mark this checkpoint."); return; }
    const distance = value < min ? min - value : value - max;
    const diagnostic = `The reading is ${Number(distance.toPrecision(5))} ${adapter.unit} ${value < min ? "below" : "above"} the target range.`;
    mark({ kind: "range", value, input }, observation, diagnostic);
  }

  return <LessonFrame title={node.title} glyph={adapter.kind === "midi" ? "music" : adapter.kind === "serial" ? "chip" : "terminal"}
    kind="Lab" className="teaching-lab" data-teaching-lab={node.id}
    tools={<span>{marks.size} / {checkpoints.length}</span>}>
    <p>{node.brief}</p>
    <ol className="teaching-lab-checkpoints" aria-label="Lab checkpoints">
      {checkpoints.map((item, index) => <li key={item.id} data-complete={marks.has(item.id)} aria-current={checkpoint?.id === item.id ? "step" : undefined}>
        {marks.has(item.id) ? <KeatingGlyph name="check" size={15} /> : <span>{index + 1}</span>}
        {item.title}{marks.has(item.id) && <span className="lesson-sr"> — complete</span>}
      </li>)}
    </ol>
    {checkpoint && <div className="teaching-lab-target">
      {checkpoint.check.kind === "notes" ? <><strong>Play</strong> {checkpoint.check.notes.map(pitch).join(" · ")}</>
        : checkpoint.check.kind === "range" && adapter.kind === "serial" ? <><strong>Target</strong> {checkpoint.check.min}–{checkpoint.check.max} {adapter.unit}</>
        : checkpoint.check.kind === "output" ? <details><summary>Expected result</summary><pre>Exit {checkpoint.check.exitCode}{"\n"}{checkpoint.check.stdout}</pre></details> : null}
    </div>}
    {adapter.kind === "code" && <div className="teaching-lab-code">
      <label><CodeLanguageIcon language={adapter.language} />{environment ? SYSTEM_ENVIRONMENT_LABELS[environment] : adapter.language}
        <textarea aria-label={node.title + " code"} value={source} onChange={e => { setSource(e.target.value); setReading(""); setFeedback(""); }}
          readOnly={inactive || working} spellCheck={false} autoCapitalize="off" /></label>
      <div className="teaching-lab-controls">
        {environment === "linux" && <label><input type="checkbox" checked={trace} disabled={working || inactive} onChange={e => setTrace(e.target.checked)} /> Trace commands</label>}
        <button type="button" disabled={working ? false : inactive || !source.trim()} onClick={() => {
          if (working) { controller.current?.abort(); setFeedback("Run stopped."); } else void runCode();
        }}>{working ? "Stop run" : "Run and check"}</button>
      </div>
    </div>}
    {adapter.kind === "midi" && <>
      <MidiLabInput disabled={inactive} notes={checkpoint?.check.kind === "notes" ? checkpoint.check.notes : []} onNote={noteOn} />
      {phrase.length > 0 && <p aria-label="Played notes">Played · {phrase.map(pitch).join(" · ")}</p>}
    </>}
    {adapter.kind === "serial" && <HardwareLabInput disabled={inactive} baudRate={adapter.baudRate} unit={adapter.unit} onSample={sample} />}
    {reading && <pre className="teaching-lab-reading" aria-label="Observed result">{reading}</pre>}
    <div role="status">{feedback || (!checkpoint ? "All checkpoints complete." : "")}</div>
    {onAction && checkpoint && !disabled && <small className="teaching-lab-coaching">Keating receives your first miss and completion for each checkpoint.</small>}
    {pending && <button type="button" disabled={disabled} onClick={() => deliver(pending)}>Retry saving checkpoint</button>}
  </LessonFrame>;
}
