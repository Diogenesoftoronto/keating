import type { TrajectorySessionMessage } from "./types";

export type ReviewTool = NonNullable<TrajectorySessionMessage["tools"]>[number];

export interface FoldedTurns<T extends TrajectorySessionMessage> {
	/** The turns a teacher reviews: learner messages and tutor replies, numbered from 1. */
	turns: T[];
	/** Hidden step id -> the visible turn that now carries its tool activity. */
	hostOf: ReadonlyMap<string, string>;
}

export interface FoldOptions {
	/** Whether a message has prose the learner read. Tool-only steps have none. */
	hasProse: (message: TrajectorySessionMessage) => boolean;
	/** Keep a step visible even when it is tool-only (it carries notes or judgements). */
	keep?: (message: TrajectorySessionMessage) => boolean;
}

function isToolStep(message: TrajectorySessionMessage, options: FoldOptions): boolean {
	if (options.keep?.(message)) return false;
	if (message.role === "tool") return true;
	return message.role === "assistant" && (message.tools?.length ?? 0) > 0 && !options.hasProse(message);
}

/**
 * Pair each call with its result by call id, so one search reads as one entry
 * with its query and what came back, not as two cards.
 */
export function pairToolActivity(tools: readonly ReviewTool[]): ReviewTool[] {
	const paired: ReviewTool[] = [];
	const callIndex = new Map<string, number>();
	for (const tool of tools) {
		if (tool.kind === "call") {
			if (tool.callId) callIndex.set(tool.callId, paired.length);
			paired.push({ ...tool });
			continue;
		}
		const index = tool.callId === undefined ? undefined : callIndex.get(tool.callId);
		if (index === undefined) {
			paired.push({ ...tool });
			continue;
		}
		const call = paired[index];
		paired[index] = {
			...call,
			status: tool.status,
			output: tool.output,
			details: tool.details,
			isError: tool.isError,
		};
	}
	return paired;
}

/**
 * A tutor reply that searched the web is recorded as several agent steps: a
 * tool-only assistant message, one tool result per call, then the reply. Only
 * the learner's messages and the replies are turns. The steps in between are
 * folded into the reply they led to (or, when the reply never came, the last
 * reply of that tutor turn), so the transcript and the turn list show turns.
 */
export function foldToolSteps<T extends TrajectorySessionMessage>(messages: readonly T[], options: FoldOptions): FoldedTurns<T> {
	const turns: T[] = [];
	const hostOf = new Map<string, string>();
	let pending: T[] = [];
	// Index in `turns` of the last tutor reply since the learner last spoke.
	let lastReply = -1;

	const attach = (index: number, steps: readonly T[], before: boolean) => {
		const host = turns[index];
		const carried = steps.flatMap((step) => step.tools ?? []);
		const tools = before ? [...carried, ...(host.tools ?? [])] : [...(host.tools ?? []), ...carried];
		turns[index] = { ...host, tools };
		for (const step of steps) hostOf.set(step.id, host.id);
	};

	const flush = () => {
		if (pending.length === 0) return;
		if (lastReply >= 0) {
			attach(lastReply, pending, false);
		} else {
			// No reply to fold into (the turn stopped after its tools). The first
			// step stands in as the turn, carrying everything that happened.
			const first = pending[0];
			turns.push({ ...first, role: "assistant", text: "", markdown: "", rawSource: "", tools: [] as ReviewTool[] } as T);
			lastReply = turns.length - 1;
			attach(lastReply, pending, false);
			hostOf.delete(first.id);
		}
		pending = [];
	};

	for (const message of messages) {
		if (isToolStep(message, options)) {
			pending.push(message);
			continue;
		}
		if (message.role === "assistant") {
			turns.push(message);
			lastReply = turns.length - 1;
			if (pending.length) {
				attach(lastReply, pending, true);
				pending = [];
			}
			continue;
		}
		flush();
		turns.push(message);
		if (message.role === "user") lastReply = -1;
	}
	flush();

	return {
		turns: turns.map((turn, index) => ({
			...turn,
			turnNumber: index + 1,
			...(turn.tools?.length ? { tools: pairToolActivity(turn.tools) } : {}),
		})),
		hostOf,
	};
}

const TOOL_LABELS: Record<string, string> = {
	consult_tutor: "Asked another tutor",
	knowledge_sources: "Listed knowledge sources",
	knowledge_read_resource: "Read a knowledge source",
	knowledge_call_tool: "Called a knowledge source tool",
	generate_image: "Made an image",
	interactive_page: "Built an interactive page",
	animate: "Made an animation",
};

export function toolActivityLabel(name: string): string {
	if (Object.hasOwn(TOOL_LABELS, name)) return TOOL_LABELS[name];
	const words = name.replaceAll(/[_-]+/g, " ").replaceAll(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
	return words ? `Used ${words}` : "Used a tool";
}

const UNTRUSTED_PREAMBLE = /^UNTRUSTED [A-Z ]+?(?:\s+[—-][^\n]*)?\n/;

/**
 * Tool output from outside sources starts with a line telling the model to
 * treat it as evidence. It is meant for the model; a reviewer sees it as a tag.
 */
export function splitUntrustedPreamble(output: string): { untrusted: boolean; body: string } {
	const match = output.match(UNTRUSTED_PREAMBLE);
	if (!match) return { untrusted: false, body: output };
	return { untrusted: true, body: output.slice(match[0].length).trim() };
}

/** Parse the formatted input back into the call's arguments, for parsers that want an object. */
export function toolArguments(input: string | undefined): unknown {
	if (!input) return undefined;
	try {
		return JSON.parse(input) as unknown;
	} catch {
		return input;
	}
}
