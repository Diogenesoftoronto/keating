import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GptLiveConsentControls, requestGptLiveConsent, type GptLiveConsent } from "../components/GptLiveConsentSettings";

const consent: GptLiveConsent = {
	purpose: "portkey-realtime-content-logging", policyVersion: "realtime-content-logging-v1",
	granted: false, disclosure: "Live audio and transcripts may be logged by the provider.",
};

test("checking consent is read-only; explicit approval and revocation send the exact policy", async () => {
	const calls: { path: string; init: RequestInit }[] = [];
	const client = { request: async (path: string, init: RequestInit = {}) => {
		calls.push({ path, init });
		return Response.json({ ...consent, granted: init.body ? JSON.parse(String(init.body)).granted : false });
	} };
	expect((await requestGptLiveConsent(undefined, client)).granted).toBe(false);
	expect(calls[0].path).toBe("/v1/realtime/consent");
	expect(calls[0].init.method).toBe("GET");
	expect(calls[0].init.body).toBeUndefined();
	expect((await requestGptLiveConsent(true, client)).granted).toBe(true);
	expect((await requestGptLiveConsent(false, client)).granted).toBe(false);
	for (const [index, granted] of [[1, true], [2, false]] as const) {
		expect(calls[index].init.method).toBe("POST");
		expect(JSON.parse(String(calls[index].init.body))).toEqual({ purpose: consent.purpose, policyVersion: consent.policyVersion, granted });
	}
});

test("unknown policies or missing disclosures cannot become live consent", async () => {
	for (const data of [
		{ ...consent, purpose: "another-purpose" }, { ...consent, policyVersion: "unreviewed-v2" },
		{ ...consent, disclosure: "" }, { ...consent, disclosure: "x".repeat(8_001) },
		{ ...consent, granted: "true" }, null,
	]) {
		await expect(requestGptLiveConsent(undefined, { request: async () => Response.json(data) })).rejects.toThrow();
	}
});

test("missing deployment and account access give recoverable errors", async () => {
	for (const status of [404, 503]) {
		await expect(requestGptLiveConsent(undefined, { request: async () => new Response(null, { status }) })).rejects.toThrow("not available");
	}
	for (const status of [401, 403]) {
		await expect(requestGptLiveConsent(undefined, { request: async () => new Response(null, { status }) })).rejects.toThrow("Reconnect Not Organic");
	}
	await expect(requestGptLiveConsent(undefined, null)).rejects.toThrow("Connect Not Organic");
});

test("consent UI exposes disclosure and deliberate actions, never a grant action before disclosure", () => {
	const render = (value: GptLiveConsent | null, busy = false, error: string | null = null) => renderToStaticMarkup(
		<GptLiveConsentControls consent={value} busy={busy} error={error} onChange={() => {}} onRefresh={() => {}} />,
	);
	const pending = render(null, true);
	expect(pending).not.toContain("Approve live content logging");
	expect(pending).toContain("Checking live consent");
	const available = render(consent);
	expect(available).toContain(consent.disclosure);
	expect(available).toContain("Approve live content logging");
	expect(available).not.toContain("Revoke live consent");
	const approved = render({ ...consent, granted: true });
	expect(approved).toContain("Revoke live consent");
	expect(approved).toContain("End any current call");
	expect(render(consent, true)).toContain("disabled");
	expect(render(null, false, "Consent endpoint unavailable")).toContain("Check again");
});
