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
	// One frame only: no card border, no tinted header bar, no separate body
	// padding. The animation itself is the object; the label sits above it as a
	// quiet eyebrow. `kind` is dropped — "hyperframes" means nothing to a learner
	// and it is the only renderer.
	return (
		<div className={cx(css({ marginBlock: "1.25rem", display: "grid", gap: "0.75rem" }), className)}>
			<div className={css({ display: "grid", gap: "0.25rem" })}>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0, fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>
					<Sparkles size={12} className={css({ color: "#f59e0b" })} />
					<span className={cx("font-terminal", css({ textTransform: "uppercase", letterSpacing: "0.06em" }))}>Animation</span>
					<span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{payload.topic}</span>
				</div>
				{payload.summary && (
					<p className={css({ fontSize: "0.875rem", color: "var(--foreground)" })}>{payload.summary}</p>
				)}
			</div>
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
