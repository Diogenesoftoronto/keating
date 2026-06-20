import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Play, Copy, Check, Loader2, Terminal } from "lucide-react";

// Syntax highlighter (react-syntax-highlighter + Prism language packs) is the
// heaviest part of this module. Load it on demand only when a code block renders.
const CodeHighlighter = lazy(() => import("./CodeHighlighter"));

interface MarkdownBlockProps {
	content: string;
}

const EXECUTABLE_LANGS = new Set([
	"javascript",
	"js",
	"typescript",
	"ts",
	"python",
	"py",
]);

type RunState = "idle" | "running" | "done" | "error";

interface CodeBlockState {
	output: string;
	state: RunState;
}

/** Run JavaScript in a (lightly) sandboxed way by capturing console.log. */
async function runJs(code: string): Promise<string> {
	const logs: string[] = [];
	const originalLog = console.log;
	const originalError = console.error;
	const originalWarn = console.warn;

	console.log = (...args: unknown[]) =>
		logs.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" "));
	console.error = (...args: unknown[]) =>
		logs.push(`[error] ${args.map((a) => String(a)).join(" ")}`);
	console.warn = (...args: unknown[]) =>
		logs.push(`[warn] ${args.map((a) => String(a)).join(" ")}`);

	try {
		const fn = new Function(code);
		const result = await fn();
		if (result !== undefined) {
			logs.push(
				`↳ ${typeof result === "object" ? JSON.stringify(result, null, 2) : String(result)}`,
			);
		}
	} catch (err) {
		console.error = originalError;
		console.log = originalLog;
		console.warn = originalWarn;
		throw err;
	} finally {
		console.error = originalError;
		console.log = originalLog;
		console.warn = originalWarn;
	}

	return logs.join("\n") || "✅ Executed successfully (no output)";
}

/** Run Python via Pyodide loaded from CDN on demand. */
async function runPython(code: string): Promise<string> {
	const cdnUrl = "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.mjs";
	// @ts-ignore — dynamic CDN import, no types available
	const { loadPyodide } = await import(/* @vite-ignore */ cdnUrl);
	const pyodide = await loadPyodide();

	const lines: string[] = [];
	pyodide.setStdout({ batched: (text: string) => lines.push(text) });
	pyodide.setStderr({ batched: (text: string) => lines.push(`[stderr] ${text}`) });

	await pyodide.runPythonAsync(code);
	return lines.join("\n") || "✅ Executed successfully (no output)";
}

