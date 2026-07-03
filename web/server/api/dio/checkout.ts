import { createError, defineEventHandler, readBody } from "h3";
import { useStorage } from "nitro/storage";
import { createCreemCheckout, getDioEnvConfig, getPurchasableDioPack, isDioEnabled, normalizeEmail } from "../../../src/dio-provider/server";
import { DEFAULT_DIO_PACK_ID } from "../../../src/dio-provider/packs";

interface CheckoutBody {
	email?: string;
	packId?: string;
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
	const packId = body?.packId?.trim() || DEFAULT_DIO_PACK_ID;
	if (!getPurchasableDioPack(config, packId)) {
		throw createError({ statusCode: 400, statusMessage: `Unknown or unavailable pack: ${packId}` });
	}
	const result = await createCreemCheckout(config, email, packId);

	const storage = useStorage("keating:dio");
	await storage.setItem(`pending:${normalizeEmail(email)}`, {
		purchaseReference: result.purchaseReference,
		email: normalizeEmail(email),
		packId,
		createdAt: new Date().toISOString(),
	});

	return result;
});
