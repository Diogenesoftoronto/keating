import { describe, expect, test } from "bun:test";
import { AuthorizedToolExecutor } from "../../keating/security";

const trustedText = {
	sessionId: "session-a",
	surface: "text" as const,
	provenance: { trust: "trusted" as const, userAuthorized: true },
};

describe("authorized tool execution", () => {
	test("runs known trusted tools immediately without a confirmation callback", async () => {
		let runs = 0;
		const executor = new AuthorizedToolExecutor();

		await expect(executor.execute({
			toolName: "generate_image",
			arguments: { prompt: "owl" },
			context: trustedText,
			run: async () => ++runs,
		})).resolves.toBe(1);
		await expect(executor.execute({
			toolName: "workspace_exec",
			arguments: { command: "pwd" },
			context: trustedText,
			run: async () => ++runs,
		})).resolves.toBe(2);
		expect(runs).toBe(2);
	});

	test("unknown tools fail closed without running", async () => {
		let ran = false;
		await expect(new AuthorizedToolExecutor().execute({
			toolName: "future_dangerous_tool",
			arguments: {},
			context: trustedText,
			run: async () => { ran = true; },
		})).rejects.toThrow("Unknown tools");
		expect(ran).toBe(false);
	});

	test("untrusted web content cannot authorize code execution", async () => {
		await expect(new AuthorizedToolExecutor().execute({
			toolName: "workspace_exec",
			arguments: { command: "id" },
			context: {
				sessionId: "s",
				surface: "automation",
				provenance: { trust: "untrusted-web", userAuthorized: false },
			},
			run: async () => "unsafe",
		})).rejects.toThrow("Untrusted web content");
	});

	test("voice can make ordinary state changes without a visual prompt", async () => {
		let runs = 0;
		await expect(new AuthorizedToolExecutor().execute({
			toolName: "feedback",
			arguments: { signal: "up" },
			context: {
				...trustedText,
				surface: "voice",
				provenance: { trust: "unknown", userAuthorized: false },
			},
			run: async () => ++runs,
		})).resolves.toBe(1);
	});

	test("voice still cannot execute code or carry secrets", async () => {
		const executor = new AuthorizedToolExecutor();
		await expect(executor.execute({
			toolName: "workspace_exec",
			arguments: { command: "id" },
			context: { ...trustedText, surface: "voice" },
			run: async () => "unsafe",
		})).rejects.toThrow("not available from voice");
		await expect(executor.execute({
			toolName: "feedback",
			arguments: { apiKey: "hidden" },
			context: { ...trustedText, surface: "voice" },
			run: async () => "unsafe",
		})).rejects.toThrow("Secret-bearing");
	});
});
