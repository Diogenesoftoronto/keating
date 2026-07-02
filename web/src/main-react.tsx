import ReactDOM from "react-dom/client";
import { PostHogProvider } from "@posthog/react";
import "./app.css";
import "./hooks/keating-storage";
// KaTeX CSS is imported by the components that actually render math
// (MarkdownBlock, AssistantChatPanel, Blog) so the entry/Landing chunk skips it.
import { App } from "./App";
import { applyKeatingUiTypography, loadKeatingUiSettings } from "./keating/ui-settings";
import { initPostHog } from "./lib/posthog";
import { installStaleBuildRecovery } from "./lib/stale-build-recovery";
import { initThemeSync } from "./theme-sync";

if (import.meta.env.DEV) {
  import("react-grab");
}

initThemeSync();
installStaleBuildRecovery();
applyKeatingUiTypography(loadKeatingUiSettings().fontFamily);
const posthogClient = initPostHog();

ReactDOM.createRoot(document.getElementById("root")!).render(
	posthogClient ? (
		<PostHogProvider client={posthogClient}>
			<App />
		</PostHogProvider>
	) : <App />,
);
