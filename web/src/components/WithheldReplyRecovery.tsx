import { useAui, useAuiState } from "@assistant-ui/react";
import { Button } from "../design-system/kit";
import { useState } from "react";
/** Text of the learner message this reply answered, if it was plain text. */
function lastLearnerText(messages: readonly { role: string; content: readonly { type: string; text?: string }[] }[]): string | null {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]!;
		if (message.role !== "user") continue;
		const text = message.content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n").trim();
		return text || null;
	}
	return null;
}

/**
 * Ways out of a reply Keating couldn't produce. Only the learner's click sends
 * anything: nothing here retries on its own, so a reload never resends a turn.
 */
export function WithheldReplyRecovery() {
	const aui = useAui();
	const isLast = useAuiState(({ message }) => message.isLast);
	const running = useAuiState(({ thread }) => thread.isRunning);
	const learnerText = useAuiState(({ thread }) => lastLearnerText(thread.messages as never));
	const [sent, setSent] = useState(false);
	if (!isLast) return null;
	const tryAgain = () => {
		if (!learnerText || running || sent) return;
		setSent(true);
		aui.thread().append({ role: "user", content: [{ type: "text", text: learnerText }] });
	};
  return <div data-withheld-recovery="">
    <div className="turn-failure__actions">
      <Button size="sm" variant={learnerText ? "outline" : "primary"} glyph="refresh" onClick={() => window.location.reload()}>Reload Keating</Button>
      {learnerText && <Button size="sm" variant="primary" glyph="refresh" onClick={tryAgain} disabled={running || sent}>Try again</Button>}
    </div>
    <small>If this keeps happening, reload the page or start a new conversation.</small>
  </div>;
}
