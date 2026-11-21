import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createParser } from "@openuidev/react-lang";
import { compileOpenUISourceToSharedDocument, validateUiActionAgainstDocument, type UiDocument, type UiManipulativeNode } from "@keating/learner-contracts";
import { keatingOpenUIEarlyLearningExampleProgram, keatingOpenUILibrary, keatingOpenUIPrompt } from "../keating/openui/library";
import { SharedUiDocumentRenderer } from "../keating/openui/shared-renderer";
import { ManipulativeRenderer } from "../components/manipulatives/ManipulativeRenderer";
import { dispatchSharedUiAction } from "../keating/openui/shared-actions";
import {
	loadManipulativeState,
	manipulativeShareIntent,
	manipulativeShareMessage,
	manipulativeStateKey,
	sameManipulativeState,
	saveManipulativeState,
} from "../keating/openui/manipulative-state";
import { createOpenUIActionLearnerResponse } from "../keating/learner-response";
import { buildOpenUIPreview } from "../keating/openui/preview";
import type { CanonicalKeatingOpenUIAction } from "../keating/openui/types";

const at = "2026-11-20T12:00:00.000Z";

class MemoryStorage {
	data = new Map<string, string>();
	getItem(key: string) { return this.data.get(key) ?? null; }
	setItem(key: string, value: string) { this.data.set(key, value); }
	removeItem(key: string) { this.data.delete(key); }
}

function documentFor(statement: string, retention: "ephemeral" | "workspace" = "workspace"): UiDocument {
	return compileOpenUISourceToSharedDocument(`root = LearningSurface([model], "", "", "${retention}")\nmodel = ${statement}`, { documentId: "early", createdAt: at });
}
function nodeOf(document: UiDocument): UiManipulativeNode {
	const node = document.nodes[0];
	if (node?.type !== "manipulative") throw new Error("expected a manipulative");
	return node;
}

describe("the tutor can author early-learning models", () => {
	test("the early-learning example parses against the live grammar and is in the prompt", () => {
		const result = createParser(keatingOpenUILibrary.toJSONSchema()).parse(keatingOpenUIEarlyLearningExampleProgram);
		expect(result.meta.errors).toEqual([]);
		expect(result.meta.unresolved).toEqual([]);
		expect(keatingOpenUIPrompt).toContain("## Early learning");
		expect(keatingOpenUIPrompt).toContain("```openui lifecycle=ephemeral id=add-3-and-4");
		for (const name of ["NumberLine(", "TenFrame(", "PlaceValue(", "FractionBars(", "CountingArray(", "Clock("]) expect(keatingOpenUIPrompt).toContain(name);
	});

	test("the generated grammar groups them under Early learning", () => {
		const grammar = keatingOpenUILibrary.prompt({ inlineMode: true, toolCalls: false, bindings: true });
		expect(grammar).toContain("Early learning");
		expect(grammar).toContain("symbol?:");
	});
});

describe("rendering", () => {
	const statements = {
		"number-line": 'NumberLine("nl", "Hops", 0, 10, 1, [{ value: 3, label: "start" }], [{ from: 3, to: 7, label: "+4" }], "Where do you land?")',
		"ten-frame": 'TenFrame("tf", "Make ten", 7, 1, "Fill to ten.")',
		"place-value": 'PlaceValue("pv", "Build 342", 0, "Build 342.")',
		"fraction-bars": 'FractionBars("fb", "Halves", [{ parts: 2, shaded: 1, label: "1/2" }, { parts: 4, shaded: 0, label: "quarters" }], "Match one half.")',
		array: 'CountingArray("ca", "Apples", 3, 4, "apple", "How many?")',
		clock: 'Clock("cl", "Time", 3, 0, "Set half past three.")',
	} as const;

	test("every model renders inside a lesson frame with an accessible control and one share action", () => {
		for (const [kind, statement] of Object.entries(statements)) {
			const html = renderToStaticMarkup(createElement(SharedUiDocumentRenderer, { document: documentFor(statement), onAction: () => true }));
			expect(html, kind).toContain(`data-manipulative="${kind}"`);
			expect(html, kind).toContain("lesson-frame");
			expect(html, kind).toContain("Share my answer");
		}
		const line = renderToStaticMarkup(createElement(SharedUiDocumentRenderer, { document: documentFor(statements["number-line"]), onAction: () => true }));
		expect(line).toContain('role="slider"');
		expect(line).toContain('aria-valuenow="3"');
		const frame = renderToStaticMarkup(createElement(SharedUiDocumentRenderer, { document: documentFor(statements["ten-frame"]), onAction: () => true }));
		expect(frame.match(/aria-pressed="true"/g)).toHaveLength(7);
		expect(frame).toContain('aria-label="Space 8"');
	});

	test("a model without a prompt is a picture: no controls, no share", () => {
		const html = renderToStaticMarkup(createElement(SharedUiDocumentRenderer, { document: documentFor('TenFrame("tf", "Seven", 7)'), onAction: () => true }));
		expect(html).not.toContain("Share my answer");
		expect(html).not.toContain("<button");
		expect(html).toContain("Ten frame: 7 of 10 filled");
	});

	test("a disabled document keeps the picture and disables every control", () => {
		const html = renderToStaticMarkup(createElement(ManipulativeRenderer, { node: nodeOf(documentFor(statements.clock)), disabled: true, onAction: () => true }));
		expect(html).toContain("Your clock shows 3:00");
		expect(html.match(/<button[^>]*disabled/g)?.length).toBeGreaterThanOrEqual(4);
	});
});

