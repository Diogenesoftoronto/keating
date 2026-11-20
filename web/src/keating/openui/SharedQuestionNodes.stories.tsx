import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UiActionReceipt, UiDocument, UiDocumentNode, UiQuestion, UiQuestionGroupResponse } from "@keating/learner-contracts";
import { userEvent, within } from "storybook/test";
import { css } from "../../../styled-system/css";
import { LessonFrame } from "../../components/lesson/LessonFrame";
import { Question, SharedUiDocumentRenderer } from "./shared-renderer";

const frameClass = css({ width: "min(48rem, calc(100vw - 2rem))", paddingBlock: "1rem" });
const at = "2026-11-20T10:00:00.000Z";

function documentOf(nodes: UiDocumentNode[], lifecycle: UiDocument["lifecycle"] = "ready"): UiDocument {
	return { schemaVersion: 1, id: `storybook-${nodes[0]?.id ?? "empty"}`, revision: 0, lifecycle, retention: "workspace", supportedSurfaces: ["web", "desktop", "mobile", "terminal"], nodes, createdAt: at, updatedAt: at };
}

function receiptFor(type: "save-artifact" | "open-handoff", nodeId: string): UiActionReceipt {
	const action = { schemaVersion: 1, type, documentId: `storybook-${nodeId}`, documentRevision: 0, nodeId, idempotencyKey: `storybook-${type}-${nodeId}` } as UiActionReceipt["action"];
	return { schemaVersion: 1, action, actionFingerprint: "storybook", state: "completed", createdAt: at, updatedAt: at };
}

/** The shared document renderer's own question branch and the small nodes around it (lane O6). */
function SharedNodes({ nodes, receipts, lifecycle, question, response }: { nodes?: UiDocumentNode[]; receipts?: UiActionReceipt[]; lifecycle?: UiDocument["lifecycle"]; question?: UiQuestion; response?: UiQuestionGroupResponse }) {
	return <div className={frameClass}>
		{question
			? <div className="lesson-document"><LessonFrame glyph="help" kind="Quick check"><Question node={question} groupResponse={response} disabled={false} onAction={() => true} /></LessonFrame></div>
			: <SharedUiDocumentRenderer document={documentOf(nodes ?? [], lifecycle)} receipts={receipts} onAction={() => true} />}
	</div>;
}

const meta = { title: "Learning/Shared question nodes", component: SharedNodes, parameters: { layout: "centered" } } satisfies Meta<typeof SharedNodes>;
export default meta;
type Story = StoryObj<typeof meta>;

const q = (question: Omit<UiQuestion, "id"> & { id?: string }): UiDocumentNode => ({ type: "question", id: question.id ?? "q", ...question } as UiDocumentNode);

export const Blanks: Story = {
	args: { nodes: [q({ id: "blanks", kind: "fill_in", prompt: "Name the three parts of Bayes' rule.", blanks: [{ placeholder: "the belief before" }, { placeholder: "how well the evidence fits" }, { placeholder: "the belief after" }] })] },
};
export const InlineBlanks: Story = {
	args: { nodes: [q({ id: "cloze", kind: "blanks", header: "Fill in the blanks", prompt: "A resolver keeps a record until its {{blank}} expires, so a second lookup skips the {{blank}} server.", blanks: [{ placeholder: "ttl", hint: "Time limit" }, { placeholder: "authority" }] })] },
};
export const FreeText: Story = {
	args: { nodes: [q({ id: "free", kind: "text", prompt: "Explain in your own words why a cached record can be stale.", hint: "Think about what changes at the source while the record sits in the cache." })] },
};
export const Slider: Story = {
	args: { nodes: [q({ id: "slide", kind: "slider", prompt: "How many minutes should a frequently changing record live in the cache?", min: 0, max: 120, step: 5 })] },
};
export const Order: Story = {
	args: { nodes: [q({ id: "order", kind: "ordering", prompt: "Put a cold DNS lookup in order.", items: ["Stub resolver asks the recursive resolver", "Recursive resolver asks a root server", "TLD server points to the authority", "Authoritative server answers", "Record is cached with its TTL"] })] },
};
const categorize: UiQuestion = { id: "sort", kind: "classification", prompt: "Which records can a resolver answer from cache?", choiceLabel: "Bucket", requireReasons: true, reasonLabel: "Why", items: ["A record, TTL 300s, fetched a minute ago", "AAAA record, TTL expired", "MX record, never fetched", "CNAME, TTL 1 day, fetched this morning"], choices: [{ id: "cache", label: "From cache" }, { id: "upstream", label: "Ask upstream" }] };
export const Categorize: Story = { args: { nodes: [{ type: "question", ...categorize }] } };
export const CategorizePlaced: Story = {
	args: { question: categorize, response: { questionId: "sort", type: "rows", rows: [
		{ item: categorize.items![0]!, optionId: "cache", reason: "TTL still running" },
		{ item: categorize.items![1]!, optionId: "upstream", reason: "" },
		{ item: categorize.items![3]!, optionId: "cache", reason: "" },
	] } },
};

