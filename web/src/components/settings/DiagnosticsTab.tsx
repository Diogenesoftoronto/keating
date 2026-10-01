import { useState, useSyncExternalStore } from "react";
import { css, cx } from "../../../styled-system/css";
import { downloadTextFile } from "../../lib/browser-download";
import {
	buildDiagnosticReport,
	clearDiagnostics,
	getDiagnosticsSnapshot,
	subscribeDiagnostics,
} from "../../lib/diagnostics";
import {
	buildRawSessionDebugReport,
	clearSessionDebug,
	getSessionDebugSnapshot,
	setSessionDebugEnabled,
	subscribeSessionDebug,
	type SessionDebugEvent,
} from "../../lib/session-debug";
import { Toggle } from "../Toggle";
import { JudgementDiagnostics } from "../JudgementDiagnostics";
import { CopyDiagnosticButton } from "./CopyDiagnosticButton";
import { explainDiagnostic, buildHealthChecks, buildHealthText, groupProblems, overallStatus, type CheckStatus } from "../../lib/diagnostics-insights";
import { diagnosticReportMailto, readDiagnosticRuntimeSnapshot, sendDiagnosticReport } from "../../lib/diagnostics";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../../keating/model-prefs";
import { useConnectedProviders } from "./ProviderConnectPanel";
import { getProviders } from "@earendil-works/pi-ai/compat";

