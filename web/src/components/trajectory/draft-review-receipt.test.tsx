import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { projectActiveWork, type UiDocument } from "@keating/learner-contracts";
import { DraftReviewReceipt } from "./DraftReviewReceipt";
import type { TeachingDraftReceiptRecord } from "../../keating/storage";

const plan: UiDocument = {
	schemaVersion: 1 as UiDocument["schemaVersion"], id: "plan-doc", revision: 1, lifecycle: "ready", supportedSurfaces: ["web"], title: "Fractions",
	nodes: [{ type: "study-plan", id: "plan", title: "Fractions path", items: [{ id: "a", title: "Equal parts" }] }],
	createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
};

const receipt: TeachingDraftReceiptRecord = {
	id: "s1:10", sessionId: "s1", messageTimestamp: 10, createdAt: 11,
	snapshot: {
		phase: "released", attempt: 2, maxAttempts: 3, reasoning: "low", standard: "supported", elapsedMs: 4_200,
		judgeModel: "jev-latest", selectedAttempt: 2, reason: null,
		attempts: [
			{ attempt: 1, reasoning: "low", standard: "supported", generationMs: 900, judgementMs: 400, status: "rejected",
				checks: [{ id: "openui_checkpoint", source: "judge", severity: "critical", status: "fail", probability: 0.81 }] },
			{ attempt: 2, reasoning: "low", standard: "supported", generationMs: 800, judgementMs: 300, status: "accepted",
				checks: [{ id: "openui_checkpoint", source: "judge", severity: "critical", status: "pass", probability: 0.04 }] },
		],
	},
	activeWork: projectActiveWork({ plan, presentations: [], attempts: [] }),
} as unknown as TeachingDraftReceiptRecord;

const paired = {
	...receipt,
	snapshot: {
		...receipt.snapshot, planningMs: 610, planReview: { trigger: "graded-attempt", action: "suggest-advance" },
		interaction: { action: "create", paired: true, features: ["variable_relationship"], families: [{ family: "manipulable", components: ["Simulation"] }] },
		attempts: receipt.snapshot.attempts.map((attempt, index) => ({ ...attempt, variant: index ? "interactive" : "prose" })),
	},
} as unknown as TeachingDraftReceiptRecord;

describe("draft review receipt", () => {
	test("shows the interaction recommendation and which variant each draft was", () => {
		const html = renderToStaticMarkup(<DraftReviewReceipt receipt={paired} />);
		expect(html).toContain("released draft 2 (interactive)");
		expect(html).toContain("Draft 1 · prose · rejected");
		expect(html).toContain("activity recommended · manipulable (Simulation)");
		expect(html).toContain("interactive and prose drafts competed blind");
		expect(html).toContain("Material features judged true: variable_relationship");
		expect(html).toContain("planning 610 ms");
		expect(html).toContain("Plan review after a graded attempt: propose marking the item done (the learner decides)");
	});

	test("receipts recorded before paired drafting render without variant labels", () => {
		const html = renderToStaticMarkup(<DraftReviewReceipt receipt={receipt} />);
		expect(html).not.toContain("draft-interaction");
		expect(html).not.toContain("default");
		expect(html).not.toContain("draft-plan-review");
	});

	test("shows every draft's check verdicts and the active work it was judged against", () => {
		const html = renderToStaticMarkup(<DraftReviewReceipt receipt={receipt} />);
		expect(html).toContain("Draft review · released draft 2 · 2 drafts checked");
		expect(html).toContain("Draft 1 · rejected");
		expect(html).toContain("0.810");
		expect(html).toContain("jev-latest");
		expect(html).toContain("Current focus: Equal parts");
	});
});
