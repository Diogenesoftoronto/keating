import { describe, expect, test } from "bun:test";
import { ArizeTraceClient, publishArizeTraceStatus, subscribeArizeTraceStatus, type ArizePublicConfig, type ArizeTraceStatus } from "../lib/arize-observability";
import type { AgentTraceEnvelopeV1 } from "../lib/agent-analytics";

const envelope: AgentTraceEnvelopeV1 = {
	schema_version: 1,
	run_id: "run-1", session_id: "session-1", turn_index: 0,
	provider: "openai", model: "gpt-5", source: "provider", status: "success",
	duration_ms: 10, generation_count: 0, tool_count: 0, app_version: "3.0.0", surface: "web",
	generations: [], tools: [], evaluation_content: { input: "private input", output: "private output" },
};

const enabledConfig: ArizePublicConfig = {
	enabled: true, reason: "enabled", evaluationContentEnabled: true, maxContentChars: 6, rateLimitPerMinute: 30,
};

describe("Arize trace client", () => {
	test("never submits while unavailable or when the independent preference is off", async () => {
		let calls = 0;
		const statuses: ArizeTraceStatus[] = [];
		const client = new ArizeTraceClient((async () => { calls += 1; return new Response(null, { status: 202 }); }) as unknown as typeof fetch, (status) => statuses.push(status));
		await client.submit(envelope, { ...enabledConfig, enabled: false, reason: "disabled" }, true);
		await client.submit(envelope, enabledConfig, false);
		expect(calls).toBe(0);
		expect(statuses.map((status) => status.state)).toEqual(["disabled", "disabled"]);
	});

	test("caps approved content, removes it when the server disallows it, and keeps failure recovery in memory", async () => {
		const bodies: string[] = [];
		let attempt = 0;
		let latest: ArizeTraceStatus | undefined;
		let turnedOff = 0;
		const client = new ArizeTraceClient((async (_input, init) => {
			bodies.push(String(init?.body));
			attempt += 1;
			return new Response(null, { status: attempt === 1 || attempt === 4 ? 503 : 202 });
		}) as typeof fetch, (status) => { latest = status; }, () => { turnedOff += 1; });

		await client.submit(envelope, enabledConfig, true);
		expect(JSON.parse(bodies[0]).evaluation_content).toEqual({ input: "privat", output: "privat" });
		expect(latest?.state).toBe("failed");
		if (latest?.state === "failed") await latest.retry();
		expect(bodies).toHaveLength(2);
		expect(latest?.state).toBe("sent");

		await client.submit(envelope, { ...enabledConfig, evaluationContentEnabled: false }, true);
		expect(JSON.parse(bodies[2]).evaluation_content).toBeUndefined();
		await client.submit(envelope, enabledConfig, true);
		if (latest?.state === "failed") latest.turnOff();
		expect(turnedOff).toBe(1);
	});

	test("keeps recovery visible across late subscribers and cannot revive it after consent is revoked", async () => {
		let releaseFailure: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => { releaseFailure = resolve; });
		const statuses: ArizeTraceStatus[] = [];
		const client = new ArizeTraceClient((async () => {
			await pending;
			return new Response(null, { status: 503 });
		}) as unknown as typeof fetch, publishArizeTraceStatus);

		const submission = client.submit(envelope, enabledConfig, true);
		client.turnOff();
		releaseFailure?.();
		await submission;

		const unsubscribe = subscribeArizeTraceStatus((status) => statuses.push(status));
		try {
			expect(statuses.at(-1)?.state).toBe("disabled");
			expect(statuses.some((status) => status.state === "failed")).toBe(false);
		} finally {
			unsubscribe();
			publishArizeTraceStatus({ state: "idle" });
		}
	});
});
