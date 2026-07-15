import { useEffect, useRef, useState } from "react";
import { css, cx } from "../../styled-system/css";
import { sanitizeSvg } from "../lib/sanitize-svg";

const errorContainerClass = css({
	padding: "1rem",
	backgroundColor: "color-mix(in srgb, #ef4444 10%, transparent)",
	border: "1px solid color-mix(in srgb, #ef4444 30%, transparent)",
	borderRadius: "0.5rem",
});
const errorTitleClass = css({ color: "#f87171", fontSize: "0.875rem" });
const errorPreClass = css({
	marginTop: "0.5rem",
	fontSize: "0.75rem",
	color: "var(--muted-foreground)",
	overflow: "auto",
});
const containerClass = css({
	backgroundColor: "color-mix(in srgb, var(--muted) 20%, transparent)",
	borderRadius: "0.5rem",
});
const loadingClass = css({ padding: "2rem", textAlign: "center", color: "var(--muted-foreground)" });
const wrapperClass = css({ marginBlock: "1rem", overflow: "auto" });
const cardClass = css({
	backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)",
	borderRadius: "0.5rem",
	padding: "1rem",
});

interface MermaidRendererProps {
	content: string;
	className?: string;
}

// Cache for rendered diagrams
const renderCache = new Map<string, string>();
const mermaidFencePattern = /```mermaid[^\n]*\n([\s\S]*?)```/i;

// Strip a leading ```mermaid fence so the model can paste a fenced diagram
// verbatim and we still pass clean Mermaid source to the renderer. We keep
// the model-authored `<br/>` markers inside node labels — Mermaid honors
// them natively when `htmlLabels: true` is set, and `lib/sanitize-svg.ts`
// now allows the `<foreignObject>` wrapper Mermaid emits for those labels
// through.
function extractMermaidSource(input: string): string {
	const trimmed = input.trim();
	const match = trimmed.match(mermaidFencePattern);
	return match ? match[1].trim() : trimmed;
}

export function MermaidRenderer({ content, className }: MermaidRendererProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const renderTargetRef = useRef<HTMLDivElement | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [svg, setSvg] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function renderDiagram() {
			if (!content) {
				setLoading(false);
				return;
			}

			const mermaidCode = extractMermaidSource(content);

			// Check cache first
			const cacheKey = mermaidCode.slice(0, 200);
			if (renderCache.has(cacheKey)) {
				if (!cancelled) {
					setSvg(renderCache.get(cacheKey)!);
					setLoading(false);
					setError(null);
				}
				return;
			}

			try {
				// Dynamically import mermaid
				const mermaid = await import("mermaid");

				// Initialize mermaid with theme
				mermaid.default.initialize({
					startOnLoad: false,
					theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
					securityLevel: "strict",
					flowchart: {
						useMaxWidth: true,
						// Render `<br/>` markers inside node labels as real line
						// breaks. The output SVG is passed through sanitizeSvg,
						// which explicitly permits the `<foreignObject>` Mermaid wraps
						// around htmlLabels content only on this strict-rendered path.
						htmlLabels: true,
					},
				});

				// Generate unique ID — must not already exist in the DOM
				const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

				// Create a detached container for mermaid to render into.
				// This avoids Mermaid and React fighting over the same DOM node,
				// which causes "removeChild" errors on re-render.
				if (!renderTargetRef.current) {
					renderTargetRef.current = document.createElement("div");
					renderTargetRef.current.style.position = "absolute";
					renderTargetRef.current.style.left = "-9999px";
					renderTargetRef.current.style.top = "-9999px";
					renderTargetRef.current.style.visibility = "hidden";
					document.body.appendChild(renderTargetRef.current);
				}

				// Clear any previous content
				renderTargetRef.current.innerHTML = "";

				// Render into detached container
				const { svg: renderedSvg } = await mermaid.default.render(id, mermaidCode, renderTargetRef.current);
				const safeSvg = sanitizeSvg(renderedSvg, { allowForeignObject: true });
				if (!safeSvg) {
					throw new Error("Rendered diagram failed SVG safety checks");
				}

				// Only store the SVG string — never let Mermaid touch React's DOM
				renderCache.set(cacheKey, safeSvg);

				if (!cancelled) {
					setSvg(safeSvg);
					setLoading(false);
					setError(null);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : "Failed to render diagram");
					setLoading(false);
				}
			}
		}

		setLoading(true);
		setError(null);
		renderDiagram();

		return () => {
			cancelled = true;
			// Clean up the detached render container
			if (renderTargetRef.current) {
				try {
					document.body.removeChild(renderTargetRef.current);
				} catch {
					// already removed
				}
				renderTargetRef.current = null;
			}
		};
	}, [content]);

	if (error) {
		return (
			<div className={cx(errorContainerClass, className)}>
				<p className={errorTitleClass}>Failed to render diagram: {error}</p>
				<pre className={errorPreClass}>{content}</pre>
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className={`mermaid-container ${className} ${loading ? containerClass : ""}`}
		>
			{loading ? (
				<div className={loadingClass}>Rendering diagram...</div>
			) : svg ? (
				<div dangerouslySetInnerHTML={{ __html: svg }} />
			) : null}
		</div>
	);
}

// Component to render mermaid from chat messages
export function MermaidMessageRenderer({ content }: { content: string }) {
	// Check if content contains mermaid code block
	const mermaidMatch = content.match(mermaidFencePattern);

	if (!mermaidMatch) {
		return null;
	}

	return (
		<div className={wrapperClass}>
			<MermaidRenderer content={mermaidMatch[1]} className={cardClass} />
		</div>
	);
}

// Hook to extract and render all mermaid blocks from text
export function useMermaidBlocks(content: string) {
	const blocks: Array<{ id: string; code: string }> = [];

	const regex = /```mermaid[^\n]*\n([\s\S]*?)```/gi;
	let match;
	let index = 0;

	while ((match = regex.exec(content)) !== null) {
		blocks.push({
			id: `mermaid-${index}`,
			code: match[1],
		});
		index++;
	}

	return blocks;
}
