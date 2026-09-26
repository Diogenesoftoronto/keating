import { useCallback, useEffect, useRef, useState } from "react";
import {
	type DeclaredLearnerProfile,
	type DeclaredProfileGroup,
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
	markDeclaredProfileGroupSkipped,
	saveDeclaredProfile,
} from "../keating/learner-profile-store";
import {
	AccessibilityFields,
	ContextFields,
	GoalFields,
	IdentityFields,
	LanguageFields,
	PedagogyFields,
} from "./profile/ProfileFieldGroups";
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
	const saved = readRecord(storage);
	if (!saved || saved.version !== 2 || saved.outcome !== "in-progress") return 0;
	const step = typeof saved.step === "number" && Number.isInteger(saved.step) ? saved.step : 0;
	return Math.min(Math.max(step, 0), ONBOARDING_STEPS.length - 1);
}

/** Outcome, position and timestamp only — never a goal, a name or anything else the learner typed. */
export function markChatOnboarding(outcome: OnboardingOutcome, storage: OnboardingStorage | undefined = browserStorage(), step = 0): boolean {
	try {
		if (!storage) return false;
		storage.setItem(CHAT_ONBOARDING_STORAGE_KEY, JSON.stringify({
			version: 2,
			outcome,
			step,
			completedAt: outcome === "in-progress" ? null : new Date().toISOString(),
		}));
		return true;
	} catch { return false; }
}

export interface ChatOnboardingProps {
	onUseKeating: () => void | Promise<void>;
	onConnectAccount: () => void | Promise<void>;
	onChooseModel: () => void | Promise<void>;
	onComplete: (goal?: string) => void;
	onSkip: () => void;
	/** Offered on the last screen; onboarding explains the app, the tour points at it. */
	onStartTour?: () => void;
	/** Tests and stories render a single screen; at runtime the resume position wins. */
	initialStep?: number;
}

interface StepDefinition {
	id: string;
	label: string;
	/** Profile steps are individually skippable and record that they were passed over. */
	group?: DeclaredProfileGroup;
}

export const ONBOARDING_STEPS: StepDefinition[] = [
	{ id: "welcome", label: "Welcome" },
	{ id: "access", label: "Model access" },
	{ id: "setup", label: "Setup" },
	{ id: "identity", label: "About you", group: "identity" },
	{ id: "learning", label: "Your learning", group: "goals" },
	{ id: "teaching", label: "How to teach you", group: "pedagogy" },
	{ id: "accessibility", label: "Accessibility", group: "accessibility" },
	{ id: "finish", label: "You are set" },
];

const LAST_STEP = ONBOARDING_STEPS.length - 1;

/** Which door the learner chose into their own profile. Both end in the same place. */
export type IntakeMode = "form" | "conversation";

/**
 * The conversational door answers the four profile steps in one screen, so it
 * shows a shorter track. The two arrays agree on every index up to `identity`,
 * which is where the doors diverge — so switching between them mid-flow cannot
 * land the learner on a different question than the one they were looking at.
 */
const CONVERSATION_STEP_IDS = new Set(["learning", "teaching", "accessibility"]);
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

export function onboardingStepsFor(mode: IntakeMode): readonly StepDefinition[] {
	return mode === "conversation" ? ONBOARDING_STEPS.filter(step => !CONVERSATION_STEP_IDS.has(step.id)) : ONBOARDING_STEPS;
}

/**
 * The mascot reacts to where the learner is rather than idling through all eight
 * steps. Setup is the one step that waits on a dialog, so it stays on `loading`.
 */
const STEP_BOT_STATES: Record<string, KeatingBotState> = {
	welcome: "greeting",
	access: "thinking",
	setup: "loading",
	identity: "listening",
	learning: "understanding",
	teaching: "reading",
	accessibility: "connecting",
	finish: "settled",
};

const TITLES: Record<string, string> = {
	welcome: "Keating teaches by asking.",
	identity: "Tell Keating who it is talking to.",
	learning: "What would you like to understand?",
	teaching: "How should Keating teach you?",
	accessibility: "Anything that would make this easier?",
	finish: "You are set.",
};

