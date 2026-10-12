import { useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_ONLINE_LEARNING, OnlineLearningSession, type OnlineLearningState } from "../../../shared/online-learning-session";
import type { PortableLearnerData } from "@keating/learner-contracts";
import { ONLINE_LEARNING_CHANGED, onlineLearningAccount, onlineLearningChatMode, onlineLearningEnabled, onlineLearningModel, requestOnlinePredictions } from "../keating/judgement/tabular-account";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../keating/model-prefs";
import { onlineDecisionEvidenceId } from "../../../packages/learner-contracts/src/judgement/online-decision-policy";
import { DECISION_POLICY_TARGETS } from "../../../packages/learner-contracts/src/judgement/decision-policy-data";

// Keep receipts and the spending cooldown through page navigation. Account changes clear both.
const webOnlineLearningSession = new OnlineLearningSession();

export function useOnlineLearningPreference() {
  const read = () => { const account = onlineLearningAccount(); return { ...account, model: onlineLearningModel(account.scope), chatMode: onlineLearningChatMode(account.scope), enabled: account.authorized && onlineLearningEnabled(account.scope) }; };
  const [preference, setPreference] = useState(read);
  useEffect(() => {
    const refresh = () => setPreference(previous => { const next = read();
      return previous.scope === next.scope && previous.enabled === next.enabled && previous.authorized === next.authorized && previous.model === next.model && previous.chatMode === next.chatMode ? previous : next; });
    const events = [ONLINE_LEARNING_CHANGED, PROVIDER_CREDENTIALS_CHANGED_EVENT, "storage", "focus"];
    events.forEach(event => window.addEventListener(event, refresh));
    const interval = window.setInterval(refresh, 5_000);
    return () => { events.forEach(event => window.removeEventListener(event, refresh)); window.clearInterval(interval); };
  }, []);
  return preference;
}
export function useOnlineLearning(data: PortableLearnerData | null, asOf: number) {
  const preference = useOnlineLearningPreference();
  const coordinator = webOnlineLearningSession;
  const [state, setState] = useState<OnlineLearningState>(EMPTY_ONLINE_LEARNING);
  const current = useRef({ data, ...preference }); current.current = { data, ...preference };
  const evidenceKey = data ? DECISION_POLICY_TARGETS.map(target => onlineDecisionEvidenceId(data, target, asOf)).join(":") : null;
  useEffect(() => {
    if (!data || !preference.enabled || !preference.scope) { coordinator.clear(); setState(EMPTY_ONLINE_LEARNING); return; }
    const scope = preference.scope;
    const timer = window.setTimeout(() => { void coordinator.update({ data, scope, asOf: Date.now(),
      current: () => {
        const account = onlineLearningAccount();
        return { data: current.current.data, scope: account.scope, enabled: account.authorized && onlineLearningEnabled(account.scope) };
      }, transport: (request, signal) => requestOnlinePredictions(request, scope, signal), publish: setState }); }, 750);
    return () => { window.clearTimeout(timer); coordinator.cancel(); };
    // Re-exports and minute ticks retain the in-flight request until actual evidence or the hour changes.
  }, [evidenceKey, preference.scope, preference.enabled, coordinator]);
  const freshState = useMemo(() => {
    if (!data || !preference.enabled || state.scope !== preference.scope) return EMPTY_ONLINE_LEARNING;
    return { ...state, results: Object.fromEntries(DECISION_POLICY_TARGETS.flatMap(target => {
      const result = state.results[target];
      return result && result.receipt.evidenceId === onlineDecisionEvidenceId(data, target, asOf)
        && result.receipt.expiresAt > Date.now() ? [[target, result]] : [];
    })) };
  }, [data, asOf, preference.enabled, preference.scope, state]);
  return { ...preference, state: freshState };
}
