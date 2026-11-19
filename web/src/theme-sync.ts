import { loadKeatingUiSettings, subscribeKeatingUiSettings } from "./keating/ui-settings";
import { motionReduced } from "./lib/motion";

/**
 * Syncs <meta name="theme-color"> with the current light/dark mode.
 * Called once on app boot and whenever the theme changes.
 */
const THEME_COLORS = {
  light: "#f1ece0",
  dark: "#0c1510",
};

function updateThemeColor() {
  const isDark = document.documentElement.classList.contains("dark");
  const meta = document.getElementById("theme-color-meta") as HTMLMetaElement | null;
  if (meta) {
    meta.content = isDark ? THEME_COLORS.dark : THEME_COLORS.light;
  }
}

type PowerTransition = (dark: boolean, apply: () => void) => void;
let powerTransition: PowerTransition | undefined;

export function registerPowerTransition(run: PowerTransition) {
  powerTransition = run;
  return () => { if (powerTransition === run) powerTransition = undefined; };
}

let pendingChange: (() => void) | undefined;

export function transitionTheme(change: (dark: boolean) => void) {
  pendingChange?.();
  const dark = !document.documentElement.classList.contains("dark");
  const apply = () => {
    if (pendingChange !== apply) return;
    pendingChange = undefined;
    change(dark);
  };
  pendingChange = apply;
  if (powerTransition && document.documentElement.dataset.fx === "on" && !document.hidden && !motionReduced()) {
    powerTransition(dark, apply);
  } else {
    apply();
  }
}

export function reflectVisualEffects({ visualEffects }: { visualEffects: boolean }) {
  document.documentElement.dataset.fx = visualEffects ? "on" : "off";
}

export type ThemePreference = "system" | "light" | "dark";
export function readThemePreference(): ThemePreference {
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem("theme");
  return stored === "light" || stored === "dark" ? stored : "system";
}
function applyThemePreference() {
  const preference = readThemePreference();
  const dark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
}
export function saveThemePreference(value:ThemePreference) {
  localStorage.setItem("theme",value);
  applyThemePreference();
  window.dispatchEvent(new Event("keating:theme"));
}
export function initThemeSync() {
  applyThemePreference();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",applyThemePreference);
  window.addEventListener("storage",event=>{if (!event.key || event.key === "theme") applyThemePreference()});
  reflectVisualEffects(loadKeatingUiSettings());
  subscribeKeatingUiSettings(reflectVisualEffects);
  // Run once immediately
  updateThemeColor();

  // Watch for class changes on <html> (theme-toggle adds/removes .dark)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === "class") {
        updateThemeColor();
      }
    }
  });
  observer.observe(document.documentElement, { attributes: true });
}
