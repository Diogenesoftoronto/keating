import { describe, expect, test } from "bun:test";

import {
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
