import { useState } from "react";
import { css } from "../../styled-system/css";
import { buildDiagnosticReport, diagnosticReportMailto, sendDiagnosticReport, type DiagnosticDelivery } from "../lib/diagnostics";
import { loadKeatingUiSettings, saveKeatingUiSettings } from "../keating/ui-settings";

interface ErrorDiagnosticsActionsProps {
	/** Short, sanitized description of the failure, used as the report subject. */
	summary: string;
}

type SendState = "idle" | "sending" | "accepted" | "failed";

const rowClass = css({
	marginTop: "0.5rem",
	display: "flex",
	flexWrap: "wrap",
	alignItems: "center",
	gap: "0.5rem",
});

const actionClass = css({
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	paddingInline: "0.625rem",
	paddingBlock: "0.375rem",
	fontSize: "0.75rem",
	fontWeight: 500,
	color: "var(--foreground)",
	_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
	_disabled: { opacity: 0.5 },
});

const noteClass = css({
	flexBasis: "100%",
	fontSize: "0.6875rem",
	lineHeight: 1.45,
	color: "var(--muted-foreground)",
});

/**
 * The escape hatch for failures the learner cannot fix by retrying: report the
 * problem so it can be resolved, or email it when diagnostic sharing is off.
 * Consent is asked once, here, and can be revoked from the same control.
 */
export function ErrorDiagnosticsActions({ summary }: ErrorDiagnosticsActionsProps) {
	const [reporting, setReporting] = useState(() => loadKeatingUiSettings().diagnosticsReporting);
	const [state, setState] = useState<SendState>("idle");
	const [delivery, setDelivery] = useState<DiagnosticDelivery | null>(null);

	const setReportingConsent = (enabled: boolean) => {
		saveKeatingUiSettings({ ...loadKeatingUiSettings(), diagnosticsReporting: enabled });
		setReporting(enabled);
	};

	const send = async () => {
		setState("sending");
		const result = await sendDiagnosticReport({ summary, report: buildDiagnosticReport() });
		setDelivery(result || null);
		setState(result ? "accepted" : "failed");
	};

	if (reporting) {
		return (
			<div className={rowClass}>
				<button
					type="button"
					className={actionClass}
					disabled={state === "sending" || state === "accepted"}
					onClick={() => void send()}
				>
					{state === "accepted"
						? "Diagnostics accepted"
						: state === "sending"
							? "Sending diagnostics…"
							: state === "failed"
								? "Retry sending diagnostics"
								: "Send diagnostics"}
				</button>
				{state === "failed" && (
					<a className={actionClass} href={diagnosticReportMailto({ summary })}>Email it instead</a>
				)}
				{state === "accepted" && (
					<p className={noteClass}>
						{delivery === "log"
							? "The sanitized report was accepted into the server log. It was not sent by email."
							: "The sanitized report was accepted by the diagnostics service; this does not confirm inbox delivery."}
					</p>
				)}
				<button type="button" className={actionClass} onClick={() => setReportingConsent(false)}>
					Turn off diagnostics
				</button>
				{state === "failed" && (
					<p className={noteClass}>
						The report could not be delivered, so nothing was recorded. Emailing it sends the same sanitized text.
					</p>
				)}
			</div>
		);
	}

	return (
		<div className={rowClass}>
			<button
				type="button"
				className={actionClass}
				disabled={state === "sending"}
				onClick={() => {
					setReportingConsent(true);
					void send();
				}}
			>
				{state === "sending" ? "Sending diagnostics…" : "Turn on diagnostics and send this"}
			</button>
			<a className={actionClass} href={diagnosticReportMailto({ summary })}>Email this error instead</a>
			<p className={noteClass}>
				Diagnostics carry the app version, page, and sanitized error messages. Prompts, replies, tool
				payloads, and credentials are removed before sending. You can turn sharing off at any time.
			</p>
		</div>
	);
}
