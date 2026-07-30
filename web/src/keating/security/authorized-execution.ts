import { evaluateToolPermission, classifyTool } from "./policy";
import type { ToolExecutionContext } from "./types";

export class ToolAuthorizationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolAuthorizationError";
	}
}

/**
 * Enforce hard runtime boundaries without pausing the learner for approval.
 * Known, in-scope calls run immediately; impossible or unsafe surfaces fail
 * closed before the underlying implementation is reached.
 */
export class AuthorizedToolExecutor {
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
		if (decision.outcome === "deny") {
			throw new ToolAuthorizationError(decision.reasons.join(" "));
		}
		return input.run();
	}
}
