import { DiagramViewport } from "./DiagramViewport";
import { IconButton, Loading } from "../design-system/kit";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { detectSupportedMermaidGrammar } from "@keating/learner-contracts";
import { css, cx } from "../../styled-system/css";
import { sanitizeSvg } from "../lib/sanitize-svg";
import { decodeSystemDesignSvgLabels } from "../lib/system-design-svg";

const errorContainerClass = css({
	padding: "1rem",
	backgroundColor: "var(--card)",
	border: "1px solid var(--destructive)",
	borderRadius: "0.5rem",
});
const errorTitleClass = css({ color: "var(--destructive)", fontSize: "0.875rem" });
const errorPreClass = css({
	marginTop: "0.5rem",
	fontSize: "0.75rem",
	color: "var(--muted-foreground)",
	overflow: "auto",
});
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
	/** Plain graph labels should stay SVG text, without HTML label markup. */
	htmlLabels?: boolean;
	decodeEntityLabels?: boolean;
}

// Cache for rendered diagrams
const renderCache = new Map<string, string>();
const mermaidFencePattern = /```mermaid[^\n]*\n([\s\S]*?)```/i;

type MermaidTheme = "default" | "dark";

export function currentMermaidTheme(documentElement = typeof document === "undefined" ? null : document.documentElement): MermaidTheme {
	return (documentElement?.classList.contains("dark") || documentElement?.getAttribute?.("data-theme") === "dark") ? "dark" : "default";
}

/** A lossless tuple key prevents same-prefix diagrams from sharing SVG output. */
export function mermaidRenderCacheKey(source: string, theme: MermaidTheme, htmlLabels = true, decodeEntityLabels = false): string {
	return JSON.stringify([theme, source, htmlLabels, decodeEntityLabels]);
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
		observer.observe(root, { attributes: true, attributeFilter: ["class","data-theme"] });
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

export function MermaidRenderer({ content, className, htmlLabels = true, decodeEntityLabels = false }: MermaidRendererProps) {
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
			const cacheKey = mermaidRenderCacheKey(mermaidCode, theme, htmlLabels, decodeEntityLabels);
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
				const styles = getComputedStyle(document.documentElement);
				const token = (name: string) => styles.getPropertyValue(name).trim();
				mermaid.default.initialize({
					startOnLoad: false,
					theme: "base",
					themeVariables: {
						darkMode: theme === "dark", fontFamily: token("--font-ui") || "system-ui, sans-serif",
						primaryColor: token("--card"), primaryTextColor: token("--ink"),
						lineColor: token("--ink"), primaryBorderColor: token("--ink"),
						secondaryColor: token("--paper-deep"), tertiaryColor: token("--paper"),
						cScale0: token("--series-1"), cScale1: token("--series-2"), cScale2: token("--series-3"),
					},
					securityLevel: "strict",
					htmlLabels,
					flowchart: {
						useMaxWidth: true,
						// Render `<br/>` markers inside node labels as real line
						// breaks. The output SVG is passed through sanitizeSvg,
						// which explicitly permits the `<foreignObject>` Mermaid wraps
						// around htmlLabels content only on this strict-rendered path.
						htmlLabels,
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
				const sanitizedSvg = sanitizeSvg(renderedSvg, { allowForeignObject: htmlLabels });
				const safeSvg = sanitizedSvg && decodeEntityLabels && !htmlLabels ? decodeSystemDesignSvgLabels(sanitizedSvg) : sanitizedSvg;
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
	}, [content, theme, htmlLabels, decodeEntityLabels]);

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
			<div className={cx("specialist-frame", errorContainerClass, className)}>
				<p className={errorTitleClass}>Failed to render diagram: {error}</p>
				<pre className={errorPreClass}>{content}</pre>
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className={cx("specialist-frame mermaid-container", rendererClass, className)}
		>
			{loading ? (
				<Loading label="Rendering diagram..." />
			) : svg ? (
				<>
					<DiagramViewport caption="Mermaid diagram" tools={<IconButton ref={expandButtonRef} glyph="expand" label="Expand diagram" aria-expanded={expanded} onClick={() => setExpanded(true)} />}>
						<div className={diagramClass} dangerouslySetInnerHTML={{ __html: svg }} />
					</DiagramViewport>
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
											<IconButton ref={closeButtonRef} glyph="x" label="Close expanded diagram" onClick={() => setExpanded(false)} />
										</header>
										<div className={cx(expandedViewportClass, "k-grid")}>
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
