import { describe, expect, test } from "bun:test";
import {
	isPublicCheckoutConfigured,
	pricingAvailability,
	pricingPackAction,
	pricingWaitlistCta,
} from "../pages/Pricing";
import { NOTORGANIC_PACKS } from "../notorganic-provider/packs";
import { normalizeCreditWallet } from "../notorganic-provider/credit-wallet";

const completePublicConfig = {
	VITE_NOTORGANIC_ENABLED: "true",
	VITE_NOTORGANIC_CHECKOUT_ENABLED: "true",
	VITE_NOTORGANIC_PUBLIC_ISSUER: "https://api.notorganic.test",
	VITE_NOTORGANIC_AUTHORIZATION_URL: "https://notorganic.test/authorize",
	VITE_NOTORGANIC_CLIENT_ID: "keating-web",
	VITE_NOTORGANIC_REDIRECT_URI: "https://keating.test/notorganic/callback",
	VITE_NOTORGANIC_SCOPE: "wallet:read usage:read billing:checkout infer:balanced",
};

describe("pricing availability", () => {
	test("requires the feature gate and the complete public client contract", () => {
		expect(isPublicCheckoutConfigured(completePublicConfig)).toBe(true);
		for (const key of Object.keys(completePublicConfig)) {
			expect(isPublicCheckoutConfigured({ ...completePublicConfig, [key]: "" })).toBe(false);
		}
		expect(isPublicCheckoutConfigured({
			...completePublicConfig,
			VITE_NOTORGANIC_SCOPE: "wallet:read usage:read billing:checkout",
		})).toBe(false);
	});

	test("distinguishes waitlist, connection, and live checkout analytics states", () => {
		expect(pricingAvailability(false, false)).toBe("waitlist");
		expect(pricingAvailability(true, false)).toBe("checkout_connect_required");
		expect(pricingAvailability(true, true)).toBe("checkout");
	});

	test("does not turn wallet loading or a failed balance request into waitlist signup", () => {
		expect(pricingPackAction(true, true, undefined, true, "keating_pack_10")).toBe("loading");
		expect(pricingPackAction(true, true, undefined, false, "keating_pack_10")).toBe("unavailable");
		expect(pricingPackAction(false, true, undefined, false, "keating_pack_10")).toBe("waitlist");
	});

	test("checks the selected pack and offers reconnection after logout", () => {
		const wallet = normalizeCreditWallet({ availableMicros: 5_000_000, checkout: { available: true, packIds: ["keating_pack_25"] } });
		expect(pricingPackAction(true, true, wallet, false, "keating_pack_25")).toBe("checkout");
		expect(pricingPackAction(true, true, wallet, false, "keating_pack_10")).toBe("unavailable");
		expect(pricingPackAction(true, false, wallet, false, "keating_pack_25")).toBe("connect");
	});

	test("keeps pack selection neutral before availability is shown", () => {
		for (const pack of NOTORGANIC_PACKS) {
			for (const variant of ["control", "test"] as const) {
				const label = pricingWaitlistCta(pack, variant);
				expect(label).toContain(pack.label);
				expect(label).toMatch(/^(Choose|Continue with) /);
				expect(label).not.toMatch(/waitlist|launch|buy|unavailable/i);
			}
		}
	});
});
