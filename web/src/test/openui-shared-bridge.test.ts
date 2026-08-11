import { describe, expect, test } from "bun:test";
import {
	OPENUI_SOURCE_PARITY_FIXTURE,
	WEB_OPENUI_COMPONENTS,
	validateUiDocument,
} from "@keating/learner-contracts";
import {
	compileOpenUISourceToSharedDocument,
	SHARED_OPENUI_COMPONENT_MAPPERS,
} from "../keating/openui/shared-bridge";

const AT = "2026-08-10T00:00:00.000Z";

describe("browser OpenUI to shared learner contract", () => {
	test("keeps the canonical mapper exhaustive with the live fixture registry", () => {
		expect(SHARED_OPENUI_COMPONENT_MAPPERS).toEqual(WEB_OPENUI_COMPONENTS);
	});

	test("compiles every registered fixture component without semantic wire loss", () => {
		const document = compileOpenUISourceToSharedDocument(OPENUI_SOURCE_PARITY_FIXTURE, {
			documentId: "message-1-openui-1",
			createdAt: AT,
			updatedAt: AT,
		});
		expect(validateUiDocument(document)).toBe(true);
		expect(document.title).toBe("Rendering parity");
		expect(document.retention).toBe("workspace");
		expect(document.nodes.map((node) => node.type)).toEqual([
			"markdown", "callout", "question-group",
			"quiz", "deck", "study-plan", "concept-map", "image", "handoff", "notes",
		]);
		const group = document.nodes.find((node) => node.type === "question-group");
		expect(group?.type === "question-group" ? {
			topic: group.topic,
			intro: group.intro,
			questions: group.questions.map((question) => question.kind),
		} : undefined).toEqual({
			topic: "Bayes",
			intro: "Use every conversational question format.",
			questions: ["choice", "text", "blanks", "classification", "matching"],
		});
		const deck = document.nodes.find((node) => node.type === "deck");
		expect(deck?.type === "deck" ? deck.description : undefined).toBe("A durable deck fixture.");
		const plan = document.nodes.find((node) => node.type === "study-plan");
		expect(plan?.type === "study-plan" ? plan.items?.[0]?.children?.[0]?.title : undefined).toBe("Retrieve the terms");
		const animation = document.nodes.find((node) => node.type === "handoff");
		expect(animation?.type === "handoff" ? animation.context : "").not.toContain("<html>");
	});

	test("normalizes matching answer labels to stable option ids", () => {
		const document = compileOpenUISourceToSharedDocument([
			'root = LearningSurface([question], "Matching", "", "workspace")',
			'question = Question([{question: "Match", type: "matching", items: ["A", "B"], choices: ["One", "Two"], correctMatches: ["Two", "One"]}], "workspace")',
		].join("\n"), { documentId: "matching-document", createdAt: AT });
		const group = document.nodes[0];
		const question = group?.type === "question-group" ? group.questions[0] : undefined;
		expect(document.retention).toBe("workspace");
		expect(question?.correctMatches).toEqual([
			"question-question-1-choice-2",
			"question-question-1-choice-1",
		]);
		expect(validateUiDocument(document)).toBe(true);
	});

	test("fails closed for ambiguous or unknown matching labels", () => {
		const compile = (choices: string, answer: string) => compileOpenUISourceToSharedDocument([
			'root = LearningSurface([question], "Matching")',
			`question = Question([{question: "Match", type: "matching", items: ["A"], choices: [${choices}], correctMatches: [${JSON.stringify(answer)}]}])`,
		].join("\n"), { documentId: "matching-document", createdAt: AT });
		expect(() => compile('"Same", "Same"', "Same")).toThrow("ambiguous");
		expect(() => compile('"One", "Two"', "Missing")).toThrow("does not match");
	});

	test("fails closed for partial or unresolved source", () => {
		expect(() => compileOpenUISourceToSharedDocument('root = LearningSurface([missing], "Title"', {
			documentId: "partial-document",
			createdAt: AT,
		})).toThrow();
	});
});
