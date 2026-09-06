import { useEffect, useRef, useState } from "react";
import { startMicRecording, type MicRecorder } from "../../keating/speech-providers/stt";

export function usePronunciationRecording(disabled: boolean, onRecorded: () => void) {
  const recorder = useRef<MicRecorder | undefined>(undefined);
  const generation = useRef(0);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;
  const urlRef = useRef<string | undefined>(undefined);
  const startedAt = useRef(0);
  const [state, setState] = useState<"idle" | "opening" | "recording" | "saving">("idle");
  const [url, setUrl] = useState<string>();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState("");

  const cancel = () => {
    generation.current += 1;
    recorder.current?.cancel();
    recorder.current = undefined;
  };
  useEffect(() => () => {
    cancel();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);
  useEffect(() => {
    if (disabled) {
      cancel();
      setState("idle");
    }
  }, [disabled]);

  const stop = async () => {
    const active = recorder.current;
    if (!active) return;
    recorder.current = undefined;
    const version = generation.current;
    setState("saving");
    try {
      const blob = await active.stop();
      if (version !== generation.current) return;
      if (!blob.size) throw new Error("No audio was captured. Try recording again.");
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setUrl(urlRef.current);
      onRecordedRef.current();
    } catch (cause) {
      if (version === generation.current) setError(cause instanceof Error ? cause.message : "The recording could not be saved.");
    } finally {
      if (version === generation.current) setState("idle");
    }
  };

  useEffect(() => {
    if (state !== "recording") return;
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      setElapsedMs(elapsed);
      if (elapsed >= 30_000) void stop();
    }, 100);
    return () => clearInterval(timer);
  }, [state]);

  const start = async () => {
    if (disabled || state !== "idle") return;
    if (typeof MediaRecorder === "undefined") { setError("Recording is not available in this browser."); return; }
    const version = ++generation.current;
    setError("");
    setState("opening");
    try {
      const active = await startMicRecording();
      if (version !== generation.current) { active.cancel(); return; }
      recorder.current = active;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = undefined;
      setUrl(undefined);
      setElapsedMs(0);
      startedAt.current = Date.now();
      setState("recording");
    } catch (cause) {
      if (version !== generation.current) return;
      setState("idle");
      setError(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Microphone access is blocked. Allow it in your browser, then try again."
        : cause instanceof Error ? cause.message : "The microphone could not start.");
    }
  };

  return { state, url, elapsedMs, error, start, stop };
}
