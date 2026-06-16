import { createError, defineEventHandler, readBody } from "h3";
import { useStorage } from "nitro/storage";
import {
	createRecoveryChallenge,
	getDioEnvConfig,
	isDioEnabled,
	loadDioEntitlement,
	normalizeEmail,
	sendRecoveryEmail,
	verifyRecoveryChallenge,
} from "../../../src/dio-provider/server";

interface RecoverBody {
	email?: string;
	otp?: string;
}

export default defineEventHandler(async (event) => {
	if (event.method !== "POST") {
		throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
	}

	if (!isDioEnabled()) {
		throw createError({ statusCode: 404, statusMessage: "Not found" });
	}

	const body = await readBody<RecoverBody>(event);
	const email = normalizeEmail(body?.email ?? "");
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw createError({ statusCode: 400, statusMessage: "Valid email is required" });
	}

	const storage = useStorage("keating:dio");
	const entitlement = await loadDioEntitlement(storage, email);
	if (!entitlement) {
		return { success: false, pending: false };
	}

	// Recovery requires a one-time code to prove email ownership. The code is
	// generated on the first request and sent to the email address.
	if (!body?.otp) {
		const otp = await createRecoveryChallenge(storage, email);
		const emailResult = await sendRecoveryEmail(getDioEnvConfig(), email, otp);
		if (emailResult.error) {
			throw createError({ statusCode: 503, statusMessage: emailResult.error });
		}
		return {
			success: false,
			requiresOtp: true,
			devCode: emailResult.devCode,
		};
	}

	const valid = await verifyRecoveryChallenge(storage, email, body.otp);
	if (!valid) {
		return { success: false, requiresOtp: true, error: "Invalid or expired verification code" };
	}

	return {
		success: true,
		apiKey: entitlement.virtualKeyValue,
	};
});