export const QuizReview: Story = {
	args: { nodes: [{ type: "quiz", id: "quiz", title: "DNS caching check", questions: [
		{ id: "q1", prompt: "What does TTL bound?", kind: "text" },
		{ id: "q2", prompt: "Which server answers authoritatively?", kind: "choice", choices: [{ id: "a", label: "The authority" }, { id: "b", label: "The stub" }], correctAnswer: "a" },
		{ id: "q3", prompt: "Explain negative caching.", kind: "text" },
	], timeLimit: 0 } as UiDocumentNode] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(await canvas.findByRole("textbox", { name: "Your answer" }), "How long a record may be reused.");
		await userEvent.click(canvas.getByRole("button", { name: /Next/ }));
		await userEvent.click(canvas.getByRole("button", { name: "Flag for review" }));
		await userEvent.click(canvas.getByRole("button", { name: "Skip" }));
		await userEvent.click(canvas.getByRole("button", { name: "Skip" }));
	},
};

const goal: UiDocumentNode = { type: "goal", id: "goal", title: "Explain Bayesian updating", status: "active", steps: [
	{ id: "s1", title: "Name prior, likelihood and posterior", status: "done" },
	{ id: "s2", title: "Work one update by hand", status: "in_progress" },
	{ id: "s3", title: "Explain why a rare disease test misleads", status: "not_started" },
] } as UiDocumentNode;
export const Checklist: Story = { args: { nodes: [goal] } };

export const Resource: Story = {
	args: { nodes: [{ type: "artifact", id: "note", resource: { id: "r", title: "Bayes cheat sheet", format: "markdown", uri: "https://example.org/bayes", content: "**Posterior** is proportional to likelihood times prior.\n\n- Prior: what you believed before\n- Likelihood: how well the evidence fits\n- Posterior: what you believe now" } }] },
};
export const ResourceText: Story = {
	args: { nodes: [{ type: "artifact", id: "plain", resource: { id: "r2", title: "resolver.conf", format: "text", content: "nameserver 1.1.1.1\noptions timeout:2 attempts:3\n# cache records for at most their TTL" } }],
		receipts: [receiptFor("save-artifact", "plain")] },
};
export const Unavailable: Story = {
	args: { nodes: [{ type: "image", id: "img", alt: "Resolver diagram", resource: { id: "r3", title: "Resolver diagram", format: "uri", uri: "https://images.invalid/resolver.png" } } as UiDocumentNode] },
};
export const Handoff: Story = {
	args: { nodes: [{ type: "handoff", id: "handoff", target: "desktop", reason: "The packet capture lab needs a terminal and local network access.", context: "Your notes and this check come with you." }] },
};
export const HandoffDone: Story = {
	args: { nodes: [{ type: "handoff", id: "handoff-web", target: "web", reason: "Continue in the full workspace to see the whole lesson.", context: "Learner state is preserved." }],
		receipts: [receiptFor("open-handoff", "handoff-web")] },
};
export const MarkdownAndRetry: Story = {
	args: { lifecycle: "failed", nodes: [{ type: "markdown", id: "md", markdown: "### Before the check\n\nA cache trades **freshness** for speed. Keep the TTL in mind." }, goal] },
};
