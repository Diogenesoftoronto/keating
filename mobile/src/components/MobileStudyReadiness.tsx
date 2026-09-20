import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useFocusEffect } from "expo-router";
import { Text, View } from "react-native";
import type { PortableLearnerData } from "@keating/learner-contracts";
import { Button } from "@/components/Buttons";
import { useKeatingTheme } from "@/constants/theme";
import { mobileReadinessSourceKey, reviewMobileStudyReadiness, type MobileReadinessResult, type MobileReadinessSnapshot } from "@/lib/judgement/readiness";
import { useUiSettings } from "@/state/UiSettingsProvider";
import { mobileJudgementCalibrationStore, mobileLocalJudgementCalibrationStore } from "@/lib/judgement/calibration";

const BLOCKED = { "not-due": "Not due", "not-covered": "No recorded exposure", "unknown-prerequisites": "Prerequisite graph unknown", "unmet-prerequisite": "Prerequisite exposure missing", "no-work": "No saved answers" } as const;

/** Transient, explicitly requested review. The ordinary Coming Up board remains usable. */
export function MobileStudyReadiness({ data, nowIso, onStudy }: { data: PortableLearnerData; nowIso: string; onStudy: (id: string) => void }) {
  const { settings, loaded } = useUiSettings();
  const theme = useKeatingTheme();
  const calibrationRevision = useSyncExternalStore(mobileJudgementCalibrationStore.subscribe, mobileJudgementCalibrationStore.getRevision, mobileJudgementCalibrationStore.getRevision);
  const localCalibrationRevision = useSyncExternalStore(mobileLocalJudgementCalibrationStore.subscribe, mobileLocalJudgementCalibrationStore.getRevision, mobileLocalJudgementCalibrationStore.getRevision);
  const snapshot = useMemo<MobileReadinessSnapshot>(() => ({ data, nowIso, hostedEnabled: loaded && settings.judgementHosted,
    localEnabled: loaded && settings.judgementLocalModel === "minicpm5-2b-int4", calibrationRevision, localCalibrationRevision }),
    [data, nowIso, loaded, settings.judgementHosted, settings.judgementLocalModel, calibrationRevision, localCalibrationRevision]);
  const key = useMemo(() => mobileReadinessSourceKey(snapshot), [snapshot]);
  const current = useRef<MobileReadinessSnapshot | null>(snapshot);
  current.current = snapshot;
  const focused = useRef(true);
  const pending = useRef<AbortController | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<MobileReadinessResult | null>(null);
  useEffect(() => { pending.current?.abort(); setReceipt(null); setBusyKey(null); return () => { pending.current?.abort(); }; }, [key]);
  useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; pending.current?.abort(); setReceipt(null); setBusyKey(null); }; }, []));
  const visible = receipt?.sourceKey === key ? receipt : null;
  const selected = visible?.review.status === "selected" ? visible.candidates.find(candidate => candidate.id === visible.review.selectedId) : null;
  const run = async () => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller; setBusyKey(key); setReceipt(null);
    try {
      const result = await reviewMobileStudyReadiness(snapshot, { current: () => focused.current ? current.current : null, signal: controller.signal });
      if (pending.current === controller && !controller.signal.aborted) setReceipt(result);
    } finally { if (pending.current === controller) { pending.current = null; setBusyKey(null); } }
  };
  return <View style={{ gap: 8 }}>
    <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700" }}>Readiness review</Text>
    <Text style={{ color: theme.colors.textMuted }}>Checks due work against known prerequisites and your 12 latest relevant saved answers. Exposure alone does not establish mastery.</Text>
    {!(snapshot.hostedEnabled || snapshot.localEnabled) ? <Text style={{ color: theme.colors.textMuted }}>Choose local or hosted judgement in Settings to request estimates.</Text> : null}
    <Button compact variant="secondary" disabled={!(snapshot.hostedEnabled || snapshot.localEnabled) || key === null} loading={key !== null && busyKey === key} onPress={() => void run()}>Review next study options</Button>
    {key === null ? <Text style={{ color: theme.colors.textMuted }}>Readiness review is unavailable for this learner snapshot.</Text> : null}
    {visible ? <View style={{ gap: 6 }}>
      <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.text }}>{selected ? `Suggested review: ${selected.title}`
        : visible.review.status === "uncalibrated" ? "Uncalibrated estimates · no recommendation"
        : visible.review.status === "no-ready-candidate" ? "No review passed the readiness gates"
        : visible.review.status === "cancelled" ? "Review cancelled; request a fresh review"
        : "Readiness unavailable · keep using your current plan"}</Text>
      {visible.review.estimates.map(estimate => <Text key={estimate.id} style={{ color: theme.colors.textMuted }}>{visible.candidates.find(candidate => candidate.id === estimate.id)?.title ?? estimate.id}: readiness estimate {Math.round(estimate.probability * 100)}% · model estimate · {estimate.backend.model}</Text>)}
      {visible.review.blocked.map(blocked => <Text key={blocked.id} style={{ color: theme.colors.textMuted }}>{visible.candidates.find(candidate => candidate.id === blocked.id)?.title ?? blocked.id}: {BLOCKED[blocked.reason]}</Text>)}
      {selected ? <Button compact onPress={() => onStudy(selected.id)}>Start suggested review</Button> : null}
    </View> : null}
  </View>;
}
