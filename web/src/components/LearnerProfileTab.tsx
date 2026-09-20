import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, RotateCcw, Save } from "lucide-react";
import {
	type DeclaredLearnerProfile,
	MAX_DECLARED_NOTES_LENGTH,
	answeredDeclaredProfileFields,
	defaultDeclaredProfile,
} from "@keating/learner-contracts";
import { css } from "../../styled-system/css";
import { outlineButton, primaryButton, textarea } from "../../styled-system/recipes";
import {
	MAX_LEARNER_CONTEXT_LENGTH,
	loadLearnerContext,
	resetLearnerContext,
	saveLearnerContext,
	subscribeLearnerContext,
} from "../keating/learner-context";
import {
	loadDeclaredProfile,
	resetDeclaredProfile,
	saveDeclaredProfile,
	subscribeDeclaredProfile,
} from "../keating/learner-profile-store";
import {
	AccessibilityFields,
	ContextFields,
	GoalFields,
	IdentityFields,
	LanguageFields,
	PedagogyFields,
} from "./profile/ProfileFieldGroups";
import type { SettingsSection } from "./SettingsSectionNav";

export const LEARNER_PROFILE_SECTIONS: SettingsSection[] = [
	{ id: "profile-identity", label: "About you" },
	{ id: "profile-language", label: "Language" },
	{ id: "profile-context", label: "Background" },
	{ id: "profile-goals", label: "Goals" },
	{ id: "profile-pedagogy", label: "Teaching" },
	{ id: "profile-accessibility", label: "Accessibility" },
	{ id: "profile-notes", label: "Anything else" },
];

