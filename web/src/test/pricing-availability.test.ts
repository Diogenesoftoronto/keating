import { describe, expect, test } from "bun:test";
import {
	isPublicCheckoutConfigured,
	pricingAvailability,
} from "../pages/Pricing";

const completePublicConfig = {
	VITE_NOTORGANIC_ENABLED: "true",
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
});
