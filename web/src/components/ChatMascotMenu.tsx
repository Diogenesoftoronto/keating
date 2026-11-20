import { useAui } from "@assistant-ui/react";
import { createPortal } from "react-dom";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useMotionAllowed } from "../design-system/motion";
import { useMediaQuery } from "../hooks/use-media-query";
import { addDraftQuote } from "../keating/passage-quote-draft";
import { KeatingBot, type KeatingBotState } from "./KeatingBot";
import { LearningReferenceScope } from "./LearningReferenceLink";
import { useCompanionMode } from "./companion/CompanionSetting";
import { useCompanionDrag } from "./companion/useCompanionDrag";
import { useLessonReactions } from "./companion/useLessonReactions";
import {
	activityTargetSelector,
	captureTarget,
	isActivityDrop,
	questionSelector,
	resolveDropTarget,
	revealHint,
	suggestions,
	targetLabels,
	type DropTarget,
} from "./companion/drop-targets";

export { CompanionSetting } from "./companion/CompanionSetting";

const STUDY_CHOICES = [
	["Explain another way", "Explain the current topic another way, with a concrete example."],
	["Quiz me", "Quiz me on the current topic, one question at a time."],
	["Make flashcards", "Make flashcards to help me review the current topic."],
] as const;
type Props = { state: KeatingBotState; busy: boolean; onSeatedChange?: (seated: boolean) => void };
export function ChatMascotMenu(props: Props) {
	const session = useContext(LearningReferenceScope);
	return <Companion key={session} {...props} session={session} />;
}
function Companion({ state, busy, session, onSeatedChange }: Props & { session?: string }) {
	const composer = useAui().composer;
	const anchor = useRef<HTMLDivElement>(null),
		trigger = useRef<HTMLButtonElement>(null),
		menu = useRef<HTMLDivElement>(null);
	const chat = () => anchor.current?.parentElement?.parentElement ?? null;
	const menuId = useId(),
		mode = useCompanionMode(),
		motion = useMotionAllowed();
	const desktop = useMediaQuery("(min-width: 640px) and (pointer: fine)");
	const [room, setRoom] = useState(false),
		[peek, setPeek] = useState(false);
	const [panel, setPanel] = useState<"study" | "targets" | "suggestions" | null>(null);
	const [target, setTarget] = useState<DropTarget | null>(null),
		[error, setError] = useState("");
	const captured = useRef<ReturnType<typeof captureTarget>>(null);
	const [choices, setChoices] = useState<DropTarget[]>([]);
	const [gesture, setGesture] = useState<KeatingBotState | null>(null);
	const [position, setPosition] = useState({ left: 8, bottom: 8 });
	const expanded = desktop && room && mode !== "off";
	useEffect(() => { onSeatedChange?.(expanded); }, [expanded, onSeatedChange]);
	const lively = expanded && mode === "lively";
	const close = () => {
		setPanel(null);
		setTarget(null);
		setError("");
		trigger.current?.focus({ preventScroll: true });
	};
	function selectTarget(t: DropTarget) {
		if (isActivityDrop(t.kind)) {
			close();
			drag.perch.current(t);
			return;
		}
		if (t.kind === "question") {
			revealHint(t.el);
			setGesture("hint");
			close();
			return;
		}
		if (t.kind === "home") {
			setGesture(null);
			return;
		}
		captured.current = captureTarget(t.el);
		setError("");
		setTarget(t);
		setPanel("suggestions");
	}
	const drag = useCompanionDrag(trigger, lively && !peek, motion, selectTarget, () => {
		setPanel(null);
		setTarget(null);
		setGesture(null);
	});
	const { reaction, typing, eventId } = useLessonReactions(
		expanded ? mode : "off",
		motion,
		state,
		session,
		() => {
			drag.home.current();
			setPanel(null);
			setTarget(null);
			setGesture(null);
		},
		chat,
		peek || !!panel || drag.pose === "held",
	);
	useLayoutEffect(() => {
		const seat = anchor.current,
			viewport = chat();
		if (!seat || !viewport || !desktop) {
			setRoom(false);
			return;
		}
		const measure = () =>
			setRoom(viewport.getBoundingClientRect().right - seat.getBoundingClientRect().right >= 114);
		measure();
		const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
		observer?.observe(viewport);
		observer?.observe(seat);
		window.addEventListener("resize", measure);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [desktop]);
	useEffect(() => {
		setPeek(false);
		setGesture(null);
		setPanel(null);
		setTarget(null);
	}, [expanded, mode]);
	useEffect(() => {
		if (!gesture) return;
		const timer = window.setTimeout(
			() => setGesture(null),
			gesture === "waving" ? 3200 : gesture === "hint" ? 2633 : 1400,
		);
		return () => window.clearTimeout(timer);
	}, [gesture]);
	useEffect(() => {
		if (busy || typing) setGesture(null);
	}, [busy, typing]);
	useLayoutEffect(() => {
		if (!panel) return;
		const update = () => {
			const r = trigger.current!.getBoundingClientRect();
			setPosition({
				left: Math.max(8, Math.min(r.left, innerWidth - 248)),
				bottom: Math.max(
					8,
					Math.min(
						innerHeight - r.top + 6,
						innerHeight - Math.min(menu.current?.scrollHeight ?? 300, innerHeight - 24) - 8,
					),
				),
			});
		};
		update();
		menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);
		const outside = (e: PointerEvent) => {
			if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close();
		};
		document.addEventListener("pointerdown", outside);
		return () => {
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
			document.removeEventListener("pointerdown", outside);
		};
	}, [panel]);
	function chooseTargets() {
		const root = chat();
		if (!root) return;
		const items = new Map<HTMLElement, DropTarget>();
		for (const el of root.querySelectorAll(
			[
				".keating-bubble :is(p,li,pre,blockquote,th,td,h1,h2,h3,h4,h5,h6)",
				questionSelector,
				...(lively ? [activityTargetSelector] : []),
			].join(","),
		)) {
			const hit = resolveDropTarget([el], root);
			if (hit && (lively || !isActivityDrop(hit.kind)) && el.getClientRects().length) items.set(hit.el, hit);
		}
		setChoices([...items.values()]);
		setPanel("targets");
	}
	function addDraft(prompt: string) {
		if (target) {
			const quote = target.el.isConnected && captureTarget(target.el);
			if (
				!quote ||
				!captured.current ||
				quote.quote.exact !== captured.current.quote.exact ||
				quote.quote.source.id !== captured.current.quote.source.id
			) {
				setError("That passage changed. Choose it again.");
				return;
			}
			if (addDraftQuote(session, quote.quote, quote.truncated) === "full") {
				setError("Remove a quote from your message to add this passage.");
				return;
			}
		}
		const draft = composer.getState().text;
		composer.setText(draft.trim() ? `${draft}\n\n${prompt}` : prompt);
		close();
		chat()?.querySelector<HTMLTextAreaElement>(".composer-root textarea")?.focus();
	}
	const working = busy && !typing && (state === "speaking" || state === "thinking");
	const seat = mode === "calm" && !busy && state !== "idle" ? state : "blank-sitting";
	const point =
		target && panel === "suggestions"
			? target.el.getBoundingClientRect().left < (trigger.current?.getBoundingClientRect().left ?? 0)
				? "pointing-left"
				: "pointing-right"
			: null;
	const pose: KeatingBotState = !expanded
		? mode === "lively" && !typing && !busy
			? (gesture ?? "idle")
			: "idle"
		: peek
			? "peeking"
			: (drag.pose ??
				point ??
				(!typing ? (gesture ?? reaction?.sprite) : null) ??
				(working && state === "speaking" ? "typing" : seat));
	const showSnack = lively && drag.hungry && !busy && !typing && drag.pose !== "held";
	const screen =
		pose === "blank-sitting"
			? !typing && working && state === "thinking"
				? "dots"
				: !typing && lively && state === "listening"
					? "wave"
					: "face"
			: undefined;
	useEffect(() => {
		if (pose !== "carrying" || !motion || !trigger.current?.animate) return;
		const button = document.querySelector<HTMLButtonElement>("button[data-material-count]");
		if (!button) return;
		const seat = trigger.current.getBoundingClientRect(),
			goal = button.getBoundingClientRect();
		const x = goal.left + goal.width / 2 - seat.left - seat.width / 2,
			y = goal.bottom - seat.top;
		const walk = trigger.current.animate(
			[
				{ transform: "none" },
				{ transform: `translate(0px,${y}px)`, offset: 0.5 },
				{ transform: `translate(${x}px,${y}px)`, offset: 0.8 },
				{ transform: "none" },
			],
			{ duration: 1450 },
		);
		return () => walk.cancel();
	}, [pose, reaction, motion]);
	return (
		<div ref={anchor} className="chat-mascot-perch" data-expanded={expanded}>
			<button
				ref={trigger}
				type="button"
				className="chat-mascot-perch__bot"
				data-peeking={peek}
				data-resting={!busy && !typing && !reaction && !panel}
				aria-label="Study with Keating"
				title="Study with Keating"
				aria-haspopup="menu"
				aria-expanded={!!panel}
				aria-controls={panel ? menuId : undefined}
				onClick={(e) => {
					if (e.detail && drag.suppressClick.current) {
						drag.suppressClick.current = false;
						return;
					}
					if (peek) {
						setPeek(false);
						return;
					}
					if (panel) close();
					else setPanel("study");
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown" || e.key === "ArrowUp") {
						e.preventDefault();
						setPeek(false);
						setPanel("study");
					}
					if (e.key === "Escape") {
						drag.clear.current();
						setGesture(null);
					}
				}}
			>
				<KeatingBot
					key={reaction?.sprite === pose ? eventId : pose}
					variant={expanded ? "body" : "head"}
					state={pose}
					label=""
					size={expanded ? 108 : 56}
					screen={screen}
					animated={motion && pose !== "held" && (expanded || (!!gesture && mode === "lively"))}
				/>
				<span className="chat-mascot-perch__snack" role="status">
					{showSnack ? "Could use a study snack" : ""}
				</span>
				<span className="chat-mascot-perch__hint" aria-hidden="true">
					+
				</span>
			</button>
			{panel &&
				createPortal(
					<div
						ref={menu}
						id={menuId}
						role="menu"
						aria-label="Study with Keating"
						className="chat-mascot-menu"
						style={position}
						onBlur={(e) => {
							if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) {
								setPanel(null);
								setTarget(null);
							}
						}}
						onKeyDown={(e) => {
							if (e.key === "Tab") {
								close();
								return;
							}
							if (e.key === "Escape") {
								e.preventDefault();
								e.stopPropagation();
								close();
								return;
							}
							const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")],
								index = items.indexOf(document.activeElement as HTMLButtonElement);
							const next =
								e.key === "ArrowDown"
									? (index + 1) % items.length
									: e.key === "ArrowUp"
										? (index - 1 + items.length) % items.length
										: e.key === "Home"
											? 0
											: e.key === "End"
												? items.length - 1
												: -1;
							if (next >= 0) {
								e.preventDefault();
								items[next]?.focus();
							}
						}}
					>
						{panel === "study" && (
							<>
								<p className="chat-mascot-menu__caption">Add to your message</p>
								{STUDY_CHOICES.map(([label, prompt]) => (
									<button key={label} type="button" role="menuitem" onClick={() => addDraft(prompt)}>
										{label}
									</button>
								))}
								<button type="button" role="menuitem" onClick={chooseTargets}>
									{lively ? "Choose a passage or activity" : "Ask about a passage or question"}
								</button>
								<div className="chat-mascot-menu__divider" role="separator" />
								<button
									type="button"
									role="menuitem"
									disabled={busy || typing || mode !== "lively"}
									onClick={() => {
										setGesture("waving");
										close();
									}}
								>
									Give me a wave
								</button>
								<button
									type="button"
									role="menuitem"
									disabled={busy || typing || mode !== "lively"}
									onClick={() => {
										setGesture("flipping");
										close();
									}}
								>
									Do a flip
								</button>
								{(drag.pose === "ledge-sitting" || drag.pose === "wall-climb") && (
									<button
										type="button"
										role="menuitem"
										onClick={() => {
											drag.home.current();
											close();
										}}
									>
										Back to the composer
									</button>
								)}
								{expanded && (
									<button
										type="button"
										role="menuitem"
										onClick={() => {
											drag.clear.current();
											setPeek(true);
											close();
										}}
									>
										Give me room
									</button>
								)}
							</>
						)}
						{panel === "targets" && (
							<>
								<p className="chat-mascot-menu__caption">
									{choices.length ? "Choose a spot" : "No passages or activities yet."}
								</p>
								{choices.map((t, i) => (
									<button key={i} type="button" role="menuitem" onClick={() => selectTarget(t)}>
										{t.kind === "question"
											? "Hint for " +
												(t.el.querySelector("legend,.activity-prompt,h3")?.textContent?.trim() ||
													"this question")
											: isActivityDrop(t.kind)
												? `${targetLabels[t.kind]} · ${t.el.getAttribute("aria-label") ||
													t.el.querySelector(".lesson-head > strong, legend, h2, h3, h4")?.textContent?.trim() ||
													(t.kind === "snack" ? "Flashcards" : "Activity")}`
												: t.el.textContent?.trim().slice(0, 90)}
									</button>
								))}
								<button type="button" role="menuitem" onClick={() => setPanel("study")}>
									Back
								</button>
							</>
						)}
						{panel === "suggestions" && target && (target.kind === "passage" || target.kind === "code") && (
							<>
								<p className="chat-mascot-menu__caption">
									{target.kind === "code" ? "This code?" : "This part?"}
								</p>
								{suggestions[target.kind].map(([label, prompt]) => (
									<button key={label} type="button" role="menuitem" onClick={() => addDraft(prompt)}>
										{label}
									</button>
								))}
								{error && <p role="status">{error}</p>}
							</>
						)}
					</div>,
					document.body,
				)}
		</div>
	);
}
