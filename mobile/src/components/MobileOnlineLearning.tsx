import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useFocusEffect } from "expo-router";
import { AppState, Text, View } from "react-native";
import type { PortableLearnerData } from "@keating/learner-contracts";
import { Button } from "./Buttons";
import { spacing, useKeatingTheme } from "@/constants/theme";
import { useNotOrganicAccount } from "@/state/NotOrganicAccountProvider";
import { defaultNotOrganicAccountConfig } from "@/lib/notorganic-account/contracts";
import { loadMobileTabularModels, notOrganicTabularRequest, type MobileTabularModel } from "@/lib/notorganic-account/client";
import { mobileOnlineLearningPreferences, mobileOnlineLearningRefreshKey, MOBILE_ONLINE_MODELS, type MobileOnlineModel, type MobileActivityLearningMode } from "@/lib/judgement/online-learning";
import { EMPTY_ONLINE_LEARNING, OnlineLearningSession, onlineLearningSummary, type OnlineLearningState } from "../../../shared/online-learning-session";

// Navigation retains the spending cooldown. Sign-out, account changes and disabling clear account-bound results.
const mobileOnlineSession = new OnlineLearningSession();
const accountSessions = new WeakMap<object, number>();
let nextAccountSession = 0;
function accountSessionId(session: object): number {
  let id = accountSessions.get(session);
  if (id === undefined) { id = ++nextAccountSession; accountSessions.set(session, id); }
  return id;
}

function useMobileOnlinePreference() {
  const account = useNotOrganicAccount();
  useSyncExternalStore(mobileOnlineLearningPreferences.subscribe, mobileOnlineLearningPreferences.getRevision, mobileOnlineLearningPreferences.getRevision);
  const accountId = account.session?.accountId ?? account.account?.did ?? account.account?.id;
  const issuer = account.session?.issuer;
  const scope = account.status === "signed-in" && issuer === defaultNotOrganicAccountConfig().issuer && accountId
    ? JSON.stringify([issuer, accountId]) : null;
  useEffect(() => { if (scope) void mobileOnlineLearningPreferences.load(scope); }, [scope]);
  return { account, scope, model: mobileOnlineLearningPreferences.get(scope), loaded: mobileOnlineLearningPreferences.loaded(scope),
    chatMode: mobileOnlineLearningPreferences.chatMode(scope),
    granted: !!scope && !!account.session?.scope.split(/\s+/).includes("tabular:predict") };
}

/** Refresh automatically only while Learn is visible, foregrounded and explicitly opted in. */
export function useMobileOnlineLearning(data: PortableLearnerData | null | undefined) {
  const preference = useMobileOnlinePreference();
  const [focused, setFocused] = useState(false), [foreground, setForeground] = useState(AppState.currentState === "active");
  const [clock, setClock] = useState(Date.now);
  const session = useRef(mobileOnlineSession);
  const [last, setLast] = useState<{ key: string; state: OnlineLearningState } | null>(null);
  useFocusEffect(useCallback(() => { setFocused(true); setClock(Date.now()); return () => { setFocused(false); session.current.cancel(); }; }, []));
  useEffect(() => {
    const listener = AppState.addEventListener("change", state => { setForeground(state === "active"); if (state === "active") setClock(Date.now()); else session.current.cancel(); });
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => { listener.remove(); clearInterval(timer); session.current.cancel(); };
  }, []);
  const scope = preference.scope && preference.account.session
    ? JSON.stringify([preference.scope, accountSessionId(preference.account.session)]) : null;
  const optedIn = preference.loaded && preference.granted && preference.model !== "off";
  const enabled = focused && foreground && optedIn;
  const key = useMemo(() => data ? mobileOnlineLearningRefreshKey(data, Date.now()) : "none", [data, clock]);
  const current = useRef({ data: data ?? null, scope, enabled });
  current.current = { data: data ?? null, scope, enabled };
  useEffect(() => {
    const coordinator = session.current;
    if (!optedIn || !scope) { coordinator.clear(); setLast(null); return; }
    if (!enabled || !current.current.data) { coordinator.cancel(); setLast(null); return; }
    const timer = setTimeout(() => {
      const latest = current.current;
      if (!latest.enabled || !latest.data || latest.scope !== scope) return;
      void coordinator.update({ data: latest.data, scope, asOf: Date.now(),
        transport: async (request, signal) => {
          const response = await notOrganicTabularRequest(request, signal);
          if (!response.ok) throw Error("Online predictions are unavailable.");
          return response.json();
        },
        current: () => current.current,
        publish: state => setLast({ key, state }),
      });
    }, 700);
    return () => { clearTimeout(timer); coordinator.cancel(); };
    // Raw snapshot identity and the minute clock must not cancel a paid request with unchanged evidence.
  }, [enabled, optedIn, scope, key]);
  const state = enabled && last?.key === key && last.state.scope === scope ? last.state : EMPTY_ONLINE_LEARNING;
  return { ...preference, enabled, state, results: state.results };
}

