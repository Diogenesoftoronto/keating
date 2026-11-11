import { useId, useState } from "react";
import { FileDown, Printer } from "lucide-react";
import type { UiTaskNode } from "@keating/learner-contracts";
import { css } from "../../../styled-system/css";
import { downloadTextFile } from "../../lib/browser-download";
import { assignmentFileName, buildAssignmentMarkdown, buildAssignmentPrintHtml, type AssignmentAnswers } from "../../keating/homework/print-assignment";
import { printHtmlDocument } from "./print-frame";

const group = css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", minWidth: 0 });
const control = css({
	display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.375rem",
	minHeight: "2.75rem", maxWidth: "100%", border: "1px solid var(--border)", borderRadius: "{radii.keating}",
	background: "var(--background)", color: "var(--foreground)", paddingInline: "0.75rem",
	fontFamily: "inherit", fontSize: "0.8125rem", fontWeight: 600, lineHeight: 1.3, cursor: "pointer",
	_hover: { borderColor: "var(--primary)" },
	_focusVisible: { outline: "3px solid var(--primary)", outlineOffset: "2px" },
	_disabled: { opacity: 0.55, cursor: "not-allowed" },
	"& svg": { width: "1rem", height: "1rem", flexShrink: 0 },
});

function hasAnswers(answers: AssignmentAnswers | undefined): boolean {
	return !!answers && (!!answers.submission?.trim() || Object.values(answers.notes ?? {}).some((note) => note.trim()));
}

/**
 * Print a task for pen-and-paper work, or save it as Markdown. When the
 * learner has already written something, both a blank copy and a copy with
 * their answers are offered.
 */
export function PrintAssignmentButton({ node, answers, sessionTitle, print = printHtmlDocument }: {
	node: UiTaskNode;
	answers?: AssignmentAnswers;
	sessionTitle?: string;
	/** Injectable for tests. */
	print?: (html: string) => Promise<void>;
}) {
	const statusId = useId();
	const [status, setStatus] = useState("");
	const written = hasAnswers(answers);
	const run = (mode: "blank" | "answers") => {
		setStatus("");
		void print(buildAssignmentPrintHtml(node, { mode, answers, sessionTitle }))
			.catch((cause) => setStatus(cause instanceof Error ? cause.message : "Printing is not available here. Try Download as Markdown."));
	};
	const download = () => {
		try {
			downloadTextFile(assignmentFileName(node, "md"), buildAssignmentMarkdown(node, { mode: written ? "answers" : "blank", answers, sessionTitle }), "text/markdown;charset=utf-8");
			setStatus("Saved as Markdown.");
		} catch {
			setStatus("Could not save the file. Try again.");
		}
	};
	return <div className={group} role="group" aria-label={`Print or save ${node.title}`} aria-describedby={status ? statusId : undefined} data-print-assignment={node.id}>
		<button type="button" className={control} onClick={() => run("blank")}>
			<Printer aria-hidden="true" />{written ? "Print blank" : "Print"}
		</button>
		{written ? <button type="button" className={control} onClick={() => run("answers")}>
			<Printer aria-hidden="true" />Print with my answers
		</button> : null}
		<button type="button" className={control} onClick={download}>
			<FileDown aria-hidden="true" />Download as Markdown
		</button>
		<span id={statusId} role="status" aria-live="polite" className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{status}</span>
	</div>;
}
