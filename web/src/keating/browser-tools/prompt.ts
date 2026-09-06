import type { KeatingStorage } from "../storage";
import { DEFAULT_TEACHER_PERSONA } from "../persona";
import { learnerContextPrompt } from "../learner-context";
import operationalProtocolMarkdown from "../prompts/operational-protocol.md?raw";
import speechSystemPromptMarkdown from "../prompts/speech-system-prompt.md?raw";
import { loadActiveTeachingRevision, type EvolutionStore } from "../../../../shared/evolution/loop";
import { composeTeachingPrompt } from "../../../../shared/evolution/benchmark";
import { browserEvolutionStore } from "../teaching-evolution-store";

export const KEATING_OPERATIONAL_PROTOCOL = operationalProtocolMarkdown.trim();

const SPEECH_SYSTEM_PROMPT = `\n${speechSystemPromptMarkdown.trim()}\n`;

export function composeKeatingSystemPrompt(persona: string = DEFAULT_TEACHER_PERSONA): string {
	const trimmed = persona.trim();
	const front = trimmed.length > 0 ? trimmed : DEFAULT_TEACHER_PERSONA;
	return `${front}\n\n${KEATING_OPERATIONAL_PROTOCOL}`;
}

export const KEATING_SYSTEM_PROMPT = composeKeatingSystemPrompt(DEFAULT_TEACHER_PERSONA);

const OPERATIONAL_PROTOCOL_HEADING = "## Self-Evolution Protocol";

/** Keep evolved voice/persona text while making the checked-in protocol authoritative. */
export function refreshKeatingOperationalProtocol(prompt: string): string {
	const heading = prompt.indexOf(OPERATIONAL_PROTOCOL_HEADING);
	const persona = (heading >= 0 ? prompt.slice(0, heading) : prompt).trim();
	return composeKeatingSystemPrompt(persona);
}

export function buildKeatingSystemPrompt(speechEnabled = false, basePrompt = KEATING_SYSTEM_PROMPT, learnerContext = ""): string {
	const personalized = `${basePrompt}${learnerContextPrompt(learnerContext)}`;
	return speechEnabled ? `${personalized}${SPEECH_SYSTEM_PROMPT}` : personalized;
}

export async function getActiveKeatingPrompt(storage: KeatingStorage, promptName = "learn", revisionStore?: EvolutionStore, basePrompt = KEATING_SYSTEM_PROMPT): Promise<string> {
	// Saved prompt proposals are not activation decisions. Retain arguments for callers.
	void storage; void promptName;
	if (!revisionStore && typeof indexedDB === "undefined") return basePrompt;
	const revision = await loadActiveTeachingRevision(revisionStore ?? browserEvolutionStore);
	if (!revision || revision.basePrompt !== basePrompt) return basePrompt;
	return composeTeachingPrompt(revision);
}
