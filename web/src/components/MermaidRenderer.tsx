import { useEffect, useRef, useState } from "react";

interface MermaidRendererProps {
	content: string;
	className?: string;
}

// Cache for rendered diagrams
const renderCache = new Map<string, string>();

export function MermaidRenderer({ content, className }: MermaidRendererProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let mounted = true;

		async function renderDiagram() {
			if (!containerRef.current || !content) return;

			// Check cache first
			const cacheKey = content.slice(0, 100);
			if (renderCache.has(cacheKey)) {
				containerRef.current.innerHTML = renderCache.get(cacheKey)!;
				setLoading(false);
				return;
			}

			try {
				// Dynamically import mermaid
				const mermaid = await import("mermaid");

				// Initialize mermaid with theme
				mermaid.default.initialize({
					startOnLoad: false,
					theme: "dark",
					securityLevel: "loose",
					flowchart: {
						useMaxWidth: true,
						htmlLabels: true,
					},
				});

				// Extract mermaid code from markdown code block if present
				let mermaidCode = content;
				const mermaidMatch = content.match(/```mermaid\n([\s\S]*?)\n```/);
				if (mermaidMatch) {
					mermaidCode = mermaidMatch[1];
				}

				// Generate unique ID
				const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

				// Render
				const { svg } = await mermaid.default.render(id, mermaidCode);

				if (mounted && containerRef.current) {
					containerRef.current.innerHTML = svg;
					renderCache.set(cacheKey, svg);
					setLoading(false);
					setError(null);
				}
			} catch (err) {
				if (mounted) {
					setError(err instanceof Error ? err.message : "Failed to render diagram");
					setLoading(false);
				}
			}
		}

		setLoading(true);
		setError(null);
		renderDiagram();

		return () => {
			mounted = false;
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
			{loading && <div className="p-8 text-center text-muted-foreground">Rendering diagram...</div>}
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