function CodeBlock({ lang, children }: { lang: string; children: string }) {
	const [{ output, state }, setRun] = useState<CodeBlockState>({
		output: "",
		state: "idle",
	});
	const [copied, setCopied] = useState(false);

	const isExecutable = EXECUTABLE_LANGS.has(lang);
	const displayLang = lang || "text";

	const copyCode = useCallback(async () => {
		await navigator.clipboard.writeText(children);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [children]);

	const runCode = useCallback(async () => {
		setRun({ output: "", state: "running" });
		try {
			if (lang === "python" || lang === "py") {
				const out = await runPython(children);
				setRun({ output: out, state: "done" });
			} else {
				const out = await runJs(children);
				setRun({ output: out, state: "done" });
			}
		} catch (err) {
			setRun({
				output: `❌ ${err instanceof Error ? err.message : String(err)}`,
				state: "error",
			});
		}
	}, [children, lang]);

	return (
		<div className="my-3 overflow-hidden rounded-md border border-border">
			{/* Toolbar */}
			<div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5">
				<div className="flex items-center gap-2">
					<Terminal size={12} className="text-muted-foreground" />
					<span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
						{displayLang}
					</span>
				</div>
				<div className="flex items-center gap-1.5">
					{isExecutable && (
						<button
							type="button"
							onClick={runCode}
							disabled={state === "running"}
							className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
						>
							{state === "running" ? (
								<Loader2 size={11} className="animate-spin" />
							) : (
								<Play size={11} />
							)}
							{state === "running" ? "Running…" : "Run"}
						</button>
					)}
					<button
						type="button"
						onClick={copyCode}
						className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
					>
						{copied ? <Check size={11} /> : <Copy size={11} />}
						{copied ? "Copied" : "Copy"}
					</button>
				</div>
			</div>

			{/* Highlighted code (highlighter chunk loads on demand; plain code shows first) */}
			<Suspense
				fallback={
					<pre
						style={{
							margin: 0,
							padding: "1em",
							fontSize: "0.82rem",
							lineHeight: 1.55,
							background: "#0d1117",
							color: "#c9d1d9",
							overflowX: "auto",
						}}
					>
						<code>{children.replace(/\n$/, "")}</code>
					</pre>
				}
			>
				<CodeHighlighter code={children} language={displayLang} />
			</Suspense>

			{/* Execution output */}
			{(state === "running" || state === "done" || state === "error") && (
				<div
					className={`border-t border-border px-3 py-2.5 font-mono text-xs ${
						state === "error" ? "bg-red-950/30 text-red-400" : "bg-black/80 text-green-400"
					}`}
				>
					<div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
						{state === "running" ? "Running…" : "Output"}
					</div>
					<pre className="whitespace-pre-wrap break-words leading-relaxed">{output}</pre>
				</div>
			)}
		</div>
	);
}

const COMPONENTS: Components = {
	pre({ children }) {
		// react-markdown wraps <code> inside <pre>; we intercept the whole block here.
		// The child should be a <code> element with a className like "language-python".
		const code = Array.isArray(children) ? children[0] : children;
		if (
			code &&
			typeof code === "object" &&
			"props" in code &&
			code.props &&
			typeof code.props === "object"
		) {
			const props = code.props as { className?: string; children?: string };
			const match = /language-(\w+)/.exec(props.className ?? "");
			const lang = match?.[1] ?? "";
			const raw = props.children ?? "";
			return <CodeBlock lang={lang}>{raw}</CodeBlock>;
		}
		return <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{children}</pre>;
	},
	code({ className, children, ...props }) {
		// Inline code (no language class = not inside a ``` fenced block)
		const isInline = !className?.includes("language-");
		if (isInline) {
			return (
				<code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono" {...props}>
					{children}
				</code>
			);
		}
		// Fenced code blocks are handled by the <pre> override above.
		return (
			<code className="font-mono text-sm" {...props}>
				{children}
			</code>
		);
	},
	p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
	ul: ({ children }) => <ul className="mb-3 list-disc pl-5">{children}</ul>,
	ol: ({ children }) => <ol className="mb-3 list-decimal pl-5">{children}</ol>,
	li: ({ children }) => <li className="mb-1">{children}</li>,
	h1: ({ children }) => <h1 className="mb-2 mt-4 text-lg font-semibold">{children}</h1>,
	h2: ({ children }) => <h2 className="mb-2 mt-3 text-base font-semibold">{children}</h2>,
	h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold">{children}</h3>,
	strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
	em: ({ children }) => <em className="italic">{children}</em>,
	a: ({ children, href }) => (
		<a href={href} className="text-primary underline" target="_blank" rel="noreferrer">
			{children}
		</a>
	),
	blockquote: ({ children }) => (
		<blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
			{children}
		</blockquote>
	),
	table: ({ children }) => <table className="mb-3 w-full border-collapse text-sm">{children}</table>,
	thead: ({ children }) => <thead className="border-b border-border bg-muted/50">{children}</thead>,
	th: ({ children }) => <th className="px-3 py-2 text-left font-semibold">{children}</th>,
	td: ({ children }) => <td className="border-b border-border px-3 py-2">{children}</td>,
};

export function MarkdownBlock({ content }: MarkdownBlockProps) {
	const plugins = useMemo(
		() => ({ remark: [remarkGfm, remarkMath], rehype: [rehypeKatex] }),
		[],
	);

	return (
		<ReactMarkdown remarkPlugins={plugins.remark} rehypePlugins={plugins.rehype} components={COMPONENTS}>
			{content}
		</ReactMarkdown>
	);
}