export function MobileOnlineLearning({ learning }: { learning: ReturnType<typeof useMobileOnlineLearning> }) {
  const { colors, type } = useKeatingTheme();
  if (learning.model === "off") return null;
  const receipts = Object.values(learning.results).map(result => result!.receipt);
  const updated = Math.max(0, ...receipts.map(receipt => receipt.updatedAt ?? 0));
  return <View style={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
    <Text style={{ ...type.label, color: colors.text }}>Adaptive learning · TabPFN 3.5</Text>
    <Text accessibilityLiveRegion="polite" style={{ ...type.caption, color: colors.textMuted }}>{!learning.granted
      ? "Authorize online predictions in Settings to continue."
      : learning.state.running ? "Checking recent learning evidence…" : learning.state.error ?? onlineLearningSummary(learning.results)}</Text>
    {updated > 0 ? <Text style={{ ...type.caption, color: colors.textMuted }}>Last checked {new Date(updated).toLocaleTimeString()}</Text> : null}
  </View>;
}

export function MobileOnlineLearningSettings() {
  const { colors, type } = useKeatingTheme(), preference = useMobileOnlinePreference();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [catalogue, setCatalogue] = useState<{ scope: string; models: MobileTabularModel[]; error: boolean } | null>(null);
  useEffect(() => {
    if (!preference.scope) { setCatalogue(null); return; }
    const scope = preference.scope, controller = new AbortController();
    void loadMobileTabularModels(controller.signal).then(models => {
      if (!controller.signal.aborted) setCatalogue({ scope, models, error: false });
    }).catch(() => { if (!controller.signal.aborted) setCatalogue({ scope, models: [], error: true }); });
    return () => controller.abort();
  }, [preference.scope, preference.granted]);
  const listed = catalogue?.scope === preference.scope ? catalogue : null;
  const select = async (model: MobileOnlineModel) => {
    if (!preference.scope || busy) return;
    setBusy(true); setError("");
    try { await mobileOnlineLearningPreferences.set(preference.scope, model); }
    catch { setError("This model selection could not be saved. Try again."); }
    finally { setBusy(false); }
  };
  const selectChatMode = async (mode: MobileActivityLearningMode) => {
    if (!preference.scope || busy) return;
    setBusy(true); setError("");
    try { await mobileOnlineLearningPreferences.setChatMode(preference.scope, mode); }
    catch { setError("This chat learning choice could not be saved. Try again."); }
    finally { setBusy(false); }
  };
  return <View style={{ gap: spacing.sm }}>
    <Text style={{ ...type.label, color: colors.text }}>Adaptive learning model</Text>
    <Text style={{ ...type.caption, color: colors.textMuted }}>Choose a model to update learning predictions while Learn is open and improve future teaching choices in chat. TabPFN receives numerical practice history through Not Organic; its requests contain no question text, answers, names or card content. Hosted requests use account credits.</Text>
    <Text style={{ ...type.caption, color: colors.textMuted }}>Background learning is the usual chat mode. Replies use the latest tested teaching preferences without waiting for TabPFN. New objective answers can improve those preferences for a later turn while this app is open. A decision model must also be enabled in Judgement settings; its normal review still takes time.</Text>
    <Text style={{ ...type.caption, color: colors.textMuted }}>At least 20 earlier observations and 5 later checks are needed. A prediction is used only when those later checks improve on the usual rule. These checks describe your recorded answers and self-reported recall; they do not establish which study choices caused learning.</Text>
    {!preference.scope || !preference.granted ? <Button compact variant="secondary" loading={preference.account.status === "authorizing"}
      onPress={() => void preference.account.login({ tabular: true })}>{preference.scope ? "Authorize online predictions" : "Sign in to choose a model"}</Button> : null}
    <Button compact variant={preference.model === "off" ? "secondary" : "quiet"} disabled={!preference.scope || busy} onPress={() => void select("off")}>Off · usual learning rules{preference.model === "off" ? " · selected" : ""}</Button>
    {MOBILE_ONLINE_MODELS.map(model => {
      const remote = listed?.models.find(candidate => candidate.id === model.id);
      const available = remote?.available && remote.priceMicrousd !== null && remote.priceMicrousd <= 100_000;
      const price = remote?.priceMicrousd !== null && remote?.priceMicrousd !== undefined
        ? (remote.priceMicrousd / 1_000_000).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 6 }) : null;
      return <View key={model.id} style={{ gap: spacing.xs }}>
        <Button compact variant={preference.model === model.id ? "secondary" : "quiet"}
          disabled={!preference.granted || !preference.loaded || !available || busy} onPress={() => void select(model.id)}>{model.label}{preference.model === model.id ? " · selected" : ""}</Button>
        <Text style={{ ...type.caption, color: colors.textMuted }}>{!preference.scope ? "Sign in to check availability and price." : !listed ? "Checking availability…" : !available ? "Currently unavailable for online predictions."
          : `${price} per batch · up to 3 batches per Learn update; background chat checks run at least a minute apart when linked evidence changes. Live comparisons can add 1 batch per eligible turn. Decision-model and tutor requests are billed separately.`}</Text>
      </View>;
    })}
    {preference.model !== "off" ? <View style={{ gap: spacing.xs }}>
      <Text style={{ ...type.label, color: colors.text }}>Chat learning</Text>
      <Button compact variant={preference.chatMode === "background" ? "secondary" : "quiet"} disabled={busy}
        onPress={() => void selectChatMode("background")}>Background · replies do not wait{preference.chatMode === "background" ? " · selected" : ""}</Button>
      <Button compact variant={preference.chatMode === "live" ? "secondary" : "quiet"} disabled={busy}
        onPress={() => void selectChatMode("live")}>Live comparisons · experimental{preference.chatMode === "live" ? " · selected" : ""}</Button>
      <Text style={{ ...type.caption, color: colors.textMuted }}>Live comparisons ask TabPFN to choose between approved replies before displaying one, adding up to 15 seconds. Background preferences are advisory and must still pass the usual teaching checks. Neither mode establishes that a teaching choice caused learning.</Text>
    </View> : null}
    {listed?.error ? <Text style={{ ...type.caption, color: colors.textMuted }}>The model catalogue could not be loaded. Return to Settings to retry.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ ...type.caption, color: colors.error }}>{error}</Text> : null}
  </View>;
}
