import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantRuntimeProvider, ThreadPrimitive, useAuiState, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { FlueConversationMessage } from "@flue/sdk";
import type { TeachingDraftSnapshot } from "@keating/learner-contracts";
import { projectThreadMessages } from "../components/AssistantChatPanel";
import { TurnJudgementSummary, summarizeTurnJudgements } from "../components/TurnJudgementSummary";
import { DraftCheckHeatmap, ReplyReviewConfidence } from "../components/MessageDecisionVisuals";
import { DraftProgressCard } from "../components/DraftProgress";
import { MessageDraftDecision } from "../components/MessageDraftDecision";
import { TurnProcessSummary, useSearchStepCovered } from "../components/TurnProgress";
import * as glyphRuntime from "../design-system/glyphs/runtime";
import * as motion from "../design-system/motion";
import type { FlueConversation } from "../keating/flue/conversation";
import { rememberTurnReceipt, resetTurnReceipts } from "../keating/judgement/turn-receipts";
import { mountRoomUi, settle, textOf } from "./helpers/room-ui-mount";
import type { JudgementLabelRecord, TurnJudgementRecord } from "../keating/judgement/turn-records";

beforeEach(() => {
  // The reconciler fixture exercises React handlers without a browser or SVG DOM.
  spyOn(glyphRuntime, "bindGlyph").mockReturnValue({ update() {}, dispose() {} });
  spyOn(motion, "useMotionAllowed").mockReturnValue(false);
});
afterEach(() => {
  spyOn(glyphRuntime, "bindGlyph").mockRestore();
  spyOn(motion, "useMotionAllowed").mockRestore();
});

const snapshot = { phase: "released", attempt: 2, maxAttempts: 2, reasoning: "low", standard: "supported", elapsedMs: 1200, judgeModel: "jev", selectedAttempt: 2, reason: null,
  attempts: [1, 2].map(attempt => ({ attempt, reasoning: "low", standard: "supported", generationMs: 1, judgementMs: 1, status: attempt === 1 ? "fail" : "pass", variant: "default",
    checks: [{ id: "mastery_overclaimed", status: attempt === 1 ? "fail" : "pass", source: "jev", severity: "critical", probability: attempt === 1 ? 0.9 : 0.05 },
      { id: "nonempty_reply", status: "pass", source: "deterministic", severity: "critical", probability: 0 }] })) } as unknown as TeachingDraftSnapshot;
const record: Pick<TurnJudgementRecord, "replyReview" | "extraction" | "memory"> = {
  extraction: [{ role: "learner", status: "completed", items: [{ kind: "answer-step", messageId: "m", start: 0, end: 9, quote: "x = 2 + 3" }], reasons: [] }],
  memory: [{ candidate: { id: "c", evidence: "I study at night.", sessionId: "s", messageId: "m", message: "I study at night.", start: 0, end: 17 },
    accepted: false, reason: "below-threshold", category: "study-context", probability: 0.71, threshold: 0.9, backend: "system-one/jev", scope: "a", committed: true }],
};

test("a turn reads as one pipeline with plain-language checks", () => {
  expect(summarizeTurnJudgements({ draft: { snapshot }, record })).toBe("2 drafts · 1 flagged check · released draft 2 · 1 passage extracted · 0 of 1 memory admitted");
  const html = renderToStaticMarkup(<TurnJudgementSummary open draft={{ snapshot }} record={record} />);
  expect(html).toContain("Mastery overclaimed");
  expect(html).toContain("Reply is empty");
  expect(html).toContain("Learner reasoning step");
  expect(html).toContain("x = 2 + 3");
  expect(html).toContain("below the admission threshold");
  expect(html).toContain("(admits at ≥ 0.90)");
  // Read-only outside the review view.
  expect(html).not.toContain("Your verdict");
  expect(html).not.toContain("Admit to memory");
});

test("the review view adds verdict and memory controls and shows the reviewer's decision", () => {
  const labels: JudgementLabelRecord[] = [{ id: "l", sessionId: "s", assistantTimestamp: 2, target: { kind: "memory-admission", candidateId: "c", scope: "a" },
    model: { probability: 0.71, accepted: false }, verdict: "admit", category: "study-context", effect: "pending-account", createdAt: 1, updatedAt: 1 }];
  const html = renderToStaticMarkup(<TurnJudgementSummary open draft={{ snapshot }} record={record}
    checkControls={{ labels, onLabel: () => {} }} memoryControls={{ labels, onLabel: () => {} }} />);
  expect(html).toContain("Your verdict");
  expect(html).toContain("You: admitted as study context.");
  expect(html).toContain("applies once you are signed in");
  expect(html).toContain("Remove from memory");
  expect(html).toContain("1 reviewer label");
});