const stackClass = css({ display: "flex", flexDirection: "column", gap: "2rem" });
const descriptionClass = css({ fontSize: "0.875rem", lineHeight: "1.5rem", color: "var(--muted-foreground)" });
const sectionClass = css({ display: "flex", flexDirection: "column", gap: "0.75rem", scrollMarginTop: "5rem" });
const sectionHeadingClass = css({ fontSize: "0.8125rem", fontWeight: 600, color: "var(--foreground)" });
const fieldStackClass = css({ display: "flex", flexDirection: "column", gap: "0.5rem" });
const fieldLabelClass = css({ fontSize: "0.75rem", fontWeight: 500, color: "var(--foreground)" });
const metaRowClass = css({ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.5rem", fontSize: "11px", color: "var(--muted-foreground)" });
const actionRowClass = css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", position: "sticky", bottom: 0, paddingBlock: "0.75rem", backgroundColor: "color-mix(in srgb, var(--background) 95%, transparent)" });
const footnoteClass = css({ fontSize: "11px", lineHeight: "1.25rem", color: "var(--muted-foreground)" });

/** Unchanged free-text contract: existing stories and any embedder keep working. */
export interface LearnerProfileStore {
	load: () => string;
	save: (context: string) => void;
	reset: () => void;
	subscribe: (listener: (context: string) => void) => () => void;
}

export interface DeclaredProfileStore {
	load: () => DeclaredLearnerProfile;
	save: (profile: DeclaredLearnerProfile) => void;
	reset: () => void;
	subscribe: (listener: (profile: DeclaredLearnerProfile) => void) => () => void;
}

const browserLearnerProfileStore: LearnerProfileStore = {
	load: loadLearnerContext,
	save: saveLearnerContext,
	reset: resetLearnerContext,
	subscribe: subscribeLearnerContext,
};

const browserDeclaredProfileStore: DeclaredProfileStore = {
	load: loadDeclaredProfile,
	save: saveDeclaredProfile,
	reset: resetDeclaredProfile,
	subscribe: subscribeDeclaredProfile,
};

/** `updatedAt` moves on every save, so it can never take part in the dirty check. */
function sameProfile(a: DeclaredLearnerProfile, b: DeclaredLearnerProfile): boolean {
	const strip = ({ updatedAt: _updatedAt, ...rest }: DeclaredLearnerProfile) => rest;
	return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

export function LearnerProfileTab({
	store = browserLearnerProfileStore,
	profileStore = browserDeclaredProfileStore,
}: { store?: LearnerProfileStore; profileStore?: DeclaredProfileStore }) {
	const [stored, setStored] = useState<DeclaredLearnerProfile>(() => ({ ...profileStore.load(), notes: store.load() }));
	const [draft, setDraft] = useState<DeclaredLearnerProfile>(stored);
	const [saved, setSaved] = useState(false);
	const savedTimer = useRef<number | null>(null);

	// An outside write (another tab, onboarding, the legacy writer) replaces an untouched draft only.
	useEffect(() => profileStore.subscribe((next) => {
		setStored((previous) => {
			const merged = { ...next, notes: next.notes || previous.notes };
			setDraft((current) => (sameProfile(current, previous) ? merged : current));
			return merged;
		});
	}), [profileStore]);
	useEffect(() => store.subscribe((notes) => {
		setStored((previous) => {
			const merged = { ...previous, notes };
			setDraft((current) => (sameProfile(current, previous) ? merged : current));
			return merged;
		});
	}), [store]);
	useEffect(() => () => {
		if (savedTimer.current) window.clearTimeout(savedTimer.current);
	}, []);

	const dirty = !sameProfile(draft, stored);
	const answered = useMemo(() => answeredDeclaredProfileFields(draft).length, [draft]);
	const patch = useCallback((next: Partial<DeclaredLearnerProfile>) => setDraft((current) => ({ ...current, ...next })), []);

	const flashSaved = useCallback(() => {
		setSaved(true);
		if (savedTimer.current) window.clearTimeout(savedTimer.current);
		savedTimer.current = window.setTimeout(() => setSaved(false), 1600);
	}, []);

	const handleSave = useCallback(() => {
		profileStore.save(draft);
		// Keep the free-text store authoritative for `notes`, including an injected one.
		store.save(draft.notes);
		setStored(draft);
		flashSaved();
	}, [draft, flashSaved, profileStore, store]);

	const handleReset = useCallback(() => {
		profileStore.reset();
		store.reset();
		const cleared = defaultDeclaredProfile();
		setStored(cleared);
		setDraft(cleared);
		flashSaved();
	}, [flashSaved, profileStore, store]);

	const groupProps = { profile: draft, onChange: patch, idPrefix: "learner-profile" };

	return (
		<div className={stackClass}>
			<p className={descriptionClass}>
				Anything you fill in here shapes how Keating teaches you — the examples it picks, the language it uses, how much it asks before it explains. Every field is optional, and it all stays in this browser.
			</p>

			<section id="settings-section-profile-identity" className={sectionClass}>
				<h4 className={sectionHeadingClass}>About you</h4>
				<IdentityFields {...groupProps} />
			</section>

			<section id="settings-section-profile-language" className={sectionClass}>
				<h4 className={sectionHeadingClass}>Language</h4>
				<LanguageFields {...groupProps} />
			</section>

			<section id="settings-section-profile-context" className={sectionClass}>
				<h4 className={sectionHeadingClass}>Background</h4>
				<ContextFields {...groupProps} />
			</section>

			<section id="settings-section-profile-goals" className={sectionClass}>
				<h4 className={sectionHeadingClass}>Your pursuits</h4>
				<GoalFields {...groupProps} showPursuits />
			</section>

			<section id="settings-section-profile-pedagogy" className={sectionClass}>
				<h4 className={sectionHeadingClass}>How Keating should teach you</h4>
				<PedagogyFields {...groupProps} />
			</section>

			<section id="settings-section-profile-accessibility" className={sectionClass}>
				<h4 className={sectionHeadingClass}>Accessibility</h4>
				<AccessibilityFields {...groupProps} />
			</section>

			<section id="settings-section-profile-notes" className={sectionClass}>
				<h4 className={sectionHeadingClass}>Anything else</h4>
				<div className={fieldStackClass}>
					<label htmlFor="learner-profile" className={fieldLabelClass}>In your own words</label>
					<textarea
						id="learner-profile"
						className={textarea()}
						value={draft.notes}
						maxLength={Math.min(MAX_LEARNER_CONTEXT_LENGTH, MAX_DECLARED_NOTES_LENGTH)}
						onChange={(event) => patch({ notes: event.target.value })}
						placeholder="I am learning for… I already know… I learn best with… I am interested in…"
					/>
					<div className={metaRowClass}>
						<span>{draft.notes.length} / {MAX_LEARNER_CONTEXT_LENGTH} characters</span>
						<span>{answered === 0 ? "Nothing filled in yet" : `${answered} ${answered === 1 ? "field" : "fields"} filled in`}</span>
					</div>
				</div>
			</section>

			<div className={actionRowClass}>
				<button type="button" onClick={handleSave} disabled={!dirty} className={primaryButton()}>
					{saved ? <Check size={15} /> : <Save size={15} />}
					{saved ? "Saved" : "Save profile"}
				</button>
				<button type="button" onClick={handleReset} className={outlineButton()}>
					<RotateCcw size={14} />
					Clear profile
				</button>
			</div>
			<p className={footnoteClass}>Changes apply to the current conversation on the next message and to every new session.</p>
		</div>
	);
}
