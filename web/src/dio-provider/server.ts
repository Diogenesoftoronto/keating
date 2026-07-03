import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { normalizeEmail } from "./index";
import { DIO_PACKS, type DioPack, type DioPackId } from "./packs";
export { normalizeEmail };

/** Minimal storage interface used by the Dio provider helpers. */
export interface DioStorage {
	getItem: (key: string) => Promise<unknown>;
	setItem: (key: string, value: any, opts?: any) => Promise<void>;
}

export interface DioServerPack extends DioPack {
	/** Creem product id for this pack; packs without one cannot be purchased. */
	productId?: string;
	/** Bifrost virtual-key budget (USD) granted per purchase of this pack. */
	budget: number;
}

export interface DioEnvConfig {
	enabled: boolean;
	creemApiKey: string;
	creemWebhookSecret: string;
	creemBaseUrl: string;
	packs: Record<DioPackId, DioServerPack>;
	bifrostApiKey: string;
	bifrostBaseUrl: string;
	bifrostModelAlias: string;
	resendApiKey?: string;
	recoveryFromEmail?: string;
	recoveryDevCode: boolean;
}

/**
 * Check whether the Dio provider is enabled without validating the rest of the
 * configuration. Routes use this to return early when the feature is off.
 */
export function isDioEnabled(): boolean {
	if (process.env.DIO_ENABLED === "false") return false;
	if (process.env.DIO_ENABLED === "true") return true;
	return process.env.NODE_ENV === "development";
}

export function getDioEnvConfig(): DioEnvConfig {
	const creemApiKey = getRequiredEnv("CREEM_API_KEY");
	const creemWebhookSecret = getRequiredEnv("CREEM_WEBHOOK_SECRET");
	const packs = getDioPacksFromEnv(process.env);
	const bifrostApiKey = getRequiredEnv("BIFROST_API_KEY");
	const bifrostBaseUrl = getDioGatewayBaseUrl();

	return {
		enabled: isDioEnabled(),
		creemApiKey,
		creemWebhookSecret,
		creemBaseUrl: resolveCreemBaseUrl(creemApiKey, process.env.CREEM_BASE_URL),
		packs,
		bifrostApiKey,
		bifrostBaseUrl,
		bifrostModelAlias: process.env.BIFROST_MODEL_ALIAS || "kimi-k2.6",
		resendApiKey: process.env.RESEND_API_KEY?.trim(),
		recoveryFromEmail: process.env.DIO_RECOVERY_FROM_EMAIL?.trim() || "support@keating.help",
		recoveryDevCode: process.env.DIO_RECOVERY_DEV_CODE === "true" || process.env.NODE_ENV === "development",
	};
}

/**
 * Build the purchasable pack config from the environment.
 *
 * Per pack: `CREEM_PRODUCT_ID_DIO_PACK_<ID>` (Creem product) and optional
 * `DIO_PACK_BUDGET_<ID>` (Bifrost budget, defaults to the pack price). The
 * legacy single-product vars `CREEM_PRODUCT_ID_DIO_CREDITS` and
 * `DIO_CREDIT_BUDGET` map to the starter pack so existing deployments keep
 * working. At least one pack must have a product id.
 */
export function getDioPacksFromEnv(env: Record<string, string | undefined>): Record<DioPackId, DioServerPack> {
	const packs = {} as Record<DioPackId, DioServerPack>;
	for (const pack of DIO_PACKS) {
		const suffix = pack.id.toUpperCase();
		let productId = env[`CREEM_PRODUCT_ID_DIO_PACK_${suffix}`]?.trim() || undefined;
		let budgetRaw = env[`DIO_PACK_BUDGET_${suffix}`]?.trim();
		if (pack.id === "starter") {
			productId = productId || env.CREEM_PRODUCT_ID_DIO_CREDITS?.trim() || undefined;
			budgetRaw = budgetRaw || env.DIO_CREDIT_BUDGET?.trim();
		}
		const budget = budgetRaw ? Number.parseFloat(budgetRaw) : pack.priceUsd;
		if (!Number.isFinite(budget) || budget <= 0) {
			throw new Error(`DIO_PACK_BUDGET_${suffix} must be a positive number`);
		}
		packs[pack.id] = { ...pack, productId, budget };
	}
	if (!Object.values(packs).some((pack) => pack.productId)) {
		throw new Error("Missing required environment variable: CREEM_PRODUCT_ID_DIO_PACK_* (or legacy CREEM_PRODUCT_ID_DIO_CREDITS)");
	}
	return packs;
}

