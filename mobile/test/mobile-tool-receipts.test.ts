import { describe, expect, it } from "bun:test";
import type { AgentStreamEvent } from "@keating/learner-contracts";
import { restoreMobileToolReceipt } from "../src/lib/mobile-tool-receipts";
import type { StudyArtifact } from "../src/lib/types";

const artifact: StudyArtifact = {
  id: "artifact-1",
  sessionId: "session-1",
  messageId: "user-1",
  kind: "study-plan",
  source: "keating-core",
  title: "Bayes plan",
  content: "Plan",
  createdAt: 1,
};

function receipt(status: "success" | "error" | "retryable", text: string): AgentStreamEvent[] {
  return [
    { id: "event-1", occurredAt: "2026-08-10T00:00:00.000Z", type: "tool-call", turnId: "turn-1", sequence: 0, call: { id: "call-1", name: "generate_study_plan", arguments: { topic: "Bayes" }, idempotencyKey: "tool-key-1" } },
    { id: "event-2", occurredAt: "2026-08-10T00:00:01.000Z", type: "tool-result", turnId: "turn-1", sequence: 1, result: { toolCallId: "call-1", idempotencyKey: "tool-key-1", status, text } },
  ];
}

describe("restoreMobileToolReceipt", () => {
  it("reuses a durable success without proposing the artifact effect again", () => {
    const restored = restoreMobileToolReceipt(
      receipt("success", JSON.stringify({ artifactId: artifact.id, kind: artifact.kind, title: artifact.title, topic: "Bayes" })),
      [artifact],
      "tool-key-1",
      "generate_study_plan",
    );
    expect(restored).toMatchObject({ ok: true, output: { artifactId: "artifact-1" }, effects: [] });
  });

  it("fails closed when a success receipt points to a missing durable artifact", () => {
    expect(restoreMobileToolReceipt(
      receipt("success", JSON.stringify({ artifactId: artifact.id })),
      [],
      "tool-key-1",
      "generate_study_plan",
    )).toBeNull();
  });

  it("restores structured retryable failures and reads legacy plain errors safely", () => {
    expect(restoreMobileToolReceipt(
      receipt("retryable", JSON.stringify({ code: "timeout", message: "Timed out.", retryable: true })),
      [],
      "tool-key-1",
      "generate_study_plan",
    )).toMatchObject({ ok: false, code: "timeout", message: "Timed out.", retryable: true });
    expect(restoreMobileToolReceipt(
      receipt("error", "Old failure text"),
      [],
      "tool-key-1",
      "generate_study_plan",
    )).toMatchObject({ ok: false, code: "execution_failed", message: "Old failure text", retryable: false });
  });

  it("rejects a receipt whose semantic key belongs to another tool", () => {
    expect(restoreMobileToolReceipt(receipt("error", "No"), [], "tool-key-1", "generate_concept_map")).toBeNull();
  });

  it("reuses a workspace proposal only while its durable overlay still exists", () => {
    const events: AgentStreamEvent[] = [
      { id: "event-workspace-call", occurredAt: "2026-08-10T00:00:00.000Z", type: "tool-call", turnId: "turn-1", sequence: 0, call: { id: "call-workspace", name: "propose_mobile_workspace_change", arguments: {}, idempotencyKey: "tool-key-workspace" } },
      { id: "event-workspace-result", occurredAt: "2026-08-10T00:00:01.000Z", type: "tool-result", turnId: "turn-1", sequence: 1, result: { toolCallId: "call-workspace", idempotencyKey: "tool-key-workspace", status: "success", text: JSON.stringify({ overlayId: "overlay-1", status: "pending-user-activation" }) } },
    ];
    expect(restoreMobileToolReceipt(events, [], "tool-key-workspace", "propose_mobile_workspace_change", (id) => id === "overlay-1"))
      .toMatchObject({ ok: true, effects: [] });
    expect(restoreMobileToolReceipt(events, [], "tool-key-workspace", "propose_mobile_workspace_change", () => false)).toBeNull();
  });
});
