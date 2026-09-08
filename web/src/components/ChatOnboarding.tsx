import { useEffect, useRef, useState } from "react";
import { KeatingBot } from "./KeatingBot";
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
	onConnectAccount: () => void | Promise<void>;
	onChooseModel: () => void | Promise<void>;
	onComplete: (goal?: string) => void;
	onSkip: () => void;
}

const STEPS = ["Account", "Model", "Starting point"];

/** Non-modal setup so account and model dialogs can open without competing focus traps. */
export function ChatOnboarding({ onConnectAccount, onChooseModel, onComplete, onSkip }: ChatOnboardingProps) {
	const [step, setStep] = useState(0);
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
	return <section className="chat-onboarding" role="dialog" aria-modal="false" aria-labelledby="chat-onboarding-title" aria-describedby="chat-onboarding-description" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); skip(); } }}>
		<header className="chat-onboarding__top"><span>Welcome to Keating</span><button type="button" className="chat-onboarding__skip" onClick={skip}>Go straight to chat</button></header>
		<div className="chat-onboarding__intro"><KeatingBot size={88} state="idle" label="" /><p className="chat-onboarding__progress">{step + 1} of 3 · {STEPS[step]}</p></div>
		<h2 ref={title} tabIndex={-1} id="chat-onboarding-title">{step === 0 ? "Make yourself at home." : step === 1 ? "Choose your model." : "What would you like to understand?"}</h2>
		<p id="chat-onboarding-description">{step === 0 ? "Connect or create a Not Organic account for hosted model access. You can use your own provider key without a Not Organic account." : step === 1 ? "Pick a model and its provider. Bring your own key, or use hosted access with your account. You can change this later." : "A starting point helps shape the conversation. We’ll put it in the chat composer for you to review and send."}</p>
		<div className="chat-onboarding__step">
			{step === 0 && <button type="button" className="chat-onboarding__primary" disabled={pending} onClick={() => void openSetup(onConnectAccount)}>{pending ? "Opening…" : "Connect or create an account"}</button>}
			{step === 1 && <button type="button" className="chat-onboarding__primary" disabled={pending} onClick={() => void openSetup(onChooseModel)}>{pending ? "Opening…" : "Choose a model"}</button>}
			{step === 2 && <label className="chat-onboarding__goal">Your starting point <span>(optional)</span><textarea rows={3} maxLength={1000} value={goal} onChange={event => setGoal(event.target.value)} placeholder="I know a little Python. Help me understand recursion." /></label>}
			{error && <p className="chat-onboarding__error" role="alert">{error}</p>}
		</div>
		<footer className="chat-onboarding__navigation"><div>{step > 0 && <button type="button" className="chat-onboarding__secondary" onClick={() => { setStep(previous => previous - 1); setError(""); }}>Back</button>}</div>{step < 2 ? <button type="button" className="chat-onboarding__secondary" onClick={() => { setStep(previous => previous + 1); setError(""); }}>Next</button> : <button type="button" className="chat-onboarding__primary" onClick={finish}>Start chatting</button>}</footer>
	</section>;
}
