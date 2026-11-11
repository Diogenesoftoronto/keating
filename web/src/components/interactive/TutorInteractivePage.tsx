import { useState } from "react";
import { ChevronDown, Code2 } from "lucide-react";
import { css } from "../../../styled-system/css";
import {
	INTERACTIVE_SHARED_EVENT,
	parseTutorPagePayload,
	type InteractiveSharedDetail,
} from "../../keating/interactive-page/tutor-page";
import { InteractivePage } from "./InteractivePage";

const styles = {
	wrap: css({ display: "grid", gap: "0.5rem", minW: 0 }),
	bar: css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }),
	title: css({ fontSize: "0.8125rem", fontWeight: "600", minW: 0, overflowWrap: "anywhere" }),
	button: css({ display: "inline-flex", alignItems: "center", gap: "0.35rem", minH: "2.75rem", px: "0.7rem", border: "1.5px solid var(--line)", borderRadius: "{radii.keating}", fontSize: "0.8125rem", fontWeight: "600", cursor: "pointer", transitionProperty: "background-color, border-color", transitionDuration: "{durations.fast}", transitionTimingFunction: "{easings.standard}", _hover: { borderColor: "var(--ink)" }, _active: { bg: "var(--accent)" }, _focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" } }),
	source: css({ maxH: "22rem", overflow: "auto", border: "1px solid var(--border)", borderRadius: "{radii.keating}", p: "0.75rem", fontSize: "0.75rem", lineHeight: "1.5", whiteSpace: "pre-wrap", overflowWrap: "anywhere", bg: "var(--muted)" }),
	note: css({ fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	status: css({ fontSize: "0.8125rem" }),
};

/**
 * A tutor-authored interactive page in the chat. The learner can read the
 * code behind it, and a result they share is handed to the conversation as
 * their next turn.
 */
export function TutorInteractivePage({ payloadText }: { payloadText: string }) {
	const payload = parseTutorPagePayload(payloadText);
	const [showSource, setShowSource] = useState(false);
	const [shared, setShared] = useState<"sent" | "failed" | null>(null);
	if (!payload) return null;
	const sourceId = `interactive-source-${payload.id}`;

	return <div className={styles.wrap}>
		<div className={styles.bar}>
			<span className={styles.title}>{payload.title}</span>
			<button type="button" className={styles.button} aria-expanded={showSource} aria-controls={sourceId} onClick={() => setShowSource((open) => !open)}>
				<Code2 size={14} aria-hidden="true" /> {showSource ? "Hide the code" : "View the code"} <ChevronDown className="k-chevron" size={14} aria-hidden="true" />
			</button>
		</div>
		<InteractivePage
			pageId={payload.id}
			title={payload.title}
			html={payload.html}
			description={payload.description}
			libraries={payload.libraries}
			onShare={(result) => {
				const detail: InteractiveSharedDetail = { pageId: payload.id, title: payload.title, purpose: payload.purpose, result };
				// Not cancelled means a conversation picked it up.
				const delivered = !window.dispatchEvent(new CustomEvent(INTERACTIVE_SHARED_EVENT, { detail, cancelable: true }));
				setShared(delivered ? "sent" : "failed");
				return delivered;
			}}
		/>
		<p className={styles.status} role="status" aria-live="polite">
			{shared === "sent" ? <span className="k-receipt">Sent to Keating.</span> : shared === "failed" ? "This could not be sent: no active conversation is open here." : ""}
		</p>
		{showSource && <div id={sourceId} className="k-reveal">
			<p className={styles.note}>The HTML, CSS and JavaScript your tutor wrote for this page. It runs in a locked-down frame with no access to your account or the network.</p>
			<pre className={styles.source} tabIndex={0} aria-label={`Code for ${payload.title}`}><code>{payload.html}</code></pre>
		</div>}
	</div>;
}
