import { loadKeatingUiSettings, subscribeKeatingUiSettings } from "./keating/ui-settings";
import { motionReduced } from "./lib/motion";
import "./themes/midnight.css";
import "./themes/phosphor-p3.css";

/**
 * Syncs <meta name="theme-color"> with the current light/dark mode.
 * Called once on app boot and whenever the theme changes.
 */
export const THEME_PALETTES = [
  { value: "light", label: "Paper", background: "#f1ece0", ink: "#1c211b" },
  { value: "dark", label: "Terminal", background: "#0c1510", ink: "#a1e0aa" },
  { value: "midnight", label: "Midnight", background: "#0b1220", ink: "#7cc0ff" },
  { value: "p3", label: "Phosphor", background: "#120c05", ink: "#ffb000" },
] as const;

function updateThemeColor() {
  const root = document.documentElement;
  const theme = root.dataset.theme ?? (root.classList.contains("dark") ? "dark" : "light");
  const meta = document.getElementById("theme-color-meta") as HTMLMetaElement | null;
  if (meta) {
    meta.content = THEME_PALETTES.find(({ value }) => value === theme)?.background ?? THEME_PALETTES[0].background;
  }
}

type PowerTransition = (dark: boolean, apply: () => void) => void;
let powerTransition: PowerTransition | undefined;

export function registerPowerTransition(run: PowerTransition) {
  powerTransition = run;
  return () => { if (powerTransition === run) powerTransition = undefined; };
}

let pendingChange: (() => void) | undefined;

export function transitionTheme(change: (dark: boolean) => void, targetDark?: boolean) {
  pendingChange?.();
  const currentDark = document.documentElement.classList.contains("dark");
  const dark = targetDark ?? !currentDark;
  if (dark === currentDark) {
    change(dark);
    return;
  }
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

export type ThemePreference = "system" | (typeof THEME_PALETTES)[number]["value"];
const DARK_THEME_STORAGE_KEY = "keating:last-dark-theme";

export function readLastDarkTheme() {
  const stored = localStorage.getItem(DARK_THEME_STORAGE_KEY);
  return stored === "midnight" || stored === "p3" ? stored : "dark";
}

export function readThemePreference(): ThemePreference {
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem("theme");
  return THEME_PALETTES.find(({ value }) => value === stored)?.value ?? "system";
}
function applyThemePreference() {
  const preference = readThemePreference();
  const dark = preference === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : preference !== "light";
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  if (preference === "midnight" || preference === "p3") root.dataset.theme = preference;
  else delete root.dataset.theme;
}
export function saveThemePreference(value: ThemePreference) {
  const darkTheme = value === "system" || value === "light" ? readThemePreference() : value;
  if (darkTheme !== "light" && darkTheme !== "system") localStorage.setItem(DARK_THEME_STORAGE_KEY, darkTheme);
  localStorage.setItem("theme", value);
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

  const observer = new MutationObserver(updateThemeColor);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
}
