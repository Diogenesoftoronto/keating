import ReactDOM from "react-dom/client";
import { PostHogProvider } from "@posthog/react";
import "./app.css";
import "katex/dist/katex.min.css";
import { App } from "./App";
import { applyKeatingUiTypography, loadKeatingUiSettings } from "./keating/ui-settings";
import { initPostHog } from "./lib/posthog";
import { initThemeSync } from "./theme-sync";

if (import.meta.env.DEV) {
  import("react-grab");
}

initThemeSync();
applyKeatingUiTypography(loadKeatingUiSettings().fontFamily);
const posthogClient = initPostHog();

ReactDOM.createRoot(document.getElementById("root")!).render(
	posthogClient ? (
		<PostHogProvider client={posthogClient}>
			<App />
		</PostHogProvider>
	) : <App />,
);
