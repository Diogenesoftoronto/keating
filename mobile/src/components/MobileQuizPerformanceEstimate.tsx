import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { UiAction, UiDocument } from "@keating/learner-contracts";
import { Button } from "./Buttons";
import { spacing, useKeatingTheme } from "@/constants/theme";
import { useKeating } from "@/state/KeatingProvider";
import { useUiSettings } from "@/state/UiSettingsProvider";
import { mobileJudgementCalibrationStore } from "@/lib/judgement/calibration";
import { shareQuizPerformanceEvidence } from "@/lib/judgement/share-quiz-performance";

type Completion = Extract<UiAction, { type: "complete-quiz" }>;

/** Optional estimates never gate the answer controls or a durable quiz save. */
export function useMobileQuizPerformance(options: {
  document: UiDocument; nodeId: string; disabled: boolean; ready: boolean; completed: boolean; completedActionId?: string;
}) {
  const theme = useKeatingTheme();
  const { createQuizPerformanceAttempt, exportQuizPerformanceEvidence, isQuizPerformanceEvidenceCurrent } = useKeating();
  const { settings, loaded } = useUiSettings();
  const [expanded, setExpanded] = useState(false);
  const [started, setStarted] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [savedEstimate, setSavedEstimate] = useState(false);
  const [evidenceStatus, setEvidenceStatus] = useState("");
  const active = useRef<ReturnType<typeof createQuizPerformanceAttempt> | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  // Parent answer state survives source revisions, so this guard must too.
  const touched = useRef(false);
  const preparedId = useRef<string | undefined>(undefined);
  const estimating = useRef(false);
  const sharingNow = useRef(false);
  const epoch = useRef(0);
  const exportEpoch = useRef(0);
  const key = JSON.stringify([options.document, options.nodeId]);
  const latest = useRef({ key, consent: loaded && (settings.judgementHosted || settings.judgementLocalModel === "minicpm5-2b-int4") });
  latest.current = { key, consent: loaded && (settings.judgementHosted || settings.judgementLocalModel === "minicpm5-2b-int4") };
  const cancelEstimate = () => {
    epoch.current++; estimating.current = false; setBusy(false); active.current?.dispose();
  };
  useEffect(() => {
    setStarted(touched.current); setBusy(false); setSharing(false);
    // A successful save advances document revision. Keep the prepared attempt's
    // observer until its asynchronous evidence transaction reports a result.
    const ownCompletion = preparedId.current !== undefined && options.completedActionId === preparedId.current;
    if (ownCompletion) setEvidenceStatus(active.current?.status() ?? "");
    else {
      unsubscribe.current?.(); unsubscribe.current = null;
      active.current?.dispose(); active.current = null; preparedId.current = undefined;
      setMessage(""); setSavedEstimate(false); setEvidenceStatus("");
    }
    return () => {
      epoch.current++; exportEpoch.current++; estimating.current = false; sharingNow.current = false;
      active.current?.dispose();
    };
  }, [key, options.completedActionId]);
  useEffect(() => () => {
    unsubscribe.current?.(); active.current?.dispose(); active.current = null;
  }, []);
  useEffect(() => {
    cancelEstimate();
  }, [loaded, settings.judgementHosted, settings.judgementLocalModel, createQuizPerformanceAttempt]);
  useEffect(() => {
    if (options.disabled || !options.ready) cancelEstimate();
  }, [options.disabled, options.ready]);
  useEffect(() => mobileJudgementCalibrationStore.subscribe(() => {
    cancelEstimate();
    setMessage("Judgement settings changed. Saved predictions keep their original model identity.");
  }), []);
  const touch = () => {
    touched.current = true; setStarted(true); active.current?.touch();
    if (estimating.current) {
      epoch.current++; estimating.current = false; setBusy(false);
      setMessage("Estimate cancelled because the quiz has started.");
    }
  };
  const estimate = async () => {
    if (touched.current || estimating.current || savedEstimate || options.disabled || !options.ready || options.completed || !latest.current.consent) return;
    const generation = ++epoch.current, capturedKey = key;
    estimating.current = true; setBusy(true); setMessage("");
    try {
      unsubscribe.current?.(); active.current?.dispose();
      const attempt = createQuizPerformanceAttempt(options.document, options.nodeId);
      active.current = attempt;
      unsubscribe.current = attempt.subscribe(() => setEvidenceStatus(attempt.status()));
      const result = await attempt.estimate();
      if (generation !== epoch.current || latest.current.key !== capturedKey || !latest.current.consent) return;
      if (result.ok) {
        setSavedEstimate(true);
        setMessage(`Estimated ${result.expectedCorrect.toFixed(1)} of ${result.itemCount} scored answers correct without an in-app hint. This prediction has not been calibrated against learner results.`);
      } else setMessage("An estimate is unavailable for this attempt. You can continue the quiz.");
    } catch {
      if (generation === epoch.current && latest.current.key === capturedKey) setMessage("The estimate could not be saved. You can continue the quiz.");
    } finally {
      if (generation === epoch.current) { estimating.current = false; setBusy(false); }
    }
  };
  const exportEvidence = async () => {
    if (sharingNow.current) return;
    sharingNow.current = true; setSharing(true);
    const generation = ++exportEpoch.current, capturedKey = key;
    const isCurrent = () => generation === exportEpoch.current && latest.current.key === capturedKey;
    try {
      const evidence = await exportQuizPerformanceEvidence(options.document.id, options.nodeId);
      if (!isCurrent()) return;
      const { createExpoPortableLearnerFileIo } = await import("@/lib/learner-portable-native");
      await shareQuizPerformanceEvidence(evidence, createExpoPortableLearnerFileIo(), () => isCurrent() && isQuizPerformanceEvidenceCurrent(evidence));
    } catch {
      if (isCurrent()) setMessage("Estimate records could not be shared. The saved records remain on this device.");
    } finally {
      if (isCurrent()) { sharingNow.current = false; setSharing(false); }
    }
  };
  const textStyle = { ...theme.type.body, color: theme.colors.textMuted };
  const controls = <View style={{ gap: spacing.sm }}>
    <Button compact variant="quiet" onPress={() => setExpanded(value => !value)}>{expanded ? "Hide quiz estimate" : "Quiz estimate"}</Button>
    {expanded && <>
      {!options.completed && <>
        <Button compact variant="secondary" disabled={options.disabled || !options.ready || !loaded || !(settings.judgementHosted || settings.judgementLocalModel === "minicpm5-2b-int4") || started || savedEstimate} loading={busy} onPress={() => void estimate()}>
          {savedEstimate ? "Prediction saved" : "Estimate before answering"}
        </Button>
        <Text style={textStyle}>{!loaded || !options.ready ? "Restoring this quiz…" : !(settings.judgementHosted || settings.judgementLocalModel === "minicpm5-2b-int4") ? "Choose local or hosted judgement in Settings to request an estimate." : started && !savedEstimate ? "Estimates are available before you start answering." : "Uses your selected judgement model with this quiz and recent assessed work. Saves the prediction on this device to compare with your submitted answers."}</Text>
      </>}
      {message ? <Text accessibilityLiveRegion="polite" style={textStyle}>{message}</Text> : null}
      {evidenceStatus === "saved" && <Text accessibilityLiveRegion="polite" style={textStyle}>The prediction and submitted result are saved on this device. Hint tracking covers hints opened in this quiz.</Text>}
      {evidenceStatus === "storage-failed" && <Text accessibilityLiveRegion="polite" style={textStyle}>Estimate records could not be saved. Your quiz answers are saved separately.</Text>}
      {evidenceStatus === "unmatched" && <Text accessibilityLiveRegion="polite" style={textStyle}>This result could not be linked to its saved prediction.</Text>}
      {options.completed && <>
        <Text style={textStyle}>Records include question text, recent assessed answers, and model predictions. Choose a destination in the share sheet to export them.</Text>
        <Button compact variant="secondary" loading={sharing} onPress={() => void exportEvidence()}>Share estimate records</Button>
      </>}
    </>}
  </View>;
  return {
    controls, touch,
    hint(questionId: string) { touch(); active.current?.hint(questionId); },
    prepareSubmission(action: Completion) {
      touched.current = true; setStarted(true);
      try {
        if (active.current?.status() === "estimated") preparedId.current = action.idempotencyKey;
        active.current?.prepareSubmission(action);
      }
      catch { setMessage("This result could not be linked to its estimate. You can still save your answers."); }
    },
  };
}
