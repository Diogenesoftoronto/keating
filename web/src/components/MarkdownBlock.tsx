import { lazy, Suspense, useMemo, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MermaidRenderer } from "./MermaidRenderer";
import { css, cx } from "../../styled-system/css";
import { RunnableCodeBlock, StreamingCodeContext, inProgressFenceCode } from "./RunnableCodeBlock";

// Syntax highlighter (react-syntax-highlighter + Prism language packs) is the
// heaviest part of this module. Load it on demand only when a code block renders.
const CodeHighlighter = lazy(() => import("./CodeHighlighter"));

interface MarkdownBlockProps {
	content: string;
	/**
	 * True while the model is still writing this message. Enables the "writing…"
	 * state on the code fence that is still open.
	 */
	streaming?: boolean;
	/** Preserve source offsets so review selections can map back to Markdown. */
	sourceMapped?: boolean;
	highlights?: MarkdownHighlightRange[];
	onHighlightReveal?: (ids: string[], rect: DOMRect) => void;
	onHighlightConceal?: () => void;
	onHighlightOpen?: (ids: string[], rect: DOMRect) => void;
}

export interface MarkdownHighlightRange {
	start: number;
	end: number;
	ids: string[];
	color: string;
	active?: boolean;
	dashed?: boolean;
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
	position?: { start?: { offset?: number }; end?: { offset?: number } };
}

function remarkSourceMap(highlights: MarkdownHighlightRange[]) {
	return () => (tree: MdastNode) => {
		function transform(node: MdastNode) {
			if (!Array.isArray(node.children)) return;
			const output: MdastNode[] = [];
			for (const child of node.children) {
				const sourceStart = child.position?.start?.offset;
				const sourceEnd = child.position?.end?.offset;
				if (child.type !== "text" || typeof child.value !== "string" || sourceStart == null || sourceEnd == null) {
					transform(child);
					output.push(child);
					continue;
				}

				const applicable = highlights.filter((range) => range.start < sourceEnd && range.end > sourceStart);
				const boundaries = Array.from(new Set([
					sourceStart,
					sourceEnd,
					...applicable.flatMap((range) => [Math.max(sourceStart, range.start), Math.min(sourceEnd, range.end)]),
				])).sort((left, right) => left - right);

				for (let index = 0; index < boundaries.length - 1; index += 1) {
					const start = boundaries[index];
					const end = boundaries[index + 1];
					if (end <= start) continue;
					const localStart = Math.max(0, Math.min(child.value.length, start - sourceStart));
					const localEnd = Math.max(localStart, Math.min(child.value.length, end - sourceStart));
					const value = child.value.slice(localStart, localEnd);
					if (!value) continue;
					const covering = applicable.filter((range) => range.start <= start && range.end >= end);
					const primary = covering[0];
					const highlightIds = Array.from(new Set(covering.flatMap((range) => range.ids)));
					output.push({
						type: primary ? "reviewHighlight" : "reviewSource",
						data: {
							hName: primary ? "mark" : "span",
							hProperties: {
								"data-source-start": start,
								"data-source-end": end,
								...(primary ? {
									"data-review-highlight": "true",
									"data-highlight-ids": highlightIds.join(","),
									"data-highlight-color": primary.color,
									"data-highlight-active": covering.some((range) => range.active) ? "true" : "false",
									"data-highlight-dashed": covering.some((range) => range.dashed) ? "true" : "false",
									"aria-label": `${highlightIds.length} note${highlightIds.length === 1 ? "" : "s"} on “${value}”`,
								} : {}),
							},
						},
						children: [{ type: "text", value }],
					});
				}
			}
			node.children = output;
		}
		transform(tree);
	};
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
	table: ({ children }) => (
		<div className={css({ marginBlock: "0.75rem", maxWidth: "100%", overflowX: "auto" })}>
			<table className={css({ width: "max-content", minWidth: "100%", borderCollapse: "collapse", fontSize: "0.875rem" })}>{children}</table>
		</div>
	),
	thead: ({ children }) => <thead className={css({ borderBottom: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 50%, transparent)" })}>{children}</thead>,
	th: ({ children }) => <th className={css({ paddingInline: "0.75rem", paddingBlock: "0.5rem", textAlign: "left", fontWeight: 600 })}>{children}</th>,
	td: ({ children }) => <td className={css({ borderBottom: "1px solid var(--border)", paddingInline: "0.75rem", paddingBlock: "0.5rem" })}>{children}</td>,
};

const reviewMarkClass = css({
	borderBottom: "1.5px solid",
	background: "transparent",
	color: "inherit",
	cursor: "pointer",
	transitionProperty: "background-color",
	transitionDuration: "120ms",
	_motionReduce: { transitionDuration: "0ms" },
	_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
});
const reviewMarkSolidClass = css({ borderBottomStyle: "solid" });
const reviewMarkDashedClass = css({ borderBottomStyle: "dashed" });

export function MarkdownBlock({ content, streaming = false, sourceMapped = false, highlights = [], onHighlightReveal, onHighlightConceal, onHighlightOpen }: MarkdownBlockProps) {
	const plugins = useMemo(
		() => ({ remark: [remarkGfm, remarkMath, ...(sourceMapped ? [remarkSourceMap(highlights)] : []), remarkSpoiler], rehype: [rehypeKatex] }),
		[highlights, sourceMapped],
	);
	const components = useMemo<Components>(() => ({
		...COMPONENTS,
		mark({ children, ...props }) {
			const attributes = props as Record<string, unknown>;
			if (attributes["data-review-highlight"] !== "true") return <mark {...props}>{children}</mark>;
			const ids = String(attributes["data-highlight-ids"] ?? "").split(",").filter(Boolean);
			const color = String(attributes["data-highlight-color"] ?? "var(--accent)");
			const active = attributes["data-highlight-active"] === "true";
			const dashed = attributes["data-highlight-dashed"] === "true";
			return (
				<mark
					{...props}
					tabIndex={0}
					role="button"
					className={cx(reviewMarkClass, dashed ? reviewMarkDashedClass : reviewMarkSolidClass)}
					style={{ borderBottomColor: color, background: active ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent" }}
					onMouseEnter={(event) => onHighlightReveal?.(ids, event.currentTarget.getBoundingClientRect())}
					onFocus={(event) => onHighlightReveal?.(ids, event.currentTarget.getBoundingClientRect())}
					onMouseLeave={onHighlightConceal}
					onBlur={onHighlightConceal}
					onClick={(event) => onHighlightOpen?.(ids, event.currentTarget.getBoundingClientRect())}
					onKeyDown={(event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						onHighlightOpen?.(ids, event.currentTarget.getBoundingClientRect());
					}}
				>
					{children}
				</mark>
			);
		},
	}), [onHighlightConceal, onHighlightOpen, onHighlightReveal]);

	// Only an unterminated fence is still being written; a closed one is done
	// even if the message itself keeps streaming prose after it.
	const openFenceCode = useMemo(
		() => (streaming ? inProgressFenceCode(content) : null),
		[content, streaming],
	);

	return (
		<StreamingCodeContext.Provider value={openFenceCode}>
			<ReactMarkdown remarkPlugins={plugins.remark} rehypePlugins={plugins.rehype} components={components}>
				{content}
			</ReactMarkdown>
		</StreamingCodeContext.Provider>
	);
}
