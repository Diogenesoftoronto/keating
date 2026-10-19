/**
 * Small subscriptions that keep the teacher's environment current: the voice
 * default for signed-in accounts, speech settings, trace export config,
 * search provenance, and the stored id of the active session.
 */
import { useEffect } from "react";
import { applyGptLiveDefaultIfUnset } from "../../keating/speech-default";
import { loadWebSpeechSettings, subscribeWebSpeechSettings, type WebSpeechSettings } from "../../keating/speech";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../../keating/model-prefs";
import { getArizePublicConfig } from "../../lib/arize-observability";
import { notOrganicPublicClient } from "../../notorganic-provider";
import { keatingStorage } from "../keating-storage";
import type { AgentHostRefs } from "./host-refs";

export function useAgentEnvironmentSync({
  refs,
  syncSpeechSettings,
  setActiveSessionId,
}: {
  refs: AgentHostRefs;
  syncSpeechSettings: (settings: WebSpeechSettings) => void;
  setActiveSessionId: (sessionId: string) => void;
}): void {
  // Signed-in Not Organic accounts start with GPT Live as their voice, unless a voice was already chosen.
  useEffect(() => {
    const apply = () => {
      try { applyGptLiveDefaultIfUnset(Boolean(notOrganicPublicClient()?.getSession())); } catch { /* session storage unavailable */ }
    };
    apply();
    window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, apply);
    return () => window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, apply);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeWebSpeechSettings(syncSpeechSettings);
    syncSpeechSettings(loadWebSpeechSettings());
    return unsubscribe;
  }, [syncSpeechSettings]);

  useEffect(() => {
    void getArizePublicConfig().then((config) => {
      refs.arizeConfigRef.current = config;
    });
  }, []);

  useEffect(() => {
    const turnOffArize = () => refs.arizeTraceClientRef.current?.turnOff();
    window.addEventListener("keating:arize-trace-turn-off", turnOffArize);
    return () =>
      window.removeEventListener("keating:arize-trace-turn-off", turnOffArize);
  }, []);

  useEffect(() => {
    const updateSearchTrust = (event: Event) => {
      const detail = (event as CustomEvent<{ untrusted?: boolean }>).detail;
      refs.untrustedSearchProvenanceRef.current = detail?.untrusted === true;
    };
    window.addEventListener("keating:search-provenance", updateSearchTrust);
    return () =>
      window.removeEventListener(
        "keating:search-provenance",
        updateSearchTrust,
      );
  }, []);

  useEffect(() => {
    setActiveSessionId(refs.sessionIdRef.current);
    keatingStorage.setCurrentSessionId(refs.sessionIdRef.current);
  }, [setActiveSessionId]);
}