/** A pack that can actually be purchased (has a Creem product configured). */
export function getPurchasableDioPack(config: DioEnvConfig, packId: string): DioServerPack | null {
	const pack = config.packs[packId as DioPackId];
	return pack?.productId ? pack : null;
}

export function findDioPackByProductId(config: DioEnvConfig, productId: string): DioServerPack | null {
	for (const pack of Object.values(config.packs)) {
		if (pack.productId && pack.productId === productId) return pack;
	}
	return null;
}

export function getDioGatewayBaseUrl(): string {
	return getRequiredEnv("BIFROST_BASE_URL").replace(/\/+$/, "");
}

function normalizeDioOpenAiProxyPath(path: string): string {
	return path.split("?")[0].replace(/^\/+/, "").replace(/\/+$/, "");
}

export function isAllowedDioOpenAiProxyRequest(method: string | undefined, path: string): boolean {
	const normalizedMethod = (method || "GET").toUpperCase();
	const normalizedPath = normalizeDioOpenAiProxyPath(path);
	if (normalizedMethod === "POST") {
		return normalizedPath === "v1/chat/completions";
	}
	if (normalizedMethod === "GET" || normalizedMethod === "HEAD") {
		return normalizedPath === "v1/models";
	}
	return false;
}

export function resolveCreemBaseUrl(apiKey: string, override?: string): string {
	const configured = override?.trim();
	if (configured) return configured;
	return apiKey.startsWith("creem_test_")
		? "https://test-api.creem.io/v1"
		: "https://api.creem.io/v1";
}

function getRequiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

export interface CreemCheckoutPayload {
	email: string;
}

export interface CreemCheckoutResponse {
	checkoutUrl: string;
	purchaseReference: string;
}

export async function createCreemCheckout(
	config: DioEnvConfig,
	email: string,
	packId: string,
): Promise<CreemCheckoutResponse> {
	const normalized = normalizeEmail(email);
	if (!isValidEmail(normalized)) {
		throw new Error("Invalid email address");
	}

	const pack = getPurchasableDioPack(config, packId);
	if (!pack) {
		throw new Error(`Unknown or unavailable Dio pack: ${packId}`);
	}

	const purchaseReference = `dio_${cryptoUUID()}`;

	const response = await fetch(`${config.creemBaseUrl.replace(/\/+$/, "")}/checkouts`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": config.creemApiKey,
		},
		body: JSON.stringify({
			product_id: pack.productId,
			success_url: `${process.env.KEATING_WEB_ORIGIN || ""}/dio/success?dio_ref=${encodeURIComponent(purchaseReference)}&dio_email=${encodeURIComponent(normalized)}`,
			request_id: purchaseReference,
			metadata: {
				dio_purchase_reference: purchaseReference,
				dio_pack_id: pack.id,
				customer_email: normalized,
			},
		}),
	});

	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const message = body?.message || body?.error || `Creem checkout failed (${response.status})`;
		throw new Error(message);
	}

	const checkoutUrl = body?.checkout_url || body?.checkoutUrl;
	if (typeof checkoutUrl !== "string") {
		throw new Error("Creem checkout response missing checkout URL");
	}

	return {
		checkoutUrl,
		purchaseReference,
	};
}

export interface CreemWebhookEvent {
	id: string;
	eventType: string;
	created_at?: number;
	object?: {
		id?: string;
		object?: string;
		request_id?: string;
		order?: { id?: string; product?: string; status?: string };
		product?: { id?: string };
		customer?: { id?: string; email?: string };
		metadata?: Record<string, unknown>;
	};
}

export function parseCreemWebhookBody(body: unknown): CreemWebhookEvent {
	if (!body || typeof body !== "object") {
		throw new Error("Invalid webhook payload");
	}
	const payload = body as Record<string, unknown>;
	if (typeof payload.id !== "string" || !payload.id) {
		throw new Error("Invalid webhook event id");
	}
	if (typeof payload.eventType !== "string" || !payload.eventType) {
		throw new Error("Invalid webhook event type");
	}
	if (!payload.object || typeof payload.object !== "object") {
		throw new Error("Invalid webhook object");
	}
	return payload as unknown as CreemWebhookEvent;
}

