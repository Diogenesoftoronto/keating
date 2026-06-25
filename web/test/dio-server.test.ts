import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { createHmac } from "node:crypto";
import type { DioEntitlement } from "../src/dio-provider/server";

const storage = new Map<string, unknown>();

function createMemoryStorage() {
	return {
		getItem: async (key: string) => storage.get(key) ?? null,
		setItem: async (key: string, value: unknown) => {
			storage.set(key, value);
		},
		hasItem: async (key: string) => storage.has(key),
		removeItem: async (key: string) => storage.delete(key),
	};
}

mock.module("nitro/storage", () => ({
	useStorage: () => createMemoryStorage(),
}));

function createFakeEvent({
	method = "POST",
	url = "http://localhost/api/dio/webhook",
	body,
	headers = {},
}: {
	method?: string;
	url?: string;
	body?: unknown;
	headers?: Record<string, string>;
} = {}) {
	const bodyString = typeof body === "string" ? body : JSON.stringify(body ?? {});
	const lowerHeaders = new Headers(Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])));
	return {
		method,
		path: new URL(url).pathname,
		node: {
			req: { method, url, headers: Object.fromEntries(lowerHeaders.entries()) },
		},
		req: {
			method,
			url,
			headers: lowerHeaders,
			text: async () => bodyString,
			json: async () => JSON.parse(bodyString),
			arrayBuffer: async () => new TextEncoder().encode(bodyString).buffer,
		} as unknown as Request,
	} as any;
}

const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
	for (const key of [
		"CREEM_API_KEY",
		"CREEM_BASE_URL",
		"CREEM_WEBHOOK_SECRET",
		"CREEM_PRODUCT_ID_DIO_CREDITS",
		"DIO_CREDIT_BUDGET",
		"BIFROST_API_KEY",
		"BIFROST_BASE_URL",
		"BIFROST_MODEL_ALIAS",
		"RESEND_API_KEY",
		"DIO_RECOVERY_FROM_EMAIL",
		"DIO_RECOVERY_DEV_CODE",
		"DIO_ENABLED",
		"NODE_ENV",
	]) {
		envBackup[key] = process.env[key];
	}
	storage.clear();
	process.env.CREEM_API_KEY = "creem_test_key";
	process.env.CREEM_WEBHOOK_SECRET = "whsec_test";
	process.env.CREEM_PRODUCT_ID_DIO_CREDITS = "prod_dio_credits";
	process.env.DIO_CREDIT_BUDGET = "500";
	process.env.BIFROST_API_KEY = "bifrost_test_key";
	process.env.BIFROST_BASE_URL = "https://bifrost.test";
	process.env.BIFROST_MODEL_ALIAS = "kimi-k2.6";
	process.env.DIO_ENABLED = "true";
});

