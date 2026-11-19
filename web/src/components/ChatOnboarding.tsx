import { Progress } from "../design-system/charts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type DeclaredLearnerProfile,
	seedCurrentPursuitFromGoal,
} from "@keating/learner-contracts";
import { KeatingBot, type KeatingBotState } from "./KeatingBot";
import { AnkiInterestImport } from "./AnkiInterestImport";
import { ProfileIntakeChat } from "./ProfileIntakeChat";
import { ProfileProposalReview } from "./ProfileProposalReview";
import type { ProfileProposal } from "@keating/learner-contracts";
import { OfflineTutorSettings } from "./OfflineTutorSettings";
import { desktopOfflineBridge } from "../lib/desktop-offline";
import { NOTORGANIC_DEFAULT_MODEL } from "../notorganic-provider";
import { onboardingProfileProperties, useOnboardingAnalytics } from "../lib/onboarding-analytics";
import {
	loadDeclaredProfile,
	saveDeclaredProfile,
} from "../keating/learner-profile-store";
import { Button, Loading, Chip, DefinitionList, Eyebrow, Field, Segmented, TextArea, TextInput } from "../design-system/kit";
import { KeatingGlyph } from "../design-system/glyphs";
import { ShaderSurface } from "../design-system/shaders";
import { motion } from "motion/react";
import { SOFT, useMotionAllowed } from "../design-system/motion";
import { Select } from "./Select";
import { loadModelPrefs } from "../keating/model-prefs";
import { modelKey } from "../lib/model-catalog";
import { STARTER_PROMPTS } from "../keating/starter-prompts";
import "./chat-onboarding.css";

export const CHAT_ONBOARDING_STORAGE_KEY = "keating:onboarding:v1";
type OnboardingStorage = Pick<Storage, "getItem" | "setItem">;
type OnboardingOutcome = "in-progress" | "completed" | "skipped";

function browserStorage(): OnboardingStorage | undefined {
	try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}

function readRecord(storage: OnboardingStorage | undefined): { version: unknown; outcome: unknown; step: unknown } | null {
	try {
		const saved = JSON.parse(storage?.getItem(CHAT_ONBOARDING_STORAGE_KEY) ?? "null");
		return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : null;
	} catch { return null; }
}

/** A v1 record predates the longer flow; finishing it once is still finishing it. */
export function hasCompletedChatOnboarding(storage: OnboardingStorage | undefined = browserStorage()): boolean {
	const saved = readRecord(storage);
	if (!saved || (saved.version !== 1 && saved.version !== 2)) return false;
	return saved.outcome === "completed" || saved.outcome === "skipped";
}

/** Where to resume. Only an unfinished v2 record carries a step; anything else starts at the beginning. */
export function readChatOnboardingStep(storage: OnboardingStorage | undefined = browserStorage()): number {
	return readChatOnboardingResume(storage).step;
}

export type OnboardingAccess = "keating" | "byok" | "offline";
export interface OnboardingResume { step: number; access: OnboardingAccess; mode: IntakeMode }

const ACCESS_CHOICES: readonly OnboardingAccess[] = ["keating", "byok", "offline"];

/**
 * Where to resume, together with the choices that give the position meaning. A step number only
 * identifies a screen within one intake mode, so the record stores the stable step id plus the
 * access and intake choices. Records written before that carry only a numeric step; they resume
 * on the form track with the default access choice.
 */
export function readChatOnboardingResume(storage: OnboardingStorage | undefined = browserStorage()): OnboardingResume {
	const fresh: OnboardingResume = { step: 0, access: "keating", mode: "form" };
	const saved = readRecord(storage) as (ReturnType<typeof readRecord> & { stepId?: unknown; access?: unknown; mode?: unknown }) | null;
	if (!saved || saved.version !== 2 || saved.outcome !== "in-progress") return fresh;
	const mode: IntakeMode = saved.mode === "conversation" ? "conversation" : "form";
	const access = ACCESS_CHOICES.find(choice => choice === saved.access) ?? "keating";
	const numeric = typeof saved.step === "number" && Number.isInteger(saved.step) ? saved.step : 0;
	const oldSteps = mode === "conversation" ? ["welcome", "access", "setup", "identity", "finish"] : LEGACY_STAGES;
	const fallback = oldSteps[Math.min(Math.max(numeric, 0), oldSteps.length - 1)];
	const id = typeof saved.stepId === "string" ? saved.stepId : fallback;
	const stage = ONBOARDING_STEPS.findIndex(item => item.id === (STAGE_FOR_LEGACY[id] ?? id));
	return { step: stage >= 0 ? stage : ONBOARDING_STEPS.findIndex(item => item.id === STAGE_FOR_LEGACY[fallback]), access, mode };
}

