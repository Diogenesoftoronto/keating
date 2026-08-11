import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { loadUiSettings, saveUiSettings } from "@/lib/ui-settings-storage";
import { DEFAULT_UI_SETTINGS, type KeatingUiSettings } from "@/lib/ui-settings";

interface UiSettingsContextValue {
  settings: KeatingUiSettings;
  /** True once the stored preferences have replaced the defaults. */
  loaded: boolean;
  updateSettings: (patch: Partial<KeatingUiSettings>) => void;
}

const UiSettingsContext = createContext<UiSettingsContextValue | null>(null);

/**
 * Sits above the theme provider so the stored appearance is known before any
 * screen paints, and above the session provider so both can read it.
 */
export function UiSettingsProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<KeatingUiSettings>(DEFAULT_UI_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadUiSettings()
      .then((stored) => {
        if (cancelled) return;
        setSettings(stored);
      })
      .finally(() => {
        if (cancelled) return;
        loadedRef.current = true;
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback((patch: Partial<KeatingUiSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      // Writing before the initial read lands would persist the defaults over
      // whatever the learner had already chosen.
      if (loadedRef.current) {
        saveUiSettings(next).catch((error) => console.warn("Failed to save UI settings:", error));
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, loaded, updateSettings }), [settings, loaded, updateSettings]);
  return <UiSettingsContext.Provider value={value}>{children}</UiSettingsContext.Provider>;
}

export function useUiSettings(): UiSettingsContextValue {
  const context = useContext(UiSettingsContext);
  if (!context) throw new Error("useUiSettings must be used inside UiSettingsProvider.");
  return context;
}
