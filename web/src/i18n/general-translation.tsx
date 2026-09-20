import { useSyncExternalStore, type ReactNode } from "react";
import { GTProvider, initializeGTSPA } from "gt-react";
import gtConfig from "../../gt.config.json";
import enCATranslations from "../_gt/en-CA.json";
import frCATranslations from "../_gt/fr-CA.json";
import { loadDeclaredProfile, subscribeDeclaredProfile } from "../keating/learner-profile-store";

const translations: Record<string, Record<string, any>> = {
  "en-CA": enCATranslations,
  "fr-CA": frCATranslations,
};

function supportedLocale(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const normalized = candidate.toLowerCase();
  if (normalized === "fr-ca" || normalized.startsWith("fr-ca-")) return "fr-CA";
  if (normalized === "en-ca" || normalized.startsWith("en-ca-")) return "en-CA";
  if (normalized.startsWith("fr")) return "fr-CA";
  if (normalized.startsWith("en")) return "en-CA";
  return undefined;
}

function getBrowserLocale(): string {
  if (typeof navigator === "undefined") return gtConfig.defaultLocale;
  const candidates = [navigator.language, ...(navigator.languages ?? [])];
  return candidates.map(supportedLocale).find(Boolean) ?? gtConfig.defaultLocale;
}

/**
 * A learner who picked an interface language in their profile means it, so the
 * declared choice outranks the browser. "system" is the absence of a choice and
 * falls through to the browser as before.
 */
export function resolveKeatingLocale(): string {
  try {
    const declared = loadDeclaredProfile().interfaceLocale;
    if (declared && declared !== "system") return supportedLocale(declared) ?? getBrowserLocale();
  } catch {
    // A blocked or corrupt profile store must never leave the app untranslated.
  }
  return getBrowserLocale();
}

export async function initializeKeatingGT(): Promise<void> {
  await initializeGTSPA({
    ...gtConfig,
    locale: resolveKeatingLocale(),
    cacheUrl: null,
    runtimeUrl: import.meta.env.DEV ? undefined : null,
    projectId: import.meta.env.VITE_GT_PROJECT_ID || undefined,
    devApiKey: import.meta.env.DEV ? import.meta.env.VITE_GT_API_KEY || undefined : undefined,
    loadTranslations: async (locale: string) => translations[locale] ?? {},
  });
}

export function KeatingGTProvider({ children }: { children: ReactNode }) {
  // Both locales are bundled, so switching in Settings re-renders straight into
  // the other one instead of waiting for a reload.
  const locale = useSyncExternalStore(subscribeDeclaredProfile, resolveKeatingLocale, resolveKeatingLocale);
  return (
    <GTProvider
      {...gtConfig}
      locale={locale}
      translations={translations}
    >
      {children}
    </GTProvider>
  );
}