/** Outcome, position and timestamp only — never a goal, a name or anything else the learner typed. */
export function markChatOnboarding(outcome: OnboardingOutcome, storage: OnboardingStorage | undefined = browserStorage(), step = 0, position?: { stepId: string; access: OnboardingAccess; mode: IntakeMode }): boolean {
	try {
		if (!storage) return false;
		storage.setItem(CHAT_ONBOARDING_STORAGE_KEY, JSON.stringify({
			version: 2,
			outcome,
			step,
			...(outcome === "in-progress" ? { stepId: ONBOARDING_STEPS[step]?.id } : {}),
			...position,
			completedAt: outcome === "in-progress" ? null : new Date().toISOString(),
		}));
		return true;
	} catch { return false; }
}

export interface ChatOnboardingProps {
	onUseKeating: () => void | Promise<void>;
	/** Starts Not Organic sign-in. Normally navigates away; onboarding resumes on return. */
	onConnectAccount: () => void | Promise<void>;
	/** Whether a Not Organic session already exists. Signed-in learners never see the sign-in step. */
	isSignedIn?: () => Promise<boolean>;
	onChooseModel: () => void | Promise<void>;
	onComplete: (goal?: string) => void;
	onSkip: () => void;
	/** Offered on the last screen; onboarding explains the app, the tour points at it. */
	onStartTour?: () => void;
	/** Tests and stories render a single screen; at runtime the resume position wins. */
	initialStep?: number;
}

interface StepDefinition { id: string; label: string }
export const ONBOARDING_STEPS: StepDefinition[] = [
	{ id: "question", label: "Question" }, { id: "model", label: "Model" },
	{ id: "you", label: "You" }, { id: "ready", label: "Ready" },
];
const LAST_STEP = ONBOARDING_STEPS.length - 1;
const LEGACY_STAGES = ["welcome", "access", "setup", "identity", "learning", "teaching", "accessibility", "finish"];
const STAGE_FOR_LEGACY: Record<string, string> = {
	welcome: "question", access: "model", setup: "model", identity: "you",
	learning: "you", teaching: "you", accessibility: "you", finish: "ready",
};
export type IntakeMode = "form" | "conversation";

/**
 * Fold Anki interests into whatever the conversation already proposed.
 *
 * Both sources land on one card because the learner is reviewing one question —
 * what Keating thinks it knows about them — not two pipelines. An interest a
 * learner already stated is not proposed twice.
 */
