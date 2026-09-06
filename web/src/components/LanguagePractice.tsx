import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, Headphones, Languages, Mic, RotateCcw, Send, SkipForward, Square, Volume2 } from "lucide-react";
import type { UiActionReceipt, UiLanguagePracticeNode, UiLanguageRound, UiLanguageRoundResult } from "@keating/learner-contracts";
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
  const heading = useRef<HTMLHeadingElement>(null);
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

  return <section className="language-game" data-language-practice={node.id} data-language-phase={terminal ? "completed" : pending ? "saving" : "playing"}>
    <header className="language-game__header">
      <div><p className="language-game__eyebrow"><Languages size={15} aria-hidden="true" />{node.language}</p><h3 ref={heading} tabIndex={-1}>{terminal ? "Practice complete" : pending ? "Ready to save" : node.title}</h3></div>
      {terminal ? <Check size={26} aria-hidden="true" /> : <span className="language-game__position">{pending ? node.rounds.length : index + 1}<span> / {node.rounds.length}</span></span>}
    </header>
    <div className="language-game__progress" role="progressbar" aria-label="Rounds completed" aria-valuemin={0} aria-valuemax={node.rounds.length} aria-valuenow={completion ? node.rounds.length : rounds.length}>
      <span style={{ transform: `scaleX(${(completion ? node.rounds.length : rounds.length) / Math.max(1, node.rounds.length)})` }} />
    </div>
    {completion ? <>
      <div className="language-game__results" role="status">
        {completion.objectiveTotal ? <div><strong>{completion.correct}/{completion.objectiveTotal}</strong><span>answers correct</span></div> : null}
        {node.rounds.some((round) => round.kind === "pronunciation") ? <div><strong>{completion.pronunciationPracticed}</strong><span>pronunciation practiced</span></div> : null}
      </div>
      <p className="language-game__duration">{formatQuizDuration(completion.totalMs)} total</p>
      <ol className="language-game__recap">{completion.rounds.map((result) => {
        const round = node.rounds.find((item) => item.id === result.roundId)!;
        return <li key={result.roundId}><span>{round.kind === "word-order" ? languageReferenceAnswer(round) : round.text}<small>{result.outcome === "practiced" ? "Practiced · not scored" : result.outcome === "skipped" ? "Skipped" : `${result.outcome === "correct" ? "Correct" : "Keep practicing"} · ${result.attempts} ${result.attempts === 1 ? "attempt" : "attempts"}`}</small></span><time>{formatQuizDuration(result.timeMs)}</time></li>;
      })}</ol>
      {!terminal ? <button className="language-game__primary" type="button" disabled={disabled} onClick={() => deliver(completion)}><Send size={17} aria-hidden="true" />Retry save practice</button> : null}
      {error ? <p className="language-game__error" role="alert">{error}</p> : null}
    </> : current ? <LanguageRound key={current.id} round={current} language={node.language} disabled={disabled} last={index + 1 === node.rounds.length} onFinish={finishRound} /> : <p role="alert">This practice has no rounds.</p>}
  </section>;
}

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

  return <div className="language-round" data-feedback={feedback}>
    <h4 ref={heading} tabIndex={-1}>{round.prompt}</h4>
    {round.kind === "translation" || round.kind === "pronunciation" ? <p className="language-round__phrase">{round.text}</p> : null}
    {isAudio ? <>
      <div className="language-audio">
        <button type="button" className="language-audio__listen" disabled={disabled || recordingBusy} onClick={() => void listen(false)} aria-label={playing ? "Stop reference audio" : "Listen to reference"}>{playing ? <Square size={24} aria-hidden="true" /> : <Volume2 size={28} aria-hidden="true" />}<span>{playing ? "Stop" : "Listen"}</span></button>
        {round.referenceAudioUrl ? <button type="button" className="language-game__quiet" disabled={disabled || recordingBusy || playing} onClick={() => void listen(true)}>Slower</button> : null}
      </div>
      {round.audioCreditUrl ? <a className="language-audio__credit" href={round.audioCreditUrl} target="_blank" rel="noreferrer">Audio credit</a> : null}
      {audioError ? <p className="language-game__error" role="alert">{audioError}</p> : null}
    </> : null}
    {round.kind === "word-order" ? <>
      <div className="language-word-order__answer" role="group" aria-label="Your sentence">
        {selected.length ? selected.map((tokenId) => <button key={tokenId} type="button" className="language-token" disabled={locked} onClick={() => setSelected((value) => value.filter((item) => item !== tokenId))} aria-label={`Remove ${round.tokens.find((token) => token.id === tokenId)!.label}`}>{round.tokens.find((token) => token.id === tokenId)!.label}</button>) : <span>Tap the words in order</span>}
      </div>
      <div className="language-word-order__bank" role="group" aria-label="Word bank">{round.tokens.map((token) => <button key={token.id} type="button" className="language-token" disabled={locked || selected.includes(token.id)} data-used={selected.includes(token.id) || undefined} onClick={() => setSelected((value) => [...value, token.id])}>{token.label}</button>)}</div>
    </> : round.kind !== "pronunciation" ? <form onSubmit={(event) => { event.preventDefault(); check(); }}>
      <label className="language-game__sr-only" htmlFor={`${id}-answer`}>{round.kind === "listening" ? "What you heard" : "Your translation"}</label>
      <input id={`${id}-answer`} value={text} onChange={(event) => setText(event.currentTarget.value)} disabled={locked} autoComplete="off" autoCapitalize="sentences" spellCheck={false} placeholder={round.kind === "listening" ? "What did you hear?" : "Your translation"} />
    </form> : <div className="language-pronunciation">
      <button type="button" className="language-pronunciation__record" data-recording={recording.state === "recording" || undefined} disabled={disabled || playing || recording.state === "opening" || recording.state === "saving"} onClick={() => { playback.current?.pause(); if (recording.state === "recording") void recording.stop(); else void recording.start(); }}>
        {recording.state === "recording" ? <Square size={19} aria-hidden="true" /> : <Mic size={19} aria-hidden="true" />}
        {recording.state === "recording" ? `Stop · ${(recording.elapsedMs / 1000).toFixed(1)}s` : recording.state === "opening" ? "Opening microphone…" : recording.state === "saving" ? "Saving recording…" : recording.url ? "Record again" : "Record yourself"}
      </button>
      {recording.url ? <div className="language-pronunciation__playback"><label htmlFor={`${id}-recording`}><Headphones size={15} aria-hidden="true" />Your recording</label><audio ref={playback} id={`${id}-recording`} controls src={recording.url} onPlay={() => controller.current?.abort()} onEnded={() => setCompared(true)} onError={() => setAudioError("Your recording could not play. Record it again.")} /></div> : null}
      <p className="language-pronunciation__note">{recording.url ? "Compare your rhythm and sounds with the reference." : "Listen, then make a short recording."} Your recording stays here.</p>
      {recording.error ? <p className="language-game__error" role="alert">{recording.error}</p> : null}
    </div>}
    {feedback ? <div className="language-feedback" role="status" data-correct={feedback === "correct" || undefined}>
      <strong>{feedback === "correct" ? <><Check size={19} aria-hidden="true" />Got it!</> : "One to practice"}</strong>
      {feedback === "retry" ? <p>{languageReferenceAnswer(round)}</p> : null}
      <div className="language-game__actions">
        {feedback === "retry" ? <button type="button" className="language-game__quiet" disabled={disabled} onClick={() => { setFeedback(undefined); setText(""); setSelected([]); }}><RotateCcw size={16} aria-hidden="true" />Try again</button> : null}
        <button type="button" className="language-game__primary" disabled={disabled} onClick={() => finish(feedback)}>{last ? "Finish practice" : "Continue"}<ArrowRight size={17} aria-hidden="true" /></button>
      </div>
    </div> : <div className="language-game__actions">
      <button type="button" className="language-game__quiet" disabled={disabled || recordingBusy || playing} onClick={() => finish("skipped")}><SkipForward size={15} aria-hidden="true" />Skip</button>
      <button type="button" className="language-game__primary" disabled={disabled || recordingBusy || (round.kind === "pronunciation" ? !(heard && compared) : !canCheck)} onClick={() => round.kind === "pronunciation" ? finish("practiced") : check()}>{round.kind === "pronunciation" ? last ? "Finish practice" : "Compared" : "Check"}<Check size={17} aria-hidden="true" /></button>
    </div>}
    {round.hint && !feedback ? <details className="language-game__hint"><summary>Hint</summary><p>{round.hint}</p></details> : null}
  </div>;
}