export function verifyCreemWebhookSignature(body: string, signature: string, secret: string): boolean {
	if (!signature) return false;
	const computed = createHmac("sha256", secret).update(body).digest("hex");
	if (computed.length !== signature.length) return false;
	try {
		const computedBuf = Buffer.from(computed, "hex");
		const signatureBuf = Buffer.from(signature, "hex");
		return timingSafeEqual(computedBuf, signatureBuf);
	} catch {
		return false;
	}
}

export interface BifrostVirtualKeyRequest {
	name: string;
	description: string;
	allowedModels: string[];
	budget: { max: number };
	metadata: Record<string, unknown>;
	/** Unique key used to make Bifrost key creation idempotent for retries. */
	idempotencyKey?: string;
}

export interface BifrostVirtualKey {
	id: string;
	value: string;
}

export async function createBifrostVirtualKey(
	config: DioEnvConfig,
	request: BifrostVirtualKeyRequest,
): Promise<BifrostVirtualKey> {
	const url = `${config.bifrostBaseUrl.replace(/\/+$/, "")}/api/governance/virtual-keys`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${config.bifrostApiKey}`,
	};
	if (request.idempotencyKey) {
		headers["Idempotency-Key"] = request.idempotencyKey;
	}
	const response = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify({
			name: request.name,
			description: request.description,
			allowed_models: request.allowedModels,
			budget: request.budget,
			metadata: request.metadata,
		}),
	});

	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const message = body?.message || body?.error || `Bifrost virtual key creation failed (${response.status})`;
		throw new Error(message);
	}

	const virtualKey = body?.virtual_key || body;
	if (typeof virtualKey?.id !== "string" || typeof virtualKey?.value !== "string") {
		throw new Error("Bifrost virtual key response missing id or value");
	}

	return { id: virtualKey.id, value: virtualKey.value };
}

/**
 * Raise the spending cap of an existing Bifrost virtual key. Used to top up
 * credits when an email that already has an entitlement buys another pack.
 */
export async function updateBifrostVirtualKeyBudget(
	config: DioEnvConfig,
	virtualKeyId: string,
	newMaxBudget: number,
): Promise<void> {
	const url = `${config.bifrostBaseUrl.replace(/\/+$/, "")}/api/governance/virtual-keys/${encodeURIComponent(virtualKeyId)}`;
	const response = await fetch(url, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${config.bifrostApiKey}`,
		},
		body: JSON.stringify({ budget: { max: newMaxBudget } }),
	});

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		const message = body?.message || body?.error || `Bifrost virtual key budget update failed (${response.status})`;
		throw new Error(message);
	}
}

export interface DioEntitlement {
	email: string;
	virtualKeyId: string;
	virtualKeyValue: string;
	purchaseReference?: string;
	orderId?: string;
	checkoutId?: string;
	productId?: string;
	customerId?: string;
	createdAt: string;
	/** Running Bifrost budget cap across all purchases (USD). */
	budgetMax?: number;
	/** Last purchased pack id. */
	packId?: string;
}

const ENTITLEMENT_KEY_PREFIX = "entitlement:";
const EVENT_KEY_PREFIX = "event:";
const RECOVERY_KEY_PREFIX = "recovery:";
const PROVISIONING_KEY_PREFIX = "provisioning:";

/** How long a "processing" event lock remains valid before it is considered stale. */
export const EVENT_LOCK_TTL_MS = 5 * 60 * 1000;

export interface DioEventRecord {
	status: "processing" | "succeeded" | "failed";
	createdAt: string;
	lockId?: string;
	error?: string;
}

export interface RecoveryChallenge {
	email: string;
	otpHash: string;
	expiresAt: string;
	attempts: number;
}

export interface DioProvisioningRecord {
	purchaseReference: string;
	email: string;
	status: "provisioning" | "completed";
	virtualKeyId?: string;
	virtualKeyValue?: string;
	createdAt: string;
	updatedAt: string;
}

export function entitlementStorageKey(email: string): string {
	return `${ENTITLEMENT_KEY_PREFIX}${normalizeEmail(email)}`;
}

function eventStorageKey(eventId: string): string {
	return `${EVENT_KEY_PREFIX}${eventId}`;
}

function recoveryStorageKey(email: string): string {
	return `${RECOVERY_KEY_PREFIX}${normalizeEmail(email)}`;
}

