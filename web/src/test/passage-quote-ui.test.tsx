import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AssistantRuntimeProvider,
	ComposerPrimitive,
	type AppendMessage,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { REVEAL_QUOTE_SOURCE_EVENT, parseQuotedTurn, serializeQuotedTurn, type PassageQuote } from "../keating/passage-quote";
import { addDraftQuote, clearDraftQuotes, getDraftQuotes, resetDraftQuoteMemory } from "../keating/passage-quote-draft";
import { captureSelectionQuote, captureWholeSource, quoteSourceStatus, revealQuoteSource } from "../components/chat/quote-dom";
import { LearnerQuotedText, QuoteComposerPreview, QuotedTurnView, sendWithDraftQuotes } from "../components/chat/QuoteParts";
import { makeUserMessageFromAppend } from "../components/chat/user-message";
import { el, installFakeDom, select, textNode, type FakeDocument, type FakeElement } from "./helpers/quote-fake-dom";
import { mountRoomUi, settle } from "./helpers/room-ui-mount";

const SESSION = "session-quotes";
let dom: ReturnType<typeof installFakeDom>;

function tutorMessage(doc: FakeDocument, id: string, ...paragraphs: string[]): FakeElement {
	const body = el(doc, "div", { "data-quote-source-kind": "message", "data-quote-source-id": id, "data-quote-source-label": "Keating's reply" },
		...paragraphs.map((text) => el(doc, "p", {}, text)),
		el(doc, "div", { "data-quote-exclude": "" }, "tool: web_search"),
	);
	const root = el(doc, "div", { "data-learning-message-ids": JSON.stringify([id]) }, body);
	doc.body.append(root);
	return body;
}

function appendText(text: string): AppendMessage {
	return { role: "user", content: [{ type: "text", text }], attachments: [], parentId: null, sourceId: null, runConfig: undefined, metadata: { custom: {} } } as unknown as AppendMessage;
}

function Composer({ children }: { children: React.ReactNode }) {
	const runtime = useExternalStoreRuntime<ThreadMessageLike>({
		messages: [],
		convertMessage: (message) => message,
		isRunning: false,
		onNew: async () => {},
	});
	return <AssistantRuntimeProvider runtime={runtime}><ComposerPrimitive.Root>{children}</ComposerPrimitive.Root></AssistantRuntimeProvider>;
}

beforeEach(() => {
	dom = installFakeDom();
	resetDraftQuoteMemory();
});
afterEach(() => {
	clearDraftQuotes(SESSION);
	dom.restore();
});

describe("selection capture", () => {
	test("a selection inside one tutor message becomes a quote with context", () => {
		const body = tutorMessage(dom.doc, "assistant-1-100", "Photosynthesis turns light into chemical energy.", "Plants store it as sugar.");
		const first = textNode(body, 0);
		select(dom.selection, dom.doc, [first, 21], [first, 47]);
		const captured = captureSelectionQuote(dom.selection as unknown as Selection)!;
		expect(captured.quote).toEqual({
			source: { kind: "message", id: "assistant-1-100", label: "Keating's reply" },
			exact: "light into chemical energy",
			prefix: "Photosynthesis turns ",
			suffix: ". Plants store it as sugar.",
		});
	});

	test("a selection across two paragraphs joins them with a space and skips tool chrome", () => {
		const body = tutorMessage(dom.doc, "m", "First line.", "Second line.");
		select(dom.selection, dom.doc, [textNode(body, 0), 6], [textNode(body, 1), 6]);
		expect(captureSelectionQuote(dom.selection as unknown as Selection)?.quote.exact).toBe("line. Second");
		expect(captureWholeSource(body as unknown as HTMLElement)?.quote.exact).toBe("First line. Second line.");
	});

	test("selections spanning two sources, or outside any source, give nothing", () => {
		const a = tutorMessage(dom.doc, "a", "Alpha text.");
		const b = tutorMessage(dom.doc, "b", "Beta text.");
		select(dom.selection, dom.doc, [textNode(a), 0], [textNode(b), 4]);
		expect(captureSelectionQuote(dom.selection as unknown as Selection)).toBeNull();
		const outside = el(dom.doc, "p", {}, "Your own message");
		dom.doc.body.append(outside);
		select(dom.selection, dom.doc, [textNode(outside), 0], [textNode(outside), 4]);
		expect(captureSelectionQuote(dom.selection as unknown as Selection)).toBeNull();
	});

	test("an over-long selection is capped and says so", () => {
		const body = tutorMessage(dom.doc, "long", "word ".repeat(400));
		select(dom.selection, dom.doc, [textNode(body), 0], [textNode(body), 2000]);
		const captured = captureSelectionQuote(dom.selection as unknown as Selection)!;
		expect(captured.truncated).toBe(true);
		expect(captured.quote.exact.length).toBeLessThanOrEqual(1000);
	});
});