test("learner messages show only their own extraction", () => {
  const html = renderToStaticMarkup(<TurnJudgementSummary role="learner" draft={{ snapshot }} record={record} />);
  expect(html).toContain("Extracted from this message");
  expect(html).not.toContain("Mastery overclaimed");
  expect(html).not.toContain("Memory admission");
});

test("the inline draft picker starts on a flagged draft and exposes the released draft as a button", () => {
  const html = renderToStaticMarkup(<TurnJudgementSummary embedded draft={{ snapshot }} />);
  expect(html).toContain('aria-label="Drafts"');
  expect(html).toMatch(/aria-pressed="true"[^>]*>Draft 1 · failed checks/);
  expect(html).toMatch(/aria-pressed="false"[^>]*>Draft 2 · released/);
  expect(html).toContain("Mastery overclaimed");
  expect(html).toMatch(/aria-expanded="false"[^>]*>Show 1 passed check/);
  expect(html).not.toContain('data-testid="turn-judgements"');
});

test("the draft heatmap distinguishes a missing record from an inconclusive result", () => {
  const heatmap = renderToStaticMarkup(<DraftCheckHeatmap snapshot={{
    ...snapshot,
    attempts: [
      snapshot.attempts[0]!,
      { ...snapshot.attempts[1]!, checks: [{ id: "mastery_overclaimed", source: "jev", status: "unknown", severity: "critical", probability: null }] },
    ],
  }} />);
  expect(heatmap).toContain("Draft check heatmap");
  expect(heatmap).toContain("Draft 1, Mastery overclaimed, Failed, 90% probability of violation");
  expect(heatmap).toContain('aria-label="Draft 2, Mastery overclaimed, Inconclusive"');
  expect(heatmap).toContain('aria-label="No check recorded"');
  expect(heatmap).toContain('aria-label="Draft 1, Reply is empty, Passed"');
  expect(heatmap).not.toContain("What changed between drafts");
});

test("draft comparison shows the direction of the released draft's risk change", () => {
  const chartFor = (before: number, after: number) => renderToStaticMarkup(<DraftCheckHeatmap snapshot={{
    ...snapshot,
    attempts: snapshot.attempts.map((attempt, index) => ({ ...attempt, checks: attempt.checks.map(check =>
      check.id === "mastery_overclaimed" ? { ...check, probability: index === 0 ? before : after } : check) })),
  }} />);
  const lower = chartFor(.88, .12);
  expect(lower).toContain("What changed between drafts");
  expect(lower).toContain("Lower is better");
  expect(lower).toMatch(/aria-label="Draft 1 · earlier estimated risk"[^>]*aria-valuenow="0.88"/);
  expect(lower).toContain("76 percentage points lower in the released draft");
  const higher = chartFor(.12, .88);
  expect(higher).toMatch(/aria-label="Draft 2 · released estimated risk"[^>]*aria-valuenow="0.88"/);
  expect(higher).toContain("76 percentage points higher in the released draft");
  expect(chartFor(.12, .12)).toContain("No change in estimated risk");
});

test("the confidence chart displays the returned choice and leaves absent confidence out", () => {
  const chart = renderToStaticMarkup(<ReplyReviewConfidence review={{
    backend: "local", model: "reviewer", calibrated: false,
    answers: [
      { id: "need", choice: "room_to_reason", confidence: 0.76, probabilities: [] },
      { id: "fit", choice: "unknown", confidence: Number.NaN, probabilities: [] },
    ],
  }} />);
  expect(chart).toContain("room to reason");
  expect(chart).toMatch(/aria-label="Learner need confidence"[^>]*aria-valuenow="0.76"/);
  expect(chart).toContain("Uncalibrated estimates");
  expect(chart).not.toContain("Response fit confidence");
});

test("review terms have individually named help controls and screen-reader descriptions", () => {
  const chart = renderToStaticMarkup(<ReplyReviewConfidence review={{
    backend: "local", model: "reviewer", calibrated: false,
    answers: ["move", "need", "fit"].map(id => ({ id, choice: "unknown", confidence: 0.65, probabilities: [] })),
  }} />);
  for (const term of ["Tutor move", "Learner need", "Response fit", "reply review confidence", "review calibration"]) {
    const describedBy = chart.split(`aria-label="Explain ${term}" aria-describedby="`)[1]?.split('"')[0];
    expect(describedBy).toBeTruthy();
    expect(chart).toContain(`hidden="" id="${describedBy}"`);
  }
  expect(chart).toContain("Overhelp means it gave too much away.");
  expect(chart).toContain("This review ran without a calibration table.");
});

