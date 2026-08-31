import type { NotOrganicPublicClient } from "../../notorganic-provider/public-client";
import { AccountEvolutionClientError } from "./errors";

export type AuthenticatedNotOrganicRequester = Pick<
	NotOrganicPublicClient,
	"request"
>;

function evolutionPath(path: string): string {
	let parsed: URL;
	try {
		parsed = new URL(path, "https://keating.invalid");
	} catch {
		throw new AccountEvolutionClientError(
			"invalid-request",
			"The account-evolution request path is invalid.",
		);
	}
	if (
		parsed.origin !== "https://keating.invalid" ||
		!parsed.pathname.startsWith("/v1/evolution/") ||
		parsed.hash
	) {
		throw new AccountEvolutionClientError(
			"invalid-request",
			"Account-evolution requests must stay under /v1/evolution/*.",
		);
	}
	return `${parsed.pathname}${parsed.search}`;
}

async function errorMessage(response: Response): Promise<string> {
	const body = (await response.clone().json().catch(() => null)) as
		| { error?: { message?: unknown }; message?: unknown }
		| null;
	if (typeof body?.error?.message === "string") return body.error.message;
	if (typeof body?.message === "string") return body.message;
	return `Not Organic account evolution request failed (${response.status}).`;
}

/**
 * Forces every account-evolution request through the signed-in browser
 * client's DPoP request path. It never accepts an account id or a raw bearer.
 */
export class AuthenticatedAccountEvolutionTransport {
	constructor(private readonly requester: AuthenticatedNotOrganicRequester) {}

	async request(path: string, init: RequestInit = {}): Promise<Response> {
		return this.requester.request(evolutionPath(path), init);
	}

	async json(path: string, init: RequestInit = {}): Promise<unknown> {
		const response = await this.request(path, init);
		if (!response.ok) {
			throw new AccountEvolutionClientError(
				"http-error",
				await errorMessage(response),
				response.status,
			);
		}
		try {
			return await response.json();
		} catch {
			throw new AccountEvolutionClientError(
				"invalid-response",
				"Not Organic returned a non-JSON account-evolution response.",
				response.status,
			);
		}
	}
}
