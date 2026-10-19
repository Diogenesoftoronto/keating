/**
 * Browser storage persistence for saved sessions: checks whether it is
 * granted, asks once at bootstrap, and lets the learner retry from the banner.
 */
import { useCallback, useEffect, useRef } from "react";
import type { PostHog } from "posthog-js";
import {
  savePersistentStorageStatus,
  useKeatingAgentStore,
  type PersistentStorageStatus,
} from "../../stores/keating-agent-store";
import {
  browserPersistentStorageGranted,
  requestBrowserPersistentStorage,
} from "./persistent-storage";

/** Hide a "declined" status until the browser has actually been checked. */
export function visiblePersistentStorageStatus(
  status: PersistentStorageStatus,
  checked: boolean,
): PersistentStorageStatus {
  return status === "declined" && !checked ? "unknown" : status;
}

export function usePersistentStorage(posthog: Pick<PostHog, "capture">) {
  const persistentStorageStatus = useKeatingAgentStore(
    (state) => state.persistentStorageStatus,
  );
  const setPersistentStorageStatus = useKeatingAgentStore(
    (state) => state.setPersistentStorageStatus,
  );
  const persistentStorageChecked = useKeatingAgentStore(
    (state) => state.persistentStorageChecked,
  );
  const setPersistentStorageChecked = useKeatingAgentStore(
    (state) => state.setPersistentStorageChecked,
  );
  const persistentBannerDismissed = useKeatingAgentStore(
    (state) => state.persistentBannerDismissed,
  );
  const dismissPersistentBanner = useKeatingAgentStore(
    (state) => state.dismissPersistentBanner,
  );
  const persistentStorageRequestedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void browserPersistentStorageGranted().then((granted) => {
      if (cancelled) return;
      if (granted) {
        setPersistentStorageStatus("granted");
        savePersistentStorageStatus("granted");
      }
      setPersistentStorageChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const requestPersistentStorageOnce = useCallback(() => {
    if (persistentStorageRequestedRef.current) return;
    if (persistentBannerDismissed || persistentStorageStatus !== "unknown")
      return;
    persistentStorageRequestedRef.current = true;
    void requestBrowserPersistentStorage()
      .then((nextStatus) => {
        setPersistentStorageStatus(nextStatus);
        savePersistentStorageStatus(
          nextStatus as Exclude<PersistentStorageStatus, "unknown">,
        );
        setPersistentStorageChecked(true);
        posthog.capture("persistent_storage_requested", {
          granted: nextStatus === "granted",
        });
      })
      .catch((error) => {
        setPersistentStorageStatus("declined");
        savePersistentStorageStatus("declined");
        setPersistentStorageChecked(true);
        posthog.capture("persistent_storage_requested", { granted: false });
        console.warn("Persistent storage request failed:", error);
      });
  }, [
    persistentBannerDismissed,
    persistentStorageStatus,
    posthog,
    setPersistentStorageChecked,
    setPersistentStorageStatus,
  ]);

  const retryPersistentStorage = useCallback(() => {
    persistentStorageRequestedRef.current = false;
    void requestBrowserPersistentStorage()
      .then((nextStatus) => {
        setPersistentStorageStatus(nextStatus);
        savePersistentStorageStatus(
          nextStatus as Exclude<PersistentStorageStatus, "unknown">,
        );
        setPersistentStorageChecked(true);
        posthog.capture("persistent_storage_retried", {
          granted: nextStatus === "granted",
        });
      })
      .catch((error) => {
        setPersistentStorageStatus("declined");
        savePersistentStorageStatus("declined");
        setPersistentStorageChecked(true);
        posthog.capture("persistent_storage_retried", { granted: false });
        console.warn("Persistent storage retry failed:", error);
      })
      // If the browser silently denies persistence, stop nagging for this
      // session instead of leaving a banner the user cannot resolve.
      .finally(() => dismissPersistentBanner());
  }, [
    dismissPersistentBanner,
    posthog,
    setPersistentStorageChecked,
    setPersistentStorageStatus,
  ]);

  return {
    persistentStorageStatus: visiblePersistentStorageStatus(persistentStorageStatus, persistentStorageChecked),
    persistentBannerDismissed,
    dismissPersistentBanner,
    requestPersistentStorageOnce,
    retryPersistentStorage,
  };
}
