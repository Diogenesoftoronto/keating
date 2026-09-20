import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Text, TextInput, View } from "react-native";
import { Button } from "./Buttons";
import { spacing, useKeatingTheme } from "@/constants/theme";
import { importMobileDecisionPolicy, mobileDecisionPolicyStores, mobileDecisionPolicyEvidenceLabel } from "@/lib/judgement/decision-policies";
import type { VerifiedDecisionPolicy } from "../../../packages/learner-contracts/src/judgement/decision-policy-fit";
import type { DecisionPolicyTarget } from "../../../packages/learner-contracts/src/judgement/decision-policy-data";

const labels = { mastery: "Next-question correctness", retention: "Delayed card recall", urgency: "Due-deck lapse ranking" };
function PolicySetting({ target }: { target: DecisionPolicyTarget }) {
  const store = mobileDecisionPolicyStores[target], { colors, type } = useKeatingTheme();
  const revision = useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision);
  const [loaded, setLoaded] = useState<{ revision: number; policy: VerifiedDecisionPolicy | null } | null>(null);
  const [pin, setPin] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    void store.load().then(policy => { if (current) { setLoaded({ revision, policy }); setError(""); } })
      .catch(() => { if (current) { setLoaded({ revision, policy: null }); setError("The saved policy could not be verified. Remove it or import the original file again."); } });
    return () => { current = false; };
  }, [revision, store]);
  const policy = loaded?.revision === revision && store.isCurrent(revision) ? loaded.policy : null;
  const run = async (remove: boolean) => {
    if (busy) return; setBusy(true); setError("");
    try { if (remove) await store.remove(); else await importMobileDecisionPolicy(store, pin.trim().toLowerCase()); }
    catch { if (mounted.current) setError("Policy could not be verified or saved. Check its target, validation result and expected file hash."); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <View style={{ gap: spacing.sm }}>
    <Text style={{ ...type.label, color: colors.text }}>{labels[target]}</Text>
    <Text style={{ ...type.caption, color: colors.textMuted }}>{policy
      ? `${policy.artifact.selected} · fitted on ${[...new Set(policy.artifact.source.sources.map(source => source.provenance.dataset))].join(", ")}`
      : "No verified fitted policy active; existing rules remain in use."}</Text>
    {policy ? <Text selectable style={{ ...type.caption, color: colors.textMuted }}>{mobileDecisionPolicyEvidenceLabel(policy.artifact.dataset.labelKind)}{"\n"}{policy.artifact.domain}{"\n"}{[...new Set(policy.artifact.source.sources.map(source => `${source.provenance.origin}; ${source.provenance.revision}; schedules ${source.provenance.schedule}`))].join(" / ")}{"\n"}File SHA256: {policy.sha256}{"\n"}Fit: {policy.artifact.fitSha256}</Text> : null}
    <TextInput accessibilityLabel={`Expected ${labels[target]} policy SHA256`} value={pin} onChangeText={setPin}
      placeholder="Expected file SHA256" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} maxLength={64}
      editable={!busy} style={{ ...type.body, color: colors.text, borderWidth: 1, borderColor: colors.border, padding: spacing.sm }} />
    <Button compact variant="secondary" disabled={busy || !/^[a-f0-9]{64}$/iu.test(pin.trim())} loading={busy} onPress={() => void run(false)}>Import fitted policy</Button>
    <Button compact variant="quiet" disabled={busy} onPress={() => void run(true)}>Remove {labels[target].toLowerCase()} policy</Button>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text> : null}
  </View>;
}
export function MobileDecisionPolicySettings() {
  const { colors, type } = useKeatingTheme();
  return <View style={{ gap: spacing.lg }}>
    <Text style={{ ...type.label, color: colors.text }}>Fitted decision policies</Text>
    <Text style={{ ...type.caption, color: colors.textMuted }}>Import a validated policy report with its expected SHA256 (up to 16 MiB). Learn uses matching proxies locally and shows their dataset and fit identity. Synthetic judge fits predict model probabilities, not observed learning outcomes. Recorded-outcome fits describe their source dataset; neither establishes your personal calibration. Recorded scores, ratings and priorities stay intact.</Text>
    {(["mastery", "retention", "urgency"] as const).map(target => <PolicySetting key={target} target={target} />)}
  </View>;
}
