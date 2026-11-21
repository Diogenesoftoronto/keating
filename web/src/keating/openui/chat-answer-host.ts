/** Browser wiring for typed chat answers: the judge, the active-work read and the composer gate. */
import type { AppendMessage } from "@assistant-ui/react";
import type { Context } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createJudgementOperationCaller } from "../judgement/operation";
import { createWebJudgementRuntime } from "../judgement/runtime";
import { loadActiveWork, type ActiveWorkSource } from "../judgement/active-work-host";
import { previousQuestionPresentation } from "../judgement/previous-question-presentation";
import { getDraftQuotes } from "../passage-quote-draft";
import {
	attemptChoice,
	createTypedAnswerClassifier,
	routeTypedAnswer,
	TYPED_ANSWER_TIMEOUT_MS,
	type TypedAnswerClassifier,
} from "./chat-answer";

/** One small Jev call, at most four seconds; judge off means ordinary chat. */
export const browserTypedAnswerClassifier: TypedAnswerClassifier = createTypedAnswerClassifier(() => {
	const runtime = createWebJudgementRuntime();
	if (runtime.settings.backend === "off") return null;
	return createJudgementOperationCaller({
		runtime,
		timeoutMs: TYPED_ANSWER_TIMEOUT_MS,
		accept: (response) => attemptChoice(response) !== null,
		diagnostics: { origin: "typed-answer", application: "Typed chat answer to an open question card" },
	});
});

/** Only a plain typed message, with no attachments or quoted passages, can stand in for a card answer. */
export function plainComposerText(message: AppendMessage, sessionId: string | undefined): string | null {
	if (message.attachments?.length || getDraftQuotes(sessionId).length) return null;
	if (!message.content.length || message.content.some((part) => part.type !== "text")) return null;
	const text = message.content.map((part) => part.type === "text" ? part.text : "").join("").trim();
	return text || null;
}

export async function answerOpenCardFromComposer(input: {
	sessionId: string | undefined;
	message: AppendMessage;
	/** The agent's own transcript: the array visible rows take their source ids from. */
	messages: readonly AgentMessage[] | undefined;
	storage: ActiveWorkSource;
	classify?: TypedAnswerClassifier;
}): Promise<"submitted" | "chat"> {
	const { sessionId } = input;
	const messages = input.messages as Context["messages"] | undefined;
	const text = plainComposerText(input.message, sessionId);
	if (!sessionId || !text || !messages?.length || messages.at(-1)?.role !== "assistant") return "chat";
	try {
		const work = await loadActiveWork(input.storage, sessionId);
		return await routeTypedAnswer({
			sessionId, text, messages, work,
			presentation: (withMessage, current) => previousQuestionPresentation(sessionId, withMessage, current),
			classify: input.classify ?? browserTypedAnswerClassifier,
		});
	} catch {
		return "chat";
	}
}
