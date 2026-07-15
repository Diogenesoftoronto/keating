import type { KeatingStorage } from "../storage";
import { DEFAULT_TEACHER_PERSONA } from "../persona";
import { learnerContextPrompt } from "../learner-context";
import operationalProtocolMarkdown from "../prompts/operational-protocol.md?raw";
import speechSystemPromptMarkdown from "../prompts/speech-system-prompt.md?raw";

export const KEATING_OPERATIONAL_PROTOCOL = operationalProtocolMarkdown.trim();

const SPEECH_SYSTEM_PROMPT = `\n${speechSystemPromptMarkdown.trim()}\n`;

export function composeKeatingSystemPrompt(persona: string = DEFAULT_TEACHER_PERSONA): string {
	const trimmed = persona.trim();
	const front = trimmed.length > 0 ? trimmed : DEFAULT_TEACHER_PERSONA;
	return `${front}\n\n${KEATING_OPERATIONAL_PROTOCOL}`;
}

export const KEATING_SYSTEM_PROMPT = composeKeatingSystemPrompt(DEFAULT_TEACHER_PERSONA);

export function buildKeatingSystemPrompt(speechEnabled = false, basePrompt = KEATING_SYSTEM_PROMPT, learnerContext = ""): string {
	const personalized = `${basePrompt}${learnerContextPrompt(learnerContext)}`;
	return speechEnabled ? `${personalized}${SPEECH_SYSTEM_PROMPT}` : personalized;
}

export async function getActiveKeatingPrompt(storage: KeatingStorage, promptName = "learn"): Promise<string> {
	const evolutions = await storage.getPromptEvolutions(promptName);
	const latest = evolutions.sort((left, right) => right.createdAt - left.createdAt)[0];
	return latest?.bestPrompt || KEATING_SYSTEM_PROMPT;
}
