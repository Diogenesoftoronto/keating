/**
 * Voice controls for the chat composer. Duplex speech providers open the live
 * conversation overlay; other providers record, transcribe and place the
 * transcript back in the composer for review before sending.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAui } from "@assistant-ui/react";
import { AudioLines, CircleAlert, Keyboard, Mic, X } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { KeatingBot } from "../KeatingBot";
import { RecordingWaveform } from "../RecordingWaveform";
import { ErrorDiagnosticsActions } from "../ErrorDiagnosticsActions";
import LiveConversation from "../live/LiveConversation";
import { liveCredentialProvider, useLiveSession } from "../live/use-live-session";
import { rememberRecordingTranscript } from "../../lib/recording-transcripts";
import { getProviderApiKey } from "../../lib/provider-models";
import {
  isDuplexSpeechProvider,
  loadWebSpeechSettings,
  primeSpeechAudio,
  resolveSpeechCredential,
  resolveSpeechRealtimeTier,
} from "../../keating/speech";
import { startVideoCapture, type VideoCaptureHandle } from "../../keating/video-capture";
import type { LiveTranscriptTurn } from "../../keating/live-transcript";
import {
  startMicRecording,
  transcribeAudio,
  transcriptionErrorMessage,
  type MicRecorder,
} from "../../keating/speech-providers/stt";
import { diagnosticsSummaryForFailure, speechDiagnosticsSummary } from "./error-classification";
import { composerIconButtonClass, composerIconButtonStyles, srInteractiveClass } from "./composer-styles";

// Voice is a real composer mode, not a small attachment action. Duplex models
// open the realtime surface; other providers use press-and-hold dictation and
// place the transcript back into the text composer for review.
export function SpeechComposerControl({
  expanded,
  onExpandedChange,
  onRecordingChange,
  onConversationComplete,
  onRequestCredential,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onRecordingChange?: (recording: boolean) => void;
  onConversationComplete: (turns: LiveTranscriptTurn[]) => void | Promise<void>;
  onRequestCredential?: (provider: string) => Promise<boolean>;
}) {
  const composer = useAui().composer;
  const [available, setAvailable] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    onRecordingChange?.(recording);
    return () => onRecordingChange?.(false);
  }, [recording, onRecordingChange]);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [audioError, setAudioError] = useState("");
  const retryAudioRef = useRef<Blob | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [forceStt, setForceStt] = useState(false);
  const recorderRef = useRef<MicRecorder | null>(null);
  const recordingPromiseRef = useRef<Promise<MicRecorder> | null>(null);
  useEffect(() => () => {
    const pending = recordingPromiseRef.current;
    recordingPromiseRef.current = null;
    if (pending) void pending.then(recorder => recorder.cancel()).catch(() => {});
  }, []);
  const pendingLiveVideoRef = useRef<Promise<VideoCaptureHandle | null> | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      const settings = loadWebSpeechSettings();
      const requiredProvider = liveCredentialProvider(settings.providerId);
      const credential = requiredProvider
        ? getProviderApiKey(requiredProvider)
        : resolveSpeechCredential(getProviderApiKey).then(
            (value) => value?.apiKey,
          );
      credential
        .then((apiKey) => {
          if (!cancelled) setAvailable(Boolean(apiKey));
        })
        .catch(() => {
          if (!cancelled) setAvailable(false);
        });
    };
    check();
    // Re-check when a key is added/changed via the API-key prompt.
    window.addEventListener("keating:api-key-prompt-changed", check);
    return () => {
      cancelled = true;
      window.removeEventListener("keating:api-key-prompt-changed", check);
    };
  }, []);

  useEffect(() => {
    if (
      !forceStt &&
      isDuplexSpeechProvider(loadWebSpeechSettings().providerId) &&
      expanded
    ) {
      onExpandedChange(false);
    }
  }, [expanded, forceStt, onExpandedChange]);

  // Let anything outside the composer start a live conversation — the /live
  // route is just this event fired on arrival. Kept as an event rather than a
  // prop so the trigger does not have to be a descendant of the chat panel.
  useEffect(() => {
    const onExternalStart = () => {
      // No pre-flight screen capture here: without a click of its own this
      // has no transient user activation to spend, and the learner can turn
      // sharing on from inside the session.
      pendingLiveVideoRef.current = null;
      void primeSpeechAudio().catch(() => {});
      setLiveOpen(true);
    };
    window.addEventListener("keating:start-live", onExternalStart);
    return () =>
      window.removeEventListener("keating:start-live", onExternalStart);
  }, []);

  const appendToComposer = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const existing = composer.getState().text;
    composer.setText(existing ? `${existing.trimEnd()} ${trimmed}` : trimmed);
  };

  const beginPushToTalk = () => {
    if (busy || recordingPromiseRef.current) return;
    setAudioError("");
    retryAudioRef.current = null;
    setRecording(true);
    const pending = startMicRecording();
    recordingPromiseRef.current = pending;
    void pending
      .then((recorder) => {
        if (recordingPromiseRef.current !== pending) return;
        recorderRef.current = recorder;
        setRecordingStream(recorder.stream);
      })
      .catch((error) => {
        recordingPromiseRef.current = null;
        setRecording(false);
        setAudioError(error instanceof Error ? error.message : "Microphone unavailable.");
      });
  };

  const transcribeRecording = async (blob: Blob) => {
    const cred = await resolveSpeechCredential(getProviderApiKey);
    if (!cred) {
      setAudioError("Add a speech provider key in Settings to create a transcript. You can still send the recording to an audio-capable model.");
      return;
    }
    const text = await transcribeAudio(blob, { provider: cred.provider, apiKey: cred.apiKey });
    if (!text.trim()) {
      setAudioError("No speech was detected. Retry if you spoke, or send the audio without a transcript.");
      return;
    }
    appendToComposer(text);
    rememberRecordingTranscript(blob, text);
    retryAudioRef.current = null;
    setAudioError("");
    onExpandedChange(false);
  };

  const retryTranscription = async () => {
    if (!retryAudioRef.current || busy) return;
    setBusy(true);
    setAudioError("");
    try { await transcribeRecording(retryAudioRef.current); }
    catch (error) { setAudioError(transcriptionErrorMessage(error)); }
    finally { setBusy(false); }
  };

  const finishPushToTalk = async () => {
    const pending = recordingPromiseRef.current;
    if (!pending) return;
    setRecording(false);
    setBusy(true);
    let attached = false;
    try {
      const recorder = recorderRef.current ?? (await pending);
      const blob = await recorder.stop();
      const file = new File([blob], `Recording-${Date.now()}.webm`, {type: blob.type || "audio/webm"});
      await composer.addAttachment(file);
      attached = true;
      retryAudioRef.current = file;
      await transcribeRecording(file);
    } catch (error) {
      setAudioError(attached ? transcriptionErrorMessage(error) : "Could not attach the recording. Check microphone access and try recording again.");
    } finally {
      recorderRef.current = null;
      recordingPromiseRef.current = null;
      setRecordingStream(null);
      setBusy(false);
    }
  };

  const openLiveVoice = (settings = loadWebSpeechSettings()) => {
    void primeSpeechAudio().catch(() => {});
    // getDisplayMedia requires transient user activation in browsers that
    // enforce the screen-sharing permission contract. Start this request from
    // the button click; the overlay will consume the resulting handle after
    // the provider connection is ready.
    const liveTier = resolveSpeechRealtimeTier(settings);
    if (settings.providerId !== "tavus" && liveTier.video && settings.videoEnabled && settings.videoSource === "screen") {
      pendingLiveVideoRef.current = startVideoCapture({
        source: settings.videoSource,
        intervalMs: settings.frameIntervalMs,
      }).catch((error) => {
        console.warn("[keating:live] screen capture unavailable", error);
        return null;
      });
    } else {
      pendingLiveVideoRef.current = null;
    }
    setLiveOpen(true);
  };

  const settings = loadWebSpeechSettings();
  const mode =
    forceStt || !isDuplexSpeechProvider(settings.providerId) ? "stt" : "duplex";
  const activateVoice = () => {
    if (mode === "stt") {
      onExpandedChange(true);
      return;
    }
    // Unlock playback from this direct learner gesture even when credential
    // setup has to finish before the provider session can be opened.
    void primeSpeechAudio().catch(() => {});
    if (available === true) {
      openLiveVoice(settings);
      return;
    }
    const requiredProvider = liveCredentialProvider(settings.providerId);
    if (!requiredProvider || !onRequestCredential) {
      openLiveVoice(settings);
      return;
    }
    void onRequestCredential(requiredProvider).then((allowed) => {
      if (!allowed) return;
      setAvailable(true);
      openLiveVoice(loadWebSpeechSettings());
    });
  };
  const liveOverlay =
    liveOpen && typeof document !== "undefined"
      ? createPortal(
          <LiveVoiceOverlay
            onClose={() => setLiveOpen(false)}
            onConversationComplete={onConversationComplete}
            initialVideoPromise={pendingLiveVideoRef.current}
            onOpenSettings={(tab) => {
              window.dispatchEvent(
                new CustomEvent("keating:open-settings", {
                  detail: { tab: tab === "speech" ? "learning" : "models" },
                }),
              );
            }}
            onFallback={() => {
              setLiveOpen(false);
              setForceStt(true);
              onExpandedChange(true);
            }}
          />,
          document.body,
        )
      : null;

  const audioErrorToast = audioError ? createPortal(
    <div role="status" aria-live="polite" className={css({
      position: "fixed", bottom: "calc(1rem + env(safe-area-inset-bottom))", right: "1rem",
      zIndex: 10000, width: "min(24rem, calc(100vw - 2rem))", padding: "1rem",
      animation: "keating-notice-enter 240ms cubic-bezier(.16,1,.3,1) both",
      "@media (prefers-reduced-motion: reduce)": {animation: "none"},
      backgroundColor: "var(--background)", color: "var(--foreground)",
      border: "1px solid var(--border)", borderRadius: "0.5rem",
      boxShadow: "0 4px 24px #0003", fontSize: "0.8125rem", lineHeight: 1.5,
    })}>
      <div className={css({display: "flex", alignItems: "center", gap: "0.5rem"})}>
        <CircleAlert size={16} aria-hidden="true" />
        <strong className={css({flex: 1})}>{retryAudioRef.current ? "Transcript unavailable" : "Recording unavailable"}</strong>
        <button type="button" onClick={() => setAudioError("")} aria-label="Dismiss notification"
          className={composerIconButtonClass}><X size={16} /></button>
      </div>
      <p>{audioError}</p>
      {retryAudioRef.current && <>
        <p className={css({color: "var(--muted-foreground)", marginTop: "0.25rem"})}>Your audio is still attached.</p>
        <button type="button" disabled={busy} onClick={() => void retryTranscription()}
          className={css({marginTop: "0.5rem", textDecoration: "underline", cursor: "pointer"})}>Retry transcription</button>
      </>}
      {speechDiagnosticsSummary(audioError) && <ErrorDiagnosticsActions summary={speechDiagnosticsSummary(audioError)!} />}
    </div>, document.body) : null;

  if (!expanded) {
    // Dictation and live conversation are different jobs, so they get
    // different buttons rather than one button whose meaning depends on a
    // setting the learner cannot see from here. Dictation puts words in the
    // composer to edit before sending; live opens a conversation that Keating
    // answers out loud.
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setForceStt(true);
            onExpandedChange(true);
          }}
          title="Record an audio message"
          aria-label="Record an audio message"
          className={cx(
            composerIconButtonClass,
            css({
              _hover: {
                backgroundColor: "var(--muted)",
                color: "var(--foreground)",
              },
            }),
          )}
        >
          <Mic size={16} />
        </button>
        <button
          type="button"
          onClick={activateVoice}
          title="Start a live conversation"
          aria-label="Start a live conversation"
          aria-haspopup="dialog"
          className={cx(
            srInteractiveClass,
            css(composerIconButtonStyles, {
              borderColor: "transparent",
              backgroundColor: "var(--foreground)",
              color: "var(--background)",
              _hover: {
                backgroundColor:
                  "color-mix(in srgb, var(--foreground) 85%, var(--background))",
                color: "var(--background)",
              },
              _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "3px" },
            }),
          )}
        >
          <AudioLines size={16} />
        </button>
        {audioErrorToast}
        {liveOverlay}
      </>
    );
  }

  return (
    <>
      <div
        className={css({
          display: "flex",
          minWidth: 0,
          flex: 1,
          alignItems: "center",
          gap: "0.375rem",
        })}
      >
        <button
          type="button"
          disabled={busy}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            beginPushToTalk();
          }}
          onPointerUp={() => void finishPushToTalk()}
          onPointerCancel={() => void finishPushToTalk()}
          onKeyDown={(event) => {
            if ((event.key === " " || event.key === "Enter") && !event.repeat) {
              event.preventDefault();
              beginPushToTalk();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              void finishPushToTalk();
            }
          }}
          aria-label="Hold to speak"
          aria-pressed={recording}
          className={cx(
            css({
              display: "inline-flex",
              minWidth: 0,
              minHeight: "2.25rem",
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              borderRadius: "0.375rem",
              backgroundColor: "var(--primary)",
              paddingInline: "0.75rem",
              fontSize: "0.8125rem",
              fontWeight: 650,
              color: "var(--primary-foreground)",
              touchAction: "none",
              userSelect: "none",
              _hover: {
                backgroundColor:
                  "color-mix(in srgb, var(--primary) 88%, black)",
              },
              _disabled: { opacity: 0.65 },
            }),

          )}
        >
          {busy ? (
            <KeatingBot state="thinking" size={32} label="" />
          ) : recording ? (
            <KeatingBot state="listening" size={32} label="" />
          ) : (
            <Mic size={16} />
          )}
          {recording && recordingStream && <RecordingWaveform stream={recordingStream} />}
          <span>
            {busy
              ? "Preparing audio"
              : recording
                ? "Release to attach"
                : "Hold to speak"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onExpandedChange(false)}
          aria-label="Switch to keyboard"
          title="Switch to keyboard"
          className={composerIconButtonClass}
        >
          <Keyboard size={16} />
        </button>
      </div>
      {audioErrorToast}
      {liveOverlay}
    </>
  );
}

// The live conversation surface, rendered over the chat. The session runtime
// and every pixel of it live in components/live so the /live route and this
// overlay cannot drift apart again.
function LiveVoiceOverlay({
  onClose,
  onConversationComplete,
  onFallback,
  initialVideoPromise,
  onOpenSettings,
}: {
  onClose: () => void;
  onConversationComplete: (turns: LiveTranscriptTurn[]) => void | Promise<void>;
  onFallback: () => void;
  initialVideoPromise?: Promise<VideoCaptureHandle | null> | null;
  onOpenSettings?: (tab: "providers" | "speech") => void;
}) {
  const session = useLiveSession({
    onConversationComplete,
    initialVideoPromise,
  });
  const liveDiagnosticsSummary = session.failure
    ? diagnosticsSummaryForFailure(session.failure, "live session")
    : undefined;

  // Ending is the learner's decision, so the surface closes only once the
  // session has flushed its transcript into the chat.
  useEffect(() => {
    if (session.phase === "ended") onClose();
  }, [session.phase, onClose]);

  // Escape ends the call rather than abandoning an open microphone.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") session.end();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Live voice conversation"
      className={css({
        position: "fixed",
        inset: 0,
        zIndex: 60,
        backgroundColor: "var(--background)",
      })}
    >
      <LiveConversation
        session={session}
        onClose={session.end}
        onOpenSettings={onOpenSettings}
        onUseDictation={onFallback}
      />
      {liveDiagnosticsSummary && (
        <div className={css({ position: "absolute", left: "1rem", right: "1rem", bottom: "7.5rem", zIndex: 1, display: "flex", justifyContent: "center" })}>
          <ErrorDiagnosticsActions summary={liveDiagnosticsSummary} />
        </div>
      )}
    </div>
  );
}
