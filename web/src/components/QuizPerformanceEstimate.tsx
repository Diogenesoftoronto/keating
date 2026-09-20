import { useEffect, useRef, useState } from "react";
import type { UiDocumentNode } from "@keating/learner-contracts";
import { createQuizPerformanceAttempt, exportQuizPerformanceEvidence } from "../keating/judgement/quiz-performance";
import { loadJudgementModelSettings, subscribeJudgementModelSettings } from "../keating/judgement-model";
import type { SharedUiActionIntent } from "../keating/openui/shared-actions";

type QuizNode = Extract<UiDocumentNode, { type: "quiz" }>;
type Attempt = ReturnType<typeof createQuizPerformanceAttempt>;
type Completion = Extract<SharedUiActionIntent, { type: "complete-quiz" }>;

/** Optional prediction never gates or disables the learner's answer controls. */
export function useQuizPerformance(options: { documentId: string; documentRevision: number; node: QuizNode; disabled: boolean; completed: boolean }) {
  const [settings, setSettings] = useState(loadJudgementModelSettings);
  const [started, setStarted] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedEstimate, setSavedEstimate] = useState(false);
  const [evidenceStatus, setEvidenceStatus] = useState("");
  const [download, setDownload] = useState<string>();
  const active = useRef<Attempt | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const touched = useRef(false);
  const epoch = useRef(0);
  const exportEpoch = useRef(0);
  const key = JSON.stringify([options.documentId, options.documentRevision, options.node]);
  const latestKey = useRef(key); latestKey.current = key;
  useEffect(() => {
    // The parent retains answers across source revisions; retain the touch guard too.
    setStarted(touched.current); setMessage(""); setBusy(false); setSavedEstimate(false); setEvidenceStatus(""); setDownload(undefined);
    return () => { epoch.current++; exportEpoch.current++; unsubscribe.current?.(); unsubscribe.current = null; active.current?.dispose(); active.current = null; };
  }, [key]);
  useEffect(() => subscribeJudgementModelSettings(next => {
    setSettings(next); epoch.current++; setBusy(false);
    if (active.current) setMessage("Judgement settings changed. Any saved prediction keeps its original model identity.");
  }), []);
  useEffect(() => {
    if (options.disabled) { epoch.current++; active.current?.dispose(); setBusy(false); }
  }, [options.disabled]);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download); }, [download]);
  const touch = () => {
    touched.current = true; setStarted(true); active.current?.touch();
    if (busy) { epoch.current++; setBusy(false); setMessage("Estimate cancelled because the quiz has started."); }
  };
  const estimate = async () => {
    if (touched.current || options.disabled || options.completed || busy || savedEstimate || settings.backend === "off") return;
    const generation = ++epoch.current;
    const capturedKey = key;
    unsubscribe.current?.(); active.current?.dispose();
    const attempt = createQuizPerformanceAttempt({
      documentId: options.documentId, documentRevision: options.documentRevision, node: options.node,
      source: { async getQuestionChecks(topic?: string) {
        const { getInitPromise, keatingStorage } = await import("../hooks/keating-storage");
        await getInitPromise(); return keatingStorage.getQuestionChecks(topic);
      } },
    });
    active.current = attempt;
    unsubscribe.current = attempt.subscribe(() => setEvidenceStatus(attempt.status()));
    setBusy(true); setMessage("");
    try {
      const result = await attempt.estimate();
      if (generation !== epoch.current || latestKey.current !== capturedKey) return;
      if (result.ok) {
        setSavedEstimate(true);
        setMessage(`Estimated ${result.expectedCorrect.toFixed(1)} of ${result.itemCount} objectively scored answers correct without an in-app hint. This is an uncalibrated prediction.`);
      } else setMessage("An estimate is unavailable for this attempt. You can continue the quiz.");
    } catch {
      if (generation === epoch.current) setMessage("The estimate could not be saved. You can continue the quiz.");
    } finally { if (generation === epoch.current) setBusy(false); }
  };
  const exportEvidence = async () => {
    const generation = ++exportEpoch.current;
    const capturedKey = key;
    try {
      const evidence = await exportQuizPerformanceEvidence({ documentId: options.documentId, nodeId: options.node.id });
      if (latestKey.current !== capturedKey || generation !== exportEpoch.current) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2) + "\n"], { type: "application/json" }));
      setDownload(url);
    } catch { if (generation === exportEpoch.current && latestKey.current === capturedKey) setMessage("Saved estimate records are unavailable on this device."); }
  };
  const controls = <details className="shared-activity__hint">
    <summary>Quiz estimate</summary>
    {!options.completed && <>
      <button type="button" className="shared-activity__quiet" disabled={options.disabled || started || busy || savedEstimate || settings.backend === "off"} onClick={() => void estimate()}>
        {busy ? "Estimating…" : savedEstimate ? "Prediction saved" : "Estimate before answering"}
      </button>
      <p>{settings.backend === "off" ? "Turn on judgement in Settings to request an estimate." : started && !savedEstimate ? "Estimates are available before you start answering." : settings.backend === "hosted" ? "Uses your hosted judgement service with this quiz and recent assessed work. Saves the estimate on this device to compare with your submitted answers." : "Uses your local judgement model. Saves the estimate on this device to compare with your submitted answers."}</p>
    </>}
    {message && <p role="status">{message}</p>}
    {evidenceStatus === "saved" && <p role="status">The prediction and submitted result are saved on this device. Hint tracking covers hints opened in this quiz.</p>}
    {evidenceStatus === "storage-failed" && <p role="status">Estimate records could not be saved. Your quiz answer is handled separately.</p>}
    {evidenceStatus === "unmatched" && <p role="status">This result could not be linked to the saved prediction.</p>}
    {options.completed && <>
      <button type="button" className="shared-activity__quiet" onClick={() => void exportEvidence()}>Prepare estimate records</button>
      {download && <p><a href={download} download="keating-quiz-estimates.json">Download estimate records</a></p>}
      <p>Records include question text, recent assessed answers, and model predictions. They stay on this device until you choose to share the download.</p>
    </>}
  </details>;
  return { controls, touch, hint(questionId: string) { touched.current = true; setStarted(true); active.current?.hint(questionId); },
    prepareSubmission(intent: Completion) {
      touched.current = true; setStarted(true);
      try { active.current?.prepareSubmission(intent); }
      catch { setMessage("The result could not be linked to its estimate. You can still save your answers."); }
    } };
}
