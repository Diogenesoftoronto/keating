import { useEffect, useMemo, useState } from "react";
import { css } from "../../../styled-system/css";
import { DECISION_POLICY_TARGETS, type DecisionPolicyTarget } from "../../../../packages/learner-contracts/src/judgement/decision-policy-data";
import { MAX_DECISION_POLICY_FIT_BYTES } from "../../../../packages/learner-contracts/src/judgement/decision-policy-fit";
import { WebDecisionPolicyStore, subscribeWebDecisionPolicies, webDecisionPolicyEvidenceLabel, type WebDecisionPolicies } from "../../keating/judgement/decision-policies";

export function DecisionPolicySettings() {
  const store = useMemo(() => new WebDecisionPolicyStore(), []), [policies, setPolicies] = useState<WebDecisionPolicies>({});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    let current = true, generation = 0;
    const load = async () => { const revision = ++generation;
      const rows = await Promise.all(DECISION_POLICY_TARGETS.map(async target => [target, await store.load(target)] as const));
      if (current && generation === revision) setPolicies(Object.fromEntries(rows.filter(([, policy]) => policy)));
    };
    void load(); const unsubscribe = subscribeWebDecisionPolicies(() => { void load(); });
    return () => { current = false; unsubscribe(); };
  }, [store]);
  const install = async (target: DecisionPolicyTarget, file: File) => {
    setBusy(true); setMessage("Checking the source evidence and held-out comparison…");
    try {
      if (file.size > MAX_DECISION_POLICY_FIT_BYTES) throw new Error("Policy file is too large");
      await store.import(target, await file.text()); setMessage(`${target} fit installed on this device.`);
    } catch { setMessage("This file could not be verified for that target. The existing policy is unchanged."); }
    finally { setBusy(false); }
  };
  return <section id="settings-section-decision-policies" className={css({ display: "grid", gap: "0.75rem" })}>
    <h3 className={css({ fontSize: "1rem", fontWeight: 600 })}>Fitted learning estimates</h3>
    <p className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)" })}>Import a source-verified fit for Coming Up. Estimates use saved answers and reviews. Urgency can reorder due decks within your chosen priority; a fixed 10% retain the usual ordering.</p>
    {DECISION_POLICY_TARGETS.map(target => <div key={target} className={css({ display: "grid", gap: "0.5rem", border: "1px solid var(--border)", p: "0.75rem" })}>
      <strong>{target === "mastery" ? "Independent-answer prediction" : target === "retention" ? "Delayed recall" : "Due-deck lapse risk"}</strong>
      {policies[target] ? <p>{webDecisionPolicyEvidenceLabel(policies[target]!.artifact.dataset.labelKind)}. {policies[target]!.artifact.selected}. File {policies[target]!.sha256.slice(0, 12)}.</p> : <p>No verified fit installed.</p>}
      <label>Import {target} fit <input type="file" accept="application/json,.json" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void install(target, file); }} /></label>
      {policies[target] ? <button type="button" disabled={busy} onClick={() => { setBusy(true); void store.remove(target).then(() => setMessage(`${target} fit removed.`)).catch(() => setMessage("Removal failed. Please try again.")).finally(() => setBusy(false)); }}>Remove {target} fit</button> : null}
    </div>)}
    <p role="status">{message}</p>
  </section>;
}
