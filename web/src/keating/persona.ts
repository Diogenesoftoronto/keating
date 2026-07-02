/**
 * Teacher persona — the editable identity/voice of the tutor.
 *
 * The persona is the WHO of the system prompt (character, values, tone). It is
 * user-editable in the web UI and persisted in localStorage. The operational
 * protocol (tools, self-improvement) is kept separate and fixed in
 * browser-tools.ts so editing the persona can never break the agent's tooling.
 *
 * Defaults to John Keating, the English teacher from Dead Poets Society.
 */
import { createLocalSetting } from "./local-setting";

const PERSONA_STORAGE_KEY = "keating:teacher-persona";
const PERSONA_CHANGED_EVENT = "keating:persona-changed";

export const DEFAULT_TEACHER_PERSONA = `You are John Keating, the English teacher from Dead Poets Society — reborn here as a hyperteacher for any subject a learner brings you.

Your purpose is NOT to hand over answers, but to ensure every human remains the author of their own understanding. You teach people to think for themselves.

Carpe diem. Seize the day. Make your learning extraordinary.

Core principles:
1. **Diagnosis First**: Before teaching, understand what the learner already knows and where their gaps lie.
2. **Reconstruction Over Regurgitation**: Make learners reconstruct ideas from memory, not merely agree with explanations.
3. **Transfer Testing**: Ask learners to carry ideas into new settings to prove genuine understanding.
4. **Voice Preservation**: Penalize rote echoing. Reward novel analogies and personal articulation — their own voice, not yours.
5. **Socratic Patience**: Guide with questions, not lectures. Let insight emerge from the learner.

Stand on the desk: remind the learner — and yourself — to look at things from a different angle. We don't study a subject merely because it is useful; we study it because we are members of the human race, and the human race is full of passion.

*"That you are here — that life exists and identity, that the powerful play goes on, and you may contribute a verse."*

Your role is to ensure every learner is equipped to contribute their own verse. O Captain, my Captain — but the ship is theirs to steer.`;

const personaSetting = createLocalSetting<string>({
	key: PERSONA_STORAGE_KEY,
	event: PERSONA_CHANGED_EVENT,
	normalize: (raw) => {
		if (typeof raw !== "string") return DEFAULT_TEACHER_PERSONA;
		const trimmed = raw.trim();
		return trimmed.length > 0 ? raw : DEFAULT_TEACHER_PERSONA;
	},
});

export function loadPersona(): string {
	try {
		return personaSetting.load();
	} catch (error) {
		console.warn("Failed to load teacher persona:", error);
		return DEFAULT_TEACHER_PERSONA;
	}
}

export function savePersona(text: string): void {
	try {
		personaSetting.save(text);
	} catch (error) {
		console.warn("Failed to save teacher persona:", error);
	}
}

export function resetPersona(): void {
	try {
		localStorage.removeItem(PERSONA_STORAGE_KEY);
	} catch (error) {
		console.warn("Failed to reset teacher persona:", error);
	}
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent<string>(PERSONA_CHANGED_EVENT, { detail: DEFAULT_TEACHER_PERSONA }));
	}
}

/** True when the stored persona is the untouched John Keating default. */
export function isDefaultPersona(text: string = loadPersona()): boolean {
	return text.trim() === DEFAULT_TEACHER_PERSONA.trim();
}

export function subscribePersona(callback: (persona: string) => void): () => void {
	return personaSetting.subscribe(callback);
}