afterEach(() => {
	for (const [key, value] of Object.entries(envBackup)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
});

describe("dio env config", () => {
	it("reads required variables and validates budget", async () => {
		process.env.NODE_ENV = "test";
		process.env.DIO_RECOVERY_DEV_CODE = "false";
		process.env.DIO_ENABLED = "true";
		const { getDioEnvConfig } = await import("../src/dio-provider/server");
		const config = getDioEnvConfig();
		expect(config.enabled).toBe(true);
		expect(config.creemApiKey).toBe("creem_test_key");
		expect(config.creemProductId).toBe("prod_dio_credits");
		expect(config.dioCreditBudget).toBe(500);
		expect(config.bifrostApiKey).toBe("bifrost_test_key");
		expect(config.bifrostBaseUrl).toBe("https://bifrost.test");
		expect(config.bifrostModelAlias).toBe("kimi-k2.6");
		expect(config.recoveryDevCode).toBe(false);
	});

	it("rejects invalid budget", async () => {
		process.env.DIO_CREDIT_BUDGET = "not-a-number";
		const { getDioEnvConfig } = await import("../src/dio-provider/server");
		expect(() => getDioEnvConfig()).toThrow(/positive integer/);
	});

	it("requires the gateway base URL from server env", async () => {
		delete process.env.BIFROST_BASE_URL;
		const { getDioEnvConfig, getDioGatewayBaseUrl } = await import("../src/dio-provider/server");
		expect(() => getDioGatewayBaseUrl()).toThrow(/BIFROST_BASE_URL/);
		expect(() => getDioEnvConfig()).toThrow(/BIFROST_BASE_URL/);
	});

	it("selects the Creem sandbox for test keys", async () => {
		process.env.CREEM_API_KEY = "creem_test_example";
		delete process.env.CREEM_BASE_URL;
		const { getDioEnvConfig } = await import("../src/dio-provider/server");
		expect(getDioEnvConfig().creemBaseUrl).toBe("https://test-api.creem.io/v1");
	});

	it("uses production Creem by default and honors an explicit base URL", async () => {
		const { getDioEnvConfig } = await import("../src/dio-provider/server");
		process.env.CREEM_API_KEY = "creem_live_example";
		delete process.env.CREEM_BASE_URL;
		expect(getDioEnvConfig().creemBaseUrl).toBe("https://api.creem.io/v1");
		process.env.CREEM_BASE_URL = "https://creem.internal/v1";
		expect(getDioEnvConfig().creemBaseUrl).toBe("https://creem.internal/v1");
	});

	it("enables dev recovery code in development", async () => {
		process.env.NODE_ENV = "development";
		process.env.DIO_RECOVERY_DEV_CODE = "";
		const { getDioEnvConfig } = await import("../src/dio-provider/server");
		const config = getDioEnvConfig();
		expect(config.enabled).toBe(true);
		expect(config.recoveryDevCode).toBe(true);
		expect(config.recoveryFromEmail).toBe("support@keating.help");
	});

	it("reads resend recovery config", async () => {
		process.env.NODE_ENV = "test";
		process.env.RESEND_API_KEY = "resend_test_key";
		process.env.DIO_RECOVERY_FROM_EMAIL = "recovery@keating.test";
		const { getDioEnvConfig } = await import("../src/dio-provider/server");
		const config = getDioEnvConfig();
		expect(config.resendApiKey).toBe("resend_test_key");
		expect(config.recoveryFromEmail).toBe("recovery@keating.test");
	});
});

describe("dio OpenAI proxy allowlist", () => {
	it("allows only the OpenAI-compatible endpoints the web client needs", async () => {
		const { isAllowedDioOpenAiProxyRequest } = await import("../src/dio-provider/server");
		expect(isAllowedDioOpenAiProxyRequest("POST", "v1/chat/completions")).toBe(true);
		expect(isAllowedDioOpenAiProxyRequest("POST", "/v1/chat/completions?stream=true")).toBe(true);
		expect(isAllowedDioOpenAiProxyRequest("GET", "v1/models")).toBe(true);
		expect(isAllowedDioOpenAiProxyRequest("HEAD", "v1/models")).toBe(true);
	});

	it("rejects gateway administration and unexpected OpenAI paths", async () => {
		const { isAllowedDioOpenAiProxyRequest } = await import("../src/dio-provider/server");
		expect(isAllowedDioOpenAiProxyRequest("POST", "api/governance/virtual-keys")).toBe(false);
		expect(isAllowedDioOpenAiProxyRequest("POST", "v1/models")).toBe(false);
		expect(isAllowedDioOpenAiProxyRequest("GET", "v1/chat/completions")).toBe(false);
		expect(isAllowedDioOpenAiProxyRequest("POST", "../api/governance/virtual-keys")).toBe(false);
	});
});

describe("generic proxy target validation", () => {
	it("accepts public https base URLs and preserves path prefixes", async () => {
		const { buildValidatedProxyUrl } = await import("../server/utils/proxy-target");
		expect(buildValidatedProxyUrl("https://gateway.example/openai/v1", "chat/completions")).toBe(
			"https://gateway.example/openai/v1/chat/completions",
		);
	});

	it("rejects local, private, credentialed, and non-http targets by default", async () => {
		const { buildValidatedProxyUrl } = await import("../server/utils/proxy-target");
		expect(() => buildValidatedProxyUrl("http://169.254.169.254", "latest/meta-data")).toThrow(/https|local|private/);
		expect(() => buildValidatedProxyUrl("https://127.0.0.1:8080", "v1/models")).toThrow(/local|private/);
		expect(() => buildValidatedProxyUrl("https://user:pass@example.com", "v1/models")).toThrow(/credentials/);
		expect(() => buildValidatedProxyUrl("file:///etc/passwd", "")).toThrow(/http or https/);
	});

	it("allows local http targets only when explicitly enabled", async () => {
		const { buildValidatedProxyUrl } = await import("../server/utils/proxy-target");
		expect(buildValidatedProxyUrl("http://localhost:11434", "api/tags", {
			allowHttp: true,
			allowLocal: true,
		})).toBe("http://localhost:11434/api/tags");
	});
});

describe("creem checkout creation", () => {
	it("creates a checkout and returns url and reference", async () => {
		const { createCreemCheckout, getDioEnvConfig } = await import("../src/dio-provider/server");
		const originalFetch = globalThis.fetch;
		let requestUrl = "";
		let requestBody: Record<string, unknown> = {};

		(globalThis as any).fetch = async (url: string | URL | Request, init?: RequestInit) => {
			requestUrl = url.toString();
			requestBody = JSON.parse((init?.body as string) ?? "{}");
			return new Response(JSON.stringify({ checkout_url: "https://checkout.test/123" }), { status: 200 });
		};

		try {
			const config = getDioEnvConfig();
			const result = await createCreemCheckout(config, "Buyer@Example.com");
			expect(result.checkoutUrl).toBe("https://checkout.test/123");
			expect(result.purchaseReference).toMatch(/^dio_[0-9a-f-]+/);
			expect(requestUrl).toMatch(/\/checkouts$/);
			expect(requestBody.product_id).toBe("prod_dio_credits");
			expect((requestBody.metadata as Record<string, string>).customer_email).toBe("buyer@example.com");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects invalid email", async () => {
		const { createCreemCheckout, getDioEnvConfig } = await import("../src/dio-provider/server");
		await expect(createCreemCheckout(getDioEnvConfig(), "not-an-email")).rejects.toThrow(/Invalid email/);
	});
});

describe("creem webhook verification", () => {
	it("verifies a valid signature", async () => {
		const { verifyCreemWebhookSignature } = await import("../src/dio-provider/server");
		const payload = JSON.stringify({ id: "evt_1", eventType: "checkout.completed" });
		const signature = createHmac("sha256", "whsec_test").update(payload).digest("hex");
		expect(verifyCreemWebhookSignature(payload, signature, "whsec_test")).toBe(true);
	});

	it("rejects an invalid signature", async () => {
		const { verifyCreemWebhookSignature } = await import("../src/dio-provider/server");
		const payload = JSON.stringify({ id: "evt_1", eventType: "checkout.completed" });
		expect(verifyCreemWebhookSignature(payload, "bad-sig", "whsec_test")).toBe(false);
		expect(verifyCreemWebhookSignature(payload, "", "whsec_test")).toBe(false);
	});

	it("parses a valid webhook body", async () => {
		const { parseCreemWebhookBody } = await import("../src/dio-provider/server");
		const body = {
			id: "evt_1",
			eventType: "checkout.completed",
			object: {
				id: "ch_1",
				request_id: "dio_purchase_1",
				order: { id: "ord_1", product: "prod_dio_credits", status: "paid" },
				product: { id: "prod_dio_credits" },
				customer: { id: "cust_1", email: "buyer@example.com" },
			},
		};
		const parsed = parseCreemWebhookBody(body);
		expect(parsed.id).toBe("evt_1");
		expect(parsed.object?.order?.product).toBe("prod_dio_credits");
	});
});

	describe("dio webhook route", () => {
	it("creates entitlement on valid checkout.completed", async () => {
		const handler = (await import("../server/api/dio/webhook")).default;
		const originalFetch = globalThis.fetch;

		let requestUrl = "";
		let requestBody: Record<string, unknown> = {};
		let authorization = "";
		let idempotencyKey = "";

		(globalThis as any).fetch = async (url: string | URL | Request, init?: RequestInit) => {
			if (url.toString().includes("virtual-keys")) {
				requestUrl = url.toString();
				requestBody = JSON.parse((init?.body as string) ?? "{}");
				authorization = ((init?.headers as Record<string, string>) || {}).Authorization ?? "";
				idempotencyKey = ((init?.headers as Record<string, string>) || {})["Idempotency-Key"] ?? "";
				return new Response(JSON.stringify({ virtual_key: { id: "vk_1", value: "vk_value_secret" } }), {
					status: 200,
				});
			}
			return new Response("{}");
		};

		try {
			const body = {
				id: "evt_1",
				eventType: "checkout.completed",
				object: {
					id: "ch_1",
					request_id: "dio_purchase_1",
					order: { id: "ord_1", product: "prod_dio_credits", status: "paid" },
					product: { id: "prod_dio_credits" },
					customer: { id: "cust_1", email: "buyer@example.com" },
				},
			};
			const payload = JSON.stringify(body);
			const signature = createHmac("sha256", "whsec_test").update(payload).digest("hex");
			const event = createFakeEvent({ url: "http://localhost/api/dio/webhook", body, headers: { "creem-signature": signature } });

			const result = (await handler(event)) as { handled: boolean; entitlement: { virtualKeyId: string } };
			expect(result.handled).toBe(true);
			expect(result.entitlement.virtualKeyId).toBe("vk_1");
			expect(requestUrl).toBe("https://bifrost.test/api/governance/virtual-keys");
			expect(requestBody.allowed_models).toEqual(["kimi-k2.6"]);
			expect(requestBody.budget).toEqual({ max: 500 });
			expect(authorization).toBe("Bearer bifrost_test_key");
			expect(idempotencyKey).toBe("dio_purchase_1");

			const provision = storage.get("provisioning:dio_purchase_1") as { status: string; virtualKeyId: string };
			expect(provision.status).toBe("completed");
			expect(provision.virtualKeyId).toBe("vk_1");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects product mismatch", async () => {
		const handler = (await import("../server/api/dio/webhook")).default;
		const body = {
			id: "evt_2",
			eventType: "checkout.completed",
			object: {
				order: { product: "prod_other" },
				product: { id: "prod_other" },
				customer: { email: "buyer@example.com" },
			},
		};
		const payload = JSON.stringify(body);
		const signature = createHmac("sha256", "whsec_test").update(payload).digest("hex");
		const event = createFakeEvent({ url: "http://localhost/api/dio/webhook", body, headers: { "creem-signature": signature } });

		await expect(handler(event)).rejects.toThrow(/Product ID mismatch/);
	});

	it("ignores duplicate event ids", async () => {
		const handler = (await import("../server/api/dio/webhook")).default;
		const originalFetch = globalThis.fetch;
		let bifrostCalls = 0;
		(globalThis as any).fetch = async (url: string | URL | Request) => {
			if (url.toString().includes("virtual-keys")) {
				bifrostCalls++;
				return new Response(JSON.stringify({ virtual_key: { id: `vk_${bifrostCalls}`, value: "secret" } }), {
					status: 200,
				});
			}
			return new Response("{}");
		};

		try {
			const body = {
				id: "evt_3",
				eventType: "checkout.completed",
				object: {
					order: { product: "prod_dio_credits" },
					product: { id: "prod_dio_credits" },
					customer: { email: "buyer@example.com" },
				},
			};
			const payload = JSON.stringify(body);
			const signature = createHmac("sha256", "whsec_test").update(payload).digest("hex");

			const event1 = createFakeEvent({ url: "http://localhost/api/dio/webhook", body, headers: { "creem-signature": signature } });
			const result1 = (await handler(event1)) as { handled: boolean };
			expect(result1.handled).toBe(true);

			const event2 = createFakeEvent({ url: "http://localhost/api/dio/webhook", body, headers: { "creem-signature": signature } });
			const result2 = (await handler(event2)) as { reason?: string };
			expect(result2.reason).toBe("duplicate event");
			expect(bifrostCalls).toBe(1);

			// Event is recorded as succeeded only after persistence.
			const record = storage.get("event:evt_3") as { status: string };
			expect(record.status).toBe("succeeded");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("does not mark event succeeded when Bifrost key creation fails", async () => {
		const handler = (await import("../server/api/dio/webhook")).default;
		const originalFetch = globalThis.fetch;
		(globalThis as any).fetch = async (url: string | URL | Request) => {
			if (url.toString().includes("virtual-keys")) {
				return new Response(JSON.stringify({ error: "Bifrost unavailable" }), { status: 500 });
			}
			return new Response("{}");
		};

		try {
			const body = {
				id: "evt_fail_1",
				eventType: "checkout.completed",
				object: {
					request_id: "dio_purchase_fail_1",
					order: { product: "prod_dio_credits" },
					product: { id: "prod_dio_credits" },
					customer: { email: "buyer@example.com" },
				},
			};
			const payload = JSON.stringify(body);
			const signature = createHmac("sha256", "whsec_test").update(payload).digest("hex");
			const event = createFakeEvent({ url: "http://localhost/api/dio/webhook", body, headers: { "creem-signature": signature } });

			await expect(handler(event)).rejects.toThrow(/Bifrost/);
			const record = storage.get("event:evt_fail_1") as { status: string };
			expect(record.status).toBe("failed");
			const provision = storage.get("provisioning:dio_purchase_fail_1") as { status: string };
			expect(provision.status).toBe("provisioning");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("recovers from partial failure using provisioning record without creating another key", async () => {
		const handler = (await import("../server/api/dio/webhook")).default;
		const originalFetch = globalThis.fetch;
		let bifrostCalls = 0;
		(globalThis as any).fetch = async (url: string | URL | Request) => {
			if (url.toString().includes("virtual-keys")) {
				bifrostCalls++;
				return new Response(JSON.stringify({ virtual_key: { id: "vk_recover", value: "secret" } }), { status: 200 });
			}
			return new Response("{}");
		};

		try {
			storage.set("provisioning:dio_purchase_partial", {
				purchaseReference: "dio_purchase_partial",
				email: "buyer@example.com",
				status: "provisioning",
				virtualKeyId: "vk_recover",
				virtualKeyValue: "secret",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			});

			const body = {
				id: "evt_partial_1",
				eventType: "checkout.completed",
				object: {
					request_id: "dio_purchase_partial",
					order: { product: "prod_dio_credits" },
					product: { id: "prod_dio_credits" },
					customer: { email: "buyer@example.com" },
				},
			};
			const payload = JSON.stringify(body);
			const signature = createHmac("sha256", "whsec_test").update(payload).digest("hex");
			const event = createFakeEvent({ url: "http://localhost/api/dio/webhook", body, headers: { "creem-signature": signature } });

			const result = (await handler(event)) as { handled: boolean; entitlement: { virtualKeyId: string } };
			expect(result.handled).toBe(true);
			expect(result.entitlement.virtualKeyId).toBe("vk_recover");
			expect(bifrostCalls).toBe(0);
			const entitlement = storage.get("entitlement:buyer@example.com") as { virtualKeyId: string };
			expect(entitlement.virtualKeyId).toBe("vk_recover");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects retry while provisioning is already in progress without key details", async () => {
		const handler = (await import("../server/api/dio/webhook")).default;
		storage.set("provisioning:dio_purchase_in_progress", {
			purchaseReference: "dio_purchase_in_progress",
			email: "buyer@example.com",
			status: "provisioning",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const body = {
			id: "evt_in_progress_1",
			eventType: "checkout.completed",
			object: {
				request_id: "dio_purchase_in_progress",
				order: { product: "prod_dio_credits" },
				product: { id: "prod_dio_credits" },
				customer: { email: "buyer@example.com" },
			},
		};
		const payload = JSON.stringify(body);
		const signature = createHmac("sha256", "whsec_test").update(payload).digest("hex");
		const event = createFakeEvent({ url: "http://localhost/api/dio/webhook", body, headers: { "creem-signature": signature } });

		await expect(handler(event)).rejects.toThrow(/409|Provisioning/);
	});
});

describe("event lock", () => {
	it("blocks already succeeded events", async () => {
		const { acquireEventLock, completeEvent } = await import("../src/dio-provider/server");
		const mem = createMemoryStorage();
		expect(await acquireEventLock(mem, "evt_s")).toBe(true);
		await completeEvent(mem, "evt_s", true);
		expect(await acquireEventLock(mem, "evt_s")).toBe(false);
	});

	it("allows retrying failed events", async () => {
		const { acquireEventLock, completeEvent } = await import("../src/dio-provider/server");
		const mem = createMemoryStorage();
		expect(await acquireEventLock(mem, "evt_f")).toBe(true);
		await completeEvent(mem, "evt_f", false);
		expect(await acquireEventLock(mem, "evt_f")).toBe(true);
	});

	it("recovers stale processing locks", async () => {
		const { acquireEventLock, EVENT_LOCK_TTL_MS } = await import("../src/dio-provider/server");
		const mem = createMemoryStorage();
		await mem.setItem("event:evt_stale", {
			status: "processing",
			createdAt: new Date(Date.now() - EVENT_LOCK_TTL_MS - 1000).toISOString(),
			lockId: "old",
		});
		expect(await acquireEventLock(mem, "evt_stale")).toBe(true);
	});

	it("only one concurrent caller acquires the lock", async () => {
		const { acquireEventLock } = await import("../src/dio-provider/server");
		const shared = new Map<string, unknown>();
		const racingStorage = {
			getItem: async (key: string) => shared.get(key) ?? null,
			setItem: async (key: string, value: unknown, _opts?: unknown) => {
				shared.set(key, value);
			},
		};

		const p1 = acquireEventLock(racingStorage, "evt_race");
		const p2 = acquireEventLock(racingStorage, "evt_race");
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1 !== r2).toBe(true);
		expect(r1 || r2).toBe(true);
	});
});

describe("dio feature flag", () => {
	it("returns 404 when Dio is disabled", async () => {
		process.env.NODE_ENV = "test";
		process.env.DIO_ENABLED = "false";
		const handler = (await import("../server/api/dio/recover")).default;
		const event = createFakeEvent({ url: "http://localhost/api/dio/recover", body: { email: "buyer@example.com" } });
		await expect(handler(event)).rejects.toThrow(/404|Not found/);
	});
});

describe("dio claim/recover routes", () => {
	async function seedEntitlement() {
		const entitlement: DioEntitlement = {
			email: "buyer@example.com",
			virtualKeyId: "vk_1",
			virtualKeyValue: "vk_value_secret",
			purchaseReference: "dio_purchase_1",
			createdAt: new Date().toISOString(),
		};
		storage.set("entitlement:buyer@example.com", entitlement);
	}

	it("claim returns pending when purchase record exists but no entitlement", async () => {
		const handler = (await import("../server/api/dio/claim")).default;
		storage.set("pending:buyer@example.com", { purchaseReference: "dio_purchase_1", email: "buyer@example.com" });
		const event = createFakeEvent({
			url: "http://localhost/api/dio/claim",
			body: { email: "buyer@example.com", purchaseReference: "dio_purchase_1" },
		});
		const result = (await handler(event)) as { success: boolean; pending: boolean };
		expect(result.success).toBe(false);
		expect(result.pending).toBe(true);
	});

	it("claim returns api key when purchase reference matches", async () => {
		const handler = (await import("../server/api/dio/claim")).default;
		await seedEntitlement();
		const event = createFakeEvent({
			url: "http://localhost/api/dio/claim",
			body: { email: "buyer@example.com", purchaseReference: "dio_purchase_1" },
		});
		const result = (await handler(event)) as { success: boolean; apiKey?: string };
		expect(result.success).toBe(true);
		expect(result.apiKey).toBe("vk_value_secret");
	});

	it("claim refuses to return key without purchase reference", async () => {
		const handler = (await import("../server/api/dio/claim")).default;
		await seedEntitlement();
		const event = createFakeEvent({ url: "http://localhost/api/dio/claim", body: { email: "buyer@example.com" } });
		const result = (await handler(event)) as { success: boolean; error?: string };
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/Purchase reference required/);
	});

	it("recover requires an OTP and does not return key by email alone", async () => {
		process.env.DIO_RECOVERY_DEV_CODE = "true";
		const { createRecoveryChallenge } = await import("../src/dio-provider/server");
		const handler = (await import("../server/api/dio/recover")).default;
		await seedEntitlement();

		// First request initiates OTP challenge.
		const event1 = createFakeEvent({ url: "http://localhost/api/dio/recover", body: { email: "buyer@example.com" } });
		const result1 = (await handler(event1)) as { success: boolean; requiresOtp?: boolean; devCode?: string };
		expect(result1.success).toBe(false);
		expect(result1.requiresOtp).toBe(true);
		expect(result1.devCode).toMatch(/^\d{6}$/);

		// Second request with correct OTP returns the key.
		const otp = await createRecoveryChallenge(createMemoryStorage(), "buyer@example.com");
		const event2 = createFakeEvent({
			url: "http://localhost/api/dio/recover",
			body: { email: "buyer@example.com", otp },
		});
		const result2 = (await handler(event2)) as { success: boolean; apiKey?: string };
		expect(result2.success).toBe(true);
		expect(result2.apiKey).toBe("vk_value_secret");
	});

	it("recover sends email via Resend when configured", async () => {
		process.env.NODE_ENV = "test";
		process.env.DIO_RECOVERY_DEV_CODE = "false";
		process.env.RESEND_API_KEY = "resend_test_key";
		process.env.DIO_RECOVERY_FROM_EMAIL = "recovery@keating.test";
		const handler = (await import("../server/api/dio/recover")).default;
		await seedEntitlement();

		const originalFetch = globalThis.fetch;
		let emailPayload: Record<string, unknown> = {};
		(globalThis as any).fetch = async (url: string | URL | Request, init?: RequestInit) => {
			if (url.toString().includes("api.resend.com")) {
				emailPayload = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
				return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
			}
			return new Response("{}", { status: 200 });
		};

		try {
			const event = createFakeEvent({ url: "http://localhost/api/dio/recover", body: { email: "buyer@example.com" } });
			const result = (await handler(event)) as { success: boolean; requiresOtp?: boolean; devCode?: string };
			expect(result.success).toBe(false);
			expect(result.requiresOtp).toBe(true);
			expect(result.devCode).toBeUndefined();
			expect(emailPayload["to"]).toBe("buyer@example.com");
			expect(emailPayload["from"]).toBe("recovery@keating.test");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("recover fails when Resend errors and dev codes are disabled", async () => {
		process.env.NODE_ENV = "test";
		process.env.DIO_RECOVERY_DEV_CODE = "false";
		process.env.RESEND_API_KEY = "resend_test_key";
		process.env.DIO_RECOVERY_FROM_EMAIL = "recovery@keating.test";
		const handler = (await import("../server/api/dio/recover")).default;
		await seedEntitlement();

		const originalFetch = globalThis.fetch;
		(globalThis as any).fetch = async (url: string | URL | Request) => {
			if (url.toString().includes("api.resend.com")) {
				return new Response(JSON.stringify({ message: "Resend is down" }), { status: 503 });
			}
			return new Response("{}", { status: 200 });
		};

		try {
			const event = createFakeEvent({ url: "http://localhost/api/dio/recover", body: { email: "buyer@example.com" } });
			await expect(handler(event)).rejects.toThrow(/Resend is down|503/);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("recover rejects invalid OTP", async () => {
		const handler = (await import("../server/api/dio/recover")).default;
		await seedEntitlement();
		const event = createFakeEvent({
			url: "http://localhost/api/dio/recover",
			body: { email: "buyer@example.com", otp: "000000" },
		});
		const result = (await handler(event)) as { success: boolean; requiresOtp?: boolean };
		expect(result.success).toBe(false);
		expect(result.requiresOtp).toBe(true);
	});

	it("recover returns success false when no entitlement", async () => {
		const handler = (await import("../server/api/dio/recover")).default;
		const event = createFakeEvent({ url: "http://localhost/api/dio/recover", body: { email: "missing@example.com" } });
		const result = (await handler(event)) as { success: boolean };
		expect(result.success).toBe(false);
	});
});

describe("dio checkout route", () => {
	it("validates email and returns checkout url", async () => {
		const handler = (await import("../server/api/dio/checkout")).default;
		const originalFetch = globalThis.fetch;
		(globalThis as any).fetch = async () =>
			new Response(JSON.stringify({ checkout_url: "https://checkout.test/123" }), { status: 200 });

		try {
			const event = createFakeEvent({ url: "http://localhost/api/dio/checkout", body: { email: "Buyer@Example.com" } });
			const result = (await handler(event)) as { checkoutUrl: string; purchaseReference: string };
			expect(result.checkoutUrl).toBe("https://checkout.test/123");
			expect(result.purchaseReference).toMatch(/^dio_/);
			expect(storage.has("pending:buyer@example.com")).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects missing email", async () => {
		const handler = (await import("../server/api/dio/checkout")).default;
		const event = createFakeEvent({ url: "http://localhost/api/dio/checkout", body: {} });
		await expect(handler(event)).rejects.toThrow(/Valid email is required/);
	});
});
