import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { assistantTextParts } from "../components/assistant-chat-messages";
import { splitSearchSources } from "../components/web-search-result";
import { parseReviewNotice } from "../keating/judgement/review-notice";

// These are rendered as special UI or attachment content. Their source can
// contain hidden state, anchors, code, file data, or tool references.
const structuredContent = /<!--|<\/?[a-z][\w:-]*(?:\s|\/?>)|\x00|\[artifact:\/\/|(?:^|\n)\s*\[(?:file|document):|```(?:openui|keating-ui|ui-document)/i;

function textParts(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter(part => part?.type === "text" && typeof part.text === "string").map(part => part.text).join("\n");
}

/** The event supplies only messages emitted in this execution, including the sent learner prompt. */
export function currentTurnEvaluationContent(
	messages: readonly AgentMessage[],
): { input: string; output: string } | undefined {
	const userIndex = messages.findLastIndex(message => message.role === "user" || message.role === "user-with-attachments");
	const user = messages[userIndex];
	if (user?.role !== "user" || "attachments" in user) return undefined;
	// Flue stores a direct text send as a string. The composer stores arrays,
	// including older arrays with flattened, unlabelled attachment text.
	if (typeof user.content !== "string" && !("keatingTextOnlyComposer" in user && user.keatingTextOnlyComposer === true)) return undefined;
	const input = textParts(user.content);
	if (!input.trim() || structuredContent.test(input)) return undefined;

	const assistant = messages.slice(userIndex + 1).findLast(message => message.role === "assistant");
	if (!assistant || assistant.stopReason === "error" || assistant.stopReason === "aborted" || assistant.stopReason === "toolUse") return undefined;
	const visible = assistantTextParts(textParts(assistant.content)).filter(part => part.type === "text").map(part => part.text).join("");
	const notice = parseReviewNotice(visible);
	if (notice?.kind === "withheld") return undefined;
	const output = splitSearchSources(notice?.text ?? visible).text;
	if (!output.trim() || structuredContent.test(output)) return undefined;
	return { input: input.slice(0, 16_000), output: output.slice(0, 16_000) };
}
