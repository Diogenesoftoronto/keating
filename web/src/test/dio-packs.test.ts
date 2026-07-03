import { afterEach, describe, expect, it } from "bun:test";
import {
	DEFAULT_DIO_PACK_ID,
	DIO_PACKS,
	DIO_TOKEN_RATES,
	formatPackTokenVolume,
	getDioPack,
	inputMTokForUsd,
	isDioPackId,
	outputMTokForUsd,
} from "../dio-provider/packs";
import {
	createCreemCheckout,
	findDioPackByProductId,
	getDioPacksFromEnv,
	getPurchasableDioPack,
	updateBifrostVirtualKeyBudget,
	type DioEnvConfig,
} from "../dio-provider/server";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function makeConfig(overrides: Partial<DioEnvConfig> = {}): DioEnvConfig {
	return {
		enabled: true,
		creemApiKey: "creem_test_key",
		creemWebhookSecret: "whsec",
		creemBaseUrl: "https://test-api.creem.io/v1",
		packs: getDioPacksFromEnv({
			CREEM_PRODUCT_ID_DIO_PACK_STARTER: "prod_starter",
			CREEM_PRODUCT_ID_DIO_PACK_PLUS: "prod_plus",
			CREEM_PRODUCT_ID_DIO_PACK_PRO: "prod_pro",
		}),
		bifrostApiKey: "bifrost_key",
		bifrostBaseUrl: "https://gateway.example.com",
		bifrostModelAlias: "kimi-k2.6",
		recoveryDevCode: true,
		...overrides,
	};
}

describe("dio pack catalog", () => {
	it("defines the three advertised packs at $10/$25/$50", () => {
		expect(DIO_PACKS.map((pack) => [pack.id, pack.priceUsd])).toEqual([
			["starter", 10],
			["plus", 25],
			["pro", 50],
		]);
		expect(DEFAULT_DIO_PACK_ID).toBe("starter");
		expect(getDioPack("plus")?.popular).toBe(true);
		expect(isDioPackId("pro")).toBe(true);
		expect(isDioPackId("mega")).toBe(false);
	});

	it("advertises $1/M input and $4/M output rates", () => {
		expect(DIO_TOKEN_RATES).toEqual({ inputPerMTok: 1, outputPerMTok: 4 });
		expect(inputMTokForUsd(10)).toBe(10);
		expect(outputMTokForUsd(10)).toBe(2.5);
	});

	it("formats pack token volume from the rates", () => {
		const starter = DIO_PACKS[0];
		expect(formatPackTokenVolume(starter)).toBe("up to 10M input / 2.5M output tokens");
	});
});

describe("getDioPacksFromEnv", () => {
	it("maps per-pack product ids and defaults budgets to the pack price", () => {
		const packs = getDioPacksFromEnv({
			CREEM_PRODUCT_ID_DIO_PACK_STARTER: "prod_starter",
			CREEM_PRODUCT_ID_DIO_PACK_PLUS: "prod_plus",
			CREEM_PRODUCT_ID_DIO_PACK_PRO: "prod_pro",
		});
		expect(packs.starter).toMatchObject({ productId: "prod_starter", budget: 10 });
		expect(packs.plus).toMatchObject({ productId: "prod_plus", budget: 25 });
		expect(packs.pro).toMatchObject({ productId: "prod_pro", budget: 50 });
	});

	it("honors explicit budget overrides", () => {
		const packs = getDioPacksFromEnv({
			CREEM_PRODUCT_ID_DIO_PACK_STARTER: "prod_starter",
			DIO_PACK_BUDGET_STARTER: "12.5",
		});
		expect(packs.starter.budget).toBe(12.5);
	});

	it("maps legacy single-product env vars to the starter pack", () => {
		const packs = getDioPacksFromEnv({
			CREEM_PRODUCT_ID_DIO_CREDITS: "prod_legacy",
			DIO_CREDIT_BUDGET: "7",
		});
		expect(packs.starter).toMatchObject({ productId: "prod_legacy", budget: 7 });
		expect(packs.plus.productId).toBeUndefined();
		expect(packs.pro.productId).toBeUndefined();
	});

	it("prefers new env vars over legacy ones", () => {
		const packs = getDioPacksFromEnv({
			CREEM_PRODUCT_ID_DIO_PACK_STARTER: "prod_new",
			CREEM_PRODUCT_ID_DIO_CREDITS: "prod_legacy",
		});
		expect(packs.starter.productId).toBe("prod_new");
	});

	it("throws when no pack has a product id", () => {
		expect(() => getDioPacksFromEnv({})).toThrow(/CREEM_PRODUCT_ID_DIO_PACK/);
	});

	it("throws on invalid budget values", () => {
		expect(() =>
			getDioPacksFromEnv({
				CREEM_PRODUCT_ID_DIO_PACK_STARTER: "prod_starter",
				DIO_PACK_BUDGET_STARTER: "-3",
			}),
		).toThrow(/DIO_PACK_BUDGET_STARTER/);
	});
});

