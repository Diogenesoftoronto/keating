import { createError, defineEventHandler, readBody } from "h3";
import { useStorage } from "nitro/storage";
import { isDioEnabled, loadDioEntitlement, normalizeEmail } from "../../../src/dio-provider/server";

interface ClaimBody {
	email?: string;
	purchaseReference?: string;
}

export default defineEventHandler(async (event) => {
	if (event.method !== "POST") {
		throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
	}

	if (!isDioEnabled()) {
		throw createError({ statusCode: 404, statusMessage: "Not found" });
	}

	const body = await readBody<ClaimBody>(event);
	const email = normalizeEmail(body?.email ?? "");
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw createError({ statusCode: 400, statusMessage: "Valid email is required" });
	}

	const storage = useStorage("keating:dio");
	const entitlement = await loadDioEntitlement(storage, email);
	if (!entitlement) {
		// Check for a pending purchase record as a hint.
		const pending = await storage.getItem(`pending:${email}`);
		if (pending) {
			return { success: false, pending: true };
		}
		return { success: false, pending: false };
	}

	// A completed entitlement always requires the checkout-bound purchase
	// reference to prove ownership before returning the virtual key.
	if (!body?.purchaseReference || entitlement.purchaseReference !== body.purchaseReference) {
		return { success: false, pending: false, error: "Purchase reference required" };
	}

	return {
		success: true,
		apiKey: entitlement.virtualKeyValue,
	};
});
