import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, AppState, StyleSheet, Text, View } from "react-native";
import { Button } from "./Buttons";
import { useKeatingTheme, spacing } from "../constants/theme";
import { offlineDownload, removeOfflineModel } from "../lib/offline-model";
import { OFFLINE_MODEL } from "../lib/offline-model-contract";

export function OfflineTutorSettings({ selected, onUse, disabled = false }: {
  selected: boolean; onUse: () => void; disabled?: boolean;
}) {
  const { colors, type } = useKeatingTheme();
  const state = useSyncExternalStore(offlineDownload.subscribe, offlineDownload.snapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (state.phase === "unavailable") return;
    void offlineDownload.refresh();
    const subscription = AppState.addEventListener("change", (value) => { if (value === "active") void offlineDownload.refresh(); });
    return () => subscription.remove();
  }, []);
  const action = (run: () => Promise<void>) => {
    setBusy(true); setError(null);
    void run().catch((failure) => setError(failure instanceof Error ? failure.message : "Could not update the offline tutor."))
      .finally(() => setBusy(false));
  };
  const downloading = state.phase === "downloading";
  const verifying = state.phase === "verifying";
  const ready = state.phase === "ready";
  const progress = Math.min(100, Math.floor(state.bytes / OFFLINE_MODEL.bytes * 100));
  const muted = { ...type.body, color: colors.textMuted };
  return (
    <View style={styles.root}>
      <Text style={{ ...type.label, color: colors.text }}>{OFFLINE_MODEL.name} · Text only</Text>
      <Text style={muted}>
        Download 1.55 GB once to chat without an account or internet. Kept through app updates; you can remove it here. Wi-Fi recommended.
      </Text>
      <Text style={muted}>Images need a vision model. Dictation uses online transcription when an OpenAI or Google key is configured. Type messages for fully offline use.</Text>
      {state.phase === "unavailable" ? (
        <Text accessibilityRole="alert" style={muted}>{state.error ? "Choose a configured online model to chat on this device." : "Install the native Keating app to use the offline tutor. Expo Go and the mobile web preview do not include LiteRT."}</Text>
      ) : (
        <>
          <Text accessibilityLiveRegion="polite" style={{ ...type.body, color: colors.text }}>
            {ready ? "Downloaded and verified. Ready offline." : verifying ? "Checking download integrity…" : downloading ? "Downloading…" : state.phase === "paused" ? "Download paused. Resume when ready." : state.phase === "checking" ? "Checking device storage…" : "Optional download"}
          </Text>
          {(state.bytes > 0 || downloading) && !ready ? (
            <View accessibilityRole="progressbar" accessibilityLabel="Offline tutor download" accessibilityValue={{ min: 0, max: 100, now: progress }}>
              <View style={[styles.track, { backgroundColor: colors.border }]}>
                <View style={[styles.fill, { backgroundColor: colors.primary, width: `${progress}%` }]} />
              </View>
              <Text style={muted}>{(state.bytes / 1e9).toFixed(2)} / 1.55 GB ({progress}%) saved</Text>
            </View>
          ) : null}
          <Text style={muted}>{(state.freeBytes / 1e9).toFixed(2)} GB free on this device. Running the tutor also needs additional memory.</Text>
          <View style={styles.actions}>
            {ready ? <Button compact disabled={selected || disabled || busy} onPress={onUse}>{selected ? "Offline tutor selected" : "Use offline tutor"}</Button> : null}
            {!ready && !downloading && !verifying ? (
              <Button compact disabled={state.phase === "checking" || busy} onPress={() => { setError(null); void offlineDownload.start(); }}>
                {state.bytes ? "Resume download" : "Download offline tutor"}
              </Button>
            ) : null}
            {downloading ? <Button compact variant="secondary" disabled={busy} onPress={() => action(() => offlineDownload.pause())}>Pause download</Button> : null}
            {(state.bytes > 0 || downloading || verifying || ready || state.phase === "error") ? (
              <Button compact variant="quiet" disabled={busy || disabled} onPress={() => {
                if (!ready && state.phase !== "error" && state.bytes < OFFLINE_MODEL.bytes) { action(() => removeOfflineModel(false)); return; }
                Alert.alert("Remove offline tutor?", "Free the model's storage. Your lessons and saved notes will stay. You can download the tutor again later.", [
                  { text: "Keep tutor", style: "cancel" },
                  { text: "Remove tutor", style: "destructive", onPress: () => action(() => removeOfflineModel(true)) },
                ]);
              }}>{ready || state.phase === "error" ? "Remove offline tutor" : "Cancel download"}</Button>
            ) : null}
          </View>
          {downloading || verifying ? <Text style={muted}>Keep Keating open. Downloads pause when the app goes into the background and resume from saved bytes.</Text> : null}
        </>
      )}
      {error || state.error ? <Text accessibilityRole="alert" style={{ ...type.body, color: colors.error }}>{error ?? state.error}</Text> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: spacing.md }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  track: { height: 6, borderRadius: 3, overflow: "hidden", marginBottom: spacing.sm }, fill: { height: 6 },
});
