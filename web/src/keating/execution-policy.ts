import { isNotOrganicFeatureEnabled } from "../notorganic-provider";

export type CodeExecutor = "local" | "cloud" | "unavailable";
export type DeviceClass = "mobile" | "desktop" | "unknown";
export type NetworkClass = "slow" | "normal" | "unknown";

export interface ExecutionSignals {
	online: boolean;
	deviceClass: DeviceClass;
	networkClass: NetworkClass;
	/**
	 * Whether hosted ("cloud") execution can actually service a run. Defaults to
	 * true so existing callers keep their behaviour; when false the policy never
	 * returns "cloud", because the hosted notebook route would reject the run.
	 */
	hostedAvailable?: boolean;
}

const SMALL_LOCAL_TYPESCRIPT_BYTES = 8_000;

export function chooseCodeExecutor(language: string, code: string, signals: ExecutionSignals): CodeExecutor {
	const normalized = language.trim().toLowerCase();
	const hosted = signals.hostedAvailable ?? true;
	if (["js", "javascript", "mjs", "cjs"].includes(normalized)) return "local";
	// Python has no local runtime, so without hosted execution it cannot run at
	// all. Returning "cloud" here would send the run to a route that rejects it.
	if (["py", "python"].includes(normalized)) {
		return signals.online && hosted ? "cloud" : "unavailable";
	}
	if (!["ts", "typescript"].includes(normalized)) return "unavailable";
	if (!signals.online) return "unavailable";
	if (signals.deviceClass === "desktop" && (signals.networkClass === "slow" || new TextEncoder().encode(code).byteLength <= SMALL_LOCAL_TYPESCRIPT_BYTES)) {
		return "local";
	}
	// TypeScript is promoted to hosted execution only as an optimisation, so
	// running it locally is always a correct fallback.
	return hosted ? "cloud" : "local";
}

export function browserExecutionSignals(hostedAvailable = isNotOrganicFeatureEnabled()): ExecutionSignals {
	const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
	const effectiveType = connection?.effectiveType;
	const networkClass: NetworkClass = effectiveType === "slow-2g" || effectiveType === "2g"
		? "slow"
		: effectiveType ? "normal" : "unknown";
	const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
	return {
		online: navigator.onLine,
		deviceClass: mobile ? "mobile" : "desktop",
		networkClass,
		hostedAvailable,
	};
}
