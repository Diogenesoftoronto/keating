import { expect, test } from "bun:test";
import { el, installFakeDom, textNode, type FakeElement } from "./helpers/quote-fake-dom";
import { addDraftQuote, getDraftQuotes, removeDraftQuote } from "../keating/passage-quote-draft";
import {
	captureTarget,
	resolveDropTarget,
	questionSelector,
	revealHint,
} from "../components/companion/drop-targets";

class Hit {
	constructor(
		readonly selectors: string[],
		readonly parent?: Hit,
	) {}
	contains(hit: Hit | null): boolean {
		return !!hit && (hit === this || this.contains(hit.parent ?? null));
	}
	closest(query: string): Hit | null {
		return query.split(",").some((s) => this.selectors.includes(s.trim()))
			? this
			: (this.parent?.closest(query) ?? null);
	}
}
const chat = new Hit([]),
	source = new Hit(['.keating-bubble[data-quote-source-kind="message"][data-quote-source-id]'], chat);
const paragraph = new Hit(["p"], source),
	code = new Hit(["pre"], source),
	token = new Hit([], code);
const bot = new Hit([".chat-mascot-perch"], chat),
	question = new Hit([questionSelector.split(",")[0]], chat);
const hit = (...elements: Hit[]) =>
	resolveDropTarget(elements as unknown as Element[], chat as unknown as HTMLElement);
test("pointer capture hits through the mascot to the innermost valid passage, code, question or composer", () => {
	expect(hit(bot, token)).toEqual({ kind: "code", el: code as unknown as HTMLElement });
	expect(hit(new Hit([], paragraph))?.el).toBe(paragraph as unknown as HTMLElement);
	expect(hit(new Hit([], question))?.kind).toBe("question");
	expect(hit(new Hit([".composer-root"], chat))?.kind).toBe("home");
});
test("learner messages, excluded output and other threads never become a source", () => {
	expect(hit(new Hit(["p"], chat))).toBeNull();
	expect(hit(new Hit(["p"], new Hit(["[data-quote-exclude]"], source)))).toBeNull();
	expect(hit(new Hit(["button"], paragraph), paragraph)).toBeNull();
	expect(hit(new Hit([".composer-root"]))).toBeNull();
});
test("reveal only opens the existing authored hint", () => {
	const details = ["About this round", "Need a hint?", "Show answer"].map((text) => ({
		open: false,
		querySelector: () => ({ textContent: text }),
	}));
	revealHint({ querySelectorAll: () => details } as unknown as HTMLElement);
	expect(details.map((d) => d.open)).toEqual([false, true, false]);
});

test("a dropped paragraph becomes a session-scoped passage with surrounding context", () => {
	const { doc, selection, restore } = installFakeDom();
	const session = "companion-test";
	try {
		const paragraph = el(doc, "p", {}, "This ", el(doc, "b", {}, "specific"), " passage.");
		const message = el(
			doc,
			"article",
			{ "data-quote-source-kind": "message", "data-quote-source-id": "reply-1" },
			el(doc, "p", {}, "Before."),
			paragraph,
			el(doc, "p", {}, "After."),
		);
		doc.body.append(message);
		const create = doc.createRange.bind(doc);
		doc.createRange = () => {
			const range = create();
			return Object.assign(range, {
				selectNodeContents(root: FakeElement) {
					const first = textNode(root, 0),
						last = textNode(root, 2);
					range.setStart(first, 0);
					range.setEnd(last, last.data.length);
				},
			});
		};
		const captured = captureTarget(paragraph as unknown as HTMLElement)!;
		expect(captured.quote).toMatchObject({
			source: { id: "reply-1" },
			exact: "This specific passage.",
			prefix: "Before. ",
			suffix: " After.",
		});
		expect(addDraftQuote(session, captured.quote)).toBe("added");
		expect(getDraftQuotes(session)).toHaveLength(1);
		expect(selection.rangeCount).toBe(0);
	} finally {
		for (const quote of getDraftQuotes(session)) removeDraftQuote(session, quote.draftId);
		restore();
	}
});
