import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { detectSupportedMermaidGrammar } from "@keating/learner-contracts";
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
const rendererClass = css({ position: "relative" });
const cardClass = css({
	backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)",
	borderRadius: "0.5rem",
	padding: "1rem",
});
const diagramClass = css({
	position: "relative",
	overflow: "auto",
	"& svg": {
		display: "block",
		maxWidth: "100%",
		height: "auto",
		marginInline: "auto",
	},
});
const expandButtonClass = cx(
	"dialog-icon-button",
	css({
		position: "absolute",
		top: "0.5rem",
		right: "0.5rem",
		display: "inline-flex",
		width: "2rem",
		height: "2rem",
		alignItems: "center",
		justifyContent: "center",
		border: "1px solid var(--border)",
		borderRadius: "0.5rem",
		backgroundColor: "color-mix(in srgb, var(--background) 92%, transparent)",
		color: "var(--foreground)",
		boxShadow: "0 2px 6px rgb(0 0 0 / 0.16)",
		backdropFilter: "blur(4px)",
		transition: "background-color 160ms ease-out, color 160ms ease-out",
		_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
		_focusVisible: { outline: "2px solid var(--primary)", outlineOffset: "2px" },
	}),
);
const expandedBackdropClass = css({
	position: "fixed",
	inset: 0,
	zIndex: 1000,
	display: "flex",
	backgroundColor: "rgb(0 0 0 / 0.72)",
	padding: "clamp(0.5rem, 2vw, 1.5rem)",
});
const expandedPanelClass = css({
	display: "flex",
	width: "100%",
	height: "100%",
	minHeight: 0,
	flexDirection: "column",
	overflow: "hidden",
	borderRadius: "0.75rem",
	backgroundColor: "var(--background)",
	color: "var(--foreground)",
	smDown: { borderRadius: 0 },
});
const expandedToolbarClass = css({
	display: "flex",
	minHeight: "3rem",
	flexShrink: 0,
	alignItems: "center",
	justifyContent: "space-between",
	gap: "1rem",
	borderBottom: "1px solid var(--border)",
	paddingInline: "0.75rem",
});
const expandedTitleClass = css({
	overflow: "hidden",
	fontSize: "0.875rem",
	fontWeight: 650,
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});
const closeButtonClass = cx(
	"dialog-icon-button",
	css({
		display: "inline-flex",
		width: "2rem",
		height: "2rem",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: "0.5rem",
		color: "var(--muted-foreground)",
		_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
		_focusVisible: { outline: "2px solid var(--primary)", outlineOffset: "2px" },
	}),
);
const expandedViewportClass = css({
	minHeight: 0,
	flex: 1,
	overflow: "auto",
	overscrollBehavior: "contain",
	backgroundColor: "color-mix(in srgb, var(--muted) 22%, var(--background))",
	padding: "clamp(1rem, 3vw, 2.5rem)",
});
const expandedDiagramClass = css({
	display: "flex",
	minWidth: "100%",
	minHeight: "100%",
	alignItems: "flex-start",
	justifyContent: "center",
	"& svg": {
		display: "block",
		width: "auto",
		minWidth: "100%",
		maxWidth: "none !important",
		height: "auto !important",
	},
});

interface MermaidRendererProps {
	content: string;
	className?: string;
}

// Cache for rendered diagrams
const renderCache = new Map<string, string>();
const mermaidFencePattern = /```mermaid[^\n]*\n([\s\S]*?)```/i;

type MermaidTheme = "default" | "dark";

export function currentMermaidTheme(documentElement = typeof document === "undefined" ? null : document.documentElement): MermaidTheme {
	return documentElement?.classList.contains("dark") ? "dark" : "default";
}

/** A lossless tuple key prevents same-prefix diagrams from sharing SVG output. */
export function mermaidRenderCacheKey(source: string, theme: MermaidTheme): string {
	return JSON.stringify([theme, source]);
}

export function mermaidSourceError(source: string): string | null {
	return detectSupportedMermaidGrammar(source) ? null : "This Mermaid grammar is not supported by Keating.";
}

