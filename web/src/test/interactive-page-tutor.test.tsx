import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseInteractiveSegments } from "../components/interactive-segments";
import { createQuizConversationHandlers } from "../components/chat/quiz-conversation";
import { TutorInteractivePage } from "../components/interactive/TutorInteractivePage";
import { createMediaTools } from "../keating/browser-tools/media";
import { classifyTool } from "../keating/security/policy";
import {
	INTERACTIVE_SHARED_EVENT,
	createTutorPage,
	interactiveShareSubmissionId,
	interactiveShareText,
	parseTutorPagePayload,
	readInteractiveSharedDetail,
} from "../keating/interactive-page/tutor-page";
import type { KeatingStorage } from "../keating/storage";

const description = "A slider for the learning rate and a button that takes one gradient step on a parabola.";
const explorer = `<label for="lr">Learning rate <output id="v">0.1</output></label><input id="lr" type="range" min="0" max="1" step="0.05"><button type="button" id="step">Step</button><script>keating.ready();</script>`;
const exercise = `${explorer}<button type="button" id="send">Send to tutor</button><script>document.getElementById("send").onclick=()=>keating.share({summary:"Converged at lr 0.3",score:{earned:2,possible:3}});</script>`;

function tool() {
	const found = createMediaTools({} as KeatingStorage).find((candidate) => candidate.name === "interactive_page");
	if (!found) throw new Error("interactive_page tool is not registered");
	return found;
}

async function run(params: Record<string, unknown>): Promise<string> {
	const result = await tool().execute("call-1", params);
	return (result.content as Array<{ type: string; text?: string }>).map((part) => part.text ?? "").join("\n");
}

describe("interactive_page tool", () => {
	test("is part of the tutor's callable surface and its guide reaches the model", () => {
		expect(classifyTool("interactive_page").known).toBe(true);
		expect(tool().description).toContain("window.keating");
		expect(tool().description).toContain("Accessibility (required)");
	});

	test("a valid page is emitted as a tag the chat renders", async () => {
		const text = await run({ title: "Gradient descent explorer", description, html: explorer });
		const segment = parseInteractiveSegments(text).find((candidate) => candidate.type === "interactive");
		expect(segment).toBeDefined();
		const payload = parseTutorPagePayload(JSON.parse((segment as { json: string }).json) as string);
		expect(payload).toMatchObject({ title: "Gradient descent explorer", description, html: explorer, purpose: "explore", libraries: [] });
	});

	test("HTML containing quotes, angle brackets and a closing tag survives the round trip", async () => {
		const tricky = `<p title="a > b">x</p><script>const s = "</p> /> \\" done"; keating.ready();</script>`;
		const text = await run({ title: "Tricky", description, html: tricky });
		const segments = parseInteractiveSegments(text);
		expect(segments.filter((candidate) => candidate.type === "interactive")).toHaveLength(1);
		const segment = segments.find((candidate) => candidate.type === "interactive") as { json: string };
		expect(parseTutorPagePayload(JSON.parse(segment.json) as string)?.html).toBe(tricky);
	});

	test("the same page always gets the same id, so saved learner state is restored on reload", () => {
		const first = createTutorPage({ title: "Explorer", description, html: explorer });
		const second = createTutorPage({ title: "Explorer", description, html: explorer });
		const changed = createTutorPage({ title: "Explorer", description, html: `${explorer}<!-- v2 -->` });
		expect(first.ok && second.ok && changed.ok).toBe(true);
		if (first.ok && second.ok && changed.ok) {
			expect(second.payload.id).toBe(first.payload.id);
			expect(changed.payload.id).not.toBe(first.payload.id);
		}
	});

	test("rejections come back as guidance, never as a tag", async () => {
		for (const params of [
			{ title: "No alternative", description: "short", html: explorer },
			{ title: "Empty", description, html: "   " },
			{ title: "Leaves the frame", description, html: `<meta http-equiv="refresh" content="0;url=https://example.test">` },
			{ title: "Assignment with no hand-back", description, html: explorer, purpose: "assignment" },
		]) {
			const text = await run(params);
			expect(text).not.toContain("<keating-interactive");
			expect(text.length).toBeGreaterThan(20);
		}
	});

	test("a library outside the allowlist is refused by the tool's schema", async () => {
		await expect(run({ title: "Unknown library", description, html: explorer, libraries: ["jquery"] })).rejects.toThrow(/must be one of/);
		// The builder refuses it too, for payloads that did not come through the schema.
		expect(createTutorPage({ title: "Unknown library", description, html: explorer, libraries: ["jquery"] }).ok).toBe(false);
	});

	test("an exercise that shares its result is accepted", async () => {
		const text = await run({ title: "Pick a learning rate", description, html: exercise, purpose: "exercise" });
		expect(text).toContain("<keating-interactive");
		expect(text).toContain("shared result will arrive");
	});
});

