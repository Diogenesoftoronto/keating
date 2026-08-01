import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Check, Copy, Pencil, Play, RotateCcw, Terminal } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { Spinner } from "./Spinner";

import {
	bootNodePod,
	isNodePodActive,
	nodePodRunScript,
	transpileTsToJs,
	type ShellSession,
} from "../keating/nodepod-runtime";

const RUNNABLE_LANGUAGES = new Set([
	"js",
	"javascript",
	"mjs",
	"cjs",
	"ts",
	"typescript",
]);

function normalizeLanguage(language: string): string {
	return language.trim().toLowerCase();
}

export function isRunnableCodeLanguage(language: string): boolean {
	return RUNNABLE_LANGUAGES.has(normalizeLanguage(language));
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

function sessionOutput(session: ShellSession): string {
	const chunks = [
		session.stdout ? `stdout\n${session.stdout.trimEnd()}` : "",
		session.stderr ? `stderr\n${session.stderr.trimEnd()}` : "",
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
	const [editableCode, setEditableCode] = useState(code);
	const [editing, setEditing] = useState(false);
	const [running, setRunning] = useState(false);
	const [result, setResult] = useState<ShellSession | null>(null);
	const [error, setError] = useState("");
	const runnable = isRunnableCodeLanguage(language);
	const dirty = editableCode !== code;

	// This block is still being written when its code matches the open fence.
	const streamingCode = useContext(StreamingCodeContext);
	const streaming = streamingCode !== null && streamingCode === code;

	// While the model writes, the code prop grows every token; mirror it into the
	// editor buffer so the learner sees the finished file when it settles. Once
	// they start editing (dirty), their text wins.
	useEffect(() => {
		if (streaming || !dirty) setEditableCode(code);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [code, streaming]);

	const status = useMemo(() => {
		if (streaming) return "writing…";
		if (running) return "Running in NodePod";
		if (error) return "Run failed";
		if (result) return result.ok ? "Finished" : `Exit ${result.exitCode ?? "unknown"}`;
		return runnable ? "Runs in NodePod" : "Not runnable";
	}, [error, result, runnable, running, streaming]);

	const run = useCallback(async () => {
		if (!runnable || running) return;
		setRunning(true);
		setError("");
		setResult(null);
		try {
			if (!isNodePodActive()) {
				const pod = await bootNodePod();
				if (!pod) throw new Error("NodePod could not boot in this browser session.");
			}
			const prepared = await prepareRunnableCode(editableCode, language);
			const session = await nodePodRunScript(prepared.code, prepared.filename);
			setResult(session);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setRunning(false);
		}
	}, [editableCode, language, runnable, running]);

	const copyCode = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(editableCode);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not copy code.");
		}
	}, [editableCode]);

	return (
		// One frame: the code surface. The toolbar sits on open space above it and
		// the output below it, separated by rules rather than nested boxes.
		<div className={css({ marginBlock: "1rem", display: "grid", gap: "0.5rem" })}>
			<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" })}>
				<div className={css({ display: "flex", minWidth: 0, alignItems: "center", gap: "0.5rem" })}>
					<Terminal size={12} className={css({ flexShrink: 0, color: "var(--muted-foreground)" })} />
					<span className={css({ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)" })}>
						{language || "text"}
					</span>
					<span className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", color: "var(--muted-foreground)" })}>
						{streaming && <span className={css({ animation: "pulse 1.4s ease-in-out infinite", color: "var(--primary)" })}>●</span>}
						{status}
					</span>
				</div>
				<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.375rem", opacity: streaming ? 0 : 1, pointerEvents: streaming ? "none" : "auto", transition: "opacity 200ms" })}>
					<button
						type="button"
						onClick={() => {
							setEditing((value) => !value);
							setError("");
						}}
						className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", paddingInline: "0.5rem", paddingBlock: "0.25rem", fontSize: "11px", fontWeight: 500, color: "var(--foreground)", transitionProperty: "color, background-color, border-color", transitionDuration: "150ms", _hover: { background: "var(--accent)" } })}
						aria-pressed={editing}
					>
						<Pencil size={11} />
						{editing ? "Preview" : "Edit"}
					</button>
					<button
						type="button"
						onClick={copyCode}
						className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", paddingInline: "0.5rem", paddingBlock: "0.25rem", fontSize: "11px", fontWeight: 500, color: "var(--foreground)", transitionProperty: "color, background-color, border-color", transitionDuration: "150ms", _hover: { background: "var(--accent)" } })}
					>
						{copied ? <Check size={11} /> : <Copy size={11} />}
						{copied ? "Copied" : "Copy"}
					</button>
					<button
						type="button"
						onClick={run}
						disabled={!runnable || running || streaming}
						title={runnable ? "Run code in the browser NodePod sandbox" : "Only JavaScript and TypeScript blocks can run here"}
						className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", border: "1px solid var(--primary)", backgroundColor: "var(--primary)", paddingInline: "0.5rem", paddingBlock: "0.25rem", fontSize: "11px", fontWeight: 500, color: "var(--primary-foreground)", transitionProperty: "color, background-color, border-color", transitionDuration: "150ms", _hover: { backgroundColor: "color-mix(in srgb, var(--primary) 90%, black)" }, _disabled: { cursor: "not-allowed", borderColor: "var(--border)", backgroundColor: "var(--muted)", color: "var(--muted-foreground)" } })}
					>
						{running ? <Spinner size={11} /> : <Play size={11} />}
						Run
					</button>
				</div>
			</div>

			{editing ? (
				<div className={css({ overflow: "hidden", borderRadius: "0.5rem", backgroundColor: "#0d1117" })}>
					<textarea
						value={editableCode}
						onChange={(event) => setEditableCode(event.target.value)}
						spellCheck={false}
						className={css({ minHeight: "12rem", width: "100%", resize: "vertical", backgroundColor: "transparent", padding: "1rem", fontFamily: "var(--mono-display)", fontSize: "0.82rem", lineHeight: "1.625", color: "#c9d1d9", outline: "none" })}
						aria-label="Editable code"
					/>
					{dirty && (
						<div className={css({ display: "flex", justifyContent: "flex-end", borderTop: "1px solid color-mix(in srgb, white 10%, transparent)", paddingInline: "0.75rem", paddingBlock: "0.375rem" })}>
							<button
								type="button"
								onClick={() => {
									setEditableCode(code);
									setResult(null);
									setError("");
								}}
								className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, white 15%, transparent)", paddingInline: "0.5rem", paddingBlock: "0.25rem", fontSize: "11px", fontWeight: 500, color: "#c9d1d9", transitionProperty: "color, background-color, border-color", transitionDuration: "150ms", _hover: { backgroundColor: "color-mix(in srgb, white 10%, transparent)" } })}
							>
								<RotateCcw size={11} />
								Reset code
							</button>
						</div>
					)}
				</div>
			) : (
				<div className={cx("runnable-code-surface", css({ overflow: "hidden", borderRadius: "0.5rem", position: "relative" }))}>
					{children}
					{streaming && (
						<span
							aria-hidden
							className={css({ position: "absolute", right: "0.75rem", bottom: "0.75rem", width: "0.5rem", height: "1rem", background: "var(--primary)", animation: "pulse 1.1s steps(2, start) infinite" })}
						/>
					)}
				</div>
			)}

			{(result || error) && (
				<div className={css({ display: "grid", gap: "0.375rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" })}>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)" })}>
						{error || result?.ok === false ? <AlertCircle size={12} className={css({ color: "var(--destructive)" })} /> : <Check size={12} />}
						Output
					</div>
					<pre className={css({ maxHeight: "16rem", overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "var(--mono-display)", fontSize: "0.75rem", lineHeight: "1.625" })}>
						{error || (result ? sessionOutput(result) : "")}
					</pre>
				</div>
			)}
		</div>
	);
}
