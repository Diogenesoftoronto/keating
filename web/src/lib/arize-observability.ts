import type { AgentTraceEnvelopeV1 } from "./agent-analytics";

export interface ArizePublicConfig {
	enabled: boolean;
	reason: string;
	evaluationContentEnabled: boolean;
	maxContentChars: number;
	rateLimitPerMinute: number;
}

export type ArizeTraceStatus =
	| { state: "idle" | "disabled" | "sent" }
	| { state: "failed"; retry: () => Promise<void>; turnOff: () => void };

let currentTraceStatus: ArizeTraceStatus = { state: "idle" };
const traceStatusListeners = new Set<(status: ArizeTraceStatus) => void>();

export function publishArizeTraceStatus(status: ArizeTraceStatus): void {
	currentTraceStatus = status;
	for (const listener of traceStatusListeners) listener(status);
}

export function subscribeArizeTraceStatus(listener: (status: ArizeTraceStatus) => void): () => void {
	traceStatusListeners.add(listener);
	listener(currentTraceStatus);
	return () => traceStatusListeners.delete(listener);
}

const CONFIG_PATH = "/api/observability/v1/arize/config";
const TRACE_PATH = "/api/observability/v1/arize/traces";

export async function getArizePublicConfig(fetcher: typeof fetch = fetch): Promise<ArizePublicConfig> {
	try {
		const response = await fetcher(CONFIG_PATH, { credentials: "same-origin" });
		if (!response.ok) throw new Error("unavailable");
		const parsed = await response.json() as Partial<ArizePublicConfig>;
		return {
			enabled: parsed.enabled === true,
			reason: typeof parsed.reason === "string" ? parsed.reason : "unavailable",
			evaluationContentEnabled: parsed.evaluationContentEnabled === true,
			maxContentChars: typeof parsed.maxContentChars === "number" ? parsed.maxContentChars : 16_000,
			rateLimitPerMinute: typeof parsed.rateLimitPerMinute === "number" ? parsed.rateLimitPerMinute : 30,
		};
	} catch {
		return { enabled: false, reason: "unavailable", evaluationContentEnabled: false, maxContentChars: 16_000, rateLimitPerMinute: 30 };
	}
}

export class ArizeTraceClient {
	private failed: AgentTraceEnvelopeV1 | undefined;
	private consentEnabled = false;
	private consentEpoch = 0;

	constructor(
		private readonly fetcher: typeof fetch = fetch,
		private readonly onStatus: (status: ArizeTraceStatus) => void = () => undefined,
		private readonly onTurnOff: () => void = () => undefined,
	) {}

	turnOff(): void {
		this.consentEnabled = false;
		this.consentEpoch += 1;
		this.failed = undefined;
		this.onStatus({ state: "disabled" });
		this.onTurnOff();
	}

	async submit(envelope: AgentTraceEnvelopeV1, config: ArizePublicConfig, preferenceEnabled: boolean): Promise<void> {
		if (!config.enabled || !preferenceEnabled) {
			this.consentEnabled = false;
			this.consentEpoch += 1;
			this.failed = undefined;
			this.onStatus({ state: "disabled" });
			return;
		}
		this.consentEnabled = true;
		const submissionEpoch = this.consentEpoch;
		const payload = !config.evaluationContentEnabled
			? { ...envelope, evaluation_content: undefined }
			: envelope.evaluation_content
				? {
					...envelope,
					evaluation_content: {
						input: envelope.evaluation_content.input.slice(0, config.maxContentChars),
						output: envelope.evaluation_content.output.slice(0, config.maxContentChars),
					},
				}
				: envelope;
		try {
			const response = await this.fetcher(TRACE_PATH, {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
			});
			if (!response.ok) throw new Error(`status_${response.status}`);
			if (submissionEpoch !== this.consentEpoch || !this.consentEnabled) return;
			this.failed = undefined;
			this.onStatus({ state: "sent" });
		} catch {
			if (submissionEpoch !== this.consentEpoch || !this.consentEnabled) return;
			this.failed = payload;
			this.onStatus({
				state: "failed",
				retry: async () => {
					if (this.failed && this.consentEnabled) await this.submit(this.failed, config, this.consentEnabled);
				},
				turnOff: () => {
					this.turnOff();
				},
			});
		}
	}
}
