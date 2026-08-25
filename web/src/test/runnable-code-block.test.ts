import { describe, expect, test } from "bun:test";

import {
	inProgressFenceCode,
	isRunnableCodeLanguage,
	prepareRunnableCode,
} from "../components/RunnableCodeBlock";
import { chooseCodeExecutor } from "../keating/execution-policy";

describe("RunnableCodeBlock helpers", () => {
	test("marks JavaScript and TypeScript fences as runnable", () => {
		expect(isRunnableCodeLanguage("js")).toBe(true);
		expect(isRunnableCodeLanguage("javascript")).toBe(true);
		expect(isRunnableCodeLanguage("ts")).toBe(true);
		expect(isRunnableCodeLanguage("typescript")).toBe(true);
		expect(isRunnableCodeLanguage("python")).toBe(true);
		expect(isRunnableCodeLanguage("mermaid")).toBe(false);
	});

	test("keeps small or slow-network desktop TypeScript local, but promotes mobile work", () => {
		expect(chooseCodeExecutor("typescript", "const x = 1", {
			online: true,
			deviceClass: "desktop",
			networkClass: "normal",
		})).toBe("local");
		expect(chooseCodeExecutor("typescript", "x".repeat(9_000), {
			online: true,
			deviceClass: "desktop",
			networkClass: "normal",
		})).toBe("cloud");
		expect(chooseCodeExecutor("typescript", "const x = 1", {
			online: true,
			deviceClass: "mobile",
			networkClass: "slow",
		})).toBe("cloud");
		expect(chooseCodeExecutor("typescript", "const x = 1", {
			online: false,
			deviceClass: "desktop",
			networkClass: "normal",
		})).toBe("unavailable");
	});

	test("never routes to hosted execution when hosted access is unavailable", () => {
		// chooseCodeExecutor used to return "cloud" for Python whenever the browser
		// was online, without consulting the Not Organic feature gate. That sent
		// every Python run to a route that answers 503, so the block just errored.
		expect(chooseCodeExecutor("python", "print(1)", {
			online: true,
			deviceClass: "desktop",
			networkClass: "normal",
			hostedAvailable: false,
		})).toBe("unavailable");

		// TypeScript is promoted to hosted execution only as an optimisation, so
		// it degrades to a local run rather than failing.
		expect(chooseCodeExecutor("typescript", "x".repeat(9_000), {
			online: true,
			deviceClass: "desktop",
			networkClass: "normal",
			hostedAvailable: false,
		})).toBe("local");

		// Hosted availability must not resurrect an offline run.
		expect(chooseCodeExecutor("python", "print(1)", {
			online: false,
			deviceClass: "desktop",
			networkClass: "normal",
			hostedAvailable: true,
		})).toBe("unavailable");
	});

	test("keeps hosted execution when it is available", () => {
		expect(chooseCodeExecutor("python", "print(1)", {
			online: true,
			deviceClass: "desktop",
			networkClass: "normal",
			hostedAvailable: true,
		})).toBe("cloud");
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
