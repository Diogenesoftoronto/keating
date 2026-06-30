import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Copy, Check, Terminal } from "lucide-react";
import { MermaidRenderer } from "./MermaidRenderer";

// Syntax highlighter (react-syntax-highlighter + Prism language packs) is the
// heaviest part of this module. Load it on demand only when a code block renders.
const CodeHighlighter = lazy(() => import("./CodeHighlighter"));

interface MarkdownBlockProps {
	content: string;
}

// Click-to-reveal "spoiler" / mask: authors wrap a clue or answer in ||double
// pipes|| and the learner clicks to reveal it. Lets the teacher hide hints so
// the learner can attempt recall first.
const SPOILER_PATTERN = /\|\|([^|]+)\|\|/g;

interface MdastNode {
	type: string;
	value?: string;
	children?: MdastNode[];
	data?: { hName?: string; hProperties?: Record<string, unknown> };
}

// Dependency-free remark transform: split text nodes on ||...|| into spoiler
// nodes. Code/inline-code nodes carry `value` under non-"text" types, so they're
// never matched — spoilers inside code are left alone.
function remarkSpoiler() {
	function transform(node: MdastNode) {
		if (!Array.isArray(node.children)) return;
		const out: MdastNode[] = [];
		for (const child of node.children) {
			if (child.type === "text" && typeof child.value === "string" && child.value.includes("||")) {
				SPOILER_PATTERN.lastIndex = 0;
				let last = 0;
				let matched = false;
				let m: RegExpExecArray | null;
				while ((m = SPOILER_PATTERN.exec(child.value)) !== null) {
					matched = true;
					if (m.index > last) out.push({ type: "text", value: child.value.slice(last, m.index) });
					out.push({
						type: "spoiler",
						data: { hName: "span", hProperties: { className: ["keating-spoiler"] } },
						children: [{ type: "text", value: m[1] }],
					});
					last = m.index + m[0].length;
				}
				if (!matched) {
					out.push(child);
				} else if (last < child.value.length) {
					out.push({ type: "text", value: child.value.slice(last) });
				}
			} else {
				transform(child);
				out.push(child);
			}
		}
		node.children = out;
	}
	return (tree: MdastNode) => transform(tree);
}

function Spoiler({ children }: { children: ReactNode }) {
	const [revealed, setRevealed] = useState(false);
	if (revealed) {
		return <span className="rounded bg-muted px-1 text-foreground">{children}</span>;
	}
	return (
		<button
			type="button"
			onClick={() => setRevealed(true)}
			title="Reveal"
			aria-label="Reveal hidden text"
			className="cursor-pointer select-none rounded bg-foreground/85 px-1 text-transparent transition-colors hover:bg-foreground/70"
		>
			{children}
		</button>
	);
}

function CodeBlock({ lang, children }: { lang: string; children: string }) {
	const [copied, setCopied] = useState(false);

	const displayLang = lang || "text";

	const copyCode = useCallback(async () => {
		await navigator.clipboard.writeText(children);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [children]);

	if (displayLang.toLowerCase() === "mermaid") {
		return (
			<div className="my-3 overflow-auto rounded-lg border border-border bg-muted/30 p-4">
				<MermaidRenderer content={children} />
			</div>
		);
	}

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
		</div>
	);
}

const COMPONENTS: Components = {
	span({ className, children, ...props }) {
		if (typeof className === "string" && className.includes("keating-spoiler")) {
			return <Spoiler>{children}</Spoiler>;
		}
		return (
			<span className={className} {...props}>
				{children}
			</span>
		);
	},
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
		() => ({ remark: [remarkGfm, remarkMath, remarkSpoiler], rehype: [rehypeKatex] }),
		[],
	);

	return (
		<ReactMarkdown remarkPlugins={plugins.remark} rehypePlugins={plugins.rehype} components={COMPONENTS}>
			{content}
		</ReactMarkdown>
	);
}