describe("composer preview and send", () => {
	test("a captured selection shows in the composer and can be removed", async () => {
		const body = tutorMessage(dom.doc, "assistant-2-200", "Mitochondria are the powerhouse of the cell.");
		select(dom.selection, dom.doc, [textNode(body), 17], [textNode(body), 43]);
		const captured = captureSelectionQuote(dom.selection as unknown as Selection)!;
		expect(addDraftQuote(SESSION, captured.quote)).toBe("added");
		expect(addDraftQuote(SESSION, captured.quote)).toBe("duplicate");

		const ui = mountRoomUi();
		await ui.render(<Composer><QuoteComposerPreview sessionId={SESSION} /></Composer>);
		expect(ui.text()).toContain("Quoting Keating's reply");
		expect(ui.text()).toContain("the powerhouse of the cell");
		expect(ui.text()).toContain("Ask about this passage");
		ui.button("Remove quote from Keating's reply").props.onClick();
		await settle();
		expect(ui.text()).not.toContain("powerhouse");
		expect(getDraftQuotes(SESSION)).toEqual([]);
		await ui.unmount();
	});

	test("the quote count is capped", () => {
		for (let index = 0; index < 3; index++) {
			expect(addDraftQuote(SESSION, { source: { kind: "message", id: `m${index}` }, exact: `p${index}` })).toBe("added");
		}
		expect(addDraftQuote(SESSION, { source: { kind: "message", id: "m9" }, exact: "p9" })).toBe("full");
	});

	test("pending quotes survive a remount (model switch or auth prompt) via session storage", () => {
		addDraftQuote(SESSION, { source: { kind: "message", id: "m" }, exact: "kept passage" });
		resetDraftQuoteMemory();
		expect(getDraftQuotes(SESSION).map((quote) => quote.exact)).toEqual(["kept passage"]);
	});

	test("sending folds the passage and source into the model-facing turn and clears the draft", async () => {
		addDraftQuote(SESSION, { source: { kind: "message", id: "assistant-2-200", label: "Keating's reply" }, exact: "the powerhouse of the cell", prefix: "Mitochondria are " });
		let sent: AppendMessage | undefined;
		const ok = await sendWithDraftQuotes(SESSION, appendText("Why is it called that?"), async (message) => {
			sent = message;
			return true;
		});
		expect(ok).toBe(true);
		const turn = makeUserMessageFromAppend(sent!)!;
		const text = ((turn as { content: { text: string }[] }).content)[0]!.text;
		expect(text).toContain("From Keating's reply:\n> the powerhouse of the cell");
		expect(text).toContain("Why is it called that?");
		expect(parseQuotedTurn(text)?.quotes[0]?.source.id).toBe("assistant-2-200");
		expect(getDraftQuotes(SESSION)).toEqual([]);
	});

	test("a refused send keeps the quotes; a quote-only send is allowed", async () => {
		addDraftQuote(SESSION, { source: { kind: "message", id: "m" }, exact: "stay" });
		expect(await sendWithDraftQuotes(SESSION, appendText("q"), async () => false)).toBe(false);
		expect(getDraftQuotes(SESSION)).toHaveLength(1);
		let sent: AppendMessage | undefined;
		await sendWithDraftQuotes(SESSION, appendText(""), async (message) => { sent = message; return true; });
		const turn = makeUserMessageFromAppend(sent!);
		expect(turn).not.toBeNull();
		expect(parseQuotedTurn(((turn as { content: { text: string }[] }).content)[0]!.text)).toMatchObject({ question: "" });
	});
});

