import { useCallback, useEffect, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import "./profile/settings-profile.css";
import {
	type DeclaredLearnerProfile,
	DECLARED_PROFILE_FIELD_GROUPS,
	MAX_DECLARED_NOTES_LENGTH,
	answeredDeclaredProfileFields,
	currentPursuit,
	defaultDeclaredProfile,
} from "@keating/learner-contracts";
import {
	Button,
	ConfirmDialog,
	EmptyState,
	Prose,
	TextArea,
} from "../design-system/kit";
import { profileSearchRows } from "./settings/search/learning";
import { StatusLine, useSectionStatus } from "./settings/ui";
import {
	MAX_LEARNER_CONTEXT_LENGTH,
	loadLearnerContext,
	learnerContextPrompt,
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
	subscribe: (
		listener: (profile: DeclaredLearnerProfile) => void,
	) => () => void;
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

function profileReading(p: DeclaredLearnerProfile) {
	const who = p.preferredName.trim() || "The learner";
	const active = currentPursuit(p.pursuits);
	const clauses = [
		[p.preferredName, p.pronouns].filter(Boolean).join(", "),
		p.ageBand &&
			(p.ageBand === "prefer-not-to-say"
				? "Age range withheld"
				: "Age range " + p.ageBand.replace("plus", "and older")),
		p.interfaceLocale !== "system" &&
			"Use the " +
				(p.interfaceLocale === "fr-CA" ? "French" : "English") +
				" interface",
		p.explainInLanguage && "Explain in " + p.explainInLanguage,
		p.instructionLanguageFluency &&
			"Instruction-language fluency is " + p.instructionLanguageFluency,
		p.otherLanguages.length &&
			"Also speaks " +
				p.otherLanguages
					.map(
						(l) =>
							l +
							(p.otherLanguageFluencies?.[l]
								? " (" + p.otherLanguageFluencies[l] + ")"
								: ""),
					)
					.join(", "),
		p.educationStage && "Education stage: " + p.educationStage,
		p.priorKnowledge && "Prior knowledge: " + p.priorKnowledge,
		p.interests.length && "Use examples from " + p.interests.join(", "),
		p.goalText && who + " wants to understand " + p.goalText,
		active && "Current pursuit: " + active.title,
		p.motivation && "Motivation: " + p.motivation.replaceAll("-", " "),
		p.deadline && "Aim for " + p.deadline,
		p.weeklyMinutes && "Allow " + p.weeklyMinutes + " minutes a week",
		p.preferredSessionMinutes &&
			"Plan for " + p.preferredSessionMinutes + "-minute sessions",
		p.socraticIntensity &&
			{
				light: "Mostly explain, asking occasionally",
				balanced: "Balance asking and telling",
				deep: "Keep asking until it clicks",
			}[p.socraticIntensity],
		p.hintLevel &&
			{
				minimal: "Allow time to struggle",
				moderate: "Give a nudge when stuck",
				generous: "Give a clear hint when stuck",
			}[p.hintLevel],
		p.tone && "Use a " + p.tone + " tone",
		p.depth &&
			{
				overview: "Give the shape of the idea",
				standard: "Explain at standard depth",
				rigorous: "Explain rigorously",
			}[p.depth],
		p.examplesFirst !== null &&
			(p.examplesFirst
				? "Start with a concrete example"
				: "Start with the general rule"),
		p.analogyDomains.length &&
			"Draw analogies from " + p.analogyDomains.join(", "),
		p.plainLanguage && "Use plain language",
		p.screenReader && "Describe visuals in text",
		p.captionsPreferred && "Provide captions and transcripts",
		p.dyslexiaFriendlyFont && "Use dyslexia-friendly reading and speech",
		p.reduceMotion && "Reduce motion",
		p.highContrast && "Use higher contrast",
		p.textScale && "Use " + p.textScale + " text",
		p.notes.trim(),
	];
	return clauses
		.filter((v): v is string => typeof v === "string" && !!v)
		.map((v) => (/[.!?]$/.test(v) ? v : v + "."))
		.join(" ");
}

export function LearnerProfileTab({
	store = browserLearnerProfileStore,
	profileStore = browserDeclaredProfileStore,
	onCountsChange,
}: {
	store?: LearnerProfileStore;
	profileStore?: DeclaredProfileStore;
	onCountsChange?: (counts: Record<string, number>) => void;
}) {
	const [stored, setStored] = useState(() => ({
		...profileStore.load(),
		notes: store.load(),
	}));
	const [edits, setEdits] = useState<Partial<DeclaredLearnerProfile>>({});
	const [active, setActive] = useState("profile-identity");
	const [phoneList, setPhoneList] = useState(true);
	const [summaryOpen, setSummaryOpen] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [notice, setNotice] = useState("");
	useEffect(
		() =>
			profileStore.subscribe((next) =>
				setStored({ ...next, notes: store.load() }),
			),
		[profileStore, store],
	);
	useEffect(
		() =>
			store.subscribe((notes) =>
				setStored((previous) => ({ ...previous, notes })),
			),
		[store],
	);
	useEffect(() => {
		const query = window.matchMedia("(min-width: 701px)");
		const sync = () => setSummaryOpen(query.matches);
		sync();
		query.addEventListener("change", sync);
		return () => query.removeEventListener("change", sync);
	}, []);
	const draft = { ...stored, ...edits };
	const count = Object.keys(edits).filter(
		(k) =>
			JSON.stringify(edits[k as keyof typeof edits]) !==
			JSON.stringify(stored[k as keyof typeof edits]),
	).length;
	const save = useCallback(() => {
		const next = { ...profileStore.load(), notes: store.load(), ...edits };
		profileStore.save(next);
		store.save(next.notes);
		setStored({ ...profileStore.load(), notes: store.load() });
		setEdits({});
		setNotice("Profile saved");
	}, [edits, profileStore, store]);
	useSectionStatus("profile", { count, save });
	const answered = new Set(answeredDeclaredProfileFields(draft));
	if (draft.examplesFirst === false) answered.add("examplesFirst");
	const counts: Record<string, number> = {
		"profile-notes": Number(!!draft.notes.trim()),
	};
	for (const [id, fields] of Object.entries(DECLARED_PROFILE_FIELD_GROUPS))
		counts["profile-" + id] = fields.filter((key) => answered.has(key)).length;
	const signature = JSON.stringify(counts);
	useEffect(() => {
		onCountsChange?.(JSON.parse(signature));
	}, [signature, onCountsChange]);
	const props = {
		profile: draft,
		idPrefix: "learner-profile",
		onChange: (update: Partial<DeclaredLearnerProfile>) => {
			setNotice("");
			setEdits((previous) => {
				const next = { ...previous, ...update };
				for (const k of Object.keys(update) as (keyof DeclaredLearnerProfile)[])
					if (JSON.stringify(next[k]) === JSON.stringify(stored[k]))
						delete next[k];
				return next;
			});
		},
	};
	function select(id: string) {
		setActive(id);
		setPhoneList(false);
	}
	const title = LEARNER_PROFILE_SECTIONS.find((s) => s.id === active)!.label;
	const reading = profileReading(draft);
	return (
		<div className="pf-layout" data-list={phoneList}>
			{LEARNER_PROFILE_SECTIONS.map((s) => (
				<span
					key={s.id}
					className="pf-anchor"
					tabIndex={-1}
					id={"settings-section-" + s.id}
					onFocus={() => {
						select(s.id);
						requestAnimationFrame(() =>
							document.getElementById("pf-subheading")?.focus(),
						);
					}}
				/>
			))}
			{profileSearchRows.map(([group, key]) => (
				<span
					className="pf-anchor"
					key={key}
					id={"pf-find-" + key}
					tabIndex={-1}
					onFocus={() => {
						select("profile-" + group);
						requestAnimationFrame(() => {
							const input = document.getElementById(
								key === "notes" ? "learner-profile" : "learner-profile-" + key,
							);
							(
								input?.querySelector<HTMLElement>(
									'[role="radio"][tabindex="0"]',
								) ??
								input ??
								document.getElementById("pf-subheading")
							)?.focus();
						});
					}}
				/>
			))}
			<nav className="pf-outline k-halftone" aria-label="Your profile">
				{LEARNER_PROFILE_SECTIONS.map((s) => (
					<button
						type="button"
						key={s.id}
						aria-current={active === s.id ? "page" : undefined}
						onClick={() => {
							select(s.id);
							if (window.matchMedia("(max-width: 700px)").matches)
								requestAnimationFrame(() =>
									document.getElementById("pf-subheading")?.focus(),
								);
						}}
					>
						{s.label}
						<small>{counts[s.id]}</small>
					</button>
				))}
			</nav>
			<div className="pf-canvas">
				<Button
					variant="ghost"
					className="pf-back"
					onClick={() => {
						setPhoneList(true);
						requestAnimationFrame(() =>
							document
								.querySelector<HTMLButtonElement>(".pf-outline [aria-current]")
								?.focus(),
						);
					}}
				>
					‹ Your profile
				</Button>
				<h4 id="pf-subheading" tabIndex={-1}>
					{active === "profile-pedagogy"
						? "How Keating should teach you"
						: title}
				</h4>
				<p className="pf-help">
					{active === "profile-pedagogy"
						? "These are preferences, not a test. Keating follows them."
						: "Every field is optional."}
				</p>
				{active === "profile-identity" && <IdentityFields {...props} />}
				{active === "profile-language" && <LanguageFields {...props} />}
				{active === "profile-context" && <ContextFields {...props} />}
				{active === "profile-goals" && <GoalFields {...props} showPursuits />}
				{active === "profile-pedagogy" && <PedagogyFields {...props} />}
				{active === "profile-accessibility" && (
					<AccessibilityFields {...props} interfaceReadOnly />
				)}
				{active === "profile-notes" && (
					<label>
						In your own words
						<TextArea
							id="learner-profile"
							value={draft.notes}
							maxLength={Math.min(
								MAX_LEARNER_CONTEXT_LENGTH,
								MAX_DECLARED_NOTES_LENGTH,
							)}
							onChange={(e) => props.onChange({ notes: e.target.value })}
							placeholder="I am learning for… I already know… I learn best with… I am interested in…"
						/>
						<small>
							{draft.notes.length} / {MAX_LEARNER_CONTEXT_LENGTH} characters ·{" "}
							{answered.size} fields filled in
						</small>
					</label>
				)}
			</div>
			<details
				className="pf-context"
				open={summaryOpen}
				onToggle={(e) => setSummaryOpen(e.currentTarget.open)}
			>
				<summary>What Keating is told</summary>
				{reading ? (
					<Prose>
						<p>{reading}</p>
					</Prose>
				) : (
					<EmptyState heading="Nothing filled in yet" />
				)}
				<details>
					<summary>Show exactly what is sent</summary>
					<pre>
						{learnerContextPrompt(draft.notes, draft) ||
							"Nothing filled in yet"}
					</pre>
				</details>
				<p className="pf-privacy" data-glyph-host>
					<KeatingGlyph name="lock" size={13} /> Saved in this browser. Keating
					includes it in requests to your tutor model so it can tailor lessons.
				</p>
				<Button variant="ghost" onClick={() => setConfirming(true)}>
					Clear profile
				</Button>
			</details>
			<footer className="st-unsaved pf-actions">
				<StatusLine tone={count ? "warn" : "ok"}>
					{count
						? `${count} unsaved ${count === 1 ? "change" : "changes"} · they apply on your next message`
						: "Saved · nothing to apply"}
				</StatusLine>
				<Button
					disabled={!count}
					onClick={() => {
						setEdits({});
						setNotice("");
					}}
				>
					Discard
				</Button>
				<Button variant="primary" disabled={!count} onClick={save}>
					Save profile
				</Button>
			</footer>
			<span role="status" className="sr-only">
				{notice}
			</span>
			<ConfirmDialog
				open={confirming}
				title="Clear profile?"
				description="Clear everything you have told Keating about yourself? This can’t be undone."
				confirmLabel="Clear profile"
				cancelLabel="Keep my profile"
				onCancel={() => setConfirming(false)}
				onConfirm={() => {
					profileStore.reset();
					store.reset();
					setStored(defaultDeclaredProfile());
					setEdits({});
					setConfirming(false);
					setNotice("Profile cleared");
				}}
			/>
		</div>
	);
}
