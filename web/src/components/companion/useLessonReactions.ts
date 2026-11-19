import { useEffect, useRef, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { parseReviewNotice } from "../../keating/judgement/review-notice";
import { KeatingStorage, QUESTION_JUDGEMENT_CHANGED_EVENT } from "../../keating/storage";
import type { KeatingBotState } from "../KeatingBot";
import type { CompanionMode } from "./CompanionSetting";
import { reactToLesson, seat, type LessonEvent } from "./reactions";

const reviewStorage = new KeatingStorage();
const breaks = new Map<string, number>();
export function useLessonReactions(
	mode: CompanionMode,
	motion: boolean,
	state: KeatingBotState,
	session: string | undefined,
	onSend: () => void,
	chat: () => HTMLElement | null,
	occupied: boolean,
) {
	const [machine, setMachine] = useState(seat);
	const [typing, setTyping] = useState(false);
	const sequence = useRef(0),
		typingUntil = useRef(0);
	const signal = useRef({ mode, motion, onSend, chat, occupied, state });
	signal.current = { mode, motion, onSend, chat, occupied, state };
	const reaction = machine.reaction;
	const sleeping = useRef(false);
	sleeping.current = reaction?.sprite === "sleeping" || reaction?.sprite === "yawning";
	const emit = useRef((event: LessonEvent, id?: string) => {
		const current = signal.current;
		if (document.hidden || current.occupied) return;
		sequence.current++;
		const token = id ?? "event-" + sequence.current;
		const writing = performance.now() < typingUntil.current;
		setMachine((prev) => reactToLesson(prev, event, token, current.mode, writing, !current.motion));
	}).current;
	const latestUser = useAuiState(({ thread }) => {
		for (let i = thread.messages.length - 1; i >= 0; i--)
			if (thread.messages[i].role === "user") return thread.messages[i].id;
		return undefined;
	});
	const terminal = useAuiState(({ thread }) => {
		const message = thread.messages.at(-1);
		if (thread.isRunning || message?.role !== "assistant" || message.metadata.custom?.keatingPrefillStatus)
			return "";
		if (
			message.metadata.custom?.keatingLlmFailure ||
			(message.status?.type === "incomplete" && message.status.reason === "error")
		)
			return "failure-" + message.id;
		if (message.status?.type !== "complete") return "";
		const text = message.content.find((part) => part.type === "text")?.text ?? "";
		if (!text.trim()) return "";
		return (parseReviewNotice(text)?.kind === "withheld" ? "failure-" : "reply-") + message.id;
	});
	const previous = useRef({ latestUser, terminal, state });
	useEffect(() => {
		const old = previous.current;
		previous.current = { latestUser, terminal, state };
		if (latestUser && latestUser !== old.latestUser) {
			typingUntil.current = 0;
			setTyping(false);
			signal.current.onSend();
			emit("sent", "sent-" + latestUser);
		} else if (terminal && terminal !== old.terminal)
			emit(terminal.startsWith("failure-") ? "failure" : "reply", terminal);
		else if (state === "speaking" && state !== old.state) emit("typing");
		else if (state === "thinking" && state !== old.state) emit("thinking");
		else if (state !== old.state)
			setMachine((prev) => (prev.reaction?.duration === 0 ? { ...prev, reaction: null } : prev));
	}, [latestUser, terminal, state, emit]);
	useEffect(() => {
		if (!reaction?.duration) return;
		const timer = window.setTimeout(
			() =>
				setMachine((prev) =>
					prev.reaction !== reaction
						? prev
						: {
								...prev,
								reaction: reaction.next
									? {
											sprite: reaction.next,
											duration: reaction.next === "hint" ? 2633 : 0,
											animate: reaction.animate,
										}
									: null,
							},
				),
			reaction.duration,
		);
		return () => window.clearTimeout(timer);
	}, [reaction]);
	useEffect(() => {
		setMachine(seat);
		setTyping(false);
		typingUntil.current = 0;
		if (mode === "off") return;
		const ctl = new AbortController(),
			opt = { signal: ctl.signal },
			seen = new Set<string>();
		let idle = 0,
			quiet = 0,
			gradeRevision = 0;
		function activity() {
			if (sleeping.current) {
				sleeping.current = false;
				emit("return");
			}
			window.clearTimeout(idle);
			if (mode === "lively" && !document.hidden)
				idle = window.setTimeout(() => {
					if (!["speaking", "thinking", "listening"].includes(signal.current.state)) emit("idle");
				}, 120000);
		}
		function input(e: Event) {
			if (
				!(e.target instanceof Element) ||
				!signal.current.chat()?.contains(e.target) ||
				!e.target.closest(".composer-root textarea")
			)
				return;
			typingUntil.current = performance.now() + 1400;
			setTyping(true);
			setMachine((prev) => ({ ...prev, reaction: null }));
			clearTimeout(quiet);
			quiet = window.setTimeout(() => setTyping(false), 1400);
		}
		function grade(score: unknown, total: number, id?: string) {
			if (
				typeof score !== "number" ||
				!Number.isFinite(score) ||
				total <= 0 ||
				score < 0 ||
				score > total ||
				(id && seen.has(id))
			)
				return;
			if (id) seen.add(id);
			emit(score === total ? "right" : score === 0 ? "wrong" : "partial", id);
		}
		function quiz(e: Event) {
			const d = (e as CustomEvent).detail;
			if (!Array.isArray(d?.questions)) return;
			grade(d.score, d.questions.filter((q: { openEnded?: boolean }) => !q.openEnded).length, d.resultId);
		}
		function question(e: Event) {
			const answers = (e as CustomEvent).detail?.answers;
			if (!Array.isArray(answers)) return;
			const grades = answers.filter((a) => a.grading === "auto" && typeof a.score === "number");
			grade(
				grades.reduce((sum, a) => sum + a.score, 0),
				grades.length,
			);
		}
		async function judgement(e: Event) {
			const id = (e as CustomEvent).detail?.id;
			if (!session || typeof id !== "string" || !id || typeof indexedDB === "undefined") return;
			const revision = ++gradeRevision,
				serial = sequence.current;
			try {
				const record = (await reviewStorage.getQuestionChecks()).find(
					(c) => c.id === id && c.sessionId === session,
				);
				if (
					!ctl.signal.aborted &&
					revision === gradeRevision &&
					serial === sequence.current &&
					record?.grading === "model"
				)
					grade(record.score, 1, id + ":" + record.score);
			} catch {
				/* A failed read has no grade to display. */
			}
		}
		document.addEventListener("input", input, opt);
		for (const name of ["pointermove", "keydown", "pointerdown", "visibilitychange"])
			document.addEventListener(name, activity, { ...opt, passive: true });
		window.addEventListener("keating:quiz-submitted", quiz, opt);
		window.addEventListener("keating:question-answered", question, opt);
		window.addEventListener(QUESTION_JUDGEMENT_CHANGED_EVENT, judgement, opt);
		window.addEventListener("keating:artifact-created", () => emit("material"), opt);
		window.addEventListener("offline", () => emit("offline"), opt);
		window.addEventListener(
			"online",
			() => setMachine((prev) => (prev.reaction?.sprite === "umbrella" ? { ...prev, reaction: null } : prev)),
			opt,
		);
		if (!navigator.onLine) emit("offline");
		activity();
		const key = session ?? "local-chat",
			started = breaks.get(key) ?? Date.now();
		breaks.set(key, started);
		const tea =
			mode === "lively" && started !== -1
				? window.setTimeout(
						() => {
							breaks.set(key, -1);
							emit("break");
						},
						Math.max(0, started + 1500000 - Date.now()),
					)
				: 0;
		return () => {
			ctl.abort();
			clearTimeout(idle);
			clearTimeout(tea);
			clearTimeout(quiet);
		};
	}, [mode, session, emit]);
	return { reaction, typing, eventId: machine.eventId };
}
