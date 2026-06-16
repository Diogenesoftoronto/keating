import { createError, defineEventHandler, getHeader, readRawBody } from "h3";
import { useStorage } from "nitro/storage";
import {
	acquireEventLock,
	completeEvent,
	createBifrostVirtualKey,
	getDioEnvConfig,
	isDioEnabled,
	loadDioEntitlement,
	loadProvisioningRecord,
	parseCreemWebhookBody,
	saveDioEntitlement,
	saveProvisioningRecord,
	verifyCreemWebhookSignature,
	type DioEntitlement,
} from "../../../src/dio-provider/server";

export default defineEventHandler(async (event) => {
	if (event.method !== "POST") {
		throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
	}

	if (!isDioEnabled()) {
		throw createError({ statusCode: 404, statusMessage: "Not found" });
	}

	const config = getDioEnvConfig();
	const bodyString = (await readRawBody(event)) ?? "";
	const signature = getHeader(event, "creem-signature") ?? "";

	if (!verifyCreemWebhookSignature(bodyString, signature, config.creemWebhookSecret)) {
		throw createError({ statusCode: 401, statusMessage: "Invalid webhook signature" });
	}

	let payload: ReturnType<typeof parseCreemWebhookBody>;
	try {
		payload = parseCreemWebhookBody(JSON.parse(bodyString));
	} catch (err) {
		throw createError({
			statusCode: 400,
			statusMessage: err instanceof Error ? err.message : "Invalid webhook payload",
		});
	}

	if (payload.eventType !== "checkout.completed") {
		return { received: true, handled: false };
	}

	const storage = useStorage("keating:dio");
	const object = payload.object;
	const productId = object?.order?.product || object?.product?.id;
	if (productId !== config.creemProductId) {
		throw createError({ statusCode: 400, statusMessage: "Product ID mismatch" });
	}

	const customerEmail = object?.customer?.email;
	if (!customerEmail) {
		throw createError({ statusCode: 400, statusMessage: "Missing customer email" });
	}
	const email = customerEmail.toLowerCase();

	// Acquire a per-event lock before any side effects. This prevents duplicate
	// Creem webhooks from racing to create multiple Bifrost virtual keys.
	const locked = await acquireEventLock(storage, payload.id);
	if (!locked) {
		const existing = await loadDioEntitlement(storage, email);
		return {
			received: true,
			handled: false,
			reason: "duplicate event",
			entitlement: existing ? { email, virtualKeyId: existing.virtualKeyId } : undefined,
		};
	}

	try {
		// Idempotency by email: if an entitlement already exists, do not create a
		// second virtual key.
		const existing = await loadDioEntitlement(storage, email);
		if (existing) {
			await completeEvent(storage, payload.id, true);
			return { received: true, handled: true, entitlement: { email, virtualKeyId: existing.virtualKeyId } };
		}

		const purchaseReference =
			(object?.request_id as string | undefined) ||
			(typeof object?.metadata?.dio_purchase_reference === "string"
				? object.metadata.dio_purchase_reference
				: undefined) ||
			payload.id;

		// Idempotency by purchase reference. If we already provisioned a key for
		// this purchase, reuse it instead of creating another Bifrost key.
		const provision = await loadProvisioningRecord(storage, purchaseReference);
		if (provision?.status === "completed") {
			await completeEvent(storage, payload.id, true);
			return { received: true, handled: true, entitlement: { email, virtualKeyId: provision.virtualKeyId } };
		}

		if (provision?.status === "provisioning" && provision.virtualKeyId && provision.virtualKeyValue) {
			// Recover from a previous partial failure: Bifrost created the key but
			// entitlement persistence failed. Complete the entitlement now.
			const entitlement: DioEntitlement = {
				email,
				virtualKeyId: provision.virtualKeyId,
				virtualKeyValue: provision.virtualKeyValue,
				purchaseReference,
				orderId: object?.order?.id,
				checkoutId: object?.id,
				productId,
				customerId: object?.customer?.id,
				createdAt: new Date().toISOString(),
			};
			await saveDioEntitlement(storage, entitlement);
			await saveProvisioningRecord(storage, { ...provision, status: "completed" });
			await completeEvent(storage, payload.id, true);
			return { received: true, handled: true, entitlement: { email, virtualKeyId: provision.virtualKeyId } };
		}

		if (provision?.status === "provisioning") {
			const message = "Provisioning already in progress for this purchase";
			await completeEvent(storage, payload.id, false, message);
			throw createError({ statusCode: 409, statusMessage: message });
		}

		// Persist a provisioning record before calling Bifrost so retries can
		// detect that key creation was already attempted.
		const now = new Date().toISOString();
		await saveProvisioningRecord(storage, {
			purchaseReference,
			email,
			status: "provisioning",
			createdAt: now,
			updatedAt: now,
		});

		const virtualKey = await createBifrostVirtualKey(config, {
			name: `keating:${email}:${purchaseReference}`,
			description: `Keating Dio credits for ${email}. Creem checkout ${object?.id ?? "unknown"}, order ${object?.order?.id ?? "unknown"}`,
			allowedModels: [config.bifrostModelAlias],
			budget: { max: config.dioCreditBudget },
			metadata: {
				email,
				purchaseReference,
				creemEventId: payload.id,
				creemCheckoutId: object?.id,
				creemOrderId: object?.order?.id,
				creemProductId: productId,
				creemCustomerId: object?.customer?.id,
				source: "creem-webhook",
			},
			idempotencyKey: purchaseReference,
		});

		// Capture the key details immediately so a crash before entitlement
		// persistence can be recovered without creating another Bifrost key.
		await saveProvisioningRecord(storage, {
			purchaseReference,
			email,
			status: "provisioning",
			virtualKeyId: virtualKey.id,
			virtualKeyValue: virtualKey.value,
			createdAt: now,
			updatedAt: new Date().toISOString(),
		});

		const entitlement: DioEntitlement = {
			email,
			virtualKeyId: virtualKey.id,
			virtualKeyValue: virtualKey.value,
			purchaseReference,
			orderId: object?.order?.id,
			checkoutId: object?.id,
			productId,
			customerId: object?.customer?.id,
			createdAt: new Date().toISOString(),
		};

		// Only mark the event as succeeded after the entitlement is persisted.
		// If persistence fails, the provision record lets retries complete it.
		await saveDioEntitlement(storage, entitlement);

		await saveProvisioningRecord(storage, {
			purchaseReference,
			email,
			status: "completed",
			virtualKeyId: virtualKey.id,
			virtualKeyValue: virtualKey.value,
			createdAt: now,
			updatedAt: new Date().toISOString(),
		});

		await completeEvent(storage, payload.id, true);

		return { received: true, handled: true, entitlement: { email, virtualKeyId: virtualKey.id } };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await completeEvent(storage, payload.id, false, message);
		throw createError({ statusCode: 500, statusMessage: message });
	}
});