const DESCRIPTIONS: Record<string, string> = {
	welcome: "Rather than hand you answers, Keating works through a question with you — then checks what stuck. Ask it anything in the composer at the bottom; it can pull up diagrams, quizzes and plans beside the conversation as you go.",
	identity: "All optional, all stored only in this browser, and all changeable later in Settings → Learning.",
	learning: "Just a starting point for today — not a commitment. You can change direction whenever you like, and Keating follows what you actually ask about. We will put this in the composer for you to review and send.",
	teaching: "These are preferences, not a test. Keating follows them.",
	accessibility: "Keating treats these as requirements, not suggestions.",
	finish: "Your profile is saved on this device. Change any of it in Settings → Learning → Your profile.",
};

/** Non-modal setup so account and model dialogs can open without competing focus traps. */
export function ChatOnboarding({ onUseKeating, onConnectAccount, onChooseModel, onComplete, onSkip, onStartTour, initialStep }: ChatOnboardingProps) {
	const [step, setStep] = useState(() => initialStep ?? readChatOnboardingStep());
	const [access, setAccess] = useState<"keating" | "byok" | "offline">("keating");
	const [profile, setProfile] = useState<DeclaredLearnerProfile>(() => loadDeclaredProfile());
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const title = useRef<HTMLHeadingElement>(null);
	const finished = useRef(false);
	const [mode, setMode] = useState<IntakeMode>("form");
	const [proposals, setProposals] = useState<readonly ProfileProposal[] | null>(null);
	const steps = onboardingStepsFor(mode);
	const lastStep = steps.length - 1;
	const current = steps[step] ?? steps[0];
	const track = useOnboardingAnalytics();

	useEffect(() => { title.current?.focus({ preventScroll: true }); }, [step]);

	// One view event per screen reached, positions and ids only.
	useEffect(() => {
		track("onboarding_viewed", { step_id: current.id, step_index: step, step_count: steps.length });
	}, [current.id, step, track]);

	const patch = useCallback((next: Partial<DeclaredLearnerProfile>) => setProfile((value) => ({ ...value, ...next })), []);

	/** Answers survive a reload even if the learner never reaches the end. */
	const persist = useCallback((nextStep: number) => {
		try { saveDeclaredProfile(profile); } catch { /* a blocked store must not trap anyone mid-flow */ }
		markChatOnboarding("in-progress", browserStorage(), nextStep);
	}, [profile]);

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
		setPending(true); setError("");
		try { await action(); }
		catch { setError("That setup couldn’t open. Try again, or continue to chat and set it up later."); }
		finally { setPending(false); }
	}
	function goTo(nextStep: number) {
		persist(nextStep);
		if (!finished.current) setStep(nextStep);
	}
	function skipStep() {
		if (current.group) markDeclaredProfileGroupSkipped(current.group);
		track("onboarding_step_completed", { step_id: current.id, step_index: step, skipped: true });
		setError("");
		goTo(Math.min(step + 1, lastStep));
	}
	async function next() {
		if (pending) return;
		setError("");
		if (current.id === "access" && access === "keating") {
			setPending(true);
			try { await onUseKeating(); }
			catch { setError("Keating’s model couldn’t be selected. Try again, or choose your own provider."); return; }
			finally { setPending(false); }
		}
		track("onboarding_step_completed", { step_id: current.id, step_index: step, skipped: false });
		goTo(Math.min(step + 1, lastStep));
	}

	const setupTitle = access === "keating" ? "Make yourself at home." : access === "offline" ? "Set up your offline tutor." : "Connect your model.";
	const setupDescription = access === "keating"
		? `${NOTORGANIC_DEFAULT_MODEL.name} is selected. Connect or create a Not Organic account to use Keating’s hosted model.`
		: access === "offline"
			? "Download the model once, then chat on this device without an account or internet connection."
			: "Choose a model and add your provider key. A Not Organic account isn’t required.";
	const groupProps = { profile, onChange: patch, idPrefix: "onboarding" };

	return <section className="chat-onboarding" role="dialog" aria-modal="false" aria-labelledby="chat-onboarding-title" aria-describedby="chat-onboarding-description" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); skip(); } }}>
		<header className="chat-onboarding__top"><span>Welcome to Keating</span><button type="button" className="chat-onboarding__skip" onClick={skip}>Go straight to chat</button></header>
		<div className="chat-onboarding__intro">
			<KeatingBot size={88} state={STEP_BOT_STATES[current.id] ?? "idle"} label="" />
			<div className="chat-onboarding__progress">
				<p className="chat-onboarding__progress-label">{step + 1} of {steps.length} · {current.label}</p>
				{/* Decorative: the sentence above already states the position for screen readers. */}
				<ol className="chat-onboarding__track" aria-hidden="true">
					{steps.map((definition, index) => <li key={definition.id} data-state={index < step ? "done" : index === step ? "current" : "ahead"} />)}
				</ol>
			</div>
		</div>
		<h2 ref={title} tabIndex={-1} id="chat-onboarding-title">{current.id === "access" ? "How would you like to chat?" : current.id === "setup" ? setupTitle : TITLES[current.id]}</h2>
		<p id="chat-onboarding-description">{current.id === "access" ? "Choose how to run your model. You can change this later." : current.id === "setup" ? setupDescription : DESCRIPTIONS[current.id]}</p>
		<div className="chat-onboarding__step" key={current.id}>
			{current.id === "welcome" && <ul className="chat-onboarding__tips">
				<li><strong>The composer</strong> at the bottom is where you ask. Plain questions work best.</li>
				<li><strong>The side panel</strong> opens on its own when Keating draws a diagram, sets a quiz or writes a plan.</li>
				<li><strong>Sessions</strong> in the left rail keep each subject separate, and Keating remembers what you covered.</li>
				<li><strong>Settings → Learning</strong> is where you change your profile, the teacher’s persona and voice.</li>
			</ul>}
			{current.id === "welcome" && <div className="chat-onboarding__doors">
				<p className="chat-onboarding__doors-ask">First, how should I get to know you?</p>
				<div>
					{/* Neither door is the fallback. The form is the default only because
					    it works with no model configured and no microphone. */}
					<button type="button" className="chat-onboarding__door" aria-pressed={mode === "form"} onClick={() => setMode("form")}>
						<strong>Fill a short form</strong>
						<span>Four screens of questions, all skippable.</span>
					</button>
					<button type="button" className="chat-onboarding__door" aria-pressed={mode === "conversation"} onClick={() => setMode("conversation")}>
						<strong>Talk it through</strong>
						<span>Four open questions, typed or spoken. I read your answers back before keeping anything.</span>
					</button>
				</div>
			</div>}

			{current.id === "access" && <fieldset className="chat-onboarding__access" disabled={pending}>
				<legend>Model access</legend>
				<label><input type="radio" name="onboarding-access" value="keating" checked={access === "keating"} onChange={() => { setAccess("keating"); setError(""); }} /><span><strong>Use Keating</strong><span>{NOTORGANIC_DEFAULT_MODEL.name} · Default</span></span></label>
				<label><input type="radio" name="onboarding-access" value="byok" checked={access === "byok"} onChange={() => { setAccess("byok"); setError(""); }} /><span><strong>Bring your own key</strong><span>Your provider, your choice of model</span></span></label>
				{desktopOfflineBridge() && <label><input type="radio" name="onboarding-access" value="offline" checked={access === "offline"} onChange={() => { setAccess("offline"); setError(""); }} /><span><strong>Use an offline tutor</strong><span>Optional 1.55 GB download · No account needed</span></span></label>}
			</fieldset>}
			{current.id === "setup" && access === "keating" && <button type="button" className="chat-onboarding__primary" disabled={pending} onClick={() => void openSetup(onConnectAccount)}>{pending ? "Opening…" : "Connect or create an account"}</button>}
			{current.id === "setup" && access === "byok" && <button type="button" className="chat-onboarding__primary" disabled={pending} onClick={() => void openSetup(onChooseModel)}>{pending ? "Opening…" : "Choose a model and provider"}</button>}
			{current.id === "setup" && access === "offline" && <><OfflineTutorSettings /><button type="button" className="chat-onboarding__secondary" disabled={pending} onClick={() => void openSetup(onChooseModel)}>Choose the offline model</button></>}
			{current.id === "identity" && mode === "form" && <div className="chat-onboarding__fields"><IdentityFields {...groupProps} /><LanguageFields {...groupProps} /></div>}

			{/* Offered on the identity step in either door: the collection says what
			    the learner studies regardless of how they chose to answer. It is never
			    shown mid-conversation, where the thread owns the screen. */}
			{current.id === "identity" && (mode === "form" || proposals !== null) && <AnkiInterestImport
				onImported={incoming => setProposals(current => mergeProposals(current, incoming))}
			/>}

			{/* The form is still on screen, so applying here fills it rather than moving on. */}
			{current.id === "identity" && mode === "form" && proposals !== null && proposals.length > 0 && <ProfileProposalReview
				proposals={proposals}
				heading="From your decks."
				onDismiss={() => setProposals(null)}
				onApply={(_accepted, profilePatch) => { patch(profilePatch); setProposals(null); }}
			/>}

			{current.id === "identity" && mode === "conversation" && proposals?.length === 0 && <div className="chat-onboarding__doors">
				<p className="chat-onboarding__doors-ask">I did not want to guess.</p>
				<p>Nothing in those answers was clear enough for me to propose, so I have kept none of it. You can fill the form instead, or carry on — I will learn as we talk.</p>
				<button type="button" className="chat-onboarding__secondary" onClick={() => { setProposals(null); setMode("form"); }}>Fill the form instead</button>
			</div>}

			{current.id === "identity" && mode === "conversation" && proposals?.length !== 0 && (proposals === null
				? <ProfileIntakeChat
					onUseForm={() => setMode("form")}
					onDone={result => {
						// Free text the learner wrote themselves is theirs already and needs
						// no review; only what was inferred goes to the card.
						patch(result.verbatim);
						setProposals(result.proposals);
					}}
				/>
				: <ProfileProposalReview
					proposals={proposals}
					heading="Here is what I picked up."
					onDismiss={() => { setProposals(null); goTo(Math.min(step + 1, lastStep)); }}
					onApply={(_accepted, profilePatch) => { patch(profilePatch); goTo(Math.min(step + 1, lastStep)); }}
				/>)}
			{current.id === "learning" && <div className="chat-onboarding__fields"><GoalFields {...groupProps} /><ContextFields {...groupProps} /></div>}
			{current.id === "teaching" && <div className="chat-onboarding__fields"><PedagogyFields {...groupProps} /></div>}
			{current.id === "accessibility" && <div className="chat-onboarding__fields"><AccessibilityFields {...groupProps} /></div>}
			{current.id === "finish" && onStartTour && <button type="button" className="chat-onboarding__secondary" onClick={() => { finish(); onStartTour(); }}>Show me around first</button>}
			{error && <p className="chat-onboarding__error" role="alert">{error}</p>}
		</div>
		<footer className="chat-onboarding__navigation">
			<div>{step > 0 && <button type="button" className="chat-onboarding__secondary" disabled={pending} onClick={() => { setError(""); goTo(step - 1); }}>Back</button>}</div>
			<div className="chat-onboarding__advance">
				{current.group && <button type="button" className="chat-onboarding__skip" disabled={pending} onClick={skipStep}>Skip this</button>}
				{!(current.id === "identity" && mode === "conversation" && proposals === null) && (step < lastStep
					? <button type="button" className="chat-onboarding__secondary" disabled={pending} onClick={() => void next()}>{pending && current.id === "access" ? "Selecting…" : "Next"}</button>
					: <button type="button" className="chat-onboarding__primary" onClick={finish}>Start chatting</button>)}
			</div>
		</footer>
	</section>;
}
