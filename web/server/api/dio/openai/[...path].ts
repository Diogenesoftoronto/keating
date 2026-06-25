import { createError, defineEventHandler, getHeaders, getRequestURL, proxyRequest } from "h3";
import { getDioGatewayBaseUrl, isDioEnabled } from "../../../../src/dio-provider/server";

export default defineEventHandler(async (event) => {
	if (!isDioEnabled()) {
		throw createError({ statusCode: 404, statusMessage: "Not found" });
	}

	const reqUrl = getRequestURL(event);
	const proxyPath = reqUrl.pathname.replace(/^\/api\/dio\/openai\/?/, "") + reqUrl.search;
	const targetUrl = `${getDioGatewayBaseUrl()}/${proxyPath}`;

	const forbiddenHeaders = [
		"x-stainless-os",
		"x-stainless-lang",
		"x-stainless-package-version",
		"x-stainless-runtime",
		"x-stainless-runtime-version",
		"x-stainless-arch",
		"x-stainless-os-version",
		"origin",
		"host",
		"referer",
		"x-target-url",
	];

	const headers: Record<string, string> = { ...getHeaders(event) };
	for (const forbidden of forbiddenHeaders) {
		delete headers[forbidden];
	}

	return proxyRequest(event, targetUrl, { headers });
});