describe("sent message", () => {
	const quote: PassageQuote = { source: { kind: "message", id: "assistant-4-400", label: "Keating's reply" }, exact: "divide by the mass", prefix: "then ", suffix: " to get" };
	const persisted = serializeQuotedTurn({ quotes: [quote], question: "Which mass?" });

	test("renders the quotation, source and Go to source after a reload from persisted text", () => {
		const html = renderToStaticMarkup(<LearnerQuotedText text={persisted} />);
		expect(html).toContain("<blockquote");
		expect(html).toContain("divide by the mass");
		expect(html).toContain("From Keating&#x27;s reply");
		expect(html).toContain("Go to source");
		expect(html).toContain("Which mass?");
		expect(html).not.toContain("keating-quotes");
	});

	test("a malformed envelope renders as readable text without markup", () => {
		const html = renderToStaticMarkup(<LearnerQuotedText text={persisted.replace('"kind":"message"', '"kind":"bogus"')} />);
		expect(html).toContain("divide by the mass");
		expect(html).not.toContain("&lt;!--");
		expect(html).not.toContain("<blockquote");
	});

	test("Go to source reveals a message in place", () => {
		const body = tutorMessage(dom.doc, "assistant-4-400", "Find the force, then divide by the mass to get acceleration.");
		expect(revealQuoteSource(quote)).toBe("revealed");
		expect(body.attributes.has("data-quote-revealed")).toBe(true);
		expect(dom.events).toHaveLength(0);
	});

	test("Go to source dispatches the reveal event for other kinds", async () => {
		const plan: PassageQuote = { source: { kind: "artifact", id: "plan-9", revision: 2, label: "Study plan" }, exact: "Week 3" };
		const ui = mountRoomUi();
		await ui.render(<QuotedTurnView turn={{ quotes: [plan], question: "" }} />);
		ui.button("Go to source").props.onClick();
		await settle();
		expect(dom.events.map((event) => [event.type, event.detail])).toEqual([
			[REVEAL_QUOTE_SOURCE_EVENT, { kind: "artifact", id: "plan-9", revision: 2, exact: "Week 3" }],
		]);
		await ui.unmount();
	});

	test("an edited source shows the changed state instead of jumping", async () => {
		tutorMessage(dom.doc, "assistant-4-400", "Find the force, then multiply by the time.");
		expect(quoteSourceStatus(quote).status).toBe("changed");
		const ui = mountRoomUi();
		await ui.render(<QuotedTurnView turn={{ quotes: [quote], question: "Which mass?" }} />);
		expect(ui.text()).toContain("This passage has changed since you quoted it");
		expect(() => ui.button("Go to source")).toThrow();
		await ui.unmount();
	});

	test("a different revision of a workspace source is reported as changed", () => {
		const plan: PassageQuote = { source: { kind: "artifact", id: "plan-9", revision: 2 }, exact: "Week 3" };
		dom.doc.body.append(el(dom.doc, "section", { "data-quote-source-kind": "artifact", "data-quote-source-id": "plan-9", "data-quote-source-revision": "3" }, "Week 3: limits"));
		expect(revealQuoteSource(plan)).toBe("changed");
		expect(dom.events).toHaveLength(0);
	});
});
