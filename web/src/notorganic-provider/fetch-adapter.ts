export const NOTORGANIC_IDEMPOTENCY_HEADER = "idempotency-key";
export const NOTORGANIC_MAX_COST_HEADER = "x-notorganic-max-cost-microusd";

export interface NotOrganicDpopInput {
	method: string;
	url: string;
	accessToken: string;
}
export interface NotOrganicProductSession {
	/** Server-validated stable account id. Never populate this from browser input. */
	accountId: string;
	accessToken: string;
	createDpopProof(input: NotOrganicDpopInput): Promise<string>;
	/** Server-held ATProto OAuth/session token for this account's own PDS. */
	pds?: {
		url: string;
		accessToken: string;
	};
}

export interface NotOrganicFetchAdapterOptions {
	baseUrl: string;
	session: NotOrganicProductSession;
	fetch?: typeof globalThis.fetch;
}

export interface NotOrganicRequestOptions {
	method?: string;
	body?: BodyInit | null;
	headers?: HeadersInit;
	signal?: AbortSignal;
	idempotencyKey?: string;
	maxCostMicrousd?: number;
}

function requestId(): string {
	return `keating_${crypto.randomUUID()}`;
}

/**
 * Small internal adapter matching the hosted SDK's HTTP contract. Keating keeps
 * this local until @notorganic/sdk is published; callers still send DPoP,
 * idempotency, and microusd cost headers exactly as the hosted gateway expects.
 */
export class NotOrganicFetchAdapter {
	private readonly baseUrl: string;
	private readonly fetcher: typeof globalThis.fetch;

	constructor(private readonly options: NotOrganicFetchAdapterOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.fetcher = options.fetch ?? globalThis.fetch;
	}

	async request(path: string, options: NotOrganicRequestOptions = {}): Promise<Response> {
		const method = (options.method ?? "GET").toUpperCase();
		const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
		const headers = new Headers(options.headers);
		headers.set("authorization", `DPoP ${this.options.session.accessToken}`);
		headers.set("dpop", await this.options.session.createDpopProof({
			method,
			url,
			accessToken: this.options.session.accessToken,
		}));

		if (options.maxCostMicrousd !== undefined) {
			if (!Number.isSafeInteger(options.maxCostMicrousd) || options.maxCostMicrousd <= 0) {
				throw new TypeError("maxCostMicrousd must be a positive safe integer");
			}
			headers.set(NOTORGANIC_MAX_COST_HEADER, String(options.maxCostMicrousd));
			headers.set(NOTORGANIC_IDEMPOTENCY_HEADER, options.idempotencyKey?.trim() || requestId());
		}

		return this.fetcher(url, {
			method,
			headers,
			body: options.body,
			signal: options.signal,
			redirect: "error",
			...(options.body ? { duplex: "half" } : {}),
		} as RequestInit);
	}
}