const stackClass = css({ display: "flex", flexDirection: "column", gap: "1.5rem" });
const sectionClass = css({ display: "flex", flexDirection: "column", gap: "0.75rem" });
const headingClass = css({ fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" });
const mutedClass = css({ fontSize: "0.75rem", color: "var(--muted-foreground)" });
const cardClass = css({
	display: "flex",
	flexDirection: "column",
	gap: "0.75rem",
	borderRadius: "0.5rem",
	border: "1px solid var(--border)",
	padding: "1rem",
});
const buttonClass = css({
	display: "inline-flex",
	height: "2.25rem",
	alignItems: "center",
	justifyContent: "center",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	paddingInline: "0.75rem",
	fontSize: "0.75rem",
	fontWeight: 500,
	_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
	_disabled: { cursor: "not-allowed", opacity: 0.5 },
});
const preClass = css({
	maxHeight: "24rem",
	overflow: "auto",
	borderRadius: "0.375rem",
	backgroundColor: "var(--muted)",
	padding: "0.75rem",
	whiteSpace: "pre-wrap",
	overflowWrap: "anywhere",
	fontFamily: "var(--mono-body)",
	fontSize: "0.7rem",
	lineHeight: "1.15rem",
	color: "var(--foreground)",
});
const summaryClass = css({
	cursor: "pointer",
	fontSize: "0.75rem",
	fontWeight: 600,
	color: "var(--foreground)",
});
const metricClass = css({ minWidth: 0 });
const metricValueClass = cx(headingClass, css({ display: "block", overflowWrap: "anywhere" }));

function displayJson(value: unknown): string {
	return JSON.stringify(value, null, 2) ?? String(value);
}

function eventLabel(event: SessionDebugEvent | null): string {
	if (!event) return "None captured";
	return `${event.kind}:${event.name}${event.status ? ` · ${event.status}` : ""}`;
}

function SessionInspector() {
	const snapshot = useSyncExternalStore(subscribeSessionDebug, getSessionDebugSnapshot, getSessionDebugSnapshot);
	const [status, setStatus] = useState("");
	const context = snapshot.modelContext;
	const failedTools = snapshot.toolRuns.filter((run) => run.status === "failed").length;

	const downloadRaw = () => {
		if (!window.confirm(
			"This raw report can contain your system prompt, conversation text, and tool arguments/results. Save it only somewhere you trust. Continue?",
		)) return;
		downloadTextFile("keating-session-debug-raw.json", buildRawSessionDebugReport(snapshot));
		setStatus("Sensitive raw session report downloaded locally.");
	};

	return (
		<section className={sectionClass} aria-labelledby="session-inspector-heading">
			<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "1rem" })}>
				<div className={css({ minWidth: 0, maxWidth: "44rem" })}>
					<h3 id="session-inspector-heading" className={headingClass}>Model session inspector</h3>
					<p className={cx(mutedClass, css({ marginTop: "0.25rem" }))}>
						Explicit local debug mode captures model-facing context, lifecycle hooks, provider routing, retries, and tool payloads in memory only.
					</p>
				</div>
				<div>
					<Toggle aria-label="Sensitive session debug mode" checked={snapshot.enabled} onChange={setSessionDebugEnabled} />
				</div>
			</div>

			{!snapshot.enabled ? (
				<div className={cardClass}>
					<strong className={headingClass}>Sensitive capture is off</strong>
					<p className={mutedClass}>
						Turn it on, then send or retry a message. Keating will show what it supplies to the model—not a claim about the model&apos;s private reasoning or semantic understanding.
					</p>
				</div>
			) : (
				<>
					<div className={cardClass}>
						<div className={css({ display: "grid", gap: "0.75rem", sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }, lg: { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" } })}>
							<div className={metricClass}><div className={mutedClass}>Latest hook</div><strong className={metricValueClass}>{eventLabel(snapshot.latestHook)}</strong></div>
							<div className={metricClass}><div className={mutedClass}>Latest event</div><strong className={metricValueClass}>{eventLabel(snapshot.latestEvent)}</strong></div>
							<div className={metricClass}><div className={mutedClass}>Tool runs</div><strong className={metricValueClass}>{snapshot.toolRuns.length} total · {failedTools} failed</strong></div>
							<div className={metricClass}><div className={mutedClass}>Session</div><strong className={metricValueClass}>{snapshot.sessionId ?? "Awaiting an agent event"}</strong></div>
						</div>
						{snapshot.transport && (
							<p className={mutedClass}>
								Route: {snapshot.transport.transport} · {snapshot.transport.provider}/{snapshot.transport.model} · hosted search {snapshot.transport.hostedWebSearch ? "on" : "off"}
							</p>
						)}
					</div>

					<div className={cardClass}>
						<div>
							<h4 className={headingClass}>Supplied model context</h4>
							<p className={mutedClass}>
								This is the last provider-bound system prompt, messages, and tool definitions, or a clearly labeled current-state preview until the next request. Token size is an approximate character-based estimate; provider tokenization remains authoritative.
							</p>
						</div>
						{context ? (
							<>
								<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.75rem", fontSize: "0.75rem" })}>
									<strong>{context.provider}/{context.model}</strong>
									<span>{context.source === "provider-bound" ? "provider-bound" : "current agent-state preview"}</span>
									<span>{context.messages.length} messages</span>
									<span>{context.tools.length} tools</span>
									<span>≈{context.estimatedTokens.toLocaleString()} tokens</span>
									{context.contextWindow && <span>{Math.round((context.estimatedTokens / context.contextWindow) * 100)}% of {context.contextWindow.toLocaleString()}</span>}
									<span>roles {Object.entries(context.messageRoles).map(([role, count]) => `${role}:${count}`).join(" · ") || "none"}</span>
								</div>
								<details>
									<summary className={summaryClass}>System prompt ({context.systemPrompt.length.toLocaleString()} characters)</summary>
									<pre className={preClass}>{context.systemPrompt || "(empty)"}</pre>
								</details>
								<details>
									<summary className={summaryClass}>Model-facing messages</summary>
									<pre className={preClass}>{displayJson(context.messages)}</pre>
								</details>
								<details>
									<summary className={summaryClass}>Available tool definitions</summary>
									<pre className={preClass}>{displayJson(context.tools)}</pre>
								</details>
							</>
						) : <p className={mutedClass}>No provider-bound context yet. Send or retry a message while debug mode is on.</p>}
					</div>

					<div className={cardClass}>
						<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: ".5rem" })}>
              <h4 className={headingClass}>Tool call timeline</h4>
              <CopyDiagnosticButton label="Copy failed tools" disabled={failedTools === 0} text={() => displayJson({ sessionId: snapshot.sessionId, transport: snapshot.transport, failures: snapshot.toolRuns.filter(run => run.status === "failed") })} />
            </div>
            <p className={mutedClass}>Copied tool details include captured arguments and results.</p>
						{snapshot.toolRuns.length === 0 ? <p className={mutedClass}>No tool calls captured.</p> : (
							<ol className={css({ display: "flex", maxHeight: "28rem", flexDirection: "column", gap: "0.5rem", overflowY: "auto" })}>
								{[...snapshot.toolRuns].reverse().map((run) => (
									<li key={run.callId} className={css({ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" })}>
										<details open={run.status === "failed"}>
											<summary className={summaryClass}>
												{run.name} · {run.status}{run.durationMs !== undefined ? ` · ${run.durationMs}ms` : ""}
											</summary>
											<CopyDiagnosticButton label={run.status === "failed" ? "Copy failure" : "Copy tool details"} text={() => displayJson({ callId: run.callId, name: run.name, status: run.status, arguments: run.arguments, result: run.result })} />
                        <pre className={preClass}>{displayJson({ callId: run.callId, arguments: run.arguments, result: run.result })}</pre>
										</details>
									</li>
								))}
							</ol>
						)}
					</div>

					<div className={cardClass}>
						<h4 className={headingClass}>Hook and runtime timeline</h4>
						{snapshot.events.length === 0 ? <p className={mutedClass}>No debug events captured.</p> : (
							<ol className={css({ display: "flex", maxHeight: "24rem", flexDirection: "column", gap: "0.4rem", overflowY: "auto" })}>
								{[...snapshot.events].reverse().map((entry) => (
									<li key={entry.id} className={css({ fontSize: "0.7rem", color: "var(--foreground)" })}>
										<time dateTime={entry.timestamp} className={css({ color: "var(--muted-foreground)" })}>{new Date(entry.timestamp).toLocaleTimeString()}</time>{" "}
										<code>{entry.kind}:{entry.name}</code>{entry.status ? ` · ${entry.status}` : ""}{entry.durationMs !== undefined ? ` · ${entry.durationMs}ms` : ""}
										<CopyDiagnosticButton label={entry.status === "failed" ? "Copy failure" : "Copy event"} text={() => displayJson(entry)} />
                    {entry.details !== undefined && <details><summary className={mutedClass}>Details</summary><pre className={preClass}>{displayJson(entry.details)}</pre></details>}
									</li>
								))}
							</ol>
						)}
						<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
							<button type="button" className={buttonClass} disabled={!context && snapshot.events.length === 0} onClick={downloadRaw}>Download raw session report</button>
							<button type="button" className={buttonClass} onClick={() => { clearSessionDebug(); setStatus("Sensitive session data cleared from memory."); }}>Clear session capture</button>
						</div>
						{status && <p role="status" className={mutedClass}>{status}</p>}
					</div>
				</>
			)}
		</section>
	);
}

function SanitizedDiagnostics() {
	const entries = useSyncExternalStore(subscribeDiagnostics, getDiagnosticsSnapshot, getDiagnosticsSnapshot);
	const [status, setStatus] = useState("");
	const warningCount = entries.filter((entry) => entry.level === "warning").length;
	const errorCount = entries.filter((entry) => entry.level === "error").length;
	const recentEntries = entries.slice(-50).reverse();


	return (
		<section className={sectionClass} aria-labelledby="sanitized-diagnostics-heading">
			<div>
				<h3 id="sanitized-diagnostics-heading" className={headingClass}>Safe runtime diagnostics</h3>
				<p className={mutedClass}>
					Up to 200 sanitized model, stream, authentication, signup/login, warning, and browser error events stay in memory. Prompts, replies, tool payloads, credentials, and URL parameters are excluded from this shareable report.
				</p>
			</div>
			<div className={cardClass}>
				<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}>
					<div><strong className={headingClass}>{entries.length} events</strong><div className={mutedClass}>{warningCount} warnings · {errorCount} errors</div></div>
					<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
						<CopyDiagnosticButton label="Copy failures" disabled={errorCount === 0} text={() => buildDiagnosticReport({ entries: entries.filter(entry => entry.level === "error") })} />
            <CopyDiagnosticButton label="Copy safe report" text={() => buildDiagnosticReport()} />
						<button type="button" className={buttonClass} onClick={() => { downloadTextFile("keating-diagnostics.json", buildDiagnosticReport()); setStatus("Sanitized report downloaded."); }}>Download safe report</button>
						<button type="button" className={buttonClass} disabled={entries.length === 0} onClick={() => { clearDiagnostics(); setStatus("Safe diagnostics cleared."); }}>Clear</button>
					</div>
				</div>
				{status && <p role="status" className={mutedClass}>{status}</p>}
				{recentEntries.length === 0 ? <p className={mutedClass}>No safe diagnostic events recorded in this page session.</p> : (
					<ol className={css({ display: "flex", maxHeight: "24rem", flexDirection: "column", gap: "0.5rem", overflowY: "auto" })}>
						{recentEntries.map((entry) => (
							<li key={entry.id} className={css({ borderTop: "1px solid var(--border)", paddingTop: "0.5rem", fontSize: "0.7rem" })}>
								<time dateTime={entry.timestamp} className={css({ color: "var(--muted-foreground)" })}>{new Date(entry.timestamp).toLocaleTimeString()}</time>{" "}
								<strong className={css({ color: entry.level === "error" ? "var(--destructive)" : "var(--foreground)" })}>{entry.level}</strong>{" "}
								<code>{entry.source}</code> · {entry.message}
                  <CopyDiagnosticButton label={entry.level === "error" ? "Copy failure" : "Copy event"} text={() => displayJson(entry)} />
								{entry.metadata && <code className={css({ display: "block", overflowWrap: "anywhere", color: "var(--muted-foreground)" })}>{JSON.stringify(entry.metadata)}</code>}
							</li>
						))}
					</ol>
				)}
			</div>
		</section>
	);
}

const STATUS_TONE: Record<CheckStatus, string> = { ok: "var(--success, #16a34a)", warning: "#d97706", problem: "var(--destructive)" };
const STATUS_GLYPH: Record<CheckStatus, string> = { ok: "✓", warning: "!", problem: "✕" };
const BANNER: Record<CheckStatus, string> = {
	ok: "Everything looks healthy",
	warning: "Working, with a few things worth a look",
	problem: "Something needs your attention",
};
const openTab = (tab: string) => window.dispatchEvent(new CustomEvent("keating:settings-tab", { detail: tab }));
const PROVIDER_LIST = [...getProviders(), "notorganic"];

function HealthSummary() {
	const entries = useSyncExternalStore(subscribeDiagnostics, getDiagnosticsSnapshot, getDiagnosticsSnapshot);
	const connected = useConnectedProviders(PROVIDER_LIST);
	const [status, setStatus] = useState("");
	const [sending, setSending] = useState(false);
	const checks = buildHealthChecks({ runtime: readDiagnosticRuntimeSnapshot(), entries, connectedProviderCount: connected.size });
	const overall = overallStatus(checks);
	const problems = groupProblems(entries);

	const sendReport = async () => {
		setSending(true);
		const summary = problems[0]?.explanation.title ?? "Diagnostics from settings";
		const delivery = await sendDiagnosticReport({ summary });
		setSending(false);
		if (delivery) { setStatus("Report sent. Thank you."); return; }
		window.location.href = diagnosticReportMailto({ summary });
		setStatus("Couldn't send automatically, so your email app was opened with the report instead.");
	};

	return (
		<section className={sectionClass} aria-labelledby="health-heading">
			<div className={cx(cardClass, css({ flexDirection: "row", alignItems: "center", gap: "0.75rem" }))}>
				<span aria-hidden className={css({ fontSize: "1.25rem", fontWeight: 700 })} style={{ color: STATUS_TONE[overall] }}>{STATUS_GLYPH[overall]}</span>
				<div>
					<h3 id="health-heading" className={headingClass}>{BANNER[overall]}</h3>
					<p className={mutedClass}>A quick check of the things that most often stop Keating from working.</p>
				</div>
				<div className={css({ marginLeft: "auto" })}>
					<CopyDiagnosticButton label="Copy summary" text={() => buildHealthText({ checks, problems })} />
				</div>
			</div>
			<ul className={cx(cardClass, css({ listStyle: "none", gap: "0.5rem" }))}>
				{checks.map((c) => (
					<li key={c.id} className={css({ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" })}>
						<span aria-hidden style={{ color: STATUS_TONE[c.status], width: "1rem", textAlign: "center", fontWeight: 700 }}>{STATUS_GLYPH[c.status]}</span>
						<div className={css({ flex: 1, minWidth: "12rem" })}>
							<div className={css({ fontSize: "0.8125rem", fontWeight: 500 })}>{c.label}</div>
							<div className={mutedClass}>{c.detail}</div>
						</div>
						{c.fix && <button type="button" className={buttonClass} onClick={() => (c.fix!.reload ? window.location.reload() : c.fix!.tab && openTab(c.fix!.tab))}>{c.fix.label}</button>}
					</li>
				))}
			</ul>
			{problems.length > 0 && (
				<div className={cardClass}>
					<h4 className={headingClass}>What happened</h4>
					<ul className={css({ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.75rem" })}>
						{problems.map((g) => (
							<li key={`${g.level}-${g.explanation.title}-${g.lastSeen}`} className={css({ display: "flex", flexDirection: "column", gap: "0.25rem" })}>
								<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}>
									<div className={css({ fontSize: "0.8125rem", fontWeight: 500, minWidth: 0 })}>
										{g.explanation.title}{g.count > 1 ? ` · ${g.count}×` : ""}
										<span className={mutedClass}> · last at {new Date(g.lastSeen).toLocaleTimeString()}</span>
									</div>
									<CopyDiagnosticButton label="Copy details" text={() => buildDiagnosticReport({ entries: entries.filter((e) => e.level === g.level && explainDiagnostic(e).title === g.explanation.title) })} />
								</div>
								<div className={cx(mutedClass, css({ overflowWrap: "anywhere" }))}>{g.explanation.meaning}</div>
								{g.explanation.fix && <button type="button" className={cx(buttonClass, css({ alignSelf: "flex-start", marginTop: "0.25rem" }))} onClick={() => (g.explanation.fix!.reload ? window.location.reload() : g.explanation.fix!.tab && openTab(g.explanation.fix!.tab))}>{g.explanation.fix.label}</button>}
							</li>
						))}
					</ul>
				</div>
			)}
			<div className={cardClass}>
				<h4 className={headingClass}>Still stuck?</h4>
				<p className={mutedClass}>Send us a sanitized report. It never includes your prompts, replies, or keys.</p>
				<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
					<button type="button" className={buttonClass} disabled={sending} onClick={() => void sendReport()}>{sending ? "Sending…" : "Send report to Keating"}</button>
					<CopyDiagnosticButton label="Copy errors only" disabled={!entries.some((e) => e.level === "error")} text={() => buildDiagnosticReport({ entries: entries.filter((e) => e.level === "error") })} />
					<CopyDiagnosticButton label="Copy everything" text={() => buildDiagnosticReport()} />
				</div>
				{status && <p role="status" className={mutedClass}>{status}</p>}
			</div>
		</section>
	);
}

export function DiagnosticsTab() {
	return (
		<div className={stackClass}>
			<HealthSummary />
			<details>
				<summary className={summaryClass}>Advanced: technical logs and session inspector</summary>
				<div className={cx(stackClass, css({ marginTop: "1rem" }))}>
					<JudgementDiagnostics controls /><SessionInspector /><SanitizedDiagnostics />
				</div>
			</details>
		</div>
	);
}
