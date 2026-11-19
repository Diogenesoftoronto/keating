import type { KeatingBotState } from "../KeatingBot";
import type { CompanionMode } from "./CompanionSetting";
export type LessonEvent =
	| "sent"
	| "thinking"
	| "typing"
	| "reply"
	| "right"
	| "partial"
	| "wrong"
	| "failure"
	| "material"
	| "idle"
	| "return"
	| "offline"
	| "break";
export interface Reaction {
	sprite: KeatingBotState;
	duration: number;
	next?: KeatingBotState;
	animate: boolean;
}
const poses: Record<LessonEvent, readonly [KeatingBotState, number, KeatingBotState?]> = {
	sent: ["paper-plane", 728],
	thinking: ["blank-sitting", 0],
	typing: ["typing", 0],
	reply: ["catching", 728],
	right: ["celebrating", 890],
	partial: ["shrug", 1150],
	wrong: ["head-shake", 1000, "hint"],
	failure: ["oops", 1050],
	material: ["carrying", 1500],
	idle: ["yawning", 1600, "sleeping"],
	return: ["startled", 800],
	offline: ["umbrella", 0],
	break: ["tea-break", 2300],
};
const cheers = ["celebrating", "clapping", "thumbs-up", "nodding"] as const;
export interface ReactionState {
	reaction: Reaction | null;
	cheers: number;
	eventId: string | null;
}
export const seat: ReactionState = { reaction: null, cheers: 0, eventId: null };
export function reactToLesson(
	previous: ReactionState,
	event: LessonEvent,
	id: string,
	mode: CompanionMode,
	typing: boolean,
	reduced: boolean,
): ReactionState {
	if (previous.eventId === id) return previous;
	if (typing || mode === "off" || (mode === "calm" && event !== "typing" && event !== "thinking"))
		return { ...previous, reaction: null, eventId: id };
	const [pose, duration, next] = poses[event];
	return {
		reaction: {
			sprite: event === "right" ? cheers[previous.cheers % 4] : pose,
			duration,
			next,
			animate: !reduced,
		},
		cheers: previous.cheers + Number(event === "right"),
		eventId: id,
	};
}