export function provisioningStorageKey(purchaseReference: string): string {
	return `${PROVISIONING_KEY_PREFIX}${purchaseReference}`;
}

function hashOtp(otp: string): string {
	return createHash("sha256").update(otp).digest("hex");
}

function generateOtp(): string {
	return Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join("");
}

export async function createRecoveryChallenge(
	storage: DioStorage,
	email: string,
): Promise<string> {
	const otp = generateOtp();
	const challenge: RecoveryChallenge = {
		email,
		otpHash: hashOtp(otp),
		expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
		attempts: 0,
	};
	await storage.setItem(recoveryStorageKey(email), challenge);
	return otp;
}

export interface RecoveryEmailResult {
	sent: boolean;
	devCode?: string;
	error?: string;
}

/**
 * Send a recovery OTP email. When a real provider is configured, the code is
 * emailed. In development (or when DIO_RECOVERY_DEV_CODE=true) the code is
 * logged and returned so flows can be tested without a mail provider.
 */
export async function sendRecoveryEmail(
	config: Pick<DioEnvConfig, "resendApiKey" | "recoveryFromEmail" | "recoveryDevCode">,
	email: string,
	otp: string,
): Promise<RecoveryEmailResult> {
	if (config.resendApiKey && config.recoveryFromEmail) {
		try {
			const response = await fetch("https://api.resend.com/emails", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${config.resendApiKey}`,
				},
				body: JSON.stringify({
					from: config.recoveryFromEmail,
					to: email,
					subject: "Your Keating recovery code",
					html: `<p>Your Keating recovery code is: <strong>${otp}</strong></p><p>This code expires in 15 minutes.</p>`,
				}),
			});
			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body?.message || `Resend returned ${response.status}`);
			}
			return { sent: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Failed to send recovery email to ${email}: ${message}`);
			// In production (dev codes disabled), a provider failure must surface
			// as an error so the client knows the code was not delivered.
			if (!config.recoveryDevCode) {
				return { sent: false, error: message };
			}
		}
	}

	if (config.recoveryDevCode) {
		console.log(`[Dio recovery dev code] ${email}: ${otp}`);
		return { sent: false, devCode: otp };
	}

	const message = "No recovery email provider configured";
	console.warn(`${message}; OTP for ${email} was not sent.`);
	return { sent: false, error: message };
}

export async function verifyRecoveryChallenge(
	storage: DioStorage,
	email: string,
	otp: string,
): Promise<boolean> {
	const key = recoveryStorageKey(email);
	const value = await storage.getItem(key);
	if (!value || typeof value !== "object") {
		return false;
	}
	const challenge = value as RecoveryChallenge;
	if (challenge.attempts >= 5) {
		return false;
	}
	if (new Date(challenge.expiresAt) < new Date()) {
		await storage.setItem(key, { ...challenge, attempts: challenge.attempts + 1 });
		return false;
	}
	const expectedHash = Buffer.from(challenge.otpHash, "hex");
	const actualHash = Buffer.from(hashOtp(otp), "hex");
	if (expectedHash.length !== actualHash.length) {
		await storage.setItem(key, { ...challenge, attempts: challenge.attempts + 1 });
		return false;
	}
	const ok = timingSafeEqual(expectedHash, actualHash);
	if (!ok) {
		await storage.setItem(key, { ...challenge, attempts: challenge.attempts + 1 });
		return false;
	}
	await storage.setItem(key, { ...challenge, attempts: challenge.attempts + 1 });
	return true;
}

function isEventLockStale(record: DioEventRecord): boolean {
	if (record.status !== "processing") return false;
	const createdAt = record.createdAt ? new Date(record.createdAt).getTime() : 0;
	return Number.isFinite(createdAt) && Date.now() - createdAt > EVENT_LOCK_TTL_MS;
}

/** In-process serialization of lock attempts for the same event id. */
const eventLockPromises = new Map<string, Promise<boolean>>();