test("the release summary uses recorded checks and preserves best-effort status", () => {
  const released = renderToStaticMarkup(<MessageDraftDecision snapshot={snapshot} />);
  expect(released).toContain("Draft 1 was flagged on “Mastery overclaimed”. Draft 2 passed that check and was released.");
  expect(released).toContain("Decision trail · 2 drafts");
  const bestEffort = renderToStaticMarkup(<MessageDraftDecision snapshot={{ ...snapshot, selectedAttempt: 1, reason: "best-effort-draft" }} />);
  expect(bestEffort).toContain("Keating released draft 1 as a best-effort reply.");
  expect(bestEffort).not.toContain("Draft 1 passed review");
  expect(renderToStaticMarkup(<MessageDraftDecision snapshot={{ ...snapshot, phase: "withheld", selectedAttempt: null }} />)).toBe("");
});

test("release diagnostics compare the parallel alternative or the actual revision source", () => {
  const [first, second] = snapshot.attempts;
  const parallel: TeachingDraftSnapshot = { ...snapshot, parallelAttempts: [1, 2], selectedAttempt: 1,
    attempts: [{ ...second!, attempt: 1 }, { ...first!, attempt: 2 }] };
  const decision = renderToStaticMarkup(<MessageDraftDecision snapshot={parallel} />);
  expect(decision).toContain("Draft 2 was flagged on “Mastery overclaimed”. Draft 1 passed that check and was released.");
  expect(decision).toContain("Started in parallel with draft 2.");
  expect(renderToStaticMarkup(<DraftCheckHeatmap snapshot={parallel} />)).toContain("Draft 2 · parallel draft");

  const repaired: TeachingDraftSnapshot = { ...parallel, attempt: 3, selectedAttempt: 3,
    attempts: [...parallel.attempts, { ...second!, attempt: 3, repairSourceAttempt: 2 }] };
  expect(renderToStaticMarkup(<MessageDraftDecision snapshot={repaired} />)).toContain("Revised draft 2.");
  expect(renderToStaticMarkup(<DraftCheckHeatmap snapshot={repaired} />)).toContain("Draft 2 · source of revision");
});

test("the folded chat receipt counts genuine passes on a released best-effort answer", async () => {
  const id = "receipt-with-review-concerns";
  const shown = { ...snapshot.attempts[0]!, checks: [
    ...snapshot.attempts[0]!.checks,
    { id: "quality_scope", source: "jev", severity: "minor", status: "unknown", probability: .5 } as const,
  ] };
  rememberTurnReceipt(id, 400, { ...snapshot, reason: "best-effort-draft", selectedAttempt: 1, attempts: [shown] });
  function Receipt() { return <TurnProcessSummary sessionId={id} />; }
  function Conversation() {
    const runtime = useExternalStoreRuntime<ThreadMessageLike>({
      messages: [{ id: "assistant-400", role: "assistant", content: "A checked reply.", status: { type: "complete", reason: "stop" } }],
      convertMessage: message => message, isRunning: false, onNew: async () => {},
    });
    return <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Messages components={{ AssistantMessage: Receipt, UserMessage: () => null }} />
    </AssistantRuntimeProvider>;
  }
  const ui = mountRoomUi();
  try {
    await ui.render(<Conversation />);
    const summary = ui.button("1 of 3 checks passed");
    expect(summary.props["aria-expanded"]).toBe(false);
    summary.props.onClick();
    await settle();
    expect(ui.text()).toContain("1 passed, 1 failed, 1 inconclusive");
  } finally {
    await ui.unmount();
    resetTurnReceipts();
  }
});

