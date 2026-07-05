import { lazy, Suspense, useMemo, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MermaidRenderer } from "./MermaidRenderer";
import { css } from "../../styled-system/css";
import { RunnableCodeBlock } from "./RunnableCodeBlock";

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
		return <span className={css({ borderRadius: "0.25rem", backgroundColor: "var(--muted)", paddingInline: "0.25rem", color: "var(--foreground)" })}>{children}</span>;
	}
	return (
		<button
			type="button"
			onClick={() => setRevealed(true)}
			title="Reveal"
			aria-label="Reveal hidden text"
			className={css({ cursor: "pointer", userSelect: "none", borderRadius: "0.25rem", backgroundColor: "color-mix(in srgb, var(--foreground) 85%, transparent)", paddingInline: "0.25rem", color: "transparent", transitionProperty: "color, background-color, border-color", transitionDuration: "150ms", _hover: { backgroundColor: "color-mix(in srgb, var(--foreground) 70%, transparent)" } })}
		>
			{children}
		</button>
	);
}

function CodeBlock({ lang, children }: { lang: string; children: string }) {
	const displayLang = lang || "text";
	const code = children.replace(/\n$/, "");

	if (displayLang.toLowerCase() === "mermaid") {
		return (
			<div className={css({ marginBlock: "0.75rem", overflow: "auto", borderRadius: "0.5rem", border: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)", padding: "1rem" })}>
				<MermaidRenderer content={children} />
			</div>
		);
	}

	return (
		<RunnableCodeBlock code={code} language={displayLang}>
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
						<code>{code}</code>
					</pre>
				}
			>
				<CodeHighlighter code={code} language={displayLang} />
			</Suspense>
		</RunnableCodeBlock>
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
		return <pre className={css({ overflowX: "auto", borderRadius: "0.375rem", backgroundColor: "var(--muted)", padding: "0.75rem", fontSize: "0.75rem" })}>{children}</pre>;
	},
	code({ className, children, ...props }) {
		// Inline code (no language class = not inside a ``` fenced block)
		const isInline = !className?.includes("language-");
		if (isInline) {
			return (
				<code className={css({ borderRadius: "0.25rem", backgroundColor: "var(--muted)", paddingInline: "0.375rem", paddingBlock: "0.125rem", fontSize: "0.875rem", fontFamily: "var(--mono-display)" })} {...props}>
					{children}
				</code>
			);
		}
		// Fenced code blocks are handled by the <pre> override above.
		return (
			<code className={css({ fontFamily: "var(--mono-display)", fontSize: "0.875rem" })} {...props}>
				{children}
			</code>
		);
	},
	p: ({ children }) => <p className={css({ marginBottom: "0.75rem", _last: { marginBottom: 0 } })}>{children}</p>,
	ul: ({ children }) => <ul className={css({ marginBottom: "0.75rem", paddingLeft: "1.25rem", listStyleType: "disc" })}>{children}</ul>,
	ol: ({ children }) => <ol className={css({ marginBottom: "0.75rem", paddingLeft: "1.25rem", listStyleType: "decimal" })}>{children}</ol>,
	li: ({ children }) => <li className={css({ marginBottom: "0.25rem" })}>{children}</li>,
	h1: ({ children }) => <h1 className={css({ marginBottom: "0.5rem", marginTop: "1rem", fontSize: "1.125rem", fontWeight: 600 })}>{children}</h1>,
	h2: ({ children }) => <h2 className={css({ marginBottom: "0.5rem", marginTop: "0.75rem", fontSize: "1rem", fontWeight: 600 })}>{children}</h2>,
	h3: ({ children }) => <h3 className={css({ marginBottom: "0.25rem", marginTop: "0.5rem", fontSize: "0.875rem", fontWeight: 600 })}>{children}</h3>,
	strong: ({ children }) => <strong className={css({ fontWeight: 600 })}>{children}</strong>,
	em: ({ children }) => <em className={css({ fontStyle: "italic" })}>{children}</em>,
	a: ({ children, href }) => (
		<a href={href} className={css({ color: "var(--primary)", textDecoration: "underline" })} target="_blank" rel="noreferrer">
			{children}
		</a>
	),
	blockquote: ({ children }) => (
		<blockquote className={css({ marginBlock: "0.5rem", borderLeft: "2px solid var(--border)", paddingLeft: "0.75rem", color: "var(--muted-foreground)" })}>
			{children}
		</blockquote>
	),
	table: ({ children }) => <table className={css({ marginBottom: "0.75rem", width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" })}>{children}</table>,
	thead: ({ children }) => <thead className={css({ borderBottom: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 50%, transparent)" })}>{children}</thead>,
	th: ({ children }) => <th className={css({ paddingInline: "0.75rem", paddingBlock: "0.5rem", textAlign: "left", fontWeight: 600 })}>{children}</th>,
	td: ({ children }) => <td className={css({ borderBottom: "1px solid var(--border)", paddingInline: "0.75rem", paddingBlock: "0.5rem" })}>{children}</td>,
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
