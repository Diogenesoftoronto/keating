import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionData } from "../types/session";
import { buildPendingResponseComparison } from "../keating/response-comparison";

const message = (role: "user" | "assistant", text: string, timestamp: number) => ({
	role,
	content: [{ type: "text", text }],
	timestamp,
}) as AgentMessage;

function session(id: string, messages: AgentMessage[], extra: Partial<SessionData> = {}): SessionData {
	return {
		id,
		title: "Promises",
		model: {} as SessionData["model"],
		thinkingLevel: "medium",
		messages,
		createdAt: "2026-01-01T00:00:00.000Z",
		lastModified: "2026-01-01T00:00:00.000Z",
		...extra,
	};
}

describe("response comparison", () => {
	it("pairs the original turn with its generated alternative", () => {
		const source = session("source", [message("user", "Explain promises", 1), message("assistant", "Original", 2)]);
		const alternative = session("alternative", [message("user", "Explain promises", 1), message("assistant", "Alternative", 3)], {
			parentSessionId: "source",
			generatedAlternative: true,
			hiddenAlternative: true,
			alternativeForMessageTimestamp: 2,
		});
		expect(buildPendingResponseComparison(source, alternative)).toMatchObject({
			sourceSessionId: "source",
			alternativeSessionId: "alternative",
			originalResponse: "Original",
			alternativeResponse: "Alternative",
		});
	});

	it("does not reopen a completed comparison", () => {
		const source = session("source", [message("assistant", "Original", 2)]);
		const alternative = session("alternative", [message("assistant", "Alternative", 3)], {
			parentSessionId: "source",
			generatedAlternative: true,
			alternativeForMessageTimestamp: 2,
			responsePreference: "original",
		});
		expect(buildPendingResponseComparison(source, alternative)).toBeNull();
	});
});
