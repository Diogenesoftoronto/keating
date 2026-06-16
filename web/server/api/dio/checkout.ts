import { createError, defineEventHandler, readBody } from "h3";
import { useStorage } from "nitro/storage";
import { createCreemCheckout, getDioEnvConfig, isDioEnabled, normalizeEmail } from "../../../src/dio-provider/server";

interface CheckoutBody {
	email?: string;
}

export default defineEventHandler(async (event) => {
	if (event.method !== "POST") {
		throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
	}

	if (!isDioEnabled()) {
		throw createError({ statusCode: 404, statusMessage: "Not found" });
	}

	const body = await readBody<CheckoutBody>(event);
	const email = normalizeEmail(body?.email ?? "");
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw createError({ statusCode: 400, statusMessage: "Valid email is required" });
	}

	const config = getDioEnvConfig();
	const result = await createCreemCheckout(config, email);

	const storage = useStorage("keating:dio");
	await storage.setItem(`pending:${normalizeEmail(email)}`, {
		purchaseReference: result.purchaseReference,
		email: normalizeEmail(email),
		createdAt: new Date().toISOString(),
	});

	return result;
});
