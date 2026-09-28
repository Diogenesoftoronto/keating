import { useEffect, useState, useSyncExternalStore } from "react";
import { Switch, Text, View } from "react-native";
import { Button } from "./Buttons";
import { spacing, useKeatingTheme } from "@/constants/theme";
import { useUiSettings } from "@/state/UiSettingsProvider";
import { juliaDownloads, mobileJuliaSupported, pauseJuliaDownload, refreshJuliaDownload, removeJuliaModel, startJuliaDownload } from "@/lib/judgement/julia-model";
import { JULIA_TOTAL_BYTES } from "../../../shared/julia/manifest";

const subscribe = (listener: () => void) => { const unsubscribes = juliaDownloads.map(({ download }) => download.subscribe(listener)); return () => unsubscribes.forEach(unsubscribe => unsubscribe()); };
const snapshot = () => juliaDownloads.map(({ download }) => `${download.state.phase}:${download.state.bytes}:${download.state.error ?? ""}`).join("|");
export function JuliaJudgementSettings() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const { settings, updateSettings } = useUiSettings();
  const { colors } = useKeatingTheme();
  const [error, setError] = useState("");
  useEffect(() => { if (mobileJuliaSupported) void refreshJuliaDownload(); }, []);
  const ready = juliaDownloads.every(({ download }) => download.state.phase === "ready");
  const busy = juliaDownloads.some(({ download }) => ["downloading", "verifying"].includes(download.state.phase));
  const bytes = juliaDownloads.reduce((total, { download }) => total + download.state.bytes, 0);
  const failure = juliaDownloads.find(({ download }) => download.state.error)?.download.state.error;
  const remove = async () => { try { setError(""); await removeJuliaModel(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Julia removal failed."); } };
  return <View style={{ gap: spacing.sm }}>
    <Text style={{ color: colors.text }}>Review on this device with Julia 1 · 144M</Text>
    <Switch accessibilityLabel="Use Julia 1 for local judgement" disabled={!mobileJuliaSupported || !ready && settings.judgementLocalModel !== "julia-1"} value={settings.judgementLocalModel === "julia-1"}
      onValueChange={enabled => updateSettings({ judgementLocalModel: enabled ? "julia-1" : "off" })} />
    <Text style={{ color: colors.textMuted }}>A separate decision model, independent of your tutor. Android CPU, four threads, one request at a time, 1,024 tokens; inputs exceeding its lossless limits are declined. Tutor weights are unloaded during review. Its {Math.ceil(JULIA_TOTAL_BYTES / 1_000_000)} MB verified download needs additional working memory.</Text>
    <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{!mobileJuliaSupported ? "Julia requires an updated native Android build; unavailable in Expo Go and mobile web." : ready ? "Julia files verified. Install matching calibration separately below. Without its measured thresholds, automatic grading and recommendations abstain and grades stay pending." : `${Math.floor(bytes / 1_000_000)} / ${Math.ceil(JULIA_TOTAL_BYTES / 1_000_000)} MB downloaded`}</Text>
    {!ready && mobileJuliaSupported ? <Button compact variant="secondary" onPress={() => void (busy ? pauseJuliaDownload() : startJuliaDownload())}>{busy ? "Pause Julia download" : bytes ? "Resume Julia download" : "Download Julia 1"}</Button> : null}
    {bytes > 0 && mobileJuliaSupported ? <Button compact variant="quiet" onPress={() => void remove()}>Remove Julia files</Button> : null}
    {failure || error ? <Text accessibilityRole="alert" style={{ color: colors.text }}>{error || failure}</Text> : null}
  </View>;
}
