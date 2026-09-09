import { useContext, useEffect, useId, useRef, useState } from "react";
import type { UiResponseCapture, UiSubmissionAttachment } from "@keating/learner-contracts";
import { SubmissionUploadContext } from "./SubmissionAttachments";
import { Mic, Video, Square, RotateCcw, Paperclip } from "lucide-react";
import "./response-capture.css";

export const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 180;
export function remainingSeconds(elapsedMs: number, seconds: number) {
  return Math.max(0, Math.ceil(seconds - elapsedMs / 1000));
}
export function recordingMime(kind: "audio" | "video", supports: (mime: string) => boolean): string | undefined {
  return (kind === "audio" ? ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"] : ["video/webm;codecs=vp8,opus", "video/mp4", "video/webm"]).find(supports);
}

type Attempt = { blob: Blob; url: string; elapsedMs: number; timed: boolean; limit: number; number: number };
type Phase = "idle" | "opening" | "recording" | "ready" | "saving";

/** Hardware starts only after a learner gesture. No transcription or network inference. */
export function ResponseCapture({ capture, disabled, onAttach, onBusyChange }: {
  capture: UiResponseCapture; disabled?: boolean;
  onAttach: (file: UiSubmissionAttachment, summary: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const save = useContext(SubmissionUploadContext);
  const id = useId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [timed, setTimed] = useState(Boolean(capture.timeLimitSeconds));
  const [withAudio, setWithAudio] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState<Attempt>();
  const [attached, setAttached] = useState(false);
  const [error, setError] = useState("");
  const live = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | undefined>(undefined);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const url = useRef<string | undefined>(undefined);
  const sequence = useRef(0);
  const active = useRef(false);
  const count = useRef(0);
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const saving = useRef(false);
  const captureKey = `${capture.kind}:${capture.timeLimitSeconds ?? "none"}`;
  const release = () => {
    clearInterval(timer.current); timer.current = undefined;
    if (recorder.current?.state !== "inactive") { try { recorder.current?.stop(); } catch { /* already stopping */ } }
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = undefined;
    if (live.current) live.current.srcObject = null;
  };
  useEffect(() => {
    return () => { sequence.current++; active.current = false; release(); if (url.current) URL.revokeObjectURL(url.current); busyCallback.current?.(false); };
  }, [captureKey]);
  useEffect(() => {
    if (disabled) { sequence.current++; active.current = false; release(); setPhase("idle"); busyCallback.current?.(false); }
  }, [disabled]);
  useEffect(() => { if (live.current) live.current.srcObject = stream.current ?? null; }, [phase]);

  const stop = () => { if (recorder.current?.state === "recording") recorder.current.stop(); };
  async function start() {
    if (disabled || active.current || saving.current) return;
    const ticket = ++sequence.current;
    active.current = true; setError(""); setPhase("opening"); busyCallback.current?.(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Recording is unavailable here. You can attach an audio or video file below instead.");
      const input = await navigator.mediaDevices.getUserMedia({ audio: capture.kind === "audio" || withAudio, video: capture.kind === "video" ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } : false });
      if (ticket !== sequence.current) { input.getTracks().forEach(track => track.stop()); return; }
      stream.current = input;
      const mimeType = recordingMime(capture.kind, mime => MediaRecorder.isTypeSupported(mime));
      const next = new MediaRecorder(input, { ...(mimeType ? { mimeType } : {}), ...(capture.kind === "video" ? { videoBitsPerSecond: 500_000 } : {}), audioBitsPerSecond: 96_000 });
      recorder.current = next;
      const chunks: Blob[] = []; let bytes = 0; let invalid = false;
      const limit = timed && capture.timeLimitSeconds ? capture.timeLimitSeconds : MAX_RECORDING_SECONDS;
      let started = 0;
      next.ondataavailable = event => {
        if (ticket !== sequence.current || invalid) return;
        bytes += event.data.size;
        if (bytes > MAX_RECORDING_BYTES) { invalid = true; setError("That recording reached the 25 MB limit. Try a shorter attempt or attach a smaller file."); stop(); return; }
        if (event.data.size) chunks.push(event.data);
      };
      next.onerror = () => { if (ticket !== sequence.current) return; invalid = true; if (ticket === sequence.current) setError("Recording was interrupted. Try again or attach a file."); release(); active.current = false; busyCallback.current?.(false); if (ticket === sequence.current) setPhase(attempt ? "ready" : "idle"); };
      next.onstop = () => {
        const duration = started ? performance.now() - started : 0;
        if (ticket !== sequence.current) return;
        release();
        active.current = false; busyCallback.current?.(false);
        if (invalid || !bytes) { setPhase(attempt ? "ready" : "idle"); if (!invalid) setError("No recording was captured. Try again."); return; }
        const blob = new Blob(chunks, { type: next.mimeType || (capture.kind === "audio" ? "audio/webm" : "video/webm") });
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = URL.createObjectURL(blob);
        setAttempt({ blob, url: url.current, elapsedMs: duration, timed: Boolean(timed && capture.timeLimitSeconds), limit, number: ++count.current });
        setAttached(false); setElapsed(duration); setPhase("ready");
      };
      next.onstart = () => {
        if (ticket !== sequence.current) return;
        started = performance.now(); setElapsed(0); setPhase("recording");
        timer.current = setInterval(() => {
          const duration = performance.now() - started;
          setElapsed(duration);
          if (duration >= limit * 1000) stop();
        }, 100);
      };
      input.getTracks().forEach(track => { track.onended = stop; });
      next.start(500);
    } catch (cause) {
      if (ticket !== sequence.current) return;
      release(); active.current = false; busyCallback.current?.(false); setPhase(attempt ? "ready" : "idle");
      setError(cause instanceof Error && cause.name === "NotAllowedError" ? "Camera or microphone access was not granted. Try again, or attach a file below." : cause instanceof Error ? cause.message : "Could not start recording.");
    }
  }
  async function attach() {
    if (!attempt || saving.current || active.current || disabled || attached) return;
    const ticket = sequence.current;
    saving.current = true; setPhase("saving"); setError(""); busyCallback.current?.(true);
    try {
      const extension = attempt.blob.type.includes("mp4") ? (capture.kind === "audio" ? "m4a" : "mp4") : "webm";
      const file = await save(new File([attempt.blob], `${capture.kind}-attempt-${attempt.number}-${Date.now()}.${extension}`, { type: attempt.blob.type }));
      if (ticket !== sequence.current) return;
      onAttach(file, `Recorded ${capture.kind} attempt ${attempt.number}: ${(attempt.elapsedMs / 1000).toFixed(1)} seconds. ${attempt.timed ? `Timed practice; target ${attempt.limit} seconds.` : "Untimed practice."} Accuracy has not been assessed.`);
      setAttached(true);
    } catch (cause) { if (ticket === sequence.current) setError(cause instanceof Error ? cause.message : "Could not attach the recording. Your replay is still available; retry attaching it."); }
    finally { saving.current = false; if (ticket === sequence.current) { setPhase("ready"); busyCallback.current?.(false); } }
  }
  const busy = phase === "opening" || phase === "recording" || phase === "saving";
  return <section className="response-capture" aria-label={`${capture.kind === "audio" ? "Audio" : "Video"} response`}>
    <div className="response-capture__heading"><span>{capture.kind === "audio" ? <Mic aria-hidden="true" /> : <Video aria-hidden="true" />} Your attempt</span><span>{attempt ? `Take ${attempt.number}` : "Ready when you are"}</span></div>
    {capture.timeLimitSeconds ? <label className="response-capture__option"><input type="checkbox" checked={timed} disabled={disabled || busy} onChange={event => setTimed(event.target.checked)} />Timed practice · {capture.timeLimitSeconds}s <small>Turn off to practise at your own pace.</small></label> : null}
    {capture.kind === "video" ? <label className="response-capture__option"><input type="checkbox" checked={withAudio} disabled={disabled || busy} onChange={event => setWithAudio(event.target.checked)} />Include microphone</label> : null}
    <div className="response-capture__stage" data-recording={phase === "recording" || undefined}>
      {capture.kind === "video" && phase === "recording" ? <video ref={live} autoPlay muted playsInline aria-label="Live camera preview" /> : null}
      <div className="response-capture__clock" aria-hidden="true">{timed && capture.timeLimitSeconds ? remainingSeconds(phase === "recording" || phase === "ready" ? elapsed : 0, capture.timeLimitSeconds) : (elapsed / 1000).toFixed(1)}<small>{timed && capture.timeLimitSeconds ? "seconds remaining" : "seconds"}</small></div>
      <p role="status">{phase === "recording" ? "Recording — stop whenever you are ready." : phase === "opening" ? "Waiting for device permission…" : phase === "saving" ? "Attaching on this device…" : attached ? "Recording attached. Add your reflection below." : attempt ? "Replay your attempt. What would you change?" : "One attempt, then a moment to reflect."}</p>
    </div>
    {attempt && !active.current ? <div className="response-capture__replay"><label htmlFor={`${id}-replay`}>Replay take {attempt.number} · {(attempt.elapsedMs / 1000).toFixed(1)}s · {attempt.timed ? "timed" : "untimed"}</label>{capture.kind === "audio" ? <audio id={`${id}-replay`} controls src={attempt.url} /> : <video id={`${id}-replay`} controls playsInline src={attempt.url} />}</div> : null}
    <div className="response-capture__controls">
      {phase === "recording" ? <button type="button" onClick={stop}><Square aria-hidden="true" />Stop recording</button> : <button type="button" disabled={disabled || busy} onClick={() => void start()}>{attempt ? <RotateCcw aria-hidden="true" /> : capture.kind === "audio" ? <Mic aria-hidden="true" /> : <Video aria-hidden="true" />}{attempt ? "Try again" : "Start recording"}</button>}
      {phase === "opening" ? <button type="button" onClick={() => { sequence.current++; active.current = false; release(); setPhase(attempt ? "ready" : "idle"); busyCallback.current?.(false); }}>Cancel</button> : null}
      {attempt ? <button type="button" disabled={disabled || busy || attached} onClick={() => void attach()}><Paperclip aria-hidden="true" />{attached ? "Attached" : "Use this attempt"}</button> : null}
    </div>
    <p className="response-capture__note">Recordings stay on this device until you submit through the activity. You can also attach a file below. Untimed takes stop after three minutes.</p>
    {error ? <p role="alert" className="response-capture__error">{error}</p> : null}
  </section>;
}
