import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LearningIntelligenceDiagnostics } from "../components/LearningIntelligenceDiagnostics";
import { configureJudgementDiagnostics } from "../keating/judgement/diagnostics";
import { clearLearningDiagnostics, recordLearningDiagnostic } from "../keating/learning-intelligence/diagnostics";
import { learningSourceHash } from "@keating/learner-contracts";

afterEach(() => { configureJudgementDiagnostics({ enabled: false, details: false }); clearLearningDiagnostics(); });
test("learning controls are available without captured private details", () => {
  const html = renderToStaticMarkup(<LearningIntelligenceDiagnostics controls />);
  expect(html).toContain("Enable learning extraction and forecasts");
  expect(html).toContain("Connect extraction account");
  expect(html).not.toContain("Original message");
});
test("diagnostics show real extraction source links and forecast intervals", () => {
  configureJudgementDiagnostics({ enabled: true, details: true });
  recordLearningDiagnostic({ kind: "extraction", status: "completed", sessionId: "session", model: "test-extractor", reasons: ["exact span verified"], evidence: [{ sessionId: "session", messageId: "message", quote: "The learner's exact step.", start: 0, end: 25, sourceHash: learningSourceHash("The learner's exact step.") }] });
  recordLearningDiagnostic({ kind: "forecast", status: "completed", sessionId: "session", reasons: ["baseline retained"], forecast: [{ target: "Card recall", p10: .2, median: .6, p90: .9, baseline: .55, observedCount: 8, dueAt: Date.UTC(2026, 9, 24), horizonHours: 24, status: "unvalidated-model-proposal" }] });
  const html = renderToStaticMarkup(<LearningIntelligenceDiagnostics sessionId="session" />);
  expect(html).toContain("Open original passage");
  expect(html).toContain("exact span verified");
  expect(html).toContain("central 80% range 0.20–0.90");
  expect(html).toContain("8 observations");
  expect(html).toContain("Usual estimate from recorded outcomes: 0.55");
  expect(html).toContain("2026-10-24T00:00:00.000Z");
  expect(html).toContain("Model proposal, not validated against this learner");
  expect(html).toContain("Forecast horizon: 24 hours");
  expect(html).toContain("Source conversation: session");
  expect(html).toContain("aria-describedby=");
  expect(html).toContain('aria-busy="false"');
  expect(html).toContain('aria-disabled="false"');
  expect(html).toContain('role="status"');
  expect(html).not.toContain("estimated probability");
});
test("quote previews redact known secrets while original navigation anchors remain exact", () => {
  configureJudgementDiagnostics({ enabled: true, details: true });
  const quote = "My email is learner@example.com.";
  recordLearningDiagnostic({ kind: "extraction", status: "completed", sessionId: "session", reasons: [], evidence: [{ sessionId: "session", messageId: "message", quote, start: 0, end: quote.length, sourceHash: learningSourceHash(quote) }] });
  const html = renderToStaticMarkup(<LearningIntelligenceDiagnostics sessionId="session" />);
  expect(html).not.toContain("learner@example.com");
  expect(html).toContain("Open original passage");
});