export function mergeProposals(
	existing: readonly ProfileProposal[] | null,
	incoming: readonly ProfileProposal[],
): readonly ProfileProposal[] {
	const seen = new Set((existing ?? []).map(proposal => `${proposal.field}:${proposal.value.toLowerCase()}`));
	return Object.freeze([...(existing ?? []), ...incoming.filter(proposal => {
		const key = `${proposal.field}:${proposal.value.toLowerCase()}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	})]);
}

const STEP_BOT_STATES: Record<string, KeatingBotState> = {
	question: "greeting", model: "thinking", you: "listening", ready: "settled",
};
const TITLES: Record<string, string> = {
	question: "What would you like to understand?", model: "How would you like to chat?",
	you: "How should Keating teach you?", ready: "You are set.",
};
const DESCRIPTIONS: Record<string, string> = {
	question: "A starting point, not a contract. It goes into the composer for you to review and send.",
	model: "You can change this later from the header.",
	you: "Preferences, not a test. Keating follows them.",
	ready: "Saved on this device. Change any of it in Settings → Learning.",
};

/** Set just before the sign-in redirect so a return without a session reads as a failed attempt. */
const SIGN_IN_ATTEMPT_KEY = "keating:onboarding-sign-in-attempted";
function sessionFlag(action: "read" | "set" | "clear"): boolean {
	try {
		if (action === "set") sessionStorage.setItem(SIGN_IN_ATTEMPT_KEY, "1");
		else if (action === "clear") sessionStorage.removeItem(SIGN_IN_ATTEMPT_KEY);
		return sessionStorage.getItem(SIGN_IN_ATTEMPT_KEY) === "1";
	} catch { return false; }
}

const LANGUAGE_OPTIONS = [
	"Arabic", "Bengali", "Cantonese", "Dutch", "English", "Farsi", "French", "German", "Greek", "Gujarati", "Hebrew",
	"Hindi", "Indonesian", "Italian", "Japanese", "Korean", "Malay", "Mandarin Chinese", "Polish", "Portuguese",
	"Punjabi", "Romanian", "Russian", "Somali", "Spanish", "Swahili", "Tagalog", "Tamil", "Thai", "Turkish",
	"Ukrainian", "Urdu", "Vietnamese",
] as const;

const TEACHING = [
	{ field: "socraticIntensity", label: "How much should Keating ask before it tells?", options: [
		{value:"light", label:"Mostly explain"}, {value:"balanced", label:"A balance"}, {value:"deep", label:"Keep asking"},
	] },
	{ field: "hintLevel", label: "When you are stuck", options: [
		{value:"minimal", label:"Let me struggle"}, {value:"moderate", label:"Nudge me"}, {value:"generous", label:"Clear hint"},
	] },
	{ field: "tone", label: "Tone", options: [
		{value:"warm", label:"Warm"}, {value:"neutral", label:"Neutral"}, {value:"direct", label:"Direct"}, {value:"playful", label:"Playful"},
	] },
] as const;
const ACCESSIBILITY = [
	["plainLanguage","Plain language"], ["screenReader","Screen reader"], ["captionsPreferred","Captions"],
	["dyslexiaFriendlyFont","Dyslexia-friendly reading and speech"], ["reduceMotion","Reduce motion"], ["highContrast","Higher contrast"],
] as const;

// A fresh chat already uses the hosted default. Reselecting it would open account setup.
function hostedIsDefault() {
	const prefs = loadModelPrefs();
	const hosted = modelKey(NOTORGANIC_DEFAULT_MODEL);
	return [prefs.defaultChatModelKey, prefs.recentModels[0]?.key].every(key => !key || key === hosted);
}

function QuickChoices({ profile, patch }: { profile: DeclaredLearnerProfile; patch: (changes: Partial<DeclaredLearnerProfile>, saveNow?: boolean) => void }) {
	const language = profile.explainInLanguage;
	const listed = LANGUAGE_OPTIONS.find(item => item.toLowerCase() === language.trim().toLowerCase());
	const [custom, setCustom] = useState(!listed && !!language);
	return <div className="ob-fields">
		<div className="ob-pair">
			<Field label="What should Keating call you?"><TextInput autoComplete="given-name" maxLength={80} placeholder="Sam"
				value={profile.preferredName} onChange={event => patch({preferredName: event.target.value})}/></Field>
			<div><Field label="Explain things in"><Select value={custom ? "other" : listed ?? ""} onValueChange={value => {
				setCustom(value === "other"); patch({explainInLanguage: value === "other" ? "" : value});
			}}><option value="">Not answered</option>{LANGUAGE_OPTIONS.map(item => <option key={item}>{item}</option>)}<option value="other">Another language…</option></Select></Field>
			{custom && <TextInput autoFocus aria-label="Explain things in (other)" value={language} maxLength={60} placeholder="Yoruba" onChange={event => patch({explainInLanguage:event.target.value})}/>}</div>
		</div>
		{TEACHING.map(({field,label,options}) => <div key={field}><p className="ob-label">{label} {profile[field] && <button type="button" className="ob-link" aria-label={`Clear ${label}`} onClick={event => {
                event.currentTarget.closest("p")?.nextElementSibling?.querySelector<HTMLButtonElement>("button")?.focus();
                patch({[field]:""});
            }}>Clear</button>}</p>
			<Segmented<string> wide ref={group => {
                // An unanswered radio group still needs one keyboard entry point.
                const first = group?.querySelector<HTMLButtonElement>("button");
                if (first && !profile[field]) first.tabIndex = 0;
            }} label={label} value={profile[field]} options={[...options]} onChange={value => patch({[field]:value})}/></div>)}
		<fieldset><legend>Anything that would make this easier?</legend><div className="ob-chips">
			{ACCESSIBILITY.map(([field,label]) => <Chip key={field} as="button" selected={profile[field]} onClick={() => patch({[field]:!profile[field]}, true)}>{label}</Chip>)}
		</div><Field label="Text size"><Select value={profile.textScale} onValueChange={value => patch({textScale:value as DeclaredLearnerProfile["textScale"]}, true)}>
			<option value="">Not answered</option><option value="default">Default</option><option value="large">Large</option><option value="larger">Larger</option>
		</Select></Field></fieldset>
		<div><Field label="Age range" hint="A range, never a birth date. It helps pick examples and vocabulary — it never changes how much Keating expects of you.">
			<Select value={profile.ageBand} onValueChange={value => patch({ageBand:value as DeclaredLearnerProfile["ageBand"]}, true)}>
				<option value="">Not answered</option>
					<option value="under-13">Under 13</option>
					<option value="13-17">13–17</option>
					<option value="18-24">18–24</option>
					<option value="25-34">25–34</option>
					<option value="35-49">35–49</option>
					<option value="50-64">50–64</option>
					<option value="65-plus">65 or older</option>
					<option value="prefer-not-to-say">Prefer not to say</option>
							</Select></Field></div>
		{profile.ageBand === "under-13" && <p role="note">Keating is built for independent study. If you are under 13, please set it up with a parent, guardian or teacher. Optional analytics stay switched off for this profile.</p>}
		<small>Pronouns, schedule and interests are in Settings → Learning.</small>
	</div>;
}

export function ChatOnboarding({ onUseKeating, onConnectAccount, isSignedIn, onChooseModel, onComplete, onSkip, onStartTour, initialStep }: ChatOnboardingProps) {
	const [resume] = useState(() => initialStep === undefined ? readChatOnboardingResume() : null);
	const [step, setStep] = useState(() => initialStep ?? resume?.step ?? 0);
	const [access, setAccess] = useState<OnboardingAccess>(() => resume?.access === "offline" && !desktopOfflineBridge() ? "keating" : resume?.access ?? "keating");
	const [profile, setProfile] = useState<DeclaredLearnerProfile>(() => loadDeclaredProfile());
	const [busy, setBusy] = useState<"select" | "open" | "sign" | null>(null);
	const pending = busy !== null;
	const awaitingSignIn = useRef(sessionFlag("read") || resume?.step === 1);
	const [error, setError] = useState("");
	const title = useRef<HTMLHeadingElement>(null);
	const finished = useRef(false);
	const [mode, setMode] = useState<IntakeMode>(() => resume?.mode ?? "form");
	const [proposals, setProposals] = useState<readonly ProfileProposal[] | null>(null);
	const [interviewDone, setInterviewDone] = useState(false);
	const steps = ONBOARDING_STEPS;
	const lastStep = steps.length - 1;
	const current = steps[step] ?? steps[0];
	const track = useOnboardingAnalytics();
	const motionAllowed = useMotionAllowed();
	// null while checking. Without a checker (stories) the step is shown but never gated.
	const [signedIn, setSignedIn] = useState<boolean | null>(isSignedIn ? null : false);
	const [signInFailed] = useState(() => sessionFlag("read"));

	useEffect(() => {
		if (!isSignedIn) return;
		let live = true;
		isSignedIn().then(value => { if (live) setSignedIn(value); }, () => { if (live) setSignedIn(false); });
		return () => { live = false; };
	}, [isSignedIn]);
	useEffect(() => { title.current?.focus({ preventScroll: true }); }, [step]);

	// One view event per screen reached, positions and ids only.
	useEffect(() => {
		track("onboarding_viewed", { step_id: current.id, step_index: step, step_count: steps.length });
	}, [current.id, step, track]);

	function patch(changes: Partial<DeclaredLearnerProfile>, saveNow = false) {
		const updated = { ...profile, ...changes };
		setProfile(updated);
		if (saveNow) {
			try { saveDeclaredProfile(updated); } catch { /* storage can be blocked */ }
		}
	}

	/** Answers survive a reload even if the learner never reaches the end. */
	const persist = useCallback((nextStep: number) => {
		try { saveDeclaredProfile(profile); } catch { /* a blocked store must not trap anyone mid-flow */ }
		markChatOnboarding("in-progress", browserStorage(), nextStep, { stepId: steps[nextStep]?.id ?? current.id, access, mode });
	}, [profile, steps, current.id, access, mode]);

	function skip() {
		if (finished.current) return;
		finished.current = true;
		const finalProfile = seedCurrentPursuitFromGoal(profile);
		try { saveDeclaredProfile(finalProfile); } catch { /* ignore */ }
		markChatOnboarding("skipped", browserStorage(), step);
		track("onboarding_skipped", { step_id: current.id, step_index: step, ...onboardingProfileProperties(finalProfile) });
		onSkip();
	}
	function finish() {
		if (finished.current) return;
		finished.current = true;
		const finalProfile = seedCurrentPursuitFromGoal(profile);
		try { saveDeclaredProfile(finalProfile); } catch { /* ignore */ }
		markChatOnboarding("completed", browserStorage(), LAST_STEP);
		track("onboarding_completed", { step_count: steps.length, intake_mode: mode, ...onboardingProfileProperties(finalProfile) });
		onComplete(finalProfile.goalText.trim() || undefined);
	}
	async function openSetup(action: () => void | Promise<void>) {
		setBusy("open"); setError("");
		try { await action(); }
		catch { setError("That setup couldn’t open. Try again, or continue to chat and set it up later."); }
		finally { setBusy(null); }
	}
	function goTo(nextStep: number) {
		if (finished.current) return;
		persist(nextStep);
		setStep(nextStep);
	}
	async function next(skipped = false) {
		if (pending) return;
		setError("");
		if (current.id === "model" && access === "keating" && !(skipped && hostedIsDefault())) {
			setBusy("select");
			try { await onUseKeating(); }
			catch { setError("Keating’s model couldn’t be selected. Try again, or choose your own provider."); return; }
			finally { setBusy(null); }
		}
		track("onboarding_step_completed", { step_id: current.id, step_index: step, skipped });
		goTo(Math.min(step + 1, lastStep));
	}
	async function signIn() {
		// Save the position first: sign-in leaves the page and onboarding resumes here.
		persist(step);
		sessionFlag("set");
		awaitingSignIn.current = true;
		setBusy("sign"); setError("");
		try { await onConnectAccount(); if (isSignedIn && await isSignedIn()) setSignedIn(true); }
		catch { sessionFlag("clear"); setError("Sign-in couldn’t open. Try again, or go back and choose your own provider."); }
		finally { setBusy(null); }
	}

	// Consume the automatic advance once. Back must still let a signed-in learner choose another model.
	useEffect(() => {
		if (current.id !== "model" || signedIn !== true || access !== "keating" || !awaitingSignIn.current || pending) return;
		awaitingSignIn.current = false;
		sessionFlag("clear");
		void next();
	}, [current.id, signedIn, access, pending]);

	const interviewing = current.id === "you" && mode === "conversation" && !interviewDone;
	const teaching = TEACHING.flatMap(({field, options}) => options.find(option => option.value === profile[field])?.label ?? []);

	return <section className="chat-onboarding" role="dialog" aria-modal="false" aria-labelledby="chat-onboarding-title" aria-describedby="chat-onboarding-description" onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); skip(); } }}>
		<header className="ob-top"><div className="ob-brand" data-glyph-host><KeatingGlyph name="kmark" label="Keating" size={24}/><span>Welcome to Keating</span></div>
			<div className="ob-step-group"><Progress label={`Onboarding: ${step} completed steps`} done={step} total={4}/><ol className="ob-steps" aria-label="Onboarding stages">{steps.map((item, index) =>
				<li key={item.id} aria-current={index === step ? "step" : undefined} aria-label={`Step ${index + 1} of 4: ${item.label}`}><b>{index + 1}</b><span>{item.label}</span></li>)}</ol></div>
			<Button variant="ghost" onClick={skip} aria-label="Go straight to chat"><span className="ob-long">Go straight to chat</span><span className="ob-short">Skip</span></Button></header>
		<div className="ob-layout" data-ready={current.id === "ready"}><aside className="ob-hero"><ShaderSurface effect="field"/>
			<div className="ob-hero-copy"><KeatingBot variant="body" size={92} state={STEP_BOT_STATES[current.id]} label=""/><h2>Keating teaches by asking.</h2>
			<p>Rather than hand you answers, Keating works through a question with you, then checks what stuck.</p></div></aside>
		<div className="ob-main"><motion.div className="ob-stage" key={current.id} initial={motionAllowed ? { y: 8 } : false} animate={{ y: 0 }} transition={motionAllowed ? SOFT : { duration: 0 }}>
		{current.id === "ready" && <button type="button" className="ob-link ob-revise" onClick={() => {setError("");goTo(step-1);}}>Back</button>}
        <Eyebrow>{step + 1} of 4 · {step === 0 ? "Your question" : current.label}</Eyebrow>
		{current.id === "ready" && <KeatingBot state={STEP_BOT_STATES.ready} size={52} label=""/>}
		<h2 ref={title} tabIndex={-1} id="chat-onboarding-title">{current.id === "ready" && profile.preferredName.trim() ? `You are set, ${profile.preferredName.trim()}.` : TITLES[current.id]}</h2>
		<p id="chat-onboarding-description">{DESCRIPTIONS[current.id]}</p>
			{current.id === "question" && <div className="chat-onboarding__doors">
				<TextArea aria-labelledby="chat-onboarding-title" rows={3} maxLength={1000} value={profile.goalText}
					placeholder="I want to understand recursion well enough to explain it to someone else."
					onChange={event => patch({ goalText: event.target.value })}/>
				<div className="ob-chips"><span>or try</span>{STARTER_PROMPTS.filter(prompt => ["medicine","civics","biology"].includes(prompt.domain)).map(prompt =>
					<Chip as="button" key={prompt.domain} onClick={() => patch({ goalText: prompt.text })}>{prompt.text}</Chip>)}</div>
				<p className="chat-onboarding__doors-ask">How should Keating get to know you?</p>
				<div>
					{/* Neither door is the fallback. The form is the default only because
					    it works with no model configured and no microphone. */}
					<button type="button" className="chat-onboarding__door" aria-pressed={mode === "form"} onClick={() => setMode("form")}>
						<strong>A few quick choices</strong>
						<span>One screen. Everything on it is optional.</span>
					</button>
					<button type="button" className="chat-onboarding__door" aria-pressed={mode === "conversation"} onClick={() => setMode("conversation")}>
						<strong>Talk it through</strong>
						<span>Four open questions, typed or spoken. I read your answers back before keeping anything.</span>
					</button>
				</div>
			</div>}

			{current.id === "model" && <fieldset className="ob-models" disabled={pending}>
				<legend className="ob-sr">Model access</legend>
				{ACCESS_CHOICES.filter(choice => choice !== "offline" || desktopOfflineBridge()).map(choice => <div key={choice} className="ob-option" data-selected={access === choice}>
					<label><input type="radio" name="onboarding-access" value={choice} checked={access === choice}
						onChange={() => { setAccess(choice); setError(""); }}/>
						<span><strong>{{keating:"Use Keating", byok:"Bring your own key", offline:"Use an offline tutor"}[choice]}</strong>
						<small>{{keating:`${NOTORGANIC_DEFAULT_MODEL.name} · Hosted · Needs an account`, byok:"Your provider, your choice of model", offline:"Optional 1.55 GB download · No account needed"}[choice]}</small></span></label>
					{choice === "keating" && (signedIn === null ? <Loading className="ob-account" size="inline" label="Checking your account…"/> : <small className="ob-account" role="status">{signedIn ? "Signed in" : "Not signed in yet"}</small>)}
                    {access === choice && <div className="ob-setup">
						{choice === "keating" ? <>
							{signedIn !== true && <Button busy={busy === "sign"} variant="primary" disabled={signedIn === null || pending} onClick={() => void signIn()}>{busy === "sign" ? "Opening sign-in…" : "Sign in or create an account"}</Button>}

							{signedIn === false && signInFailed && !error && <p role="alert">Sign-in didn’t finish, so you’re not signed in yet. Try again, or choose your own provider.</p>}
							{signedIn === false && <small>Keating asks again when you send your first message.</small>}
						</> : <>{choice === "offline" && <OfflineTutorSettings/>}
							<Button variant="ghost" busy={busy === "open"} onClick={() => void openSetup(onChooseModel)}>{busy === "open" ? "Opening…" : choice === "offline" ? "Choose the offline model" : "Choose a model and provider"}</Button></>}
					</div>}
				</div>)}
			</fieldset>}
			{current.id === "you" && mode === "form" && <QuickChoices profile={profile} patch={patch}/>}
			{interviewing && <ProfileIntakeChat onUseForm={() => setMode("form")} onDone={result => {
				patch(result.verbatim, true);
				setProposals(previous => mergeProposals(previous, result.proposals));
				setInterviewDone(true);
			}}/>}
			{current.id === "you" && !interviewing && <>
				{mode === "conversation" && !proposals?.length && <div><strong>I did not want to guess.</strong>
					<p>Nothing in those answers was clear enough for me to propose, so I have kept none of it. You can fill the form instead, or carry on — I will learn as we talk.</p></div>}
				{mode === "conversation" && <button className="ob-link" type="button" onClick={() => setMode("form")}>Fill the form instead</button>}
				<details><summary className="ob-link">Use Anki? Bring your decks</summary>
					<AnkiInterestImport onImported={incoming => setProposals(previous => mergeProposals(previous, incoming))}/></details>
			</>}
			{current.id === "ready" && <>
				<DefinitionList items={[
					{term:"Model", detail:access === "keating" ? NOTORGANIC_DEFAULT_MODEL.name : access === "byok" ? "Bring your own key" : "Offline tutor"},
					...(profile.explainInLanguage ? [{term:"Explains in",detail:profile.explainInLanguage}] : []),
					...(teaching.length ? [{term:"Teaching",detail:teaching.join(" · ")}] : []),
				]}/>
				{proposals && proposals.length > 0 && <ProfileProposalReview proposals={proposals}
					heading={proposals.every(item => item.source === "anki-import") ? "From your decks." : "Here is what I picked up."}
					onDismiss={() => setProposals(null)} onApply={(_accepted, changes) => {
						patch(changes.interests ? {...changes, interests:[...new Set([...profile.interests, ...changes.interests])]} : changes, true);
						setProposals(null);
					}}/>}
				{profile.goalText.trim() && <div className="ob-preview k-grid" data-glyph-host><span>Your question is waiting in the composer</span><TextArea aria-label="Your first message" readOnly rows={2} value={profile.goalText}/><div aria-hidden="true"><KeatingGlyph name="clip"/><KeatingGlyph name="mic"/><KeatingGlyph name="send"/></div></div>}
			</>}

			{error && <p className="chat-onboarding__error" role="alert">{error}</p>}
		</motion.div>
		<footer className="ob-footer">
			{step === 0 ? <small className="ob-private" data-glyph-host><KeatingGlyph name="lock"/>Stored only in this browser</small> :
				current.id !== "ready" && <Button variant="line" disabled={pending} onClick={() => { setError(""); goTo(step - 1); }}>Back</Button>}
			{current.id === "model" && access === "keating" && signedIn !== true && <button className="ob-link" type="button" disabled={pending} onClick={() => void next(true)}>Skip sign-in for now</button>}
			{current.id === "you" && mode === "form" && <button className="ob-link" type="button" onClick={() => setMode("conversation")}>Talk it through instead</button>}
			{current.id === "ready" && onStartTour && <Button variant="line" onClick={() => { finish(); onStartTour(); }}>Show me around first</Button>}
			{!interviewing && (step === lastStep ? <Button className="ob-primary" variant="primary" onClick={finish}>Start chatting</Button> :
				<Button className="ob-primary" variant="primary" busy={busy === "select"} disabled={pending} onClick={() => void next()}>{busy === "select" ? "Selecting…" : "Continue"}<KeatingGlyph name="right"/></Button>)}
		</footer></div></div>
	</section>;
}
