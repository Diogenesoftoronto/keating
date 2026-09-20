import { useCallback, useEffect, useRef, useState } from "react";
import {
	type DeclaredLearnerProfile,
	type DeclaredProfileGroup,
	seedCurrentPursuitFromGoal,
} from "@keating/learner-contracts";
import { KeatingBot } from "./KeatingBot";
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
	const current = ONBOARDING_STEPS[step] ?? ONBOARDING_STEPS[0];
	const track = useOnboardingAnalytics();

	useEffect(() => { title.current?.focus({ preventScroll: true }); }, [step]);

	// One view event per screen reached, positions and ids only.
	useEffect(() => {
		track("onboarding_viewed", { step_id: current.id, step_index: step, step_count: ONBOARDING_STEPS.length });
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
		track("onboarding_completed", { step_count: ONBOARDING_STEPS.length, ...onboardingProfileProperties(finalProfile) });
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
		goTo(Math.min(step + 1, LAST_STEP));
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
		goTo(Math.min(step + 1, LAST_STEP));
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
		<div className="chat-onboarding__intro"><KeatingBot size={88} state="idle" label="" /><p className="chat-onboarding__progress">{step + 1} of {ONBOARDING_STEPS.length} · {current.label}</p></div>
		<h2 ref={title} tabIndex={-1} id="chat-onboarding-title">{current.id === "access" ? "How would you like to chat?" : current.id === "setup" ? setupTitle : TITLES[current.id]}</h2>
		<p id="chat-onboarding-description">{current.id === "access" ? "Choose how to run your model. You can change this later." : current.id === "setup" ? setupDescription : DESCRIPTIONS[current.id]}</p>
		<div className="chat-onboarding__step">
			{current.id === "welcome" && <ul className="chat-onboarding__tips">
				<li><strong>The composer</strong> at the bottom is where you ask. Plain questions work best.</li>
				<li><strong>The side panel</strong> opens on its own when Keating draws a diagram, sets a quiz or writes a plan.</li>
				<li><strong>Sessions</strong> in the left rail keep each subject separate, and Keating remembers what you covered.</li>
				<li><strong>Settings → Learning</strong> is where you change your profile, the teacher’s persona and voice.</li>
			</ul>}
			{current.id === "access" && <fieldset className="chat-onboarding__access" disabled={pending}>
				<legend>Model access</legend>
				<label><input type="radio" name="onboarding-access" value="keating" checked={access === "keating"} onChange={() => { setAccess("keating"); setError(""); }} /><span><strong>Use Keating</strong><span>{NOTORGANIC_DEFAULT_MODEL.name} · Default</span></span></label>
				<label><input type="radio" name="onboarding-access" value="byok" checked={access === "byok"} onChange={() => { setAccess("byok"); setError(""); }} /><span><strong>Bring your own key</strong><span>Your provider, your choice of model</span></span></label>
				{desktopOfflineBridge() && <label><input type="radio" name="onboarding-access" value="offline" checked={access === "offline"} onChange={() => { setAccess("offline"); setError(""); }} /><span><strong>Use an offline tutor</strong><span>Optional 1.55 GB download · No account needed</span></span></label>}
			</fieldset>}
			{current.id === "setup" && access === "keating" && <button type="button" className="chat-onboarding__primary" disabled={pending} onClick={() => void openSetup(onConnectAccount)}>{pending ? "Opening…" : "Connect or create an account"}</button>}
			{current.id === "setup" && access === "byok" && <button type="button" className="chat-onboarding__primary" disabled={pending} onClick={() => void openSetup(onChooseModel)}>{pending ? "Opening…" : "Choose a model and provider"}</button>}
			{current.id === "setup" && access === "offline" && <><OfflineTutorSettings /><button type="button" className="chat-onboarding__secondary" disabled={pending} onClick={() => void openSetup(onChooseModel)}>Choose the offline model</button></>}
			{current.id === "identity" && <div className="chat-onboarding__fields"><IdentityFields {...groupProps} /><LanguageFields {...groupProps} /></div>}
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
				{step < LAST_STEP
					? <button type="button" className="chat-onboarding__secondary" disabled={pending} onClick={() => void next()}>{pending && current.id === "access" ? "Selecting…" : "Next"}</button>
					: <button type="button" className="chat-onboarding__primary" onClick={finish}>Start chatting</button>}
			</div>
		</footer>
	</section>;
}
