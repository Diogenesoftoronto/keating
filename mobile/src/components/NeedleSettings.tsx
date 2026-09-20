import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, AppState, StyleSheet, Text, View } from "react-native";
import { Button } from "./Buttons";
import { spacing, useKeatingTheme } from "../constants/theme";
import { needleDownload, removeNeedleModel } from "../lib/needle-model";
import { NEEDLE_MODEL } from "../lib/needle-contract";

export function NeedleSettings() {
  const { colors, type } = useKeatingTheme();
  const state = useSyncExternalStore(needleDownload.subscribe, needleDownload.snapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void needleDownload.refresh();
    const subscription = AppState.addEventListener("change", next => { if (next === "active") void needleDownload.refresh(); });
    return () => subscription.remove();
  }, []);
  const action = (run: () => Promise<void>) => {
    setBusy(true); setError(null);
    void run().catch(cause => setError(cause instanceof Error ? cause.message : "Could not update local recall."))
      .finally(() => setBusy(false));
  };
  const ready = state.phase === "ready";
  const downloading = state.phase === "downloading";
  const verifying = state.phase === "verifying";
  const progress = Math.min(100, Math.floor(state.bytes / NEEDLE_MODEL.bytes * 100));
  const muted = { ...type.body, color: colors.textMuted };
  const size = (NEEDLE_MODEL.bytes / 1e6).toFixed(0);
  return <View style={styles.root}>
    <Text style={{ ...type.label, color: colors.text }}>Needle · Local recall</Text>
    <Text style={muted}>Download {size} MB to help Keating find relevant excerpts from your earlier learning. Embeddings run on this device. Downloading enables local recall; remove the model to turn it off.</Text>
    <Text style={muted}>Exact earlier learner excerpts may be included in tutor requests, including requests to a hosted model when you choose one. Recall does not automatically save facts to your learner profile.</Text>
    <Text accessibilityLiveRegion="polite" style={{ ...type.body, color: colors.text }}>
      {ready ? "Downloaded and verified. Local recall is enabled." : verifying ? "Verifying model integrity…" : downloading ? "Downloading…" : state.phase === "paused" ? "Download paused." : state.phase === "checking" ? "Checking device storage…" : "Optional download"}
    </Text>
    {!ready && (state.bytes > 0 || downloading) && <View accessibilityRole="progressbar" accessibilityLabel="Local recall model download" accessibilityValue={{ min: 0, max: 100, now: progress }}>
      <View style={[styles.track, { backgroundColor: colors.border }]}><View style={[styles.fill, { backgroundColor: colors.primary, width: `${progress}%` }]} /></View>
      <Text style={muted}>{(state.bytes / 1e6).toFixed(0)} / {size} MB saved ({progress}%)</Text>
    </View>}
    <View style={styles.actions}>
      {!ready && !downloading && !verifying && <Button compact disabled={busy || state.phase === "checking" || state.phase === "unavailable"} onPress={() => {
        setError(null);
        void needleDownload.start().catch(cause => setError(cause instanceof Error ? cause.message : "Could not start the download."));
      }}>{state.bytes ? "Resume download" : "Download local recall"}</Button>}
      {downloading && <Button compact variant="secondary" disabled={busy} onPress={() => action(() => needleDownload.pause())}>Pause download</Button>}
      {(ready || state.bytes > 0 || downloading || verifying || state.phase === "error") && <Button compact variant="quiet" disabled={busy} onPress={() => {
        if (!ready && state.phase !== "error") { action(() => removeNeedleModel(false)); return; }
        Alert.alert("Remove local recall model?", "This turns off local recall and removes the downloaded model. Your lessons stay on this device.", [
          { text: "Keep model", style: "cancel" },
          { text: "Remove model", style: "destructive", onPress: () => action(() => removeNeedleModel(true)) },
        ]);
      }}>{ready || state.phase === "error" ? "Remove model" : "Cancel download"}</Button>}
    </View>
    {(downloading || verifying) && <Text style={muted}>Keep Keating open. The download pauses in the background. Resume here when ready.</Text>}
    {error || state.error ? <Text accessibilityRole="alert" style={{ ...type.body, color: colors.error }}>{error ?? state.error}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: spacing.md }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  track: { height: 6, borderRadius: 3, overflow: "hidden", marginBottom: spacing.sm }, fill: { height: 6 },
});
