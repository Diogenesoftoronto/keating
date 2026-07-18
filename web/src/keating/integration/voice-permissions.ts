import { AuthorizedToolExecutor, type ToolExecutionContext } from "../security";
import type { LiveSpeechToolCall } from "../speech";

export interface VoicePermissionResult {
	allowed: boolean;
	reason?: string;
}

export function authorizeVoiceToolCall(call: LiveSpeechToolCall): VoicePermissionResult {
	// Compatibility preflight. Actual execution must use executeAuthorizedVoiceToolCall.
	const knownInformational = ["bench", "deck", "quiz", "ask_user_question", "prompt_eval", "evaluate_teaching", "keating_voice"].includes(call.name);
	return knownInformational
		? { allowed: true }
		: { allowed: false, reason: `Voice tool "${call.name}" is not permitted without authorized execution.` };
}

export function executeAuthorizedVoiceToolCall<T>(executor: AuthorizedToolExecutor, call: LiveSpeechToolCall, context: Omit<ToolExecutionContext, "surface">, run: () => Promise<T>): Promise<T> {
	return executor.execute({ toolName: call.name, arguments: call.arguments, context: { ...context, surface: "voice" }, run });
}
