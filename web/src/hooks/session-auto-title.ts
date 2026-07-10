/** Do not ask a model for a title until it has two actual learner exchanges. */
export function hasAutoTitleContext(messages: Array<{ role?: unknown }>): boolean {
	let awaitingAssistant = false;
	let completedTurns = 0;
	for (const message of messages) {
		if (message.role === "user" || message.role === "user-with-attachments") {
			awaitingAssistant = true;
			continue;
		}
		if (message.role === "assistant" && awaitingAssistant) {
			completedTurns += 1;
			awaitingAssistant = false;
			if (completedTurns >= 2) return true;
		}
	}
	return false;
}
