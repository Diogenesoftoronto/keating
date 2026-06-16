import { Sparkles } from "lucide-react";
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
			className={`overflow-hidden rounded-xl border-2 border-border bg-background shadow-sm ${className ?? ""}`}
		>
			<header className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<Sparkles size={12} className="text-amber-500" />
						<span className="font-terminal uppercase tracking-wide">Animation</span>
						<span className="text-border">·</span>
						<span className="truncate">{payload.topic}</span>
						<span className="text-border">·</span>
						<span className="font-terminal text-[10px] uppercase tracking-wider">
							{payload.kind}
						</span>
					</div>
					{payload.summary && (
						<p className="mt-0.5 text-sm text-foreground">{payload.summary}</p>
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
				sandbox="allow-scripts allow-same-origin"
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
				sandbox="allow-scripts allow-same-origin"
			/>
		);
	}
	return <ErrorBody message={`Unknown animation kind: ${String((payload as { kind?: unknown }).kind)}`} />;
}

function CodeFrame({ html, sandbox }: { html: string; sandbox: string }) {
	return (
		<iframe
			title="Keating animation"
			srcDoc={html}
			sandbox={sandbox}
			className="block aspect-video w-full border-0 bg-black"
		/>
	);
}

function ErrorBody({ message }: { message: string }) {
	return <div className="p-4 text-sm text-rose-500">{message}</div>;
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
