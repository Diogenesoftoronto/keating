import { defineEventHandler, proxyRequest, getHeader, getRequestURL, getHeaders, createError } from "h3";
import { buildValidatedProxyUrl } from "../../utils/proxy-target";

export default defineEventHandler(async (event) => {
  const targetBaseUrl = getHeader(event, "x-target-url");

  if (!targetBaseUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing x-target-url header",
    });
  }

  const reqUrl = getRequestURL(event);
  const proxyPath = reqUrl.pathname.replace(/^\/api\/chat-proxy\/?/, "") + reqUrl.search;
  let fullTargetUrl: string;
  try {
    fullTargetUrl = buildValidatedProxyUrl(targetBaseUrl, proxyPath, {
      allowHttp: process.dev || import.meta.env?.DEV,
      allowLocal: process.dev || import.meta.env?.DEV,
    });
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : "Invalid proxy target",
    });
  }

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

  if (process.dev || import.meta.env?.DEV) {
    const hasAuth = !!headers["authorization"];
    const hasApiKey = !!headers["x-api-key"];
    console.log(`[chat-proxy] ${event.method} ${proxyPath} -> ${new URL(fullTargetUrl).hostname} (auth=${hasAuth}, xApiKey=${hasApiKey})`);
  }

  return proxyRequest(event, fullTargetUrl, {
    headers,
  });
});
