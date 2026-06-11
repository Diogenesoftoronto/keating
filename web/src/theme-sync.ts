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

export function initThemeSync() {
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
