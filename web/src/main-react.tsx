import { startSubmissionSync } from "./submissions/course-outbox";
import ReactDOM from "react-dom/client";
import { PostHogProvider } from "@posthog/react";
import "@earendil-works/pi-web-ui/app.css";
import "../styled-system/styles.css";
import "./hooks/keating-storage";
// KaTeX CSS is imported by the components that actually render math
// (MarkdownBlock, AssistantChatPanel, blog reader) so the entry/Landing chunk skips it.
import { App } from "./App";
import { initializeKeatingGT, KeatingGTProvider } from "./i18n/general-translation";
import { applyKeatingUiTypography, loadKeatingUiSettings } from "./keating/ui-settings";
import { installBrowserDiagnosticsCapture, recordDiagnostic } from "./lib/diagnostics";
import { initPostHog } from "./lib/posthog";
import { installStaleBuildRecovery } from "./lib/stale-build-recovery";
import { initThemeSync } from "./theme-sync";

installBrowserDiagnosticsCapture();

if (import.meta.env.DEV) {
  void import("react-grab")
    .then(() => recordDiagnostic("info", "devtools", "React Grab loaded", { version: "0.2.0" }))
    .catch((error) => console.warn("React Grab failed to load:", error));
}

const stopSubmissionSync = startSubmissionSync();
if (import.meta.hot) import.meta.hot.dispose(stopSubmissionSync);
initThemeSync();
installStaleBuildRecovery();
applyKeatingUiTypography(loadKeatingUiSettings().fontFamily);
const posthogClient = initPostHog();

const root = ReactDOM.createRoot(document.getElementById("root")!);

function renderApp() {
  root.render(
    <KeatingGTProvider>
      {posthogClient ? (
        <PostHogProvider client={posthogClient}>
          <App />
        </PostHogProvider>
      ) : <App />}
    </KeatingGTProvider>,
  );
}

initializeKeatingGT()
  .catch((error) => {
    if (import.meta.env.DEV) console.warn("General Translation failed to initialize:", error);
  })
  .finally(renderApp);
