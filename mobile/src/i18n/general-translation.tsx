import "@formatjs/intl-getcanonicallocales/polyfill-force";
import "@formatjs/intl-locale/polyfill-force";
import "@formatjs/intl-displaynames/polyfill-force";
import "@formatjs/intl-displaynames/locale-data/en";

import type { ReactNode } from "react";
import { GTProvider, initializeGT } from "gt-react-native";
import gtConfig from "../../gt.config.json";
import enTranslations from "../_gt/en.json";
import frTranslations from "../_gt/fr.json";

const translations: Record<string, Record<string, any>> = {
  en: enTranslations,
  fr: frTranslations,
};

let initialized = false;

function ensureInitialized(): void {
  if (initialized) return;
  initializeGT({
    ...gtConfig,
    loadTranslations: async (locale: string) => translations[locale] ?? {},
  });
  initialized = true;
}

export function KeatingGTProvider({ children }: { children: ReactNode }) {
  ensureInitialized();
  return (
    <GTProvider {...gtConfig}>
      {children}
    </GTProvider>
  );
}
