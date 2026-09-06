import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UiDocument } from "@keating/learner-contracts";
import { expect, userEvent, within } from "storybook/test";
import { css } from "../../../styled-system/css";
import { keatingOpenUIQuestionExampleProgram } from "./library";
import { KeatingOpenUIRenderer } from "./renderer";

const frameClass = css({ width: "min(64rem, calc(100vw - 2rem))", paddingBlock: "1rem" });

const componentGallery: UiDocument = {
	schemaVersion: 1,
	id: "storybook-openui-gallery",
	revision: 0,
	lifecycle: "ready",
	retention: "workspace",
	supportedSurfaces: ["web", "desktop", "mobile", "terminal"],
	title: "Shared OpenUI component gallery",
	description: "One canonical document rendered through the same learner contract used across Keating surfaces.",
	nodes: [
		{ type: "markdown", id: "overview", markdown: "### Retrieval workspace\n\nRead the model, answer the check, and keep a short note about what remains uncertain." },
		{ type: "callout", id: "ttl-warning", tone: "warning", title: "Watch the boundary", markdown: "A valid cache hit can still return data that changed at the source before its TTL expired." },
		{
			type: "question-group",
			id: "cache-check",
			title: "Check your cache model",
			topic: "DNS caching",
			questions: [
				{
					id: "cache-mechanism",
					header: "Mechanism",
					prompt: "Why can a repeated lookup be faster?",
					kind: "choice",
					choices: [
						{ id: "reuse", label: "The resolver can reuse an unexpired cached record" },
						{ id: "skip", label: "The second request skips DNS entirely" },
					],
					allowText: true,
				},
				{ id: "staleness", header: "Tradeoff", prompt: "Explain how the same cache can become stale.", kind: "text", allowText: true },
			],
		},
		{
			type: "study-plan",
			id: "cache-plan",
			title: "DNS cache reasoning",
			overview: "Move from the lookup path to TTL tradeoffs and incident evidence.",
			items: [
				{ id: "trace", title: "Trace a cold lookup", detail: "Label the stub, recursive resolver, and authoritative server.", outcomes: ["Narrate the query path in order"] },
				{ id: "compare", title: "Compare cold and warm lookups", detail: "Identify which upstream work disappears after caching.", dependsOn: ["trace"], outcomes: ["Explain the latency difference from evidence"] },
				{ id: "ttl", title: "Reason about TTL", detail: "Balance bounded staleness against query volume.", dependsOn: ["compare"] },
			],
		},
		{ type: "concept-map", id: "cache-map", title: "Resolution and reuse", source: "flowchart LR\n  Client --> Resolver\n  Resolver --> Cache\n  Cache -->|miss| Authority\n  Cache -->|hit before TTL| Client" },
		{ type: "notes", id: "cache-notes", title: "Working notes", value: "", placeholder: "Write the part of the cache model you still need to test." },
	],
	createdAt: "2026-08-25T14:20:00.000Z",
	updatedAt: "2026-08-25T14:20:00.000Z",
};

function StoryFrame(props: Parameters<typeof KeatingOpenUIRenderer>[0]) {
	return <div className={frameClass}><KeatingOpenUIRenderer {...props} /></div>;
}

const meta = {
	title: "Learning/OpenUI",
	component: StoryFrame,
	parameters: { layout: "centered" },
} satisfies Meta<typeof StoryFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SharedComponentGallery: Story = {
	args: {
		document: componentGallery,
		metadata: { id: componentGallery.id, lifecycle: "workspace", revision: 0 },
	},
};

export const QuestionInteraction: Story = {
	args: {
		program: keatingOpenUIQuestionExampleProgram,
		metadata: { id: "storybook-openui-question", lifecycle: "ephemeral", revision: 0 },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /cached record can be reused/i }));
		await userEvent.click(canvas.getByRole("button", { name: "Answer" }));
		await expect(canvas.findByText("Submitted")).resolves.toBeTruthy();
	},
};

export const StreamingSourceRecovery: Story = {
	args: {
		source: 'root = LearningSurface([check], "Check your model"',
		isStreaming: true,
		sourceComplete: false,
		metadata: { id: "storybook-openui-streaming", lifecycle: "ephemeral", revision: 0 },
	},
};

export const RejectedSourceRecovery: Story = {
	args: {
		program: 'root = LearningSurface([unsafe], "Unsafe source", "This must fail closed.", "ephemeral")\nunsafe = Explanation(globalThis.secret)',
		metadata: { id: "storybook-openui-rejected", lifecycle: "ephemeral", revision: 0 },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.findByRole("alert")).resolves.toBeTruthy();
		await expect(canvas.findByText(/could not be built/i)).resolves.toBeTruthy();
	},
};
