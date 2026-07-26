import {
	createError,
	defineEventHandler,
	getQuery,
	getRouterParam,
	readBody,
	type H3Event,
} from "h3";
import {
	createNotOrganicServerClient,
	getNotOrganicServerConfig,
	NotOrganicOperationalError,
} from "../../../../src/notorganic-provider/server";
import { isNotOrganicPackId } from "../../../../src/notorganic-provider/packs";

const RESOURCE_ROUTES = {
	account: { method: "GET", path: "/v1/account", feature: "keating:account" },
	wallet: { method: "GET", path: "/v1/wallet", feature: "keating:wallet" },
	usage: { method: "GET", path: "/v1/usage", feature: "keating:usage" },
	checkout: { method: "POST", path: "/v1/billing/checkout", feature: "keating:billing" },
} as const;

type ResourceName = keyof typeof RESOURCE_ROUTES;

function resourceName(event: H3Event): ResourceName | null {
	const value = getRouterParam(event, "resource");
	return typeof value === "string" && value in RESOURCE_ROUTES
		? value as ResourceName
		: null;
}

export default defineEventHandler(async (event) => {
	const resource = resourceName(event);
	if (!resource) throw createError({ statusCode: 404, statusMessage: "Not found" });
	const route = RESOURCE_ROUTES[resource];
	if (event.method !== route.method) {
		throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
	}

	try {
		const client = await createNotOrganicServerClient(
			event,
			route.feature,
			getNotOrganicServerConfig(),
		);
		let path = route.path;
		let body: string | undefined;
		if (resource === "usage") {
			const query = getQuery(event);
			const parameters = new URLSearchParams();
			if (typeof query.after === "string") parameters.set("after", query.after);
			if (typeof query.limit === "string") parameters.set("limit", query.limit);
			if (parameters.size) path += `?${parameters}`;
		} else if (resource === "checkout") {
			const input = await readBody<{ product_id?: unknown; return_url?: unknown }>(event);
			if (typeof input?.return_url !== "string") {
				throw createError({ statusCode: 400, statusMessage: "return_url is required" });
			}
			if (typeof input?.product_id !== "string" || !isNotOrganicPackId(input.product_id)) {
				throw createError({ statusCode: 400, statusMessage: "A valid Keating product_id is required" });
			}
			const returnUrl = new URL(input.return_url);
			if (returnUrl.protocol !== "https:") {
				throw createError({ statusCode: 400, statusMessage: "return_url must use HTTPS" });
			}
			body = JSON.stringify({
				product_id: input.product_id,
				return_url: returnUrl.toString(),
			});
		}
		return await client.request(path, {
			method: route.method,
			body,
			headers: body ? { "content-type": "application/json" } : undefined,
		});
	} catch (error) {
		if (error instanceof NotOrganicOperationalError) {
			throw createError({
				statusCode: error.statusCode,
				statusMessage: error.message,
				data: { code: error.code },
			});
		}
		throw error;
	}
});
