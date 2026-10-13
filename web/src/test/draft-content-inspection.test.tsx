import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftContentInspectionView } from "../components/DraftContentInspection";
import { clearTeachingDraftContents, clearTeachingDraftStatus, clearTeachingDraftStatuses, getTeachingDraftContent, getTeachingDraftStatus, publishTeachingDraftContent, publishTeachingDraftStatus } from "../keating/judgement/draft-status";
import { clearDiagnostics, getDiagnosticsSnapshot } from "../lib/diagnostics";
import type { TeachingDraftSnapshot } from "@keating/learner-contracts";
const snapshot: TeachingDraftSnapshot = { phase: "planning", attempt: 0, maxAttempts: 3, reasoning: "low", standard: "concise", elapsedMs: 0, attempts: [], judgeModel: null, selectedAttempt: null, reason: null };
afterEach(() => { clearTeachingDraftStatuses(); clearDiagnostics(); });

test("answer content stays separate from receipts and diagnostics and clears at each boundary", () => {
  publishTeachingDraftStatus("turn", snapshot);
  publishTeachingDraftContent("turn", { attempt: 1, variant: "default", text: "PRIVATE_ANSWER", toolCalls: [{ arguments: { secret: "TOOL_SECRET" } }], reasoning: "HIDDEN_REASONING" } as never);
  expect(getTeachingDraftContent("turn")).toEqual([{ attempt: 1, variant: "default", text: "PRIVATE_ANSWER", truncated: false }]);
  publishTeachingDraftStatus("turn", { ...snapshot, phase: "released", selectedAttempt: 1 });
  expect(JSON.stringify(getTeachingDraftStatus("turn"))).not.toContain("PRIVATE_ANSWER");
  expect(JSON.stringify(getDiagnosticsSnapshot())).not.toContain("PRIVATE_ANSWER");
  publishTeachingDraftStatus("turn", snapshot);
  expect(getTeachingDraftContent("turn")).toBeNull();
  publishTeachingDraftContent("turn", { attempt: 2, variant: "prose", text: "SECOND" });
  publishTeachingDraftStatus("turn", { ...snapshot, phase: "cancelled" });
  expect(getTeachingDraftContent("turn")).toBeNull();
  publishTeachingDraftContent("turn", { attempt: 2, variant: "prose", text: "SECOND" });
  clearTeachingDraftContents();
  expect(getTeachingDraftContent("turn")).toBeNull();
  publishTeachingDraftContent("turn", { attempt: 2, variant: "prose", text: "SECOND" });
  clearTeachingDraftStatus("turn");
  expect(getTeachingDraftContent("turn")).toBeNull();
});

test("inspection bounds text and projects away arbitrary candidate fields", () => {
  publishTeachingDraftContent("turn", { attempt: 1, variant: "default", text: "x".repeat(70_000) });
  expect(getTeachingDraftContent("turn")?.[0]?.text.length).toBe(64_000);
  expect(getTeachingDraftContent("turn")?.[0]?.truncated).toBe(true);
  publishTeachingDraftContent("turn", { attempt: 11, variant: "prose", text: "INVALID" });
  expect(getTeachingDraftContent("turn")?.length).toBe(1);
});

test("developer inspection compares selected and unselected answer text as escaped inert text", () => {
  const candidates = [{ attempt: 1, variant: "prose" as const, text: '<script>alert("unselected")</script>\n```keating-ui\nrun_tool()', truncated: false },
    { attempt: 2, variant: "default" as const, text: "Selected answer", truncated: false }];
  expect(renderToStaticMarkup(<DraftContentInspectionView candidates={candidates} selectedAttempt={2} />)).toBe("");
  const html = renderToStaticMarkup(<DraftContentInspectionView enabled candidates={candidates} selectedAttempt={2} />);
  expect(html).toContain("Unselected drafts (1)");
  expect(html).toContain("Selected response");
  expect(html).toContain("Selected answer");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("not model reasoning");
});
