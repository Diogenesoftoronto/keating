import { describe, expect, test } from "bun:test";

import {
	inProgressFenceCode,
	isRunnableCodeLanguage,
	prepareRunnableCode,
} from "../components/RunnableCodeBlock";

describe("RunnableCodeBlock helpers", () => {
	test("marks JavaScript and TypeScript fences as runnable", () => {
		expect(isRunnableCodeLanguage("js")).toBe(true);
		expect(isRunnableCodeLanguage("javascript")).toBe(true);
		expect(isRunnableCodeLanguage("ts")).toBe(true);
		expect(isRunnableCodeLanguage("typescript")).toBe(true);
		expect(isRunnableCodeLanguage("python")).toBe(false);
		expect(isRunnableCodeLanguage("mermaid")).toBe(false);
	});

	test("transpiles TypeScript snippets before NodePod execution", async () => {
		const prepared = await prepareRunnableCode("const x: number = 2;\nconsole.log(x);", "typescript");
		expect(prepared.filename).toEndWith(".js");
		expect(prepared.code).toContain("const x = 2");
		expect(prepared.code).not.toContain(": number");
	});
});

describe("inProgressFenceCode", () => {
	test("returns null when every fence is closed", () => {
		expect(inProgressFenceCode("text\n```js\nconst a = 1;\n```\nmore")).toBeNull();
	});

	test("returns null when there is no fence at all", () => {
		expect(inProgressFenceCode("just prose")).toBeNull();
	});

	test("returns the body of an unterminated fence", () => {
		expect(inProgressFenceCode("intro\n```js\nconst a = 1;\nconst b = ")).toBe(
			"const a = 1;\nconst b = ",
		);
	});

	test("tracks only the last fence when an earlier one closed", () => {
		const content = "```js\ndone();\n```\nprose\n```ts\nwip(";
		expect(inProgressFenceCode(content)).toBe("wip(");
	});

	test("returns an empty body right after the fence opens", () => {
		expect(inProgressFenceCode("```js\n")).toBe("");
	});
});
