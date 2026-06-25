import { useEffect, useRef, useState } from "react";
import { sanitizeSvg } from "../lib/sanitize-svg";

interface MermaidRendererProps {
	content: string;
	className?: string;
}

// Cache for rendered diagrams
const renderCache = new Map<string, string>();

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

			// Check cache first
			const cacheKey = content.slice(0, 100);
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
						htmlLabels: false,
					},
				});

				// Extract mermaid code from markdown code block if present
				let mermaidCode = content;
				const mermaidMatch = content.match(/```mermaid\n([\s\S]*?)\n```/);
				if (mermaidMatch) {
					mermaidCode = mermaidMatch[1];
				}

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
				const safeSvg = sanitizeSvg(renderedSvg);
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
			<div className={`p-4 bg-red-500/10 border border-red-500/30 rounded-lg ${className}`}>
				<p className="text-red-400 text-sm">Failed to render diagram: {error}</p>
				<pre className="mt-2 text-xs text-muted-foreground overflow-auto">{content}</pre>
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className={`mermaid-container ${className} ${loading ? "animate-pulse bg-muted/20 rounded-lg" : ""}`}
		>
			{loading ? (
				<div className="p-8 text-center text-muted-foreground">Rendering diagram...</div>
			) : svg ? (
				<div dangerouslySetInnerHTML={{ __html: svg }} />
			) : null}
		</div>
	);
}

// Component to render mermaid from chat messages
export function MermaidMessageRenderer({ content }: { content: string }) {
	// Check if content contains mermaid code block
	const mermaidMatch = content.match(/```mermaid\n([\s\S]*?)\n```/);

	if (!mermaidMatch) {
		return null;
	}

	return (
		<div className="my-4 overflow-auto">
			<MermaidRenderer content={mermaidMatch[1]} className="bg-muted/30 rounded-lg p-4" />
		</div>
	);
}

// Hook to extract and render all mermaid blocks from text
export function useMermaidBlocks(content: string) {
	const blocks: Array<{ id: string; code: string }> = [];

	const regex = /```mermaid\n([\s\S]*?)\n```/g;
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
