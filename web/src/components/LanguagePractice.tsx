import { Loading } from "../design-system/kit";
import { LessonFrame } from "./lesson/LessonFrame";
import { useEffect, useId, useRef, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import type { UiActionReceipt, UiLanguagePracticeNode, UiLanguageRound, UiLanguageRoundResult } from "@keating/learner-contracts";
import type { GlyphName } from "../design-system/glyphs";
import type { SharedUiActionEvent } from "../keating/openui/shared-renderer";
import { formatQuizDuration } from "./quiz/game";
import { checkLanguageAnswer, languageCompletion, languageReferenceAnswer, type LanguageCompletion } from "./language/game";
import { playLanguageReference } from "./language/speech";
import { usePronunciationRecording } from "./language/usePronunciationRecording";
import "./language/language-practice.css";

export interface LanguagePracticeProps {
  node: UiLanguagePracticeNode;
  receipt?: UiActionReceipt;
  disabled?: boolean;
  onAction?: (event: SharedUiActionEvent) => boolean;
}

export function LanguagePractice(props: LanguagePracticeProps) {
  return <LanguageRun key={JSON.stringify(props.node)} {...props} />;
}

function LanguageRun({ node, receipt, disabled = false, onAction }: LanguagePracticeProps) {
  const [index, setIndex] = useState(0);
  const [rounds, setRounds] = useState<UiLanguageRoundResult[]>([]);
  const [pending, setPending] = useState<LanguageCompletion>();
  const [delivered, setDelivered] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(Date.now());
  const entered = useRef(started.current);
  const heading = useRef<HTMLSpanElement>(null);
  const saved = receipt?.state === "completed" && receipt.action.type === "complete-language-practice" ? receipt.action : undefined;
  const terminal = Boolean(saved || delivered);
  const completion = saved ?? pending;
  const current = node.rounds[index];

  useEffect(() => {
    if (!delivered) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start" });
  }, [delivered]);

  const deliver = (intent: LanguageCompletion) => {
    if (disabled || terminal) return;
    setPending(intent);
    setError("");
    try {
      if (onAction?.({ intent, humanFriendlyMessage: `Finished ${node.title}: ${intent.correct}/${intent.objectiveTotal} language answers correct; ${intent.pronunciationPracticed} pronunciation rounds practiced. ${formatQuizDuration(intent.totalMs)} total.` }) === true) setDelivered(true);
      else setError("Your practice is ready. Retry saving it.");
    } catch { setError("Your practice is ready. Retry saving it."); }
  };
  const finishRound = (result: Omit<UiLanguageRoundResult, "timeMs">) => {
    if (disabled || pending || terminal) return;
    const at = Date.now();
    const next = [...rounds, { ...result, timeMs: Math.max(0, at - entered.current) }];
    setRounds(next);
    if (index + 1 === node.rounds.length) deliver(languageCompletion(node, next, Math.max(0, at - started.current)));
    else { entered.current = at; setIndex(index + 1); }
  };

  const done = completion ? node.rounds.length : rounds.length;
  return <LessonFrame className="language-frame" glyph="globe" kind={node.language}
    title={<span role="heading" aria-level={3} ref={heading} tabIndex={-1}>{terminal ? "Practice complete" : pending ? "Ready to save" : node.title}</span>}
    tools={terminal ? <span className="lesson-foot-meta"><KeatingGlyph name="check" size={13} />Saved</span> : <span>{pending ? node.rounds.length : index + 1} / {node.rounds.length}</span>}
    footer={completion && !terminal ? <>
      <span className="lesson-foot-meta">Not saved yet</span>
      <button className="lesson-primary" data-glyph-surface="inverse" type="button" disabled={disabled} onClick={() => deliver(completion)}><KeatingGlyph name="refresh" size={13} />Retry save practice</button>
    </> : completion ? <span className="lesson-foot-meta"><KeatingGlyph name="clock" size={13} />{formatQuizDuration(completion.totalMs)} total</span> : undefined}
    data-language-practice={node.id} data-language-phase={terminal ? "completed" : pending ? "saving" : "playing"}>
    <div className="lesson-round language-progress">
      <span className="lesson-progress" role="progressbar" aria-label="Rounds completed" aria-valuemin={0} aria-valuemax={node.rounds.length} aria-valuenow={done} aria-valuetext={`${done} of ${node.rounds.length}`}>
        <i style={{ width: `${done / Math.max(1, node.rounds.length) * 100}%` }} />
      </span>
      <small className="lesson-sr">{done} of {node.rounds.length}</small>
    </div>
    {completion ? <>
      <div className="lesson-readouts" role="status" data-glyph-host>
        {completion.objectiveTotal ? <div className="lesson-readout"><small><KeatingGlyph name="check" size={13} /> answers correct</small><b>{completion.correct}/{completion.objectiveTotal}</b></div> : null}
        {node.rounds.some((round) => round.kind === "pronunciation") ? <div className="lesson-readout"><small><KeatingGlyph name="mic" size={13} /> pronunciation practiced</small><b>{completion.pronunciationPracticed}</b></div> : null}
      </div>
      <ol className="lesson-rows language-recap">{completion.rounds.map((result) => {
        const round = node.rounds.find((item) => item.id === result.roundId)!;
        const tone = result.outcome === "correct" ? "ok" : result.outcome === "retry" ? "bad" : undefined;
        return <li key={result.roundId}><span className="language-recap__text">{round.kind === "word-order" ? languageReferenceAnswer(round) : round.text}<span className="lesson-status" data-tone={tone}>{result.outcome === "practiced" ? "Practiced · not scored" : result.outcome === "skipped" ? "Skipped" : `${result.outcome === "correct" ? "Correct" : "Not quite"} · ${result.attempts} ${result.attempts === 1 ? "attempt" : "attempts"}`}</span></span><time className="lesson-meta">{formatQuizDuration(result.timeMs)}</time></li>;
      })}</ol>
      {error ? <p className="language-error" role="alert">{error}</p> : null}
    </> : current ? <LanguageRound key={current.id} round={current} language={node.language} disabled={disabled} last={index + 1 === node.rounds.length} onFinish={finishRound} /> : <p role="alert">This practice has no rounds.</p>}
  </LessonFrame>;
}

const ROUND_GLYPH: Record<UiLanguageRound["kind"], GlyphName> = { translation: "globe", "word-order": "globe", listening: "speaker", pronunciation: "speaker" };

function LanguageRound({ round, language, disabled, last, onFinish }: { round: UiLanguageRound; language: string; disabled: boolean; last: boolean; onFinish: (result: Omit<UiLanguageRoundResult, "timeMs">) => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [feedback, setFeedback] = useState<"correct" | "retry">();
  const [playing, setPlaying] = useState(false);
  const [heard, setHeard] = useState(false);
  const [compared, setCompared] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [hintOpen, setHintOpen] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const recording = usePronunciationRecording(disabled, () => { setAttempts((value) => value + 1); setCompared(false); });
  const playback = useRef<HTMLAudioElement>(null);
  const isAudio = round.kind === "listening" || round.kind === "pronunciation";
  const recordingBusy = recording.state !== "idle";
  const locked = disabled || Boolean(feedback);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    return () => controller.current?.abort();
  }, []);
  useEffect(() => { if (disabled) controller.current?.abort(); }, [disabled]);

  const listen = async (slow: boolean) => {
    if (!isAudio || disabled || recordingBusy) return;
    if (playing) { controller.current?.abort(); return; }
    playback.current?.pause();
    const abort = new AbortController();
    controller.current = abort;
    setPlaying(true);
    setAudioError("");
    try {
      await playLanguageReference({ text: round.text, language, audioUrl: round.referenceAudioUrl, slow, signal: abort.signal });
      if (!abort.signal.aborted) setHeard(true);
    } catch (cause) {
      if (!abort.signal.aborted) setAudioError(cause instanceof Error ? cause.message : "The reference audio could not play.");
    } finally { if (controller.current === abort) { controller.current = undefined; setPlaying(false); } }
  };
  const answer = round.kind === "word-order" ? selected.map((tokenId) => round.tokens.find((token) => token.id === tokenId)!.label).join(" ") : text;
  const canCheck = round.kind === "word-order" ? selected.length === round.tokens.length : Boolean(text.trim()) && (round.kind !== "listening" || heard);
  const check = () => {
    if (locked || round.kind === "pronunciation" || !canCheck) return;
    setAttempts((value) => value + 1);
    setFeedback(checkLanguageAnswer(round, round.kind === "word-order" ? selected : text) ? "correct" : "retry");
  };
  const finish = (outcome: UiLanguageRoundResult["outcome"]) => {
    if (disabled || recordingBusy) return;
    controller.current?.abort();
    onFinish({ roundId: round.id, outcome, attempts, ...(round.kind !== "pronunciation" && answer ? { answer } : {}) });
  };

  return <section className="lesson-section language-round" data-kind={round.kind} data-feedback={feedback}>
    <h4 data-glyph-host className="lesson-section-title" ref={heading} tabIndex={-1}><KeatingGlyph name={ROUND_GLYPH[round.kind] ?? "globe"} size={13} />{round.prompt}</h4>
    {round.kind === "translation" || round.kind === "pronunciation" ? <p className="language-phrase">{round.text}</p> : null}
    {isAudio ? <>
      <div className="language-audio">
        <button type="button" className="lesson-quiet k-bloom language-audio__listen" disabled={disabled || recordingBusy} onClick={() => void listen(false)} aria-label={playing ? "Stop reference audio" : "Listen to reference"}>{playing ? <KeatingGlyph name="stop" size={13} /> : <KeatingGlyph name="speaker" size={13} />}<span>{playing ? "Stop" : "Listen"}</span></button>
        {round.referenceAudioUrl ? <button type="button" className="lesson-quiet k-bloom" disabled={disabled || recordingBusy || playing} onClick={() => void listen(true)}><KeatingGlyph name="clock" size={13} />Slower</button> : null}
        {round.audioCreditUrl ? <a className="language-audio__credit" href={round.audioCreditUrl} target="_blank" rel="noreferrer">Audio credit</a> : null}
      </div>
      {audioError ? <p className="language-error" role="alert">{audioError}</p> : null}
    </> : null}
    {round.kind === "word-order" ? <>
      <div className="language-word-order__answer" role="group" aria-label="Your sentence">
        {selected.length ? selected.map((tokenId) => <button key={tokenId} type="button" className="language-token" disabled={locked} onClick={() => setSelected((value) => value.filter((item) => item !== tokenId))} aria-label={`Remove ${round.tokens.find((token) => token.id === tokenId)!.label}`}>{round.tokens.find((token) => token.id === tokenId)!.label}</button>) : <span>Tap the words in order</span>}
      </div>
      <div className="language-word-order__bank" role="group" aria-label="Word bank">{round.tokens.map((token) => <button key={token.id} type="button" className="language-token" disabled={locked || selected.includes(token.id)} data-used={selected.includes(token.id) || undefined} onClick={() => setSelected((value) => [...value, token.id])}>{token.label}</button>)}</div>
    </> : round.kind !== "pronunciation" ? <form onSubmit={(event) => { event.preventDefault(); check(); }}>
      <label className="lesson-sr" htmlFor={`${id}-answer`}>{round.kind === "listening" ? "What you heard" : "Your translation"}</label>
      <input className="language-input" id={`${id}-answer`} value={text} onChange={(event) => setText(event.currentTarget.value)} disabled={locked} autoComplete="off" autoCapitalize="sentences" spellCheck={false} placeholder={round.kind === "listening" ? "What did you hear?" : "Your translation"} />
    </form> : <div className="language-pronunciation">
      {recording.state === "recording" ? <div className="lesson-stage k-grid language-stage" role="status"><span className="lesson-live">Recording</span><b>{(recording.elapsedMs / 1000).toFixed(1)}s</b></div> : null}
      {recording.url ? <div className="language-pronunciation__playback"><label className="lesson-label" htmlFor={`${id}-recording`}><KeatingGlyph name="headphones" size={13} />Your recording</label><audio ref={playback} id={`${id}-recording`} controls src={recording.url} onPlay={() => controller.current?.abort()} onEnded={() => setCompared(true)} onError={() => setAudioError("Your recording could not play. Record it again.")} /></div> : null}
      <p className="lesson-hint">{recording.url ? "Compare your rhythm and sounds with the reference." : "Listen, then make a short recording."}</p>
      {recording.error ? <p className="language-error" role="alert">{recording.error}</p> : null}
    </div>}
    {feedback ? <div className="lesson-feedback language-feedback" role="status" data-result={feedback === "correct" ? "correct" : "wrong"}>
      <KeatingGlyph name={feedback === "correct" ? "check" : "x"} size={13} /><b>{feedback === "correct" ? "Correct" : "Not quite"}</b>
      {feedback === "retry" ? <span className="language-feedback__answer">{languageReferenceAnswer(round)}</span> : null}
    </div> : null}
    {round.hint && !feedback && hintOpen ? <p className="language-hint" id={`${id}-hint`}><KeatingGlyph name="bulb" size={13} />Hint: {round.hint}</p> : null}
    {feedback ? <div className="lesson-foot language-actions">
      {feedback === "retry" ? <button type="button" className="lesson-quiet" disabled={disabled} onClick={() => { setFeedback(undefined); setText(""); setSelected([]); }}><KeatingGlyph name="refresh" size={13} />Try again</button> : null}
      <button type="button" className="lesson-primary" data-glyph-surface="inverse" disabled={disabled} onClick={() => finish(feedback)}><KeatingGlyph name="right" size={13} />{last ? "Finish practice" : "Continue"}</button>
    </div> : <div className="lesson-foot language-actions">
      <button type="button" className="lesson-quiet" disabled={disabled || recordingBusy || playing} onClick={() => finish("skipped")}><KeatingGlyph name="skip" size={13} />Skip</button>
      {round.hint ? <button type="button" className="lesson-quiet" aria-expanded={hintOpen} aria-controls={`${id}-hint`} onClick={() => setHintOpen((value) => !value)}><KeatingGlyph name="bulb" size={13} />Hint</button> : null}
      {round.kind === "pronunciation" ? <>
        <span className="lesson-foot-meta">Your recording stays here</span>
        {heard && compared ? <>
          <RecordButton recording={recording} quiet disabled={disabled || playing} onToggle={() => playback.current?.pause()} />
          <button type="button" className="lesson-primary" data-glyph-surface="inverse" disabled={disabled || recordingBusy} onClick={() => finish("practiced")}><KeatingGlyph name="check" size={13} />{last ? "Finish practice" : "Compared"}</button>
        </> : <>
          <button type="button" className="lesson-quiet language-finish" disabled>{last ? "Finish practice" : "Compared"}</button>
          <RecordButton recording={recording} disabled={disabled || playing} onToggle={() => playback.current?.pause()} />
        </>}
      </> : <button type="button" className="lesson-primary" data-glyph-surface="inverse" disabled={disabled || recordingBusy || !canCheck} onClick={check}><KeatingGlyph name="check" size={13} />Check</button>}
    </div>}
  </section>;
}

/** Record / stop: the ink primary until there is something to compare, then a quiet "Record again". Red while live. */
function RecordButton({ recording, quiet = false, disabled, onToggle }: { recording: ReturnType<typeof usePronunciationRecording>; quiet?: boolean; disabled: boolean; onToggle: () => void }) {
  const live = recording.state === "recording";
  return <button type="button" className={`${quiet ? "lesson-quiet" : "lesson-primary"} language-record`} data-glyph-surface={quiet ? undefined : "inverse"} data-recording={live || undefined}
    disabled={disabled || recording.state === "opening" || recording.state === "saving"}
    onClick={() => { onToggle(); if (live) void recording.stop(); else void recording.start(); }}>
    {live ? <KeatingGlyph name="stop" size={13} /> : <KeatingGlyph name="mic" size={13} />}
    {live ? `Stop · ${(recording.elapsedMs / 1000).toFixed(1)}s` : recording.state === "opening" ? <Loading size="inline" label="Opening microphone…" /> : recording.state === "saving" ? <Loading size="inline" label="Saving recording…" /> : recording.url ? "Record again" : "Record yourself"}
  </button>;
}
