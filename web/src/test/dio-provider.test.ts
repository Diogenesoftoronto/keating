import { describe, expect, it, mock } from "bun:test";
import {
	DIO_BASE_URL,
	DIO_DEFAULT_MODEL,
	DIO_DEFAULT_MODEL_ID,
	DIO_PROVIDER_ID,
	dioProviderDefinition,
	isDioProvider,
	normalizeEmail,
} from "../dio-provider";

describe("dio provider constants", () => {
	it("defines provider id, label, base url, and api", () => {
		expect(dioProviderDefinition.id).toBe("dio");
		expect(dioProviderDefinition.label).toBe("Dio");
		expect(dioProviderDefinition.baseUrl).toBe("https://bifrost.dio.computer/v1");
		expect(dioProviderDefinition.api).toBe("openai-completions");
	});

	it("exports stable module constants", () => {
		expect(DIO_PROVIDER_ID).toBe("dio");
		expect(DIO_BASE_URL).toBe("https://bifrost.dio.computer/v1");
		expect(DIO_DEFAULT_MODEL_ID).toBe("kimi-k2.6");
	});

	it("defines the default model with expected shape", () => {
		expect(DIO_DEFAULT_MODEL.id).toBe("kimi-k2.6");
		expect(DIO_DEFAULT_MODEL.name).toBe("Kimi K2.6");
		expect(DIO_DEFAULT_MODEL.provider).toBe("dio");
		expect(DIO_DEFAULT_MODEL.api).toBe("openai-completions");
		expect(DIO_DEFAULT_MODEL.baseUrl).toBe(DIO_BASE_URL);
		expect(DIO_DEFAULT_MODEL.reasoning).toBe(true);
		expect(DIO_DEFAULT_MODEL.input).toEqual(["text"]);
		expect(DIO_DEFAULT_MODEL.contextWindow).toBeGreaterThanOrEqual(256_000);
		expect(DIO_DEFAULT_MODEL.maxTokens).toBeGreaterThan(0);
		expect(DIO_DEFAULT_MODEL.cost).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
	});

	it("normalizes emails to lowercase and trimmed", () => {
		expect(normalizeEmail("  ExamPle@Dio.Computer  ")).toBe("example@dio.computer");
		expect(normalizeEmail("user@example.com")).toBe("user@example.com");
	});

	it("identifies dio provider by id", () => {
		expect(isDioProvider("dio")).toBe(true);
		expect(isDioProvider("openai")).toBe(false);
		expect(isDioProvider("google")).toBe(false);
	});
});

describe("dio proxy behavior", () => {
	it("proxies dio requests through chat-proxy", async () => {
		const { shouldProxyModel } = await import("../lib/provider-proxy");
		expect(shouldProxyModel(DIO_DEFAULT_MODEL)).toBe(true);
	});
});

describe("dio selectable model ordering", () => {
	mock.module("@earendil-works/pi-web-ui", () => ({
		getAppStorage: () => ({
			customProviders: { getAll: async () => [] },
			providerKeys: { get: async () => undefined },
		}),
	}));

	it("places the dio model first in selectable models", async () => {
		const { getSelectableModels } = await import("../lib/provider-models");
		const models = await getSelectableModels();
		expect(models.length).toBeGreaterThan(0);
		expect(models[0].provider).toBe("dio");
		expect(models[0].id).toBe("kimi-k2.6");
	});

	it("respects provider filter for dio", async () => {
		const { getSelectableModels } = await import("../lib/provider-models");
		const models = await getSelectableModels((provider) => provider === "dio");
		expect(models.every((model) => model.provider === "dio")).toBe(true);
		expect(models[0].id).toBe("kimi-k2.6");
	});
});

describe("dio default stream model", () => {
	it("uses dio default model as the chat default", async () => {
		const { DEFAULT_MODEL } = await import("../hooks/keating-stream");
		expect(DEFAULT_MODEL.provider).toBe("dio");
		expect(DEFAULT_MODEL.id).toBe("kimi-k2.6");
	});
});
