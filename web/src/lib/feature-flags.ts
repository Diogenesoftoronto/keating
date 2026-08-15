export interface KeatingFeatureEnv {
	DEV?: boolean;
	VITE_KEATING_CANVAS_ENABLED?: string;
}

/**
 * The current artifact canvas is experimental. Production builds keep it out
 * of ordinary navigation unless a deployment deliberately opts its cohort in;
 * local development retains access for redesign and testing.
 */
export function resolveCanvasFeatureEnabled(env: KeatingFeatureEnv): boolean {
	const configured = env.VITE_KEATING_CANVAS_ENABLED?.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(configured ?? "")) return true;
	if (["0", "false", "no", "off"].includes(configured ?? "")) return false;
	return env.DEV === true;
}

export function isCanvasFeatureEnabled(): boolean {
	return resolveCanvasFeatureEnabled(import.meta.env);
}