describe("transcript payloads", () => {
	test("malformed payloads render nothing instead of throwing", () => {
		for (const bad of ["", "not json", "null", "[]", JSON.stringify({ id: "page-1", title: "t" }), JSON.stringify({ id: "has spaces!", title: "t", description: "d", html: "<p>x</p>" })]) {
			expect(parseTutorPagePayload(bad)).toBeNull();
			expect(renderToStaticMarkup(<TutorInteractivePage payloadText={bad} />)).toBe("");
		}
	});

	test("the card offers the code and starts with it hidden", () => {
		const page = createTutorPage({ title: "Explorer", description, html: explorer });
		if (!page.ok) throw new Error(page.message);
		const markup = renderToStaticMarkup(<TutorInteractivePage payloadText={JSON.stringify(page.payload)} />);
		expect(markup).toContain("View the code");
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).toContain(description);
		expect(markup).not.toContain("<pre");
	});
});

describe("sharing a result with the tutor", () => {
	const detail = { pageId: "page-abc", title: "Pick a learning rate", purpose: "exercise" as const, result: { summary: "Converged at lr 0.3", score: { earned: 2, possible: 3 }, complete: true, data: { lr: 0.3, steps: 12 } } };

	test("the learner turn states the actual result", () => {
		const text = interactiveShareText(detail);
		expect(text).toContain("Pick a learning rate");
		expect(text).toContain("Converged at lr 0.3");
		expect(text).toContain("Score: 2 of 3");
		expect(text).toContain('"steps": 12');
	});

	test("an assignment is worded as a submission", () => {
		expect(interactiveShareText({ ...detail, purpose: "assignment" })).toContain("submitting my work");
	});

	test("invalid or oversized shares are refused", () => {
		expect(readInteractiveSharedDetail(null)).toBeNull();
		expect(readInteractiveSharedDetail({ ...detail, result: { summary: "" } })).toBeNull();
		expect(readInteractiveSharedDetail({ ...detail, pageId: "bad id" })).toBeNull();
		expect(readInteractiveSharedDetail({ ...detail, result: { summary: "x", score: { earned: 5, possible: 3 } } })).toBeNull();
		expect(readInteractiveSharedDetail({ ...detail, result: { summary: "x", data: "y".repeat(20_000) } })).toBeNull();
	});

	function handlers(hasAgent = true) {
		const submitted: Array<{ text: string; id?: string }> = [];
		const built = createQuizConversationHandlers({
			hasAgent: () => hasAgent,
			submit: (serialized, id) => { submitted.push({ text: typeof serialized === "string" ? serialized : serialized({ sessionMessageId: "m", submittedAt: 1 } as never), id }); },
			capture: () => {},
		});
		return { built, submitted };
	}
	const event = (value: unknown) => new CustomEvent(INTERACTIVE_SHARED_EVENT, { detail: value, cancelable: true });

	test("a shared result becomes one learner turn and is claimed", () => {
		const { built, submitted } = handlers();
		const shared = event(detail);
		built.interactiveShared(shared);
		expect(shared.defaultPrevented).toBe(true);
		expect(submitted).toHaveLength(1);
		expect(submitted[0]!.text).toContain("Converged at lr 0.3");
		expect(submitted[0]!.id).toBe(interactiveShareSubmissionId(detail));
	});

	test("the same result has the same submission id, and a different result a different one", () => {
		expect(interactiveShareSubmissionId({ ...detail })).toBe(interactiveShareSubmissionId(detail));
		const reordered = { ...detail, result: { data: detail.result.data, complete: true, score: { possible: 3, earned: 2 }, summary: "Converged at lr 0.3" } };
		expect(interactiveShareSubmissionId(reordered)).toBe(interactiveShareSubmissionId(detail));
		expect(interactiveShareSubmissionId({ ...detail, result: { summary: "Diverged at lr 0.9" } })).not.toBe(interactiveShareSubmissionId(detail));
	});

	test("with no conversation open nothing is sent and the page is told it failed", () => {
		const { built, submitted } = handlers(false);
		const shared = event(detail);
		built.interactiveShared(shared);
		expect(shared.defaultPrevented).toBe(false);
		expect(submitted).toHaveLength(0);
	});

	test("a malformed event is ignored", () => {
		const { built, submitted } = handlers();
		const shared = event({ pageId: "page-abc", title: "x", result: { summary: 42 } });
		built.interactiveShared(shared);
		expect(shared.defaultPrevented).toBe(false);
		expect(submitted).toHaveLength(0);
	});
});
