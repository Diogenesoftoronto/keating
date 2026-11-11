import { useAui, useAuiState } from "@assistant-ui/react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { useState } from "react";
import { css } from "../../styled-system/css";

const rowClass = css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" });
const buttonClass = css({
	display: "inline-flex", alignItems: "center", gap: "0.375rem",
	minHeight: "2rem", paddingInline: "0.75rem", borderRadius: "0.5rem",
	border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)",
	fontSize: "0.8125rem", cursor: "pointer",
	_hover: { background: "var(--muted)" },
	_disabled: { opacity: 0.55, cursor: "not-allowed" },
	_focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" },
});
const hintClass = css({ fontSize: "0.75rem", color: "var(--muted-foreground)" });

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
	return (
		<div className={rowClass} data-withheld-recovery="">
			{learnerText && (
				<button type="button" className={buttonClass} onClick={tryAgain} disabled={running || sent}>
					<RotateCcw size={13} aria-hidden /> Try again
				</button>
			)}
			<button type="button" className={buttonClass} onClick={() => window.location.reload()}>
				<RefreshCw size={13} aria-hidden /> Reload Keating
			</button>
			<span className={hintClass}>If this keeps happening, reload the page or start a new conversation.</span>
		</div>
	);
}
