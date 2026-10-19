/**
 * Small timers and lookups used by the chat thread.
 */
import { useEffect, useState } from "react";
import { getProviderApiKey } from "../../lib/provider-models";

/** Whether a Google key exists, looked up only while the composer contains a URL. */
export function useGoogleKeyForUrls(composerHasUrl: boolean): boolean | null {
  const [hasGoogleKey, setHasGoogleKey] = useState<boolean | null>(null);
  useEffect(() => {
    if (!composerHasUrl) {
      setHasGoogleKey(null);
      return;
    }

    let cancelled = false;
    getProviderApiKey("google")
      .then((key) => {
        if (!cancelled) setHasGoogleKey(!!key);
      })
      .catch(() => {
        if (!cancelled) setHasGoogleKey(false);
      });

    return () => {
      cancelled = true;
    };
  }, [composerHasUrl]);
  return hasGoogleKey;
}

/** Advances every 2.2s while a reply runs, so the pending status can rotate; resets when idle. */
export function useLoadingStep(isRunning: boolean): number {
  const [loadingStep, setLoadingStep] = useState(0);
  useEffect(() => {
    if (!isRunning) {
      setLoadingStep(0);
      return;
    }
    const id = window.setInterval(
      () => setLoadingStep((current) => current + 1),
      2200,
    );
    return () => window.clearInterval(id);
  }, [isRunning]);
  return loadingStep;
}
