import { LessonFrame } from "./lesson/LessonFrame";
import "./specialist-lessons.css";
import { css } from "../../styled-system/css";
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
		<LessonFrame glyph="spark" title={payload.topic} kind="Animation" className={["specialist-animation", className].filter(Boolean).join(" ")}>
			{payload.summary && <p>{payload.summary}</p>}
			<AnimationBody payload={payload} />
		</LessonFrame>
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
	return <div className={css({ padding: "1rem", fontSize: "0.875rem", color: "var(--destructive)" })}>{message}</div>;
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
