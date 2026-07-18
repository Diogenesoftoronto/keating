import { evaluateToolPermission, classifyTool } from "./policy";
import type { InvocationSurface, ToolExecutionContext, ToolRiskClass } from "./types";

export interface ConfirmationChallenge {
	id: string;
	sessionId: string;
	toolName: string;
	argumentDigest: string;
	expiresAt: number;
	documentRevision?: number;
	risk: ToolRiskClass;
}

/** The complete, intentionally argument-free review surface exposed to UI code. */
export interface ToolConfirmationReview {
	toolName: string;
	risk: ToolRiskClass;
	surface: InvocationSurface;
	expiresAt: number;
}

/** Ephemeral browser event detail. It contains callbacks, so it cannot be serialized or persisted. */
export interface ToolConfirmationRequestDetail {
	review: ToolConfirmationReview;
	approve: () => void;
	cancel: () => void;
}

export class ToolAuthorizationError extends Error {
	constructor(message: string, readonly outcome: "deny" | "confirm", readonly challenge?: ConfirmationChallenge) {
		super(message);
		this.name = "ToolAuthorizationError";
	}
}

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

async function digest(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(canonical(value));
	const hash = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class AuthorizedToolExecutor {
	private readonly challenges = new Map<string, ConfirmationChallenge>();

	constructor(private readonly ttlMs = 120_000, private readonly now = () => Date.now()) {}

	async execute<T>(input: {
		toolName: string;
		arguments?: unknown;
		context: ToolExecutionContext;
		run: () => Promise<T>;
	}): Promise<T> {
		const decision = evaluateToolPermission({
			tool: classifyTool(input.toolName),
			surface: input.context.surface,
			provenance: input.context.provenance,
			arguments: input.arguments,
		});
		if (decision.outcome === "deny") throw new ToolAuthorizationError(decision.reasons.join(" "), "deny");
		if (decision.outcome === "allow") return input.run();

		const argumentDigest = await digest(input.arguments);
		if (input.context.confirmationToken) {
			this.redeem(input.context.confirmationToken, input.context, input.toolName, argumentDigest);
			return input.run();
		}
		const challenge = this.issue(input.context, input.toolName, argumentDigest, decision.risk);
		throw new ToolAuthorizationError(`Confirmation required for ${input.toolName}.`, "confirm", challenge);
	}

	async executeWithTrustedConfirmation<T>(input: {
		toolName: string;
		arguments?: unknown;
		context: ToolExecutionContext;
		run: () => Promise<T>;
		requestConfirmation: (review: ToolConfirmationReview) => Promise<boolean>;
	}): Promise<T> {
		try {
			return await this.execute(input);
		} catch (error) {
			if (!(error instanceof ToolAuthorizationError) || error.outcome !== "confirm" || !error.challenge) throw error;
			const challenge = error.challenge;
			const remainingMs = Math.max(0, challenge.expiresAt - this.now());
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const approved = await Promise.race([
				input.requestConfirmation({
					toolName: challenge.toolName,
					risk: challenge.risk,
					surface: input.context.surface,
					expiresAt: challenge.expiresAt,
				}),
				new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), remainingMs); }),
			]);
			if (timeout) clearTimeout(timeout);
			if (!approved) {
				this.challenges.delete(challenge.id);
				throw new ToolAuthorizationError("Confirmation was cancelled or expired.", "deny");
			}
			return this.execute({
				...input,
				context: {
					...input.context,
					confirmationToken: challenge.id,
					provenance: { ...input.context.provenance, userAuthorized: true },
				},
			});
		}
	}

	private issue(context: ToolExecutionContext, toolName: string, argumentDigest: string, risk: ToolRiskClass): ConfirmationChallenge {
		const challenge: ConfirmationChallenge = {
			id: crypto.randomUUID(), sessionId: context.sessionId, toolName, argumentDigest,
			expiresAt: this.now() + this.ttlMs, documentRevision: context.documentRevision, risk,
		};
		this.challenges.set(challenge.id, challenge);
		return challenge;
	}

	private redeem(token: string, context: ToolExecutionContext, toolName: string, argumentDigest: string): void {
		const challenge = this.challenges.get(token);
		this.challenges.delete(token);
		if (!challenge || challenge.expiresAt < this.now()) throw new ToolAuthorizationError("Confirmation is invalid or expired.", "deny");
		if (challenge.sessionId !== context.sessionId || challenge.toolName !== toolName || challenge.argumentDigest !== argumentDigest || challenge.documentRevision !== context.documentRevision) {
			throw new ToolAuthorizationError("Confirmation does not match this invocation.", "deny");
		}
		if (context.provenance.userAuthorized !== true) throw new ToolAuthorizationError("Confirmation must come from an independent user action.", "deny");
	}
}
