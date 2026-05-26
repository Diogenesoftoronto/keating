import ReactDOM from "react-dom/client";
import "./app.css";
import "katex/dist/katex.min.css";
import { App } from "./App";
import { applyKeatingUiTypography, loadKeatingUiSettings } from "./keating/ui-settings";
import { initThemeSync } from "./theme-sync";

if (import.meta.env.DEV) {
  import("react-grab");
}

initThemeSync();
applyKeatingUiTypography(loadKeatingUiSettings().fontFamily);

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
