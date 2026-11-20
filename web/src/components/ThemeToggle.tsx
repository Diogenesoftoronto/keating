import { useCallback, useEffect, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { readLastDarkTheme, readThemePreference, saveThemePreference, THEME_PALETTES, transitionTheme } from "../theme-sync";
import { KeatingGlyph } from "../design-system/glyphs";
import { css } from "../../styled-system/css";
import "./select.css";
import "./theme-toggle.css";

const menuButtonClass = css({
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  borderRadius: "0.375rem",
  paddingInline: "0.75rem",
  paddingBlock: "0.5rem",
  textAlign: "left",
  fontSize: "0.875rem",
  transitionProperty: "color, background-color",
  transitionDuration: "{durations.fast}",
  transitionTimingFunction: "{easings.standard}",
  _hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
});

const swatchClass = css({
  display: "grid",
  placeItems: "center",
  width: "1.2rem",
  height: "0.9rem",
  border: "1px solid var(--line)",
  borderRadius: "0.14rem",
  fontFamily: "var(--mono-body)",
  fontSize: "0.56rem",
  fontWeight: 700,
  lineHeight: 1,
});

function getInitialTheme(): boolean {
  if (typeof document === "undefined") return false;
  const root = document.documentElement;
  if (root.classList.contains("dark") || root.classList.contains("light")) {
    return root.classList.contains("dark");
  }
  const stored = readThemePreference();
  if (stored !== "system") return stored !== "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

interface ThemeToggleProps {
  className?: string;
  /** The header has a mode button and a palette picker. The menu row provides a mode button. */
  variant?: "icon" | "menu";
  /** Called after the theme is toggled (e.g. to close the overflow menu). */
  onToggled?: () => void;
}

export function ThemeToggle({ className = "", variant = "icon", onToggled }: ThemeToggleProps = {}) {
  const [isDark, setIsDark] = useState(() => getInitialTheme());
  const [preference, setPreference] = useState(readThemePreference);

  useEffect(() => {
    const syncMode = () => setIsDark(getInitialTheme());
    const syncPreference = () => setPreference(readThemePreference());
    const observer = new MutationObserver(syncMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("keating:theme", syncPreference);
    window.addEventListener("storage", syncPreference);
    syncMode();
    syncPreference();
    return () => {
      observer.disconnect();
      window.removeEventListener("keating:theme", syncPreference);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  const toggle = useCallback(() => {
    transitionTheme((next) => {
      saveThemePreference(next ? readLastDarkTheme() : "light");
      setIsDark(next);
      onToggled?.();
    });
  }, [onToggled]);

  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  const glyph = isDark ? "sun" : "moon";
  const effectiveTheme = preference === "system" ? (isDark ? "dark" : "light") : preference;
  const selectedTheme = THEME_PALETTES.find((option) => option.value === effectiveTheme);

  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={toggle}
        className={`${menuButtonClass} ${className}`.trim()}
        aria-label={label}
      >
        <KeatingGlyph name={glyph} size={16} />
        {isDark ? "Light mode" : "Dark mode"}
      </button>
    );
  }

  return (
    <div className={`theme-split ${className}`.trim()} role="group" aria-label="Appearance">
      <button type="button" onClick={toggle} title={label} aria-label={label}>
        <KeatingGlyph name={glyph} size={18} />
      </button>
      <Select.Root
        value={preference === "system" ? "" : preference}
        onValueChange={(value) => {
          const option = THEME_PALETTES.find((theme) => theme.value === value);
          if (!option) return;
          transitionTheme(() => {
            saveThemePreference(option.value);
            onToggled?.();
          }, option.value !== "light");
        }}
      >
        <Select.Trigger
          className="theme-split-picker"
          title="Choose theme"
          aria-label={`Theme, ${selectedTheme?.label}`}
        >
          <span className="theme-split-swatches" aria-hidden="true"><span /><span /><span /><span /></span>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="keating-select-menu" position="popper" align="end" sideOffset={6} collisionPadding={8} aria-label="Theme">
            <Select.Viewport className="keating-select-viewport">
              {THEME_PALETTES.map(({ value, label, background, ink }) => (
                <Select.Item key={value} value={value} textValue={label} className="keating-select-option">
                  <span className={css({ display: "inline-flex", alignItems: "center", gap: "0.45rem" })}>
                    <span aria-hidden="true" className={swatchClass} style={{ background, color: ink }}>Aa</span>
                    <Select.ItemText>{label}</Select.ItemText>
                  </span>
                  <Select.ItemIndicator className="keating-select-option__check">
                    <KeatingGlyph name="check" size={17} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
