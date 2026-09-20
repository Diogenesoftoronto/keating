import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Text, TextInput, View } from "react-native";
import { Button } from "./Buttons";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { importMobileJudgementCalibration, mobileJudgementCalibrationStore, mobileLocalJudgementCalibrationStore, type InstalledMobileCalibration } from "@/lib/judgement/calibration";

/** Device-local measured calibration installation; importing never enables hosted review. */
export function MobileJudgementCalibrationSettings({ local = false }: { local?: boolean } = {}) {
  const store = local ? mobileLocalJudgementCalibrationStore : mobileJudgementCalibrationStore;
  const { colors, type } = useKeatingTheme();
  const revision = useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision);
  const [installed, setInstalled] = useState<InstalledMobileCalibration | null>(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true; setLoading(true);
    void store.load().then(value => { if (active) { setInstalled(value); setLoadError(""); } })
      .catch(() => { if (active) { setInstalled(null); setLoadError("The saved calibration could not be verified. Import it again or remove it."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, store]);
  const importArtifact = async () => {
    if (busy) return; setBusy(true); setError("");
    try {
      const result = await importMobileJudgementCalibration(pin.trim().toLowerCase(), { store });
      if (mounted.current && result) { setInstalled(result); setPin(""); }
    } catch { if (mounted.current) setError("Calibration could not be verified or saved. Check the file and its expected SHA256, then try again."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const remove = async () => {
    if (busy) return; setBusy(true); setError("");
    try { await store.remove(); if (mounted.current) setInstalled(null); }
    catch { if (mounted.current) setError("Calibration could not be removed from this device. Try again."); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <View style={{ gap: spacing.sm }}>
    <Text style={{ ...type.body, color: colors.text, fontWeight: "700" }}>{local ? "Local model calibration" : "Hosted model calibration"}</Text>
    <Text style={{ ...type.caption, color: colors.textMuted }}>Import an independently validated calibration file to use its measured thresholds for matching questions. It stays on this device and keeps your review permission unchanged.</Text>
    <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{loading || busy ? "Checking device calibration…" : installed
      ? `${installed.backend.model} · ${installed.questionCount} calibrated question${installed.questionCount === 1 ? "" : "s"}` : "No verified calibration installed"}</Text>
    {installed && !busy ? <>
      <Text selectable style={{ ...type.caption, color: colors.textMuted }}>File SHA256: {installed.fileSha256}</Text>
      <Text selectable style={{ ...type.caption, color: colors.textMuted }}>Fitted identity: {installed.backend.calibrationSha256}</Text>
    </> : null}
    <Text style={{ ...type.caption, color: colors.text }}>Expected file SHA256</Text>
    <TextInput accessibilityLabel="Expected calibration file SHA256" value={pin} onChangeText={setPin}
      editable={!busy} autoCapitalize="none" autoCorrect={false} maxLength={64}
      style={{ ...type.body, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, padding: spacing.sm }} />
    <Text style={{ ...type.caption, color: colors.textMuted }}>Use the file hash supplied with the calibration report. Select a JSON file for {local ? "this exact MiniCPM5 model and native scorer" : "one hosted model"}, up to 5 MiB.</Text>
    <Button compact variant="secondary" loading={busy} disabled={busy || !/^[a-f0-9]{64}$/iu.test(pin.trim())} onPress={() => void importArtifact()}>Import calibration file</Button>
    {installed || error || loadError ? <Button compact variant="quiet" disabled={busy} onPress={() => void remove()}>Remove device calibration</Button> : null}
    {(error || loadError) && !busy ? <Text accessibilityRole="alert" style={{ color: colors.text }}>{error || loadError}</Text> : null}
  </View>;
}