function useMermaidTheme(): MermaidTheme {
	const [theme, setTheme] = useState<MermaidTheme>(() => currentMermaidTheme());

	useEffect(() => {
		if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
		const root = document.documentElement;
		const observer = new MutationObserver(() => setTheme(currentMermaidTheme(root)));
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		setTheme(currentMermaidTheme(root));
		return () => observer.disconnect();
	}, []);

	return theme;
}

// Strip a leading ```mermaid fence so the model can paste a fenced diagram
// verbatim and we still pass clean Mermaid source to the renderer. We keep
// the model-authored `<br/>` markers inside node labels — Mermaid honors
// them natively when `htmlLabels: true` is set, and `lib/sanitize-svg.ts`
// now allows the `<foreignObject>` wrapper Mermaid emits for those labels
// through.
export function extractMermaidSource(input: string): string {
	const trimmed = input.trim();
	const match = trimmed.match(mermaidFencePattern);
	return match ? match[1].trim() : trimmed;
}

export function MermaidRenderer({ content, className }: MermaidRendererProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const renderTargetRef = useRef<HTMLDivElement | null>(null);
	const expandButtonRef = useRef<HTMLButtonElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [svg, setSvg] = useState<string | null>(null);
	const [expanded, setExpanded] = useState(false);
	const theme = useMermaidTheme();

	useEffect(() => {
		let cancelled = false;

		async function renderDiagram() {
			if (!content) {
				setLoading(false);
				return;
			}

			const mermaidCode = extractMermaidSource(content);
			const sourceError = mermaidSourceError(mermaidCode);
			if (sourceError) {
				if (!cancelled) {
					setError(sourceError);
					setLoading(false);
				}
				return;
			}

			// Check cache first
			const cacheKey = mermaidRenderCacheKey(mermaidCode, theme);
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
					theme,
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
	}, [content, theme]);

	useEffect(() => {
		if (!expanded || typeof document === "undefined") return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
		const handleDialogKeydown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setExpanded(false);
			if (event.key === "Tab") {
				event.preventDefault();
				closeButtonRef.current?.focus();
			}
		};
		document.addEventListener("keydown", handleDialogKeydown);

		return () => {
			window.cancelAnimationFrame(focusFrame);
			document.removeEventListener("keydown", handleDialogKeydown);
			document.body.style.overflow = previousOverflow;
			expandButtonRef.current?.focus();
		};
	}, [expanded]);

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
			className={cx("mermaid-container", rendererClass, className, loading && containerClass)}
		>
			{loading ? (
				<div className={loadingClass}>Rendering diagram...</div>
			) : svg ? (
				<>
					<div className={diagramClass} dangerouslySetInnerHTML={{ __html: svg }} />
					<button
						ref={expandButtonRef}
						type="button"
						className={expandButtonClass}
						aria-label="Expand diagram"
						aria-expanded={expanded}
						title="Expand diagram"
						onClick={() => setExpanded(true)}
					>
						<Maximize2 aria-hidden="true" size={16} />
					</button>
					{expanded && typeof document !== "undefined"
						? createPortal(
								<div
									className={expandedBackdropClass}
									onMouseDown={(event) => {
										if (event.target === event.currentTarget) setExpanded(false);
									}}
								>
									<section
										className={expandedPanelClass}
										role="dialog"
										aria-modal="true"
										aria-label="Expanded Mermaid diagram"
									>
										<header className={expandedToolbarClass}>
											<h2 className={expandedTitleClass}>Expanded diagram</h2>
											<button
												ref={closeButtonRef}
												type="button"
												className={closeButtonClass}
												aria-label="Close expanded diagram"
												title="Close expanded diagram"
												onClick={() => setExpanded(false)}
											>
												<X aria-hidden="true" size={18} />
											</button>
										</header>
										<div className={expandedViewportClass}>
											<div className={expandedDiagramClass} dangerouslySetInnerHTML={{ __html: svg }} />
										</div>
									</section>
								</div>,
								document.body,
							)
						: null}
				</>
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
