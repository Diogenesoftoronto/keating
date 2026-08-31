import { describe, expect, test } from "bun:test";
import {
	browserSystemPromptFromRevision,
	type SafeJsonValue,
	type VerifiedBrowserActiveRevision,
} from "../keating/account-evolution";

const digest = `sha256:${"a".repeat(64)}`;

function revision(value: string | SafeJsonValue): VerifiedBrowserActiveRevision {
	const promptRef = {
		id: "prompts-1",
		kind: "prompt-set" as const,
		digest,
		mediaType: typeof value === "string" ? "text/markdown" : "application/json",
		sizeBytes: 128,
	};
	const compatibility = {
		agentApi: "keating-agent-hooks-v1",
		learnerContract: 1,
		targets: ["browser-nodepod" as const],
		requiredCapabilities: ["prompt-set"],
	};
	const sourceRevision = {
		id: "revision-1",
		createdAt: "2026-08-31T12:00:00.000Z",
		manifestDigest: digest,
		artifacts: [promptRef],
		compatibility,
	};
	return {
		projectId: "keating-account",
		revisionId: sourceRevision.id,
		manifestDigest: digest,
		generation: 1,
		createdAt: sourceRevision.createdAt,
		compatibility,
		artifacts: [{
			kind: "prompt-set",
			format: typeof value === "string" ? "markdown" : "json",
			ref: promptRef,
			value,
		}],
		omittedArtifactKinds: [],
		sourceRevision,
	};
}

describe("connected account prompt activation", () => {
	test("activates verified text and canonical JSON system prompts", () => {
		expect(browserSystemPromptFromRevision(revision("Evolved tutor prompt"))).toBe("Evolved tutor prompt");
		expect(browserSystemPromptFromRevision(revision({
			schemaVersion: 1,
			prompts: { system: "Evolved JSON tutor", learn: "Teach adaptively" },
		}))).toBe("Evolved JSON tutor");
	});

	test("fails closed for malformed prompt-set JSON", () => {
		expect(browserSystemPromptFromRevision(revision({
			schemaVersion: 2,
			prompts: { system: "future contract" },
		}))).toBeNull();
		expect(browserSystemPromptFromRevision(revision({ schemaVersion: 1, prompts: {} }))).toBeNull();
	});
});
