import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveMinimaxApiKey } from "../../src/core/skate-secrets.js";
import { launchRpcClient } from "../../src/runtime/pi.js";

const enabled = process.env.KEATING_E2E === "1";
const workspace = enabled ? mkdtempSync(join(tmpdir(), "keating-tui-e2e-")) : "";

afterAll(() => {
	if (workspace) rmSync(workspace, { recursive: true, force: true });
});

describe.skipIf(!enabled)("TUI real-model harness", () => {
	test("MiniMax drives a Pi tool loop over RPC", async () => {
		const key = resolveMinimaxApiKey();
		expect(key, "Set MINIMAX_API_KEY or store minimax@secrets in Skate").toBeTruthy();
		const previous = process.env.MINIMAX_API_KEY;
		process.env.MINIMAX_API_KEY = key;
		writeFileSync(join(workspace, "keating.config.json"), JSON.stringify({
			pi: {
				runtimePreference: "embedded-only",
				defaultProvider: "minimax",
				defaultModel: "MiniMax-M2.7-highspeed",
				defaultThinking: "low",
			},
		}, null, 2));

		const client = await launchRpcClient(workspace, [
			"--provider", "minimax",
			"--model", "MiniMax-M2.7-highspeed",
			"--thinking", "low",
		]);
		const commands = await client.getCommands();
		expect(commands.map((command) => command.name)).toContain("plan");
		const toolNames: string[] = [];
		let assistantText = "";
		const internal = client as unknown as { send(command: Record<string, unknown>): Promise<unknown> };
		const unsubscribe = client.onEvent((event: any) => {
			if (event.type === "tool_execution_start" && typeof event.toolName === "string") toolNames.push(event.toolName);
			if (event.type === "message_end" && event.message?.role === "assistant") {
				assistantText += (event.message.content ?? [])
					.filter((part: any) => part?.type === "text")
					.map((part: any) => part.text)
					.join("\n");
			}
			if (event.type === "extension_ui_request" && event.id) {
				const response = event.method === "confirm"
					? { confirmed: true }
					: event.method === "select"
						? { value: event.options?.[0] ?? "" }
						: { value: "A concise test answer" };
				void internal.send({ type: "extension_ui_response", id: event.id, ...response });
			}
		});

		try {
			await client.prompt("Use the read tool exactly once to read package.json, then reply with only the package name and version. Do not inspect any other files.");
			await client.waitForIdle();
			expect(toolNames).toContain("read");
			expect(assistantText.length).toBeGreaterThan(0);
		} finally {
			unsubscribe();
			await client.stop();
			if (previous === undefined) delete process.env.MINIMAX_API_KEY;
			else process.env.MINIMAX_API_KEY = previous;
		}
	}, 120_000);
});
