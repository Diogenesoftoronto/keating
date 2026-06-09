import { useCallback, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

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
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    if (next) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
    setIsDark(next);
    onToggled?.();
  }, [onToggled]);

  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={toggle}
        className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors ${className}`.trim()}
        aria-label={label}
      >
        {isDark ? <Sun size={14} /> : <Moon size={14} />}
        {isDark ? "Light mode" : "Dark mode"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`chat-action-button inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors ${className}`.trim()}
      title={label}
      aria-label={label}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
