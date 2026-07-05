import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Check, Copy, Pencil, Play, RotateCcw, Terminal } from "lucide-react";
import { css } from "../../styled-system/css";
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

	const status = useMemo(() => {
		if (running) return "Running in NodePod";
		if (error) return "Run failed";
		if (result) return result.ok ? "Finished" : `Exit ${result.exitCode ?? "unknown"}`;
		return runnable ? "Runs in NodePod" : "Not runnable";
	}, [error, result, runnable, running]);

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
		<div className={css({ marginBlock: "0.75rem", overflow: "hidden", borderRadius: "0.375rem", border: "1px solid var(--border)" })}>
			<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", borderBottom: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 40%, transparent)", paddingInline: "0.75rem", paddingBlock: "0.375rem" })}>
				<div className={css({ display: "flex", minWidth: 0, alignItems: "center", gap: "0.5rem" })}>
					<Terminal size={12} className={css({ flexShrink: 0, color: "var(--muted-foreground)" })} />
					<span className={css({ fontSize: "11px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-foreground)" })}>
						{language || "text"}
					</span>
					<span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", color: "var(--muted-foreground)" })}>{status}</span>
				</div>
				<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.375rem" })}>
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
						disabled={!runnable || running}
						title={runnable ? "Run code in the browser NodePod sandbox" : "Only JavaScript and TypeScript blocks can run here"}
						className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", border: "1px solid var(--primary)", backgroundColor: "var(--primary)", paddingInline: "0.5rem", paddingBlock: "0.25rem", fontSize: "11px", fontWeight: 500, color: "var(--primary-foreground)", transitionProperty: "color, background-color, border-color", transitionDuration: "150ms", _hover: { backgroundColor: "color-mix(in srgb, var(--primary) 90%, black)" }, _disabled: { cursor: "not-allowed", borderColor: "var(--border)", backgroundColor: "var(--muted)", color: "var(--muted-foreground)" } })}
					>
						{running ? <Spinner size={11} /> : <Play size={11} />}
						Run
					</button>
				</div>
			</div>

			{editing ? (
				<div className={css({ borderBottom: "1px solid var(--border)", backgroundColor: "#0d1117" })}>
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
				children
			)}

			{(result || error) && (
				<div className={css({ borderTop: "1px solid var(--border)", backgroundColor: "var(--background)" })}>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", borderBottom: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)", paddingInline: "0.75rem", paddingBlock: "0.375rem", fontSize: "11px", fontWeight: 500, color: "var(--muted-foreground)" })}>
						{error || result?.ok === false ? <AlertCircle size={12} className={css({ color: "var(--destructive)" })} /> : <Check size={12} />}
						Output
					</div>
					<pre className={css({ maxHeight: "16rem", overflow: "auto", whiteSpace: "pre-wrap", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontFamily: "var(--mono-display)", fontSize: "0.75rem", lineHeight: "1.625" })}>
						{error || (result ? sessionOutput(result) : "")}
					</pre>
				</div>
			)}
		</div>
	);
}