test("a Flue reply and its search step use the receipt for the same projected turn", async () => {
  const sessionId = "native-receipt-sources";
  const answer = "Three times three is nine.";
  const originals = [
    { role: "user" as const, content: "First example?", timestamp: 10 },
    fauxAssistantMessage(answer, { timestamp: 100 }),
    { role: "user" as const, content: "Next example?", timestamp: 20 },
    fauxAssistantMessage("Three times three", { timestamp: 190 }),
    fauxAssistantMessage(answer, { timestamp: 200 }),
  ];
  const nativeText = (id: string, role: "user" | "assistant", text: string, timestamp?: number): FlueConversationMessage => ({
    id, role, purpose: role, display: "visible", timestamp: new Date(800).toISOString(),
    ...(timestamp === undefined ? {} : { metadata: { timestamp } }), parts: [{ type: "text", text, state: "done" }],
  });
  const search = (id: string): FlueConversationMessage => ({
    id, role: "assistant", purpose: "assistant", display: "visible", parts: [
      { type: "dynamic-tool", toolName: "web_search", toolCallId: id, input: { query: "square number" }, state: "output-available", output: {} },
    ],
  });
  const native = [
    nativeText("entry_U1", "user", "First example?", 10), search("entry_S1"), nativeText("entry_A1", "assistant", answer),
    nativeText("entry_U2", "user", "Next example?", 20), search("entry_S2"), nativeText("entry_A2", "assistant", answer, 900),
    nativeText("entry_U3", "user", "Another question?"), nativeText("entry_orphan", "assistant", "An unmatched response.", 200),
  ];
  const agent = { getSnapshot: () => ({ conversation: { messages: native } }), context: { messages: originals },
    legacyMessages: [], localMessages: [] } as unknown as FlueConversation;
  const rows = projectThreadMessages(agent, originals, false, false, undefined);
  expect(rows.find(row => row.id === "entry_A1")?.metadata?.custom?.keatingDiagnosticTimestamps).toEqual([100]);
  expect(rows.find(row => row.id === "entry_A2")?.metadata?.custom?.keatingDiagnosticTimestamps).toEqual([190, 200]);
  expect(rows.find(row => row.id === "entry_orphan")?.metadata?.custom?.keatingDiagnosticTimestamps).toEqual([]);
  // Only the second of the identical replies was reviewed. The orphan's display date
  // coincides with that receipt. Neither the first turn nor the orphan can claim it.
  rememberTurnReceipt(sessionId, 200, snapshot);
  const olderRows: ThreadMessageLike[] = [
    { id: "assistant-9-500", role: "assistant", content: "An older reply." },
    { id: "historic-reply", role: "assistant", createdAt: new Date(600), content: "An imported reply." },
  ];
  rememberTurnReceipt(sessionId, 500, snapshot);
  rememberTurnReceipt(sessionId, 600, snapshot);
  function Receipt() {
    const id = useAuiState(({ message }) => message.id);
    return <article data-id={id}>{useSearchStepCovered(sessionId) ? "Search covered" : <TurnProcessSummary sessionId={sessionId} />}</article>;
  }
  function Conversation() {
    const runtime = useExternalStoreRuntime<ThreadMessageLike>({ messages: [...rows, ...olderRows],
      convertMessage: message => message, isRunning: false, onNew: async () => {} });
    return <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Messages components={{ AssistantMessage: Receipt, UserMessage: () => null }} />
    </AssistantRuntimeProvider>;
  }
  const ui = mountRoomUi();
  try {
    await ui.render(<Conversation />);
    const rendered = new Map(ui.all("article").map(row => [row.props["data-id"], textOf(row)]));
    expect(rendered.get("entry_S1")).toBe("");
    expect(rendered.get("entry_A1")).toBe("");
    expect(rendered.get("entry_S2")).toBe("Search covered");
    expect(rendered.get("entry_A2")).toContain("2 checks passed");
    expect(rendered.get("entry_orphan")).toBe("");
    for (const row of olderRows) expect(rendered.get(row.id)).toContain("2 checks passed");
  } finally {
    await ui.unmount();
    resetTurnReceipts();
  }
});