describe("sharing an answer", () => {
	test("a share intent dispatches through the shared journal and validates against its document", () => {
		const document = documentFor('NumberLine("nl", "Hops", 0, 10, 1, [{ value: 3 }], [], "Where do you land?")');
		const node = nodeOf(document);
		const intent = manipulativeShareIntent(node, { kind: "number-line", value: 7 });
		const message = manipulativeShareMessage(node, intent.state);
		expect(message).toBe("Put the point at 7 on the number line.");
		const dispatch = dispatchSharedUiAction(new MemoryStorage(), document, intent, at, { sessionId: "s1", humanFriendlyMessage: message });
		expect(dispatch.receipt.state).toBe("completed");
		expect(validateUiActionAgainstDocument(dispatch.action, document)).toBe(true);

		const action: CanonicalKeatingOpenUIAction = {
			kind: "canonical", type: dispatch.action.type, params: {}, humanFriendlyMessage: message,
			document: { id: document.id, revision: dispatch.sourceDocument.revision, lifecycle: "workspace" },
			sourceDocument: dispatch.sourceDocument, action: dispatch.action, receipt: dispatch.receipt,
		};
		const response = createOpenUIActionLearnerResponse(action);
		expect(response.review).toEqual({
			title: "Number line shared",
			summary: "Put the point at 7 on the number line.",
			items: [{ label: "Task", value: "Where do you land?" }, { label: "Answer", value: "7" }],
		});
		expect(response.agentInstruction).toContain("early-learning model");
	});

	test("an off-tick share is rejected by the journal instead of reaching the tutor", () => {
		const document = documentFor('NumberLine("nl", "Hops", 0, 10, 2, [], [], "Land on an even number.")');
		const intent = manipulativeShareIntent(nodeOf(document), { kind: "number-line", value: 3 });
		expect(() => dispatchSharedUiAction(new MemoryStorage(), document, intent, at, { sessionId: "s1", humanFriendlyMessage: "x" })).toThrow();
	});
});

describe("learner work persists per node and model", () => {
	const document = documentFor('TenFrame("tf", "Make ten", 7, 1, "Fill to ten.")');
	const node = nodeOf(document);

	test("saved work is restored, and a changed model starts fresh", () => {
		const storage = new MemoryStorage();
		expect(saveManipulativeState(storage, document.id, node, { kind: "ten-frame", cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] })).toBe(true);
		expect(loadManipulativeState(storage, document.id, node)).toEqual({ kind: "ten-frame", cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
		const changed = { ...node, model: { kind: "ten-frame" as const, frames: 1 as const, filled: 6 } };
		expect(loadManipulativeState(storage, document.id, changed)).toEqual({ kind: "ten-frame", cells: [0, 1, 2, 3, 4, 5] });
	});

	test("corrupt or impossible saved work falls back to the authored start", () => {
		const storage = new MemoryStorage();
		storage.setItem(manipulativeStateKey(document.id, node.id), "{not json");
		expect(loadManipulativeState(storage, document.id, node)).toEqual({ kind: "ten-frame", cells: [0, 1, 2, 3, 4, 5, 6] });
		storage.setItem(manipulativeStateKey(document.id, node.id), JSON.stringify({ version: 1, signature: JSON.stringify(node.model), state: { kind: "ten-frame", cells: [42] } }));
		expect(loadManipulativeState(storage, document.id, node)).toEqual({ kind: "ten-frame", cells: [0, 1, 2, 3, 4, 5, 6] });
		const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
		expect(loadManipulativeState(throwing, document.id, node)).toEqual({ kind: "ten-frame", cells: [0, 1, 2, 3, 4, 5, 6] });
		expect(saveManipulativeState(throwing, document.id, node, { kind: "ten-frame", cells: [] })).toBe(false);
	});

	test("the same cells in another order count as the same answer, but counting order is a different count", () => {
		expect(sameManipulativeState({ kind: "ten-frame", cells: [2, 1] }, { kind: "ten-frame", cells: [1, 2] })).toBe(true);
		expect(sameManipulativeState({ kind: "ten-frame", cells: [2] }, { kind: "ten-frame", cells: [1, 2] })).toBe(false);
		expect(sameManipulativeState(undefined, { kind: "clock", hour: 3, minute: 0 })).toBe(false);
	});
});

test("previews name the model and whether it is a task", () => {
	const text = ["```openui lifecycle=ephemeral id=clock-check", 'root = LearningSurface([model], "", "", "ephemeral")', 'model = Clock("cl", "Half past three", 3, 30, "Set the clock.")', "```"].join("\n");
	expect(JSON.stringify(buildOpenUIPreview(text, "s1"))).toContain('"kind":"manipulative","label":"Half past three","detail":"Clock · to try"');
});
