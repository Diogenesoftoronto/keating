import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import { css, cx } from "../../styled-system/css";
import "./runnable-code-figure.css";
import { Button, IconButton, Loading } from "../design-system/kit";

import {
	bootNodePod,
	isNodePodActive,
	nodePodRunScript,
	transpileTsToJs,
	type ShellSession,
} from "../keating/nodepod-runtime";
import {
	isPendingNotebookRun,
	startOrRefreshCodeRun,
	type HostedNotebookRun,
} from "../notorganic-provider/notebook";
import { browserExecutionSignals, chooseCodeExecutor } from "../keating/execution-policy";
import { isStrudelBlock } from "./labs/strudel-detect";
import { CodeLanguageIcon } from "./CodeLanguageIcon";
import { runSystemSnippet, systemSnippetEnvironment, SYSTEM_ENVIRONMENT_LABELS } from "../keating/system-snippet";
import { DiscussSnippetRun } from "./DiscussSnippetRun";
import { editableCodeLanguage } from "../keating/editable-code-language";
import { MusicLab } from "./MusicLab";
import type { UiMusicLabNode } from "@keating/learner-contracts";

const EditedCodePreview = lazy(() => import("./CodeHighlighter"));
type LocalResult = Pick<ShellSession, "ok" | "exitCode" | "stdout" | "stderr">;

function wasmArguments(argsText: string, exportName: string): (number | string)[] {
	if (!argsText.trim()) return [];
	if (!exportName.trim()) throw new Error("Enter the name of the exported function to call with these arguments.");
	let args: unknown;
	try { args = JSON.parse(argsText); } catch { throw new Error('Use a JSON array for arguments, such as [3, 4] or ["12n"] for i64.'); }
	if (!Array.isArray(args) || !args.every(arg => typeof arg === "number" || typeof arg === "string")) {
		throw new Error('Arguments must be an array of numbers or quoted i64 values such as "12n".');
	}
	return args;
}

function normalizeLanguage(language: string): string {
	return language.trim().toLowerCase();
}

export function isRunnableCodeLanguage(language: string, source = ""): boolean {
	return editableCodeLanguage(language) !== null || systemSnippetEnvironment(language, source) !== null;
}

export async function prepareRunnableCode(code: string, language: string): Promise<{ code: string; filename: string }> {
	const lang = normalizeLanguage(language);
	if (lang === "ts" || lang === "typescript") {
		return {
			code: await transpileTsToJs(code, "chat-snippet.ts"),
			filename: `/workspace/_chat_snippet_${Date.now()}.js`,
		};
	}
	return {
		code,
		filename: `/workspace/_chat_snippet_${Date.now()}.js`,
	};
}

/**
 * The code of the fence the model is still writing, or null when nothing is in
 * flight. Provided by MarkdownBlock so a block can tell whether it is complete.
 */
export const StreamingCodeContext = createContext<string | null>(null);

/**
 * Find the body of an unterminated ``` fence. Markdown fences toggle, so an odd
 * number of fence lines means the last one is still open and its content is
 * arriving token by token.
 */
