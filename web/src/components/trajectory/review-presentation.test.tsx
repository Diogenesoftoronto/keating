import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	TRAJECTORY_REVIEW_SCHEMA_VERSION,
	createTextAnchor,
	type ReviewGenerationCandidate,
	type ReviewModelPool,
	type StoredModelReference,
} from "../../keating/trajectory-review";
import { CandidateLedger } from "./CandidateLedger";
import { TrajectoryCanvas } from "./TrajectoryCanvas";

const noop = () => {};

describe("trajectory review presentation", () => {
	test("renders message markdown and exposes tool calls plus raw view controls", () => {
		const source = "## Diagnosis\n\nCheck the premise.\n[Tool: learner_state]";
		const phraseStart = source.indexOf("premise");
		const html = renderToStaticMarkup(
			<TrajectoryCanvas
				messages={[{
					id: "message-1",
					role: "assistant",
					ordinal: 0,
					text: source,
					markdown: source,
					raw: '{"role":"assistant"}',
					tools: [{ kind: "call", name: "learner_state", callId: "call-1", status: "failed", input: '{"topic":"logic"}' }],
					contentFingerprint: "fingerprint",
				}]}
				artifacts={[]}
				annotations={[{
					schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
					id: "annotation-1",
					reviewId: "review-1",
					sessionId: "session-1",
					target: { kind: "message-span", messageId: "message-1", role: "assistant", anchor: createTextAnchor(source, phraseStart, phraseStart + "premise".length) },
					targetKey: "message:message-1",
					kind: "problem",
					category: "accuracy",
					note: "The premise needs checking.",
					status: "draft",
					createdAt: 1,
					updatedAt: 1,
				}]}
				activeMessageId="message-1"
				mode="transcript"
				transcript="continuous"
				onTranscriptChange={noop}
				onModeChange={noop}
				onSelectMessage={noop}
				onSelectArtifact={noop}
			/>,
		);

		expect(html).toContain("<h2");
		expect(html).toContain("Diagnosis");
		expect(html).toContain("Tool call");
		expect(html).toContain("learner_state");
		expect(html).toContain("Failed");
		expect(html).toContain("data-review-highlight=\"true\"");
		expect(html).toContain("data-source-start");
		expect(html).toContain('aria-label="Transcript layout"');
		expect(html).toContain("Focused turn");
		expect(html).not.toContain('id="trajectory-artifact-tab"');
		expect(html).toContain('aria-label="Message view"');
		expect(html).toContain(">rendered</button>");
		expect(html).toContain(">raw</button>");
	});

	test("renders the active model result as markdown in the comparison surface", () => {
		const model: StoredModelReference = {
			provider: "browser",
			id: "teacher-small",
			name: "Teacher Small",
			api: "browser",
			baseUrl: "browser://local",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8_192,
			maxTokens: 2_048,
		};
		const pool: ReviewModelPool = {
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			id: "pool-1",
			name: "Teaching alternatives",
			tasks: ["response"],
			models: [model],
			candidateCount: 1,
			temperature: 0.7,
			maxTokens: 1_024,
			createdAt: 1,
			updatedAt: 1,
		};
		const candidate: ReviewGenerationCandidate = {
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			id: "candidate-1",
			reviewId: "review-1",
			sessionId: "session-1",
			target: { kind: "response", messageId: "message-1", originalContent: "Old answer" },
			targetKey: "message:message-1",
			poolId: pool.id,
			model,
			prompt: "Rewrite the response",
			annotationIds: [],
			state: "completed",
			content: "## Better answer\n\nUse a concrete example.",
			preferred: false,
			createdAt: 2,
			updatedAt: 2,
		};

		const html = renderToStaticMarkup(
			<CandidateLedger
				candidates={[candidate]}
				modelPools={[pool]}
				availableModels={[model]}
				activeTargetKey="message:message-1"
				activeTask="response"
				promptCharacters={500}
				activeCandidateId={candidate.id}
				activeModelPoolId={pool.id}
				onSelectCandidate={noop}
				onSelectModelPool={noop}
				onGenerate={noop}
				onChoose={noop}
				onInsert={noop}
				onRegenerate={noop}
			/>,
		);

		expect(html).toContain("Model results");
		expect(html).toContain("Teacher Small");
		expect(html).toContain("Better answer");
		expect(html).toContain("Candidate view");
		expect(html).toContain("Copy response");
	});
});
