import type { VerifiedBrowserActiveRevision, VerifiedPromptSetArtifact } from "./types";

const MAX_ACTIVE_SYSTEM_PROMPT_CHARACTERS = 1_000_000;

function promptFromJson(value: VerifiedPromptSetArtifact["value"]): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (record.schemaVersion !== 1) return null;
	const prompts = record.prompts;
	if (!prompts || typeof prompts !== "object" || Array.isArray(prompts)) return null;
	const system = (prompts as Record<string, unknown>).system;
	return typeof system === "string" ? system : null;
}

/**
 * Select only the system entry from the verified prompt-set contract. Other
 * named prompts remain available to compatible runtimes without being folded
 * into the tutor's authority prompt accidentally.
 */
export function browserSystemPromptFromRevision(
	revision: VerifiedBrowserActiveRevision,
): string | null {
	const artifact = revision.artifacts.find(
		(candidate): candidate is VerifiedPromptSetArtifact => candidate.kind === "prompt-set",
	);
	if (!artifact) return null;
	const prompt = typeof artifact.value === "string"
		? artifact.value
		: promptFromJson(artifact.value);
	if (!prompt?.trim() || prompt.length > MAX_ACTIVE_SYSTEM_PROMPT_CHARACTERS) return null;
	return prompt;
}
