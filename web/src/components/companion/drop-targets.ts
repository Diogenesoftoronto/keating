import { captureSelectionQuote } from "../chat/quote-dom";
export const questionSelector =
	'.activity-game:has([data-question-progress]), .activity-quiz:has(.activity-prompt), [data-quiz-phase="answering"], fieldset[data-question-kind]:has(:enabled), [aria-label^="Quiz ready:"]';
const passageSelector = "p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6";
const codeSelector = ".runnable-code-surface, pre";
export const ledgeSelector = [codeSelector, questionSelector, ".composer-root"].join(",");
export type DropKind = "passage" | "code" | "question" | "home";
export interface DropTarget {
	kind: DropKind;
	el: HTMLElement;
}
export const targetLabels = {
	passage: "Ask about this part",
	code: "Ask about this code",
	question: "Give me a hint",
	home: "Sit here",
};
export function resolveDropTarget(elements: readonly Element[], chat: HTMLElement): DropTarget | null {
	for (const hit of elements) {
		if (hit.closest(".chat-mascot-perch")) continue;
		if (!chat.contains(hit)) return null;
		const home = hit.closest<HTMLElement>(".composer-root");
		if (home) return { kind: "home", el: home };
		const question = hit.closest<HTMLElement>(questionSelector);
		if (question) return { kind: "question", el: question };
		const source = hit.closest('.keating-bubble[data-quote-source-kind="message"][data-quote-source-id]');
		if (!source || hit.closest("[data-quote-exclude],textarea,input,button")) return null;
		const code = hit.closest<HTMLElement>(codeSelector);
		if (code && source.contains(code)) return { kind: "code", el: code };
		const passage = hit.closest<HTMLElement>(passageSelector);
		if (passage && source.contains(passage)) return { kind: "passage", el: passage };
	}
	return null;
}
export function captureTarget(el: HTMLElement) {
	const range = el.ownerDocument.createRange();
	range.selectNodeContents(el);
	// quote-dom consumes only this read-only selection surface. The learner's
	// browser selection and any keyboard selection toolbar stay untouched.
	const selection: Pick<Selection, "getRangeAt" | "rangeCount" | "isCollapsed"> = {
		rangeCount: 1,
		isCollapsed: range.collapsed,
		getRangeAt: () => range,
	};
	return captureSelectionQuote(selection as Selection);
}
export function revealHint(card: HTMLElement) {
	for (const details of card.querySelectorAll<HTMLDetailsElement>("details")) {
		if (
			/^(need a hint\?|show hint|hint)$/i.test(details.querySelector("summary")?.textContent?.trim() ?? "")
		) {
			details.open = true;
			return;
		}
	}
}
export const suggestions = {
	passage: [
		["Explain another way", "Explain this another way, with a concrete example."],
		["Give me an example", "Give me one worked example of this."],
		["Quiz me on it", "Ask me one question that checks I understood this."],
	],
	code: [
		["Walk me through it", "Walk me through this code line by line, asking me to predict each step."],
		["Let me predict the output", "Let me predict the output first, then tell me where I went wrong."],
		["Try an edge case", "What happens with an edge case? Let me guess first."],
	],
} as const;
