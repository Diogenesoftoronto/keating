import { describe, expect, test } from "bun:test";

import {
	inProgressFenceCode,
	isRunnableCodeLanguage,
	prepareRunnableCode,
} from "../components/RunnableCodeBlock";
import { isStrudelBlock, isStrudelPattern } from "../components/labs/strudel-detect";
import { chooseCodeExecutor } from "../keating/execution-policy";
import { startOrRefreshCodeRun, type HostedNotebookRun } from "../notorganic-provider/notebook";

describe("refreshing cloud code output", () => {
	const input = {
		code: "print(24)", language: "python" as const, filename: "notebook.py",
		execution: { executor: "cloud" as const, device_class: "desktop" as const, network_class: "normal" as const, code_bytes: 9 },
	};
	const pause = async () => {};
	for (const interruption of ["poll limit", "poll error"]) {
		test(`uses the original run and source record after a ${interruption}`, async () => {
			const requests: string[] = [];
			let finishing = false;
			const fetcher = (async (url, init) => {
				requests.push(`${init?.method ?? "GET"} ${url}`);
				if (init?.method === "POST") return Response.json({ id: "python-1", status: "queued" }, { headers: { "x-keating-pds-snapshot": "source-1" } });
				if (!finishing && interruption === "poll error") throw Error("disconnected");
				return Response.json({ id: "python-1", status: finishing ? "succeeded" : "running" });
			}) as typeof fetch;
			const updates: HostedNotebookRun[] = [];
			const first = startOrRefreshCodeRun(input, null, run => updates.push(run), fetcher, pause);
			if (interruption === "poll error") await expect(first).rejects.toThrow("disconnected");
			else await first;
			finishing = true;
			await startOrRefreshCodeRun(input, updates.at(-1)!, run => updates.push(run), fetcher, pause);
			expect(updates.at(-1)?.status).toBe("succeeded");
			expect(requests.filter(row => row.startsWith("POST"))).toHaveLength(1);
			expect(new Set(requests.slice(1))).toEqual(new Set(["GET /api/notorganic/notebook/runs/python-1?snapshot_id=source-1"]));
		});
	}
});

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

describe("Strudel fence detection", () => {
	const chatSnippet = [
		'note("c3 e3 g3").s("piano")               // sample — warm, real',
		'note("c3 e3 g3").s("sawtooth")            // pure synth — buzzy, clean',
		'note("c3 e3 g3").s("sawtooth").lpf(800)   // synth shaped toward piano',
		's("bd*4, hh*8")                            // drum samples — the rhythm workhorse',
		'stack(s("bd*4"), note("c2").s("sawtooth")) // layers — the real production model',
	].join("\n");

	test("claims Strudel patterns fenced as JavaScript", () => {
		expect(isStrudelBlock("js", chatSnippet)).toBe(true);
		expect(isStrudelBlock("javascript", 'note("c3 e3 g3").s("piano")')).toBe(true);
		expect(isStrudelBlock("js", 's("bd*4, hh*8")')).toBe(true);
		expect(isStrudelBlock("js", 's("bd hh")')).toBe(true);
		expect(isStrudelBlock("js", 'note("c3")')).toBe(true);
		expect(isStrudelBlock("js", 'setcpm(120 / 4)\nsound("bd")')).toBe(true);
	});

	test("leaves ordinary JavaScript to the Node runner", () => {
		expect(isStrudelPattern("const x = 1;\nconsole.log(x);")).toBe(false);
		expect(isStrudelPattern("function twoSum(nums, target) { return []; }")).toBe(false);
		expect(isStrudelPattern("async function load() { return fetch('/api'); }")).toBe(false);
		expect(isStrudelPattern("import { stack } from './stack.js';")).toBe(false);
		// Ambiguous calls without any Strudel signal stay unhijacked.
		expect(isStrudelPattern('s("hello world")')).toBe(false);
		expect(isStrudelPattern("stack([1, 2, 3])")).toBe(false);
	});

	test("only routes JavaScript-shaped or explicit Strudel fences", () => {
		expect(isStrudelBlock("python", chatSnippet)).toBe(false);
		expect(isStrudelBlock("text", chatSnippet)).toBe(false);
		expect(isStrudelBlock("strudel", 'note("c3")')).toBe(true);
	});
});
