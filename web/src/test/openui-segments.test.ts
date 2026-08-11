import { describe, expect, it } from "bun:test";
import { OPENUI_JSON_PARITY_FIXTURE } from "@keating/learner-contracts";

import {
	parseOpenUIMessageSegments,
	stripOpenUIPrograms,
} from "../keating/openui/segments";

describe("OpenUI message segments", () => {
	it("preserves Markdown around a complete OpenUI document", () => {
		const text = [
			"Before",
			"```openui lifecycle=resumable id=fractions-check",
			'root = Explanation({ markdown: "A whole can be partitioned." })',
			"```",
			"After",
		].join("\n");
		const segments = parseOpenUIMessageSegments(text);

		expect(segments.map((segment) => segment.type)).toEqual(["text", "openui", "text"]);
		const document = segments[1];
		if (document.type !== "openui") throw new Error("expected OpenUI segment");
		expect(document.complete).toBe(true);
		expect(document.metadata).toEqual({ id: "fractions-check", lifecycle: "resumable", revision: 0 });
		expect(document.program).toContain("partitioned");
	});

	it("returns an incomplete document while a response is streaming", () => {
		const segments = parseOpenUIMessageSegments(
			"```openui lifecycle=workspace id=map-1\nroot = ConceptMap({ code: \"graph TD",
		);
		const document = segments[0];
		if (document.type !== "openui") throw new Error("expected OpenUI segment");
		expect(document.complete).toBe(false);
		expect(document.program).toBe("");
		expect(document.rawProgram).toContain("graph TD");
		expect(document.metadata.lifecycle).toBe("workspace");
	});

	it("commits only whole OpenUI statements while a question streams", () => {
		const root = 'root = LearningSurface([check], "Check", "Answer once ready.", "ephemeral")\n';
		const question = 'check = Question([{ question: "Why?", type: "choice", choices: ["A", "B"], allowText: true }], "ephemeral", "topic", "Pick one.")';
		const source = `\`\`\`openui id=atomic-question\n${root}${question}`;

		for (let length = root.length + "```openui id=atomic-question\n".length; length < source.length; length += 1) {
			const [segment] = parseOpenUIMessageSegments(source.slice(0, length));
			if (segment.type !== "openui") throw new Error("expected OpenUI segment");
			expect(segment.program).not.toContain("check = Question");
		}

		const [committed] = parseOpenUIMessageSegments(`${source}\n`);
		if (committed.type !== "openui") throw new Error("expected OpenUI segment");
		expect(committed.program).toContain(question);
	});

	it("keeps completed static statements while withholding a partial question", () => {
		const [segment] = parseOpenUIMessageSegments([
			"```openui id=progressive",
			'root = Explanation("A complete explanation.")',
			'check = Question([{ question: "Why?", choices: ["A"',
		].join("\n"));
		if (segment.type !== "openui") throw new Error("expected OpenUI segment");
		expect(segment.program).toContain("A complete explanation.");
		expect(segment.program).not.toContain("check = Question");
	});

	it("keeps an inferred document id stable as a program streams", () => {
		const prefix = "Lesson\n```openui lifecycle=ephemeral\nroot = Callout({";
		const first = parseOpenUIMessageSegments(prefix, "assistant-message-1")[1];
		const second = parseOpenUIMessageSegments(`${prefix} tone: \"hint\"`, "assistant-message-1")[1];
		if (first.type !== "openui" || second.type !== "openui") {
			throw new Error("expected OpenUI segments");
		}
		expect(first.metadata.id).toBe(second.metadata.id);
	});

	it("scopes declared document ids to their persisted assistant message", () => {
		const source = "```openui lifecycle=resumable id=shared-name\nroot = Explanation({ markdown: \"Alpha\" })\n```";
		const first = parseOpenUIMessageSegments(source, "assistant-message-1")[0];
		const replay = parseOpenUIMessageSegments(source, "assistant-message-1")[0];
		const second = parseOpenUIMessageSegments(source, "assistant-message-2")[0];
		if (first.type !== "openui" || replay.type !== "openui" || second.type !== "openui") {
			throw new Error("expected OpenUI segments");
		}
		expect(first.metadata.id).toBe(replay.metadata.id);
		expect(first.metadata.id).not.toBe(second.metadata.id);
		expect(first.metadata.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
	});

	it("scopes repeated declared ids to their fence position inside one message", () => {
		const source = [
			"```openui lifecycle=resumable id=shared-name",
			'root = Explanation({ markdown: "Alpha" })',
			"```",
			"Between",
			"```openui lifecycle=resumable id=shared-name",
			'root = Explanation({ markdown: "Beta" })',
			"```",
		].join("\n");
		const documents = parseOpenUIMessageSegments(source, "session-1:assistant-message-1")
			.filter((segment): segment is Extract<typeof segment, { type: "openui" }> => segment.type === "openui");
		expect(documents).toHaveLength(2);
		expect(documents[0]?.metadata.id).not.toBe(documents[1]?.metadata.id);
		expect(parseOpenUIMessageSegments(source, "session-1:assistant-message-1")
			.filter((segment) => segment.type === "openui")
			.map((segment) => segment.metadata.id)).toEqual(documents.map((segment) => segment.metadata.id));
	});

	it("isolates declared ids across session forks while retaining migration aliases", () => {
		const source = "```openui lifecycle=resumable id=shared-name\nroot = Explanation({ markdown: \"Alpha\" })\n```";
		const original = parseOpenUIMessageSegments(source, { sessionId: "session-original", messageId: "assistant-message-1" })[0];
		const fork = parseOpenUIMessageSegments(source, { sessionId: "session-fork", messageId: "assistant-message-1" })[0];
		if (original.type !== "openui" || fork.type !== "openui") throw new Error("expected OpenUI segments");
		expect(original.metadata.id).not.toBe(fork.metadata.id);
		expect(original.metadata.legacyIds).toEqual(fork.metadata.legacyIds);
		expect(original.metadata.legacyIds).toHaveLength(2);
	});

	it("does not reuse fallback ids for unrelated documents at the same position", () => {
		const first = parseOpenUIMessageSegments("```openui lifecycle=workspace\nroot = Explanation({ markdown: \"Alpha\" })\n```")[0];
		const second = parseOpenUIMessageSegments("```openui lifecycle=workspace\nroot = Explanation({ markdown: \"Beta\" })\n```")[0];
		if (first.type !== "openui" || second.type !== "openui") {
			throw new Error("expected OpenUI segments");
		}
		expect(first.metadata.id).not.toBe(second.metadata.id);
	});

	it("ignores markdown fences embedded in OpenUI string literals", () => {
		const text = [
			"```openui id=code-example",
			'root = Explanation({ markdown: "Example:',
			"```js",
			"const answer = 42",
			"```",
			'Done" })',
			"```",
			"After",
		].join("\n");
		const segments = parseOpenUIMessageSegments(text);
		const document = segments[0];
		if (document.type !== "openui") throw new Error("expected OpenUI segment");

		expect(document.complete).toBe(true);
		expect(document.program).toContain("const answer = 42");
		expect(document.program).toContain("Done");
		expect(segments.at(-1)).toEqual({ type: "text", content: "After" });
	});

	it("defaults malformed metadata safely", () => {
		const [document] = parseOpenUIMessageSegments("```openui lifecycle=forever id=bad/id revision=-1\nroot = Nope({})\n```");
		if (document.type !== "openui") throw new Error("expected OpenUI segment");
		expect(document.metadata.lifecycle).toBe("ephemeral");
		expect(document.metadata.id).toMatch(/^openui-/);
		expect(document.metadata.revision).toBe(0);
	});

	it("parses a validated non-negative document revision", () => {
		const [document] = parseOpenUIMessageSegments("```openui id=quiz-1 revision=3\nroot = Quiz({})\n```");
		if (document.type !== "openui") throw new Error("expected OpenUI segment");
		expect(document.metadata.revision).toBe(3);
	});

	it("removes programs without discarding surrounding prose", () => {
		const text = "One\n```openui id=x\nroot = Explanation({ markdown: \"hidden\" })\n```\nTwo";
		expect(stripOpenUIPrograms(text)).toBe("One\nTwo");
	});

	it("accepts canonical JSON through the same persisted message fence", () => {
		const [segment] = parseOpenUIMessageSegments(`\`\`\`openui id=scoped-message-document revision=2\n${JSON.stringify(OPENUI_JSON_PARITY_FIXTURE)}\n\`\`\``);
		if (segment.type !== "openui" || segment.format !== "document") throw new Error("expected canonical OpenUI document");
		expect(segment.error).toBeUndefined();
		expect(segment.document?.id).toBe("scoped-message-document");
		expect(segment.document?.revision).toBe(2);
		expect(segment.document?.nodes.map((node) => node.type)).toEqual(OPENUI_JSON_PARITY_FIXTURE.nodes.map((node) => node.type));
		expect(segment.program).toBe("");
	});

	it("accepts every canonical JSON fence alias used by mobile", () => {
		for (const alias of ["keating-ui", "ui-document", "openui-json", "openui"] as const) {
			const [segment] = parseOpenUIMessageSegments(
				`\`\`\`${alias} id=alias-${alias} revision=4\n${JSON.stringify(OPENUI_JSON_PARITY_FIXTURE)}\n\`\`\``,
			);
			if (segment.type !== "openui" || segment.format !== "document") {
				throw new Error(`expected ${alias} to produce a canonical OpenUI document`);
			}
			expect(segment.complete, alias).toBe(true);
			expect(segment.error, alias).toBeUndefined();
			expect(segment.document?.id, alias).toBe(`alias-${alias}`);
			expect(segment.document?.revision, alias).toBe(4);
			expect(segment.document?.nodes, alias).toEqual(OPENUI_JSON_PARITY_FIXTURE.nodes);
		}
	});

	it("withholds split canonical JSON aliases until their fence closes", () => {
		const complete = `\`\`\`keating-ui id=split-document\n${JSON.stringify(OPENUI_JSON_PARITY_FIXTURE)}\n\`\`\``;
		const [partial] = parseOpenUIMessageSegments(complete.slice(0, -3));
		if (partial.type !== "openui" || partial.format !== "document") {
			throw new Error("expected an incomplete canonical OpenUI document");
		}
		expect(partial.complete).toBe(false);
		expect(partial.document).toBeUndefined();
		expect(partial.error).toBeUndefined();
		expect(partial.rawProgram).toContain("schemaVersion");

		const [closed] = parseOpenUIMessageSegments(complete);
		if (closed.type !== "openui" || closed.format !== "document") {
			throw new Error("expected a closed canonical OpenUI document");
		}
		expect(closed.complete).toBe(true);
		expect(closed.error).toBeUndefined();
		expect(closed.document?.id).toBe("split-document");
	});

	it("keeps source compilation exclusive to the browser source labels", () => {
		const source = 'root = Explanation({ markdown: "Inert under JSON aliases" })';
		const [documentAlias] = parseOpenUIMessageSegments(`\`\`\`keating-ui\n${source}\n\`\`\``);
		if (documentAlias.type !== "openui" || documentAlias.format !== "document") {
			throw new Error("expected a document-only alias");
		}
		expect(documentAlias.document).toBeUndefined();
		expect(documentAlias.error).toContain("JSON");

		const [sourceAlias] = parseOpenUIMessageSegments(`\`\`\`openui-lang\n${source}\n\`\`\``);
		if (sourceAlias.type !== "openui" || sourceAlias.format !== "source") {
			throw new Error("expected the browser source alias");
		}
		expect(sourceAlias.complete).toBe(true);
		expect(sourceAlias.program).toBe(source);
	});

	it("leaves legacy messages unchanged", () => {
		const legacy = '<keating-question json={"question":"Why?"} />';
		expect(parseOpenUIMessageSegments(legacy)).toEqual([{ type: "text", content: legacy }]);
	});
});
