import { describe, expect, test } from "bun:test";
import {
	createTool,
	createToolRegistry,
	KeatingToolError,
	toolFailureMessage,
} from "../src/keating/browser-tools/shared";

function textFromResult(result: unknown): string {
	const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content ?? [];
	return content.map((part) => part.text ?? "").join("\n");
}

describe("browser tool contract", () => {
	test("advertises required and optional parameters in the tool description", () => {
		const tool = createTool(
			"example",
			"Example tool.",
			{
				topic: { type: "string", description: "Topic to inspect." },
				limit: { type: "number", description: "Maximum rows.", default: 10 },
			},
			async () => "ok",
			["topic"],
		);

		expect(tool.description).toContain("`topic` (required, string)");
		expect(tool.description).toContain("`limit` (optional, number)");
		expect(tool.description).toContain("Default: 10.");
		expect((tool.parameters as any).required).toEqual(["topic"]);
	});

	test("rejects missing, mistyped, enum-invalid, and unknown arguments before execution", async () => {
		let calls = 0;
		const tool = createTool(
			"validate",
			"Validate arguments.",
			{
				topic: { type: "string", description: "Topic." },
				mode: { type: "string", enum: ["quick", "deep"], description: "Mode." },
			},
			async () => {
				calls += 1;
				return "ok";
			},
			["topic"],
		);

		for (const args of [
			{},
			{ topic: 42 },
			{ topic: "DNS", mode: "wrong" },
			{ topic: "DNS", extra: true },
		]) {
			try {
				await tool.execute("call", args as any);
				throw new Error("expected validation to fail");
			} catch (error) {
				expect(error).toBeInstanceOf(KeatingToolError);
				expect((error as KeatingToolError).code).toBe("invalid-arguments");
				expect((error as Error).message).toContain("Parameters:");
			}
		}
		expect(calls).toBe(0);
	});

	test("validates required fields inside array items", async () => {
		const tool = createTool(
			"batch",
			"Batch operation.",
			{
				requests: {
					type: "array",
					minItems: 1,
					items: {
						type: "object",
						properties: {
							operation: { type: "string" },
							path: { type: "string" },
						},
						required: ["operation"],
						additionalProperties: false,
					},
				},
			},
			async () => "ok",
			["requests"],
		);

		await expect(tool.execute("call", { requests: [{ path: "src" }] } as any)).rejects.toThrow(
			"arguments.requests[0].operation is required.",
		);
	});

	test("wraps thrown execution failures with the tool name and error classification", async () => {
		const tool = createTool(
			"explode",
			"Always fails.",
			{},
			async () => {
				throw new Error("storage unavailable");
			},
		);

		try {
			await tool.execute("call", {} as any);
			throw new Error("expected execution to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(KeatingToolError);
			expect((error as KeatingToolError).toolName).toBe("explode");
			expect((error as KeatingToolError).code).toBe("execution-failed");
			expect((error as Error).message).toBe("storage unavailable");
		}
	});

	test("promotes legacy failure text to a real tool error while preserving empty-state success", async () => {
		expect(toolFailureMessage("Error: path is required.")).toContain("path is required");
		expect(toolFailureMessage("# Command Failed\n\nexit 1")).toContain("Command Failed");
		expect(toolFailureMessage("NodePod sandbox is not active.")).toContain("not active");
		expect(toolFailureMessage("No artifacts yet.")).toBeNull();

		const tool = createTool("legacy", "Legacy result.", {}, async () => "Error: storage unavailable.");
		await expect(tool.execute("call", {} as any)).rejects.toMatchObject({
			name: "KeatingToolError",
			code: "execution-failed",
		});
	});

	test("returns successful text results and throws for unavailable composed tools", async () => {
		const tool = createTool("hello", "Greets.", {}, async () => "hello");
		expect(textFromResult(await tool.execute("call", {} as any))).toBe("hello");

		const registry = createToolRegistry([tool]);
		expect(await registry.invoke("hello", {})).toBe("hello");
		await expect(registry.invoke("missing", {})).rejects.toMatchObject({
			name: "KeatingToolError",
			code: "unavailable",
		});
	});
});
