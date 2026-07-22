import type { ReactNode } from "react";
import { GTProvider, initializeGTSPA } from "gt-react";
import gtConfig from "../../gt.config.json";
import enCATranslations from "../_gt/en-CA.json";
import frCATranslations from "../_gt/fr-CA.json";

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

export async function initializeKeatingGT(): Promise<void> {
  await initializeGTSPA({
    ...gtConfig,
    locale: getBrowserLocale(),
    cacheUrl: null,
    runtimeUrl: import.meta.env.DEV ? undefined : null,
    projectId: import.meta.env.VITE_GT_PROJECT_ID || undefined,
    devApiKey: import.meta.env.DEV ? import.meta.env.VITE_GT_API_KEY || undefined : undefined,
    loadTranslations: async (locale: string) => translations[locale] ?? {},
  });
}

export function KeatingGTProvider({ children }: { children: ReactNode }) {
  return (
    <GTProvider
      {...gtConfig}
      locale={getBrowserLocale()}
      translations={translations}
    >
      {children}
    </GTProvider>
  );
}
