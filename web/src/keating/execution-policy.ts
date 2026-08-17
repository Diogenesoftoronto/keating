export type CodeExecutor = "local" | "cloud" | "unavailable";
export type DeviceClass = "mobile" | "desktop" | "unknown";
export type NetworkClass = "slow" | "normal" | "unknown";

export interface ExecutionSignals {
	online: boolean;
	deviceClass: DeviceClass;
	networkClass: NetworkClass;
}

const SMALL_LOCAL_TYPESCRIPT_BYTES = 8_000;

export function chooseCodeExecutor(language: string, code: string, signals: ExecutionSignals): CodeExecutor {
	const normalized = language.trim().toLowerCase();
	if (["js", "javascript", "mjs", "cjs"].includes(normalized)) return "local";
	if (["py", "python"].includes(normalized)) return signals.online ? "cloud" : "unavailable";
	if (!["ts", "typescript"].includes(normalized)) return "unavailable";
	if (!signals.online) return "unavailable";
	if (signals.deviceClass === "desktop" && (signals.networkClass === "slow" || new TextEncoder().encode(code).byteLength <= SMALL_LOCAL_TYPESCRIPT_BYTES)) {
		return "local";
	}
	return "cloud";
}

export function browserExecutionSignals(): ExecutionSignals {
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
	};
}
