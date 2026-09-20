import {
	type DeclaredLearnerProfile,
	type DeclaredProfileGroup,
	DECLARED_PROFILE_SCHEMA_VERSION,
	defaultDeclaredProfile,
	parseDeclaredProfile,
} from "@keating/learner-contracts";
import { createLocalSetting } from "./local-setting";

export const DECLARED_PROFILE_STORAGE_KEY = "keating:learner-profile:v2";
export const DECLARED_PROFILE_CHANGED_EVENT = "keating:learner-profile-v2-changed";

/**
 * The pre-v2 single free-text blob. Still read as a migration source and still
 * written by {@link saveLearnerContext}, so a learner who never opens the new
 * form keeps working exactly as before.
 */
export const LEGACY_LEARNER_CONTEXT_STORAGE_KEY = "keating:learner-profile";

function readLegacyNotes(): string {
	try {
		if (typeof localStorage === "undefined") return "";
		return (localStorage.getItem(LEGACY_LEARNER_CONTEXT_STORAGE_KEY) ?? "").trim();
	} catch {
		return "";
	}
}

const declaredProfileSetting = createLocalSetting<DeclaredLearnerProfile>({
	key: DECLARED_PROFILE_STORAGE_KEY,
	event: DECLARED_PROFILE_CHANGED_EVENT,
	normalize: (raw) => {
		// `raw` is the stored string on load and a profile object on save.
		if (raw === null || raw === undefined) {
			// No v2 record yet: adopt whatever the learner already wrote by hand.
			const legacy = readLegacyNotes();
			return legacy ? { ...defaultDeclaredProfile(), notes: legacy } : defaultDeclaredProfile();
		}
		return parseDeclaredProfile(raw);
	},
});

export function loadDeclaredProfile(): DeclaredLearnerProfile {
	return declaredProfileSetting.load();
}

/**
 * Persists the profile and mirrors `notes` back to the legacy key, so the
 * untouched `loadLearnerContext`/`saveLearnerContext` pair — which 99 call
 * sites depend on — keeps returning the learner's free text.
 */
export function saveDeclaredProfile(profile: DeclaredLearnerProfile): void {
	const next = parseDeclaredProfile({ ...profile, updatedAt: new Date().toISOString() });
	declaredProfileSetting.save(next);
	try {
		if (typeof localStorage !== "undefined") {
			if (next.notes) localStorage.setItem(LEGACY_LEARNER_CONTEXT_STORAGE_KEY, next.notes);
			else localStorage.removeItem(LEGACY_LEARNER_CONTEXT_STORAGE_KEY);
		}
	} catch {
		// The v2 record above is authoritative; the mirror is a convenience.
	}
}

export function updateDeclaredProfile(patch: Partial<DeclaredLearnerProfile>): DeclaredLearnerProfile {
	const next = parseDeclaredProfile({ ...loadDeclaredProfile(), ...patch });
	saveDeclaredProfile(next);
	return next;
}

export function markDeclaredProfileGroupSkipped(group: DeclaredProfileGroup): void {
	const current = loadDeclaredProfile();
	if (current.skippedGroups.includes(group)) return;
	updateDeclaredProfile({ skippedGroups: [...current.skippedGroups, group] });
}

export function resetDeclaredProfile(): void {
	try {
		if (typeof localStorage !== "undefined") {
			localStorage.removeItem(DECLARED_PROFILE_STORAGE_KEY);
			localStorage.removeItem(LEGACY_LEARNER_CONTEXT_STORAGE_KEY);
		}
	} catch {
		// The in-memory broadcast below still keeps this tab consistent.
	}
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent<DeclaredLearnerProfile>(DECLARED_PROFILE_CHANGED_EVENT, { detail: defaultDeclaredProfile() }),
		);
	}
}

export function subscribeDeclaredProfile(callback: (profile: DeclaredLearnerProfile) => void): () => void {
	return declaredProfileSetting.subscribe(callback);
}

export { DECLARED_PROFILE_SCHEMA_VERSION };
