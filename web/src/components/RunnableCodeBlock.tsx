import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Check, Copy, Loader2, Pencil, Play, RotateCcw, Terminal } from "lucide-react";

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
		<div className="my-3 overflow-hidden rounded-md border border-border">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
				<div className="flex min-w-0 items-center gap-2">
					<Terminal size={12} className="shrink-0 text-muted-foreground" />
					<span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
						{language || "text"}
					</span>
					<span className="truncate text-[11px] text-muted-foreground">{status}</span>
				</div>
				<div className="flex flex-wrap items-center gap-1.5">
					<button
						type="button"
						onClick={() => {
							setEditing((value) => !value);
							setError("");
						}}
						className="dialog-compact-button inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
						aria-pressed={editing}
					>
						<Pencil size={11} />
						{editing ? "Preview" : "Edit"}
					</button>
					<button
						type="button"
						onClick={copyCode}
						className="dialog-compact-button inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
					>
						{copied ? <Check size={11} /> : <Copy size={11} />}
						{copied ? "Copied" : "Copy"}
					</button>
					<button
						type="button"
						onClick={run}
						disabled={!runnable || running}
						title={runnable ? "Run code in the browser NodePod sandbox" : "Only JavaScript and TypeScript blocks can run here"}
						className="dialog-compact-button inline-flex items-center gap-1 rounded-md border border-primary bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
					>
						{running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
						Run
					</button>
				</div>
			</div>

			{editing ? (
				<div className="border-b border-border bg-[#0d1117]">
					<textarea
						value={editableCode}
						onChange={(event) => setEditableCode(event.target.value)}
						spellCheck={false}
						className="min-h-48 w-full resize-y bg-transparent p-4 font-mono text-[0.82rem] leading-relaxed text-[#c9d1d9] outline-none"
						aria-label="Editable code"
					/>
					{dirty && (
						<div className="flex justify-end border-t border-white/10 px-3 py-1.5">
							<button
								type="button"
								onClick={() => {
									setEditableCode(code);
									setResult(null);
									setError("");
								}}
								className="dialog-compact-button inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] font-medium text-[#c9d1d9] transition-colors hover:bg-white/10"
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
				<div className="border-t border-border bg-background">
					<div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
						{error || result?.ok === false ? <AlertCircle size={12} className="text-destructive" /> : <Check size={12} />}
						Output
					</div>
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-relaxed">
						{error || (result ? sessionOutput(result) : "")}
					</pre>
				</div>
			)}
		</div>
	);
}
