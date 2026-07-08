import { Sparkles } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { buildHyperframesHtml } from "./animation-host";
import { HyperframesPlayer } from "./HyperframesPlayer";

/**
 * The agent authors the animation as a Hyperframes HTML document with GSAP
 * timelines. It is rendered verbatim in a sandboxed iframe.
 */
export type AnimationKind = "hyperframes";

export interface AnimationPayload {
	topic: string;
	kind: AnimationKind;
	/** Required. The model-authored Hyperframes HTML. */
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
	if (payload.kind === "hyperframes") {
		if (!payload.body || payload.body.trim().length < 20) {
			return <ErrorBody message="Missing hyperframes HTML body." />;
		}
		return (
			<HyperframesPlayer
				html={buildHyperframesHtml(payload.body, payload.topic)}
				title={`${payload.topic} Hyperframes animation`}
				className={css({ padding: "0.75rem" })}
			/>
		);
	}
	return <ErrorBody message={`Unknown animation kind: ${String((payload as { kind?: unknown }).kind)}`} />;
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
		const kind: AnimationKind | null = inner.kind === "hyperframes" ? "hyperframes" : null;
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
