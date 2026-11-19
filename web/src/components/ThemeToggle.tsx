import { useCallback, useEffect, useState } from "react";
import { saveThemePreference, transitionTheme } from "../theme-sync";
import { KeatingGlyph } from "../design-system/glyphs";
import { css } from "../../styled-system/css";
import { iconButton } from "../../styled-system/recipes";

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

const iconButtonClass = iconButton({ size: "lg", tone: "ghost" });

function getInitialTheme(): boolean {
  if (typeof document === "undefined") return false;
  const root = document.documentElement;
  if (root.classList.contains("dark") || root.classList.contains("light")) {
    return root.classList.contains("dark");
  }
  const stored = localStorage.getItem("theme");
  if (stored === "dark") return true;
  if (stored === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

interface ThemeToggleProps {
  className?: string;
  /** "icon" (default) renders the square header button; "menu" renders a full-width labeled row for the overflow menu. */
  variant?: "icon" | "menu";
  /** Called after the theme is toggled (e.g. to close the overflow menu). */
  onToggled?: () => void;
}

export function ThemeToggle({ className = "", variant = "icon", onToggled }: ThemeToggleProps = {}) {
  const [isDark, setIsDark] = useState(() => getInitialTheme());

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback(() => {
    transitionTheme((next) => {
      saveThemePreference(next ? "dark" : "light");
      setIsDark(next);
      onToggled?.();
    });
  }, [onToggled]);

  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={toggle}
        className={`${menuButtonClass} ${className}`.trim()}
        aria-label={label}
      >
        {isDark ? <KeatingGlyph name="sun" size={16} /> : <KeatingGlyph name="moon" size={16} />}
        {isDark ? "Light mode" : "Dark mode"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`chat-action-button ${iconButtonClass} ${className}`.trim()}
      title={label}
      aria-label={label}
    >
      {isDark ? <KeatingGlyph name="sun" size={16} /> : <KeatingGlyph name="moon" size={16} />}
    </button>
  );
}