async function acquireEventLockUncontended(storage: DioStorage, eventId: string): Promise<boolean> {
	const key = eventStorageKey(eventId);
	const existing = await storage.getItem(key);
	if (existing && typeof existing === "object") {
		const record = existing as DioEventRecord;
		if (record.status === "succeeded") return false;
		if (record.status === "processing" && !isEventLockStale(record)) return false;
		// Stale "processing" lock or "failed" record: fall through and attempt
		// to overwrite with a new lock.
	}

	const lockId = cryptoUUID();
	const record: DioEventRecord = {
		status: "processing",
		createdAt: new Date().toISOString(),
		lockId,
	};

	// Attempt an atomic write. Drivers that support {@code nx} will reject if the
	// key already exists; drivers that do not support it will perform a plain set.
	// The re-read below verifies that this process won the race.
	try {
		await storage.setItem(key, record, { nx: true });
	} catch {
		// nx may have been honored and failed, or the driver may have rejected the
		// unknown option. Either way, verify ownership with the re-read.
	}

	const reRead = await storage.getItem(key);
	if (!reRead || typeof reRead !== "object") {
		return false;
	}
	const reReadRecord = reRead as DioEventRecord;
	return reReadRecord.status === "processing" && reReadRecord.lockId === lockId;
}

/**
 * Acquire a per-event processing lock using a dedicated storage key.
 *
 * Returns false if the event has already succeeded or is currently being
 * processed by another worker. A previously "failed" event can be retried, and
 * "processing" locks older than {@link EVENT_LOCK_TTL_MS} are treated as stale
 * and may be re-acquired.
 *
 * The public entry point serializes callers for the same event within this
 * process, so multiple concurrent webhooks for one event cannot race here. The
 * underlying storage write attempts an atomic set-if-not-exists ({@code nx:
 * true}) when the driver supports it, then verifies ownership by reading the
 * stored lock id. For cross-process or multi-instance deployments, this relies
 * on the storage backend honoring {@code nx} (Redis, KV, etc.) or otherwise
 * providing linearizable writes; filesystem-backed storage without an atomic
 * CAS primitive cannot give a hard distributed-lock guarantee.
 */
export async function acquireEventLock(storage: DioStorage, eventId: string): Promise<boolean> {
	const previous = eventLockPromises.get(eventId);
	const current = (async () => {
		await previous;
		return acquireEventLockUncontended(storage, eventId);
	})();
	eventLockPromises.set(eventId, current);
	try {
		return await current;
	} finally {
		if (eventLockPromises.get(eventId) === current) {
			eventLockPromises.delete(eventId);
		}
	}
}

export async function completeEvent(
	storage: DioStorage,
	eventId: string,
	succeeded: boolean,
	error?: string,
): Promise<void> {
	const key = eventStorageKey(eventId);
	const record: DioEventRecord = {
		status: succeeded ? "succeeded" : "failed",
		createdAt: new Date().toISOString(),
		error,
	};
	await storage.setItem(key, record);
}

/** @deprecated Prefer {@link acquireEventLock} and {@link completeEvent}. */
export async function markEventProcessed(
	storage: DioStorage,
	eventId: string,
): Promise<boolean> {
	const locked = await acquireEventLock(storage, eventId);
	if (!locked) return false;
	await completeEvent(storage, eventId, true);
	return true;
}

export async function loadDioEntitlement(
	storage: DioStorage,
	email: string,
): Promise<DioEntitlement | null> {
	const value = await storage.getItem(entitlementStorageKey(email));
	if (value && typeof value === "object") {
		const entitlement = value as DioEntitlement;
		if (
			typeof entitlement.email === "string" &&
			typeof entitlement.virtualKeyId === "string" &&
			typeof entitlement.virtualKeyValue === "string"
		) {
			return entitlement;
		}
	}
	return null;
}

export async function saveDioEntitlement(
	storage: DioStorage,
	entitlement: DioEntitlement,
): Promise<void> {
	await storage.setItem(entitlementStorageKey(entitlement.email), entitlement);
}

export async function loadProvisioningRecord(
	storage: DioStorage,
	purchaseReference: string,
): Promise<DioProvisioningRecord | null> {
	const value = await storage.getItem(provisioningStorageKey(purchaseReference));
	if (value && typeof value === "object") {
		const record = value as DioProvisioningRecord;
		if (typeof record.purchaseReference === "string" && typeof record.email === "string") {
			return record;
		}
	}
	return null;
}

export async function saveProvisioningRecord(
	storage: DioStorage,
	record: DioProvisioningRecord,
): Promise<void> {
	await storage.setItem(provisioningStorageKey(record.purchaseReference), record);
}

function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function cryptoUUID(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	const bytes = new Uint8Array(16);
	if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
		crypto.getRandomValues(bytes);
	} else {
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = Math.floor(Math.random() * 256);
		}
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
