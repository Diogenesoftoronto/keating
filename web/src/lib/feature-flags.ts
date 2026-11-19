export interface KeatingFeatureEnv {
	DEV?: boolean;
	VITE_KEATING_CANVAS_ENABLED?: string;
}

/**
 * The session materials panel (beside the chat on wide screens, an overlay on
 * narrow ones) is on in every build. A deployment can still switch it off
 * with `VITE_KEATING_CANVAS_ENABLED=off|0|false|no`; any other value, or
 * none, leaves it on.
 */
export function resolveCanvasFeatureEnabled(env: KeatingFeatureEnv): boolean {
	const configured = env.VITE_KEATING_CANVAS_ENABLED?.trim().toLowerCase();
	if (["0", "false", "no", "off"].includes(configured ?? "")) return false;
	return true;
}

export function isCanvasFeatureEnabled(): boolean {
	return resolveCanvasFeatureEnabled(import.meta.env);
}
