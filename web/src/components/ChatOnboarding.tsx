import { useEffect, useRef, useState } from "react";
import { KeatingBot } from "./KeatingBot";
import { OfflineTutorSettings } from "./OfflineTutorSettings";
import { desktopOfflineBridge } from "../lib/desktop-offline";
import "./chat-onboarding.css";

export const CHAT_ONBOARDING_STORAGE_KEY = "keating:onboarding:v1";
type OnboardingStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): OnboardingStorage | undefined {
	try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}

export function hasCompletedChatOnboarding(storage: OnboardingStorage | undefined = browserStorage()): boolean {
	try {
		const saved = JSON.parse(storage?.getItem(CHAT_ONBOARDING_STORAGE_KEY) ?? "null");
		return saved?.version === 1 && (saved.outcome === "completed" || saved.outcome === "skipped");
	} catch { return false; }
}

/** Only explicit finish/skip actions call this; goals and account details are never stored here. */
export function markChatOnboarding(outcome: "completed" | "skipped", storage: OnboardingStorage | undefined = browserStorage()): boolean {
	try {
		if (!storage) return false;
		storage.setItem(CHAT_ONBOARDING_STORAGE_KEY, JSON.stringify({ version: 1, outcome, completedAt: new Date().toISOString() }));
		return true;
	} catch { return false; }
}

export interface ChatOnboardingProps {
	onUseKeating: () => void | Promise<void>;
	onConnectAccount: () => void | Promise<void>;
	onChooseModel: () => void | Promise<void>;
	onComplete: (goal?: string) => void;
	onSkip: () => void;
}

const STEPS = ["Model access", "Setup", "Starting point"];

/** Non-modal setup so account and model dialogs can open without competing focus traps. */
export function ChatOnboarding({ onUseKeating, onConnectAccount, onChooseModel, onComplete, onSkip }: ChatOnboardingProps) {
	const [step, setStep] = useState(0);
	const [access, setAccess] = useState<"keating" | "byok" | "offline">("keating");
	const [goal, setGoal] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const title = useRef<HTMLHeadingElement>(null);
	const finished = useRef(false);
	useEffect(() => { title.current?.focus({ preventScroll: true }); }, [step]);
	function skip() {
		if (finished.current) return;
		finished.current = true; markChatOnboarding("skipped"); onSkip();
	}
	function finish() {
		if (finished.current) return;
		finished.current = true; markChatOnboarding("completed"); onComplete(goal.trim() || undefined);
	}
	async function openSetup(action: () => void | Promise<void>) {
		setPending(true); setError("");
		try { await action(); }
		catch { setError("That setup couldn’t open. Try again, or continue to chat and set it up later."); }
		finally { setPending(false); }
	}
	async function next() {
		if (pending) return;
		setError("");
		if (step === 0 && access === "keating") {
			setPending(true);
			try { await onUseKeating(); }
			catch { setError("Keating’s model couldn’t be selected. Try again, or choose your own provider."); return; }
			finally { setPending(false); }
		}
		if (!finished.current) setStep(previous => previous + 1);
	}
	return <section className="chat-onboarding" role="dialog" aria-modal="false" aria-labelledby="chat-onboarding-title" aria-describedby="chat-onboarding-description" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); skip(); } }}>
		<header className="chat-onboarding__top"><span>Welcome to Keating</span><button type="button" className="chat-onboarding__skip" onClick={skip}>Go straight to chat</button></header>
		<div className="chat-onboarding__intro"><KeatingBot size={88} state="idle" label="" /><p className="chat-onboarding__progress">{step + 1} of 3 · {STEPS[step]}</p></div>
		<h2 ref={title} tabIndex={-1} id="chat-onboarding-title">{step === 0 ? "How would you like to chat?" : step === 1 ? access === "keating" ? "Make yourself at home." : access === "offline" ? "Set up your offline tutor." : "Connect your model." : "What would you like to understand?"}</h2>
		<p id="chat-onboarding-description">{step === 0 ? "Choose how to run your model. You can change this later." : step === 1 ? access === "keating" ? "Inkling Small is selected. Connect or create a Not Organic account to use Keating’s hosted model." : access === "offline" ? "Download the model once, then chat on this device without an account or internet connection." : "Choose a model and add your provider key. A Not Organic account isn’t required." : "A starting point helps shape the conversation. We’ll put it in the chat composer for you to review and send."}</p>
		<div className="chat-onboarding__step">
			{step === 0 && <fieldset className="chat-onboarding__access" disabled={pending}>
				<legend>Model access</legend>
				<label><input type="radio" name="onboarding-access" value="keating" checked={access === "keating"} onChange={() => { setAccess("keating"); setError(""); }} /><span><strong>Use Keating</strong><span>Inkling Small · Default</span></span></label>
				<label><input type="radio" name="onboarding-access" value="byok" checked={access === "byok"} onChange={() => { setAccess("byok"); setError(""); }} /><span><strong>Bring your own key</strong><span>Your provider, your choice of model</span></span></label>
				{desktopOfflineBridge() && <label><input type="radio" name="onboarding-access" value="offline" checked={access === "offline"} onChange={() => { setAccess("offline"); setError(""); }} /><span><strong>Use an offline tutor</strong><span>Optional 1.55 GB download · No account needed</span></span></label>}
			</fieldset>}
			{step === 1 && access === "keating" && <button type="button" className="chat-onboarding__primary" disabled={pending} onClick={() => void openSetup(onConnectAccount)}>{pending ? "Opening…" : "Connect or create an account"}</button>}
			{step === 1 && access === "byok" && <button type="button" className="chat-onboarding__primary" disabled={pending} onClick={() => void openSetup(onChooseModel)}>{pending ? "Opening…" : "Choose a model and provider"}</button>}
			{step === 1 && access === "offline" && <><OfflineTutorSettings /><button type="button" className="chat-onboarding__secondary" disabled={pending} onClick={() => void openSetup(onChooseModel)}>Choose the offline model</button></>}
			{step === 2 && <label className="chat-onboarding__goal">Your starting point <span>(optional)</span><textarea rows={3} maxLength={1000} value={goal} onChange={event => setGoal(event.target.value)} placeholder="I know a little Python. Help me understand recursion." /></label>}
			{error && <p className="chat-onboarding__error" role="alert">{error}</p>}
		</div>
		<footer className="chat-onboarding__navigation"><div>{step > 0 && <button type="button" className="chat-onboarding__secondary" disabled={pending} onClick={() => { setStep(previous => previous - 1); setError(""); }}>Back</button>}</div>{step < 2 ? <button type="button" className="chat-onboarding__secondary" disabled={pending} onClick={() => void next()}>{pending && step === 0 ? "Selecting…" : "Next"}</button> : <button type="button" className="chat-onboarding__primary" onClick={finish}>Start chatting</button>}</footer>
	</section>;
}