test("stopping after a checked opening keeps its counts and covers only that turn’s search", async () => {
  const sessionId = "stopped-opening";
  const opening = { ...snapshot.attempts[1]!, checks: [
    ...snapshot.attempts[1]!.checks,
    { id: "requested_part_missing", source: "jev", severity: "minor", status: "fail", probability: .99 } as const,
    { id: "quality_scope", source: "jev", severity: "minor", status: "unknown", probability: .5 } as const,
  ] };
  const stopped: TeachingDraftSnapshot = { ...snapshot, phase: "cancelled", reason: "cancelled",
    attempt: 3, maxAttempts: 3, parallelAttempts: [1, 2], attempts: [snapshot.attempts[0]!, opening], selectedAttempt: 2 };
  rememberTurnReceipt(sessionId, 1100, stopped);
  rememberTurnReceipt(sessionId, 2100, { ...stopped, selectedAttempt: null });
  rememberTurnReceipt(sessionId, 3100, { ...stopped, selectedAttempt: 1 });
  rememberTurnReceipt(sessionId, 4100, { ...stopped, attempts: [{ ...opening, checks: [] }] });
  const rows: ThreadMessageLike[] = [1100, 2100, 3100, 4100].flatMap(timestamp => [
    { id: `user-${timestamp}`, role: "user", content: "Give me an example." },
    { id: `entry_search_${timestamp}`, role: "assistant",
      content: [{ type: "tool-call", toolCallId: `q${timestamp}`, toolName: "web_search", args: { query: "example" }, result: {} }] },
    { id: `entry_reply_${timestamp}`, role: "assistant", content: timestamp === 1100 ? "The checked opening." : "Response stopped",
      status: { type: "incomplete", reason: "cancelled" }, metadata: { custom: { keatingDiagnosticTimestamps: [timestamp] } } },
  ]);
  function Receipt() {
    const id = useAuiState(({ message }) => message.id);
    return <article data-id={id}>{useSearchStepCovered(sessionId) ? "Search covered" : <TurnProcessSummary sessionId={sessionId} />}</article>;
  }
  function Conversation() {
    const runtime = useExternalStoreRuntime<ThreadMessageLike>({ messages: rows, convertMessage: message => message, isRunning: false, onNew: async () => {} });
    return <AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Messages components={{ AssistantMessage: Receipt, UserMessage: () => null }} /></AssistantRuntimeProvider>;
  }
  const ui = mountRoomUi();
  try {
    await ui.render(<Conversation />);
    const rendered = new Map(ui.all("article").map(row => [row.props["data-id"], textOf(row)]));
    expect(rendered.get("entry_search_1100")).toBe("Search covered");
    expect(rendered.get("entry_reply_1100")).toContain("You stopped after the opening");
    expect(rendered.get("entry_reply_1100")).toContain("2 passed, 1 failed, 1 inconclusive");
    for (const timestamp of [2100, 3100, 4100]) {
      expect(rendered.get(`entry_search_${timestamp}`)).toBe("");
      expect(rendered.get(`entry_reply_${timestamp}`)).toBe("");
    }
    ui.button("You stopped after the opening").props.onClick();
    await settle();
    expect(ui.text()).toContain("Showed draft 2 as the opening");
  } finally {
    await ui.unmount();
    resetTurnReceipts();
  }
});

test("alternate reply answers retain the model's scores and the original selected label", () => {
  const chart = renderToStaticMarkup(<ReplyReviewConfidence review={{
    backend: "local", model: "reviewer", calibrated: false,
    answers: [{ id: "fit", choice: "appropriate", confidence: 0.86, probabilities: [
      { label: "overhelp", value: 0.14 }, { label: "appropriate", value: 0.86 }, { label: "unknown", value: NaN },
    ] }],
  }} />);
  expect(chart).toContain('aria-label="See other answers for Response fit"');
  expect(chart).toContain(" · selected");
  expect(chart).toMatch(/aria-label="Response fit: overhelp"[^>]*aria-valuenow="0.14"/);
  expect(chart).not.toContain("Response fit: unknown");
});

test("inline memory decisions show the recorded score and cutoff together", () => {
  const html = renderToStaticMarkup(<TurnJudgementSummary embedded record={record} />);
  expect(html).toContain("Worth remembering");
  expect(html).toContain("Cutoff (%) 90");
  expect(html).toMatch(/aria-label="Estimated worth remembering, cutoff 90%"[^>]*aria-valuenow="71"/);
});

test("draft progress reports stage completion, elapsed budget and the actual attempt count", () => {
  const html = renderToStaticMarkup(<DraftProgressCard status={{ id: 1, feedback: null,
    snapshot: { ...snapshot, phase: "checking", selectedAttempt: null, elapsedMs: 57000, maxAttempts: 3 } }} />);
  expect(html).toMatch(/aria-label="Completed draft stages"[^>]*aria-valuetext="2 of 4"/);
  expect(html).toMatch(/aria-label="Draft 2 of 3"[^>]*aria-valuenow="2"/);
  expect(html).toContain('aria-valuetext="57 of 90 seconds"');
});

test("the judgement summary exposes exact option probabilities as a table", () => {
  const html = renderToStaticMarkup(<TurnJudgementSummary record={{ ...record, replyReview: {
    backend: "local", model: "reviewer", calibrated: false,
    answers: [{ id: "fit", choice: "appropriate", confidence: .7, probabilities: [
      { label: "appropriate", value: .7 }, { label: "overhelp", value: .12 },
      { label: "underhelp", value: .13 }, { label: "other", value: .05 },
    ] }],
  } }} />);
  expect(html).toContain("Review option probabilities");
  expect(html).toMatch(/aria-label="Response fit: underhelp"[^>]*aria-valuenow="0.13"/);
  expect(html).toContain("<td>underhelp</td><td>0.13</td>");
});
