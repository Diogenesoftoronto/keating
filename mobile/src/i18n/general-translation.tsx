import type { ReactNode } from "react";
import { GTProvider, initializeGT } from "gt-react-native";
import gtConfig from "../../gt.config.json";
import enCATranslations from "../_gt/en-CA.json";
import frCATranslations from "../_gt/fr-CA.json";

const translations: Record<string, Record<string, any>> = {
  "en-CA": enCATranslations,
  "fr-CA": frCATranslations,
};

initializeGT({
  ...gtConfig,
  loadTranslations: async (locale: string) => translations[locale] ?? {},
});

export function KeatingGTProvider({ children }: { children: ReactNode }) {
  return (
    <GTProvider {...gtConfig}>
      {children}
    </GTProvider>
  );
}
