import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { buildManimSceneHtml, buildHyperframesHtml } from "./animation-host";

/**
 * The agent authors the animation itself. Two code-authored kinds are supported:
 *
 * - `manim` — the agent writes raw JavaScript: an `async function construct(scene, M)`
 *   that uses manim-web primitives (M.Text, M.FadeIn, M.Create, M.Axes, M.BarChart,
 *   M.Transform, etc.) to stage a real, motion-driven explanation. `M` is the
 *   full manim-web namespace. The host page loads the library from /manim-web/
 *   and runs the construct function inside a fresh Scene.
 *
 * - `hyperframes` — the agent writes a full HTML document with GSAP timelines.
 *   Rendered verbatim in an iframe.
 */
export type AnimationKind = "manim" | "hyperframes";

export interface AnimationPayload {
	topic: string;
	kind: AnimationKind;
	/** Required for `manim` and `hyperframes`. The model-authored code/HTML. */
	body?: string;
	/** Optional one-line summary shown above the animation. */
	summary?: string;
}

export interface AnimatedSceneProps {
	payload: AnimationPayload;
	className?: string;
}

export function AnimatedScene({ payload, className }: AnimatedSceneProps) {
	return (
		<div
			className={cx(
				css({
					overflow: "hidden",
					borderRadius: "0.75rem",
					borderWidth: "2px",
					borderColor: "var(--border)",
					background: "var(--background)",
					boxShadow: "var(--shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05))",
				}),
				className,
			)}
		>
			<header className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderBottom: "1px solid var(--border)", background: "color-mix(in srgb, var(--muted) 30%, transparent)", padding: "0.5rem 1rem" })}>
				<div className={css({ minWidth: 0 })}>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
						<Sparkles size={12} className={css({ color: "#f59e0b" })} />
						<span className={cx("font-terminal", css({ textTransform: "uppercase", letterSpacing: "0.025em" }))}>Animation</span>
						<span className={css({ color: "var(--border)" })}>·</span>
						<span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{payload.topic}</span>
						<span className={css({ color: "var(--border)" })}>·</span>
						<span className={cx("font-terminal", css({ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }))}>
							{payload.kind}
						</span>
					</div>
					{payload.summary && (
						<p className={css({ marginTop: "0.125rem", fontSize: "0.875rem", color: "var(--foreground)" })}>{payload.summary}</p>
					)}
				</div>
			</header>
			<AnimationBody payload={payload} />
		</div>
	);
}

function AnimationBody({ payload }: { payload: AnimationPayload }) {
	if (payload.kind === "manim") {
		if (!payload.body || payload.body.trim().length < 20) {
			return <ErrorBody message="Missing manim scene body." />;
		}
		return (
			<CodeFrame
				html={buildManimSceneHtml(payload.body, payload.topic)}
				sandbox="allow-scripts"
			/>
		);
	}
	if (payload.kind === "hyperframes") {
		if (!payload.body || payload.body.trim().length < 20) {
			return <ErrorBody message="Missing hyperframes HTML body." />;
		}
		return (
			<CodeFrame
				html={buildHyperframesHtml(payload.body, payload.topic)}
				sandbox="allow-scripts"
			/>
		);
	}
	return <ErrorBody message={`Unknown animation kind: ${String((payload as { kind?: unknown }).kind)}`} />;
}

function CodeFrame({ html, sandbox }: { html: string; sandbox: string }) {
	const src = useBlobUrl(html);
	return (
		<iframe
			title="Keating animation"
			src={src}
			sandbox={sandbox}
			className={css({ display: "block", aspectRatio: "16 / 9", width: "100%", border: 0, background: "black" })}
		/>
	);
}

/**
 * Wrap the model-authored HTML in a blob URL so the iframe shares the
 * parent's origin. With `srcDoc`, the iframe has a unique opaque origin
 * and cross-origin module imports (e.g. `/manim-web/index.js`) are
 * blocked by COEP/CORP even when served with the right headers — which
 * is exactly what was breaking the animate tool in production.
 */
function useBlobUrl(html: string): string {
	const blob = useMemo(() => new Blob([html], { type: "text/html" }), [html]);
	const [url, setUrl] = useState<string>("");
	useEffect(() => {
		const next = URL.createObjectURL(blob);
		setUrl(next);
		return () => URL.revokeObjectURL(next);
	}, [blob]);
	return url;
}

function ErrorBody({ message }: { message: string }) {
	return <div className={css({ padding: "1rem", fontSize: "0.875rem", color: "#f43f5e" })}>{message}</div>;
}

export function parseAnimationPayload(payload: string): AnimationPayload | null {
	try {
		const parsed = JSON.parse(payload);
		const inner = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
		if (!inner || typeof inner !== "object") return null;
		const topic = typeof inner.topic === "string" ? inner.topic : "Animation";
		const kind: AnimationKind | null =
			inner.kind === "manim" || inner.kind === "hyperframes"
				? inner.kind
				: null;
		if (!kind) return null;
		return {
			topic,
			kind,
			summary: typeof inner.summary === "string" ? inner.summary : undefined,
			body: typeof inner.body === "string" ? inner.body : undefined,
		};
	} catch {
		return null;
	}
}
