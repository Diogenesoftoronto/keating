import { describe, expect, test } from "bun:test";
import { AuthorizedToolExecutor, ToolAuthorizationError } from "../../keating/security";

const trustedText = { sessionId: "session-a", surface: "text" as const, provenance: { trust: "trusted" as const, userAuthorized: true } };

async function challengeFor(executor: AuthorizedToolExecutor, toolName = "generate_image", args: unknown = { prompt: "owl" }) {
	try {
		await executor.execute({ toolName, arguments: args, context: trustedText, run: async () => "ran" });
	} catch (error) {
		if (error instanceof ToolAuthorizationError && error.challenge) return error.challenge;
		throw error;
	}
	throw new Error("Expected confirmation challenge");
}

describe("authorized tool execution", () => {
	test("unknown tools fail closed on voice and automation", async () => {
		for (const surface of ["voice", "automation"] as const) {
			let ran = false;
			await expect(new AuthorizedToolExecutor().execute({
				toolName: "future_dangerous_tool", arguments: {},
				context: { ...trustedText, surface }, run: async () => { ran = true; },
			})).rejects.toMatchObject({ outcome: "deny" });
			expect(ran).toBe(false);
		}
	});

	test("confirmation is bound, independently authorized, and single use", async () => {
		const executor = new AuthorizedToolExecutor();
		const challenge = await challengeFor(executor);
		let runs = 0;
		const execute = (arguments_: unknown, token = challenge.id, sessionId = "session-a") => executor.execute({
			toolName: "generate_image", arguments: arguments_,
			context: { ...trustedText, sessionId, confirmationToken: token },
			run: async () => ++runs,
		});
		await expect(execute({ prompt: "different" })).rejects.toMatchObject({ outcome: "deny" });
		expect(runs).toBe(0);
		const valid = await challengeFor(executor);
		await expect(executor.execute({
			toolName: "generate_image", arguments: { prompt: "owl" },
			context: { ...trustedText, confirmationToken: valid.id }, run: async () => ++runs,
		})).resolves.toBe(1);
		await expect(executor.execute({
			toolName: "generate_image", arguments: { prompt: "owl" },
			context: { ...trustedText, confirmationToken: valid.id }, run: async () => ++runs,
		})).rejects.toMatchObject({ outcome: "deny" });
		expect(runs).toBe(1);
	});

	test("untrusted search provenance cannot authorize effects", async () => {
		await expect(new AuthorizedToolExecutor().execute({
			toolName: "workspace_exec", arguments: { command: "id" },
			context: { sessionId: "s", surface: "automation", provenance: { trust: "untrusted-web", userAuthorized: false } },
			run: async () => "unsafe",
		})).rejects.toMatchObject({ outcome: "deny" });
	});

	test("explicit browser approval retries the exact invocation without exposing arguments", async () => {
		const executor = new AuthorizedToolExecutor();
		let runs = 0;
		let review: Record<string, unknown> | undefined;
		const result = await executor.executeWithTrustedConfirmation({
			toolName: "generate_image",
			arguments: { prompt: "owl", apiKey: "must-not-leak" },
			context: trustedText,
			run: async () => ++runs,
			requestConfirmation: async (value) => {
				review = { ...value };
				return true;
			},
		});
		expect(result).toBe(1);
		expect(runs).toBe(1);
		expect(review).toEqual({
			toolName: "generate_image",
			risk: "external-side-effect",
			surface: "text",
			expiresAt: expect.any(Number),
		});
		expect(JSON.stringify(review)).not.toContain("owl");
		expect(JSON.stringify(review)).not.toContain("must-not-leak");
	});

	test("cancellation denies without running and consumes the challenge", async () => {
		const executor = new AuthorizedToolExecutor();
		let runs = 0;
		await expect(executor.executeWithTrustedConfirmation({
			toolName: "generate_image",
			arguments: { prompt: "owl" },
			context: trustedText,
			run: async () => ++runs,
			requestConfirmation: async () => false,
		})).rejects.toMatchObject({ outcome: "deny" });
		expect(runs).toBe(0);
	});

	test("voice confirmation requires the independent confirmation callback", async () => {
		const executor = new AuthorizedToolExecutor();
		let reviewedSurface: string | undefined;
		let runs = 0;
		await executor.executeWithTrustedConfirmation({
			toolName: "feedback",
			arguments: { signal: "up" },
			context: { ...trustedText, surface: "voice", provenance: { trust: "unknown", userAuthorized: false } },
			run: async () => ++runs,
			requestConfirmation: async (review) => {
				reviewedSurface = review.surface;
				return true;
			},
		});
		expect(reviewedSurface).toBe("voice");
		expect(runs).toBe(1);
	});
});