export function inProgressFenceCode(content: string): string | null {
	const lines = content.split("\n");
	let openIndex = -1;
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*```/.test(lines[i])) openIndex = openIndex === -1 ? i : -1;
	}
	if (openIndex === -1) return null;
	return lines.slice(openIndex + 1).join("\n").replace(/\n$/, "");
}

function sessionOutput(session: LocalResult): string {
	const chunks = [
		session.stdout ? `stdout\n${session.stdout.trimEnd()}` : "",
		session.stderr ? `stderr\n${session.stderr.trimEnd()}` : "",
	].filter(Boolean);
	return chunks.join("\n\n") || "(no output)";
}

function hostedOutput(run: HostedNotebookRun): string {
	const chunks = [
		run.stdout ? `stdout\n${run.stdout.trimEnd()}` : "",
		run.stderr ? `stderr\n${run.stderr.trimEnd()}` : "",
		run.error_code ? `error\n${run.error_code}` : "",
	].filter(Boolean);
	return chunks.join("\n\n") || "(no output)";
}

export function RunnableCodeBlock({
	children,
	code,
	language,
}: {
	children: ReactNode;
	code: string;
	language: string;
}) {
	const [copied, setCopied] = useState(false);
	const [draft, setDraft] = useState<string | null>(null);
	const editableCode = draft ?? code;
	const [editing, setEditing] = useState(false);
	const [running, setRunning] = useState(false);
	const [result, setResult] = useState<LocalResult | null>(null);
	const [trace, setTrace] = useState(false);
	const [exportName, setExportName] = useState("");
	const [argsText, setArgsText] = useState("");
	const [stopped, setStopped] = useState(false);
	// Once a manifest is identified, keep its diagnostics available while a learner
	// edits an identifying field or temporarily leaves the document incomplete.
	const environment = useMemo(() => systemSnippetEnvironment(language, code)
		?? systemSnippetEnvironment(language, editableCode), [language, code, editableCode]);
	const [hostedAttempt, setHostedAttempt] = useState<{ code: string; language: string; run: HostedNotebookRun } | null>(null);
	const hostedResult = hostedAttempt?.code === editableCode && hostedAttempt.language === language ? hostedAttempt.run : null;
	const pending = hostedAttempt?.code === editableCode && hostedAttempt.language === language && isPendingNotebookRun(hostedAttempt.run)
		? hostedAttempt.run : null;
	const inFlight = useRef<AbortController | null>(null);
	const [error, setError] = useState("");
	const [connectionVersion, setConnectionVersion] = useState(0);
	const executor = useMemo(() =>
		typeof navigator === "undefined"
			? "unavailable"
			: chooseCodeExecutor(language, editableCode, browserExecutionSignals()),
		[connectionVersion, editableCode, language],
	);
	const runnable = !!environment || (editableCodeLanguage(language) !== null && executor !== "unavailable");
	const hosted = executor === "cloud";
	const dirty = editableCode !== code;

	useEffect(() => {
		const refresh = () => setConnectionVersion((version) => version + 1);
		window.addEventListener("online", refresh);
		window.addEventListener("offline", refresh);
		return () => {
			window.removeEventListener("online", refresh);
			window.removeEventListener("offline", refresh);
		};
	}, []);

	// This block is still being written when its code matches the open fence.
	const streamingCode = useContext(StreamingCodeContext);
	const streaming = streamingCode !== null && streamingCode === code;

	// Strudel patterns are JavaScript-shaped but have no Node runtime. Route them
	// to the isolated audio sandbox instead of failing inside NodePod.
	const strudel = !streaming && isStrudelBlock(language, editableCode);
	const musicNode = useMemo<UiMusicLabNode>(() => ({
		type: "music-lab",
		id: "chat-strudel-snippet",
		title: "Strudel",
		code: editableCode,
		visualization: "pianoroll",
	}), [editableCode]);

	useEffect(() => {
		setDraft(null);
		setEditing(false);
		setTrace(false);
		setExportName("");
		setArgsText("");
		setResult(null);
		setHostedAttempt(null);
		setError("");
		setStopped(false);
		setRunning(false);
		return () => {
			inFlight.current?.abort();
			inFlight.current = null;
		};
	}, [code, language]);

	function clearRun() {
		setResult(null);
		setStopped(false);
		setError("");
	}

	function stop() {
		inFlight.current?.abort();
		inFlight.current = null;
		setRunning(false);
		setStopped(true);
	}

	const status = useMemo(() => {
		if (streaming) return "writing…";
		if (strudel) return "Runs in the Strudel sandbox";
		if (running) return hosted ? "Running in Cloudflare" : "Running on this device";
		if (stopped) return "Stopped";
		if (error) return pending ? "Could not refresh" : "Run failed";
		if (hostedResult) return hostedResult.status === "succeeded" ? "Finished" : hostedResult.status;
		if (result) return result.ok ? "Finished" : `Exit ${result.exitCode ?? "unknown"}`;
		if (environment) return "";
		if (executor === "unavailable" && isRunnableCodeLanguage(language)) {
			// Distinguish "no network" from "hosted execution is switched off";
			// both reach this branch but they mean different things to the reader.
			return typeof navigator !== "undefined" && !navigator.onLine
				? "Unavailable offline"
				: "Hosted runs unavailable";
		}
		return runnable ? (hosted ? "Runs in Cloudflare" : "Runs on this device") : "Not runnable";
	}, [environment, error, executor, hosted, hostedResult, language, pending, result, runnable, running, stopped, streaming, strudel]);

	const run = useCallback(async () => {
		if (!runnable || streaming || inFlight.current) return;
		const controller = new AbortController();
		inFlight.current = controller;
		setRunning(true);
		setStopped(false);
		setError("");
		setResult(null);
		if (!pending) setHostedAttempt(null);
		try {
			if (environment) {
				const args = environment === "wasm" ? wasmArguments(argsText, exportName) : undefined;
				const output = await runSystemSnippet(environment, editableCode, controller.signal, {
					trace: environment === "linux" && trace,
					exportName: environment === "wasm" ? exportName.trim() || undefined : undefined,
					args,
				});
				if (!controller.signal.aborted) setResult({ ...output, ok: output.exitCode === 0 });
				return;
			}
			if (hosted || pending) {
				const normalized = normalizeLanguage(language);
				const hostedLanguage = normalized === "py" || normalized === "python" ? "python" : "typescript";
				const signals = browserExecutionSignals();
				await startOrRefreshCodeRun({
					code: editableCode,
					language: hostedLanguage,
					filename: hostedLanguage === "python" ? "notebook.py" : "notebook.ts",
					execution: {
						executor: "cloud",
						device_class: signals.deviceClass,
						network_class: signals.networkClass,
						code_bytes: new TextEncoder().encode(editableCode).byteLength,
					},
				}, pending, run => { if (!controller.signal.aborted) setHostedAttempt({ code: editableCode, language, run }); });
				return;
			}
			if (!isNodePodActive()) {
				const pod = await bootNodePod();
				if (!pod) throw new Error("NodePod could not boot in this browser session.");
			}
			const prepared = await prepareRunnableCode(editableCode, language);
			const session = await nodePodRunScript(prepared.code, prepared.filename);
			if (!controller.signal.aborted) setResult(session);
		} catch (err) {
			if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
		} finally {
			if (inFlight.current === controller) {
				inFlight.current = null;
				setRunning(false);
			}
		}
	}, [argsText, editableCode, environment, exportName, hosted, language, pending, runnable, streaming, trace]);

	const copyCode = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(editableCode);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not copy code.");
		}
	}, [editableCode]);

	const environmentLabel = environment ? SYSTEM_ENVIRONMENT_LABELS[environment] : hostedResult ? "Hosted notebook" : "NodePod";
	const output = error || (hostedResult ? hostedOutput(hostedResult) : result ? sessionOutput(result) : "");
	const hasFinishedRun = !!result || (!!hostedResult && !isPendingNotebookRun(hostedResult));
	const invocation = environment === "wasm" && exportName.trim()
		? `${exportName.trim()} · arguments ${argsText.trim() || "[]"}` : undefined;

	return (
		// One frame: the code surface. The toolbar sits on open space above it and
		// the output below it, separated by rules rather than nested boxes.
		<div className="ch-code">
			<div className="ch-code-toolbar">
				<div className="ch-code-caption" data-glyph-host>
					<b className="ch-code-language">
						<CodeLanguageIcon language={strudel ? "strudel" : language} />
						<span>{strudel ? "Strudel" : language || "text"}</span>
					</b>
					{environment && !streaming && <span className="ch-code-environment">{environmentLabel}</span>}
					{running || streaming ? <Loading size="inline" label={status} /> : <span role="status">{status}</span>}
				</div>
				{!streaming && <div className="ch-code-actions">
					<IconButton size="sm" label={editing ? "Preview code" : "Edit code"} pressed={editing}
						glyph={editing ? "eye" : "edit"} onClick={() => {
							setEditing(value => !value);
							setError("");
						}} />
					<IconButton size="sm" className="ch-code-copy" data-copied={copied || undefined}
						label={copied ? "Copied" : "Copy code"} glyph={copied ? "check" : "copy"} onClick={copyCode} />
					{!strudel && <Button size="sm" variant="outline" glyph={running && environment ? "stop" : "play"}
						onClick={running && environment ? stop : run} disabled={!runnable || (running && !environment)}
						aria-busy={running && !environment}
						title={pending ? "Check the existing cloud run for output" : environment ? environmentLabel : status}>
						{running && environment ? "Stop" : pending ? "Refresh output" : "Run"}
					</Button>}
				</div>}
			</div>

			{editing && !streaming ? (
				<div className={css({ overflow: "hidden", borderRadius: "0.5rem", backgroundColor: "#0d1117" })}>
					<textarea
						value={editableCode}
						readOnly={running}
						onChange={(event) => { setDraft(event.target.value); clearRun(); }}
						spellCheck={false}
						className={css({ minHeight: "12rem", width: "100%", resize: "vertical", backgroundColor: "transparent", padding: "1rem", fontFamily: "var(--mono-display)", fontSize: "0.82rem", lineHeight: "1.625", color: "#c9d1d9", outline: "none" })}
						aria-label="Editable code"
					/>
					{dirty && (
						<div className={css({ display: "flex", justifyContent: "flex-end", borderTop: "1px solid color-mix(in srgb, white 10%, transparent)", paddingInline: "0.75rem", paddingBlock: "0.375rem" })}>
							<button
								type="button"
								disabled={running}
								onClick={() => {
									setDraft(null);
									clearRun();
								setHostedAttempt(current => current?.code === code && current.language === language && isPendingNotebookRun(current.run) ? current : null);
								}}
								className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, white 15%, transparent)", paddingInline: "0.5rem", paddingBlock: "0.25rem", fontSize: "11px", fontWeight: 500, color: "#c9d1d9", transitionProperty: "color, background-color, border-color", transitionDuration: "150ms", _hover: { backgroundColor: "color-mix(in srgb, white 10%, transparent)" } })}
							>
								<KeatingGlyph name="undo" size={11} />
								Reset code
							</button>
						</div>
					)}
				</div>
			) : (
				<div className={cx("runnable-code-surface", css({ overflow: "hidden", borderRadius: "0.5rem", position: "relative" }))}>
					{dirty && !streaming
						? <Suspense fallback={<pre><code>{editableCode}</code></pre>}><EditedCodePreview code={editableCode} language={language} /></Suspense>
						: children}
					{streaming && (
						<span
							aria-hidden
							className={css({ position: "absolute", right: "0.75rem", bottom: "0.75rem", width: "0.5rem", height: "1rem", background: "var(--primary)", animation: "pulse 1.1s steps(2, start) infinite" })}
						/>
					)}
				</div>
			)}

			{strudel && !editing && <MusicLab node={musicNode} />}

			{!streaming && environment === "linux" && <div className="ch-code-runtime-options">
				<label><input type="checkbox" checked={trace} disabled={running}
					onChange={event => { setTrace(event.target.checked); clearRun(); }} />Trace commands</label>
			</div>}
			{!streaming && environment === "wasm" && <details className="ch-code-runtime-options">
				<summary>Call an exported function</summary>
				<div className="ch-code-export-options">
					<label>Export name<input placeholder="e.g. add" value={exportName} disabled={running} autoCapitalize="none" spellCheck={false}
						onChange={event => { setExportName(event.target.value); clearRun(); }} /></label>
					<label>Arguments (JSON array)<input placeholder="[3, 4]" value={argsText} disabled={running} autoCapitalize="none" spellCheck={false}
						onChange={event => { setArgsText(event.target.value); clearRun(); }} /></label>
				</div>
			</details>}

			{(result || hostedResult || error) && (
				<div className="ch-snippet-output" role="region" aria-label="Snippet output">
					<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)" })}>
						{error || result?.ok === false || hostedResult?.status === "failed" || hostedResult?.status === "cancelled" ? <KeatingGlyph name="alert" size={12} className={css({ color: "var(--destructive)" })} /> : hostedResult && isPendingNotebookRun(hostedResult) ? <KeatingGlyph name="terminal" size={12} /> : <KeatingGlyph name="check" size={12} />}
						Output
					</div>
					<pre tabIndex={0}>{output}</pre>
					{!error && hasFinishedRun && <DiscussSnippetRun environment={environmentLabel} source={editableCode} output={output}
						status={status} invocation={invocation} />}
				</div>
			)}
		</div>
	);
}
