import { useEffect, useRef, useState } from "react";
import type { ProfileProposal, ProfileProposalSource } from "@keating/learner-contracts";
import { INTAKE_PROMPTS, extractIntakeProposals, verbatimIntakeFields, type IntakeAnswer } from "../keating/profile-intake";
import { KeatingBot } from "./KeatingBot";
import "./profile-intake-chat.css";

/**
 * The conversational door into the profile — four open questions instead of
 * eight screens of fields. It is a peer of the form, not a replacement: every
 * question is skippable, and walking out of it early is a valid ending.
 *
 * Voice is a transport over this same thread rather than a separate path. At
 * onboarding the learner has usually not configured a speech provider yet, so
 * dictation uses the browser's own recogniser and quietly disappears when the
 * browser does not have one.
 */

type Recogniser = {
	lang: string; continuous: boolean; interimResults: boolean;
	start: () => void; stop: () => void;
	onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
	onend: (() => void) | null; onerror: (() => void) | null;
};

function recogniserClass(): (new () => Recogniser) | null {
	if (typeof window === "undefined") return null;
	const scope = window as unknown as Record<string, new () => Recogniser>;
	return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** True when this browser can dictate at all; the voice affordance is hidden otherwise. */
export const dictationAvailable = () => recogniserClass() !== null;

export interface ProfileIntakeChatProps {
	/** Called once the learner is done, with the answers and what was read from them. */
	onDone: (result: {
		proposals: readonly ProfileProposal[];
		verbatim: { preferredName?: string; goalText?: string };
		answers: readonly IntakeAnswer[];
	}) => void;
	/** Leaves the conversational door for the form without discarding the answers so far. */
	onUseForm?: () => void;
}

export function ProfileIntakeChat({ onDone, onUseForm }: ProfileIntakeChatProps) {
	const [index, setIndex] = useState(0);
	const [draft, setDraft] = useState("");
	const [answers, setAnswers] = useState<readonly IntakeAnswer[]>([]);
	const [listening, setListening] = useState(false);
	const [reading, setReading] = useState(false);
	const spoken = useRef(false);
	const recogniser = useRef<Recogniser | null>(null);
	const heading = useRef<HTMLParagraphElement>(null);

	const prompt = INTAKE_PROMPTS[index];
	const done = index >= INTAKE_PROMPTS.length;

	useEffect(() => { heading.current?.focus(); }, [index]);
	useEffect(() => () => { try { recogniser.current?.stop(); } catch { /* already stopped */ } }, []);

	function toggleDictation() {
		if (listening) { try { recogniser.current?.stop(); } catch { /* already stopped */ } return; }
		const Recogniser = recogniserClass();
		if (!Recogniser) return;
		const instance = new Recogniser();
		instance.lang = document.documentElement.lang || "en-US";
		instance.continuous = true;
		instance.interimResults = false;
		instance.onresult = event => {
			// Appended rather than replacing: a learner may dictate, then type a
			// correction, and losing the typed part would be the worse surprise.
			const heard = Array.from(event.results, result => result[0]?.transcript ?? "").join(" ").trim();
			if (!heard) return;
			spoken.current = true;
			setDraft(current => (current.trim() ? `${current.trim()} ${heard}` : heard));
		};
		instance.onend = () => setListening(false);
		instance.onerror = () => setListening(false);
		recogniser.current = instance;
		try { instance.start(); setListening(true); } catch { setListening(false); }
	}

	async function advance(recorded: readonly IntakeAnswer[]) {
		if (index + 1 < INTAKE_PROMPTS.length) { setIndex(index + 1); setDraft(""); spoken.current = false; return; }
		setReading(true);
		const { proposals } = await extractIntakeProposals(recorded);
		setIndex(INTAKE_PROMPTS.length);
		onDone({ proposals, verbatim: verbatimIntakeFields(recorded), answers: recorded });
	}

	function submit() {
		try { recogniser.current?.stop(); } catch { /* already stopped */ }
		const text = draft.trim();
		const source: ProfileProposalSource = spoken.current ? "speech" : "conversation";
		const recorded = text ? [...answers, { promptId: prompt!.id, text, source }] : answers;
		setAnswers(recorded);
		void advance(recorded);
	}

	if (done) {
		return <section className="intake-chat" aria-live="polite">
			<KeatingBot size={72} state={reading ? "sorting" : "settled"} label="" />
			<p className="intake-chat__reading">{reading ? "Reading back what you told me…" : "Thank you."}</p>
		</section>;
	}

	return <section className="intake-chat" aria-labelledby="intake-chat-ask">
		<div className="intake-chat__said">
			{answers.map(answer => <p key={answer.promptId} className="intake-chat__answer" data-source={answer.source}>{answer.text}</p>)}
		</div>
		<div className="intake-chat__turn" key={prompt!.id}>
			<KeatingBot size={64} state={listening ? "listening-voice" : "greeting"} label="" />
			<div>
				<p className="intake-chat__ask" id="intake-chat-ask" ref={heading} tabIndex={-1}>{prompt!.ask}</p>
				<p className="intake-chat__hint">{prompt!.hint}</p>
			</div>
		</div>
		<label className="intake-chat__compose">
			<span className="intake-chat__label">Your answer</span>
			<textarea
				value={draft}
				rows={3}
				placeholder={listening ? "Listening…" : "Type, or use the microphone."}
				onChange={event => setDraft(event.target.value)}
				onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); } }}
			/>
		</label>
		<footer className="intake-chat__actions">
			<div>
				{dictationAvailable() && <button type="button" className="intake-chat__mic" aria-pressed={listening} onClick={toggleDictation}>
					{listening ? "Stop listening" : "Answer out loud"}
				</button>}
				{onUseForm && <button type="button" className="intake-chat__plain" onClick={onUseForm}>Fill a form instead</button>}
			</div>
			<div>
				<button type="button" className="intake-chat__plain" onClick={() => { setDraft(""); spoken.current = false; void advance(answers); }}>
					{index + 1 === INTAKE_PROMPTS.length ? "Skip and finish" : "Skip"}
				</button>
				<button type="button" className="intake-chat__next" disabled={!draft.trim()} onClick={submit}>
					{index + 1 === INTAKE_PROMPTS.length ? "Done" : "Next"}
				</button>
			</div>
		</footer>
		<p className="intake-chat__progress" role="status">Question {index + 1} of {INTAKE_PROMPTS.length} · every one is optional</p>
	</section>;
}