describe("pack lookup helpers", () => {
	it("resolves purchasable packs by id and rejects unconfigured ones", () => {
		const config = makeConfig();
		expect(getPurchasableDioPack(config, "plus")?.productId).toBe("prod_plus");
		expect(getPurchasableDioPack(config, "nope")).toBeNull();

		const legacyOnly = makeConfig({
			packs: getDioPacksFromEnv({ CREEM_PRODUCT_ID_DIO_CREDITS: "prod_legacy" }),
		});
		expect(getPurchasableDioPack(legacyOnly, "starter")?.productId).toBe("prod_legacy");
		expect(getPurchasableDioPack(legacyOnly, "plus")).toBeNull();
	});

	it("finds packs by Creem product id for webhook routing", () => {
		const config = makeConfig();
		expect(findDioPackByProductId(config, "prod_pro")?.id).toBe("pro");
		expect(findDioPackByProductId(config, "prod_pro")?.budget).toBe(50);
		expect(findDioPackByProductId(config, "prod_unknown")).toBeNull();
	});
});

describe("createCreemCheckout pack selection", () => {
	it("sends the selected pack's product id and pack metadata", async () => {
		let captured: { url: string; body: any } | null = null;
		globalThis.fetch = (async (url: any, init: any) => {
			captured = { url: String(url), body: JSON.parse(init.body) };
			return new Response(JSON.stringify({ checkout_url: "https://creem.test/checkout" }), { status: 200 });
		}) as typeof fetch;

		const result = await createCreemCheckout(makeConfig(), "user@example.com", "plus");
		expect(result.checkoutUrl).toBe("https://creem.test/checkout");
		expect(captured!.body.product_id).toBe("prod_plus");
		expect(captured!.body.metadata.dio_pack_id).toBe("plus");
		expect(captured!.body.request_id).toBe(result.purchaseReference);
	});

	it("rejects packs without a configured product", async () => {
		const legacyOnly = makeConfig({
			packs: getDioPacksFromEnv({ CREEM_PRODUCT_ID_DIO_CREDITS: "prod_legacy" }),
		});
		await expect(createCreemCheckout(legacyOnly, "user@example.com", "plus")).rejects.toThrow(
			/Unknown or unavailable Dio pack/,
		);
	});
});

describe("updateBifrostVirtualKeyBudget", () => {
	it("PUTs the summed budget to the governance endpoint", async () => {
		let captured: { url: string; method: string; body: any } | null = null;
		globalThis.fetch = (async (url: any, init: any) => {
			captured = { url: String(url), method: init.method, body: JSON.parse(init.body) };
			return new Response("{}", { status: 200 });
		}) as typeof fetch;

		await updateBifrostVirtualKeyBudget(makeConfig(), "vk_123", 35);
		expect(captured!.url).toBe("https://gateway.example.com/api/governance/virtual-keys/vk_123");
		expect(captured!.method).toBe("PUT");
		expect(captured!.body).toEqual({ budget: { max: 35 } });
	});

	it("surfaces gateway errors", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ message: "nope" }), { status: 403 })) as unknown as typeof fetch;
		await expect(updateBifrostVirtualKeyBudget(makeConfig(), "vk_123", 35)).rejects.toThrow("nope");
	});
});
