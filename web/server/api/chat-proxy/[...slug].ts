import { defineEventHandler, proxyRequest, getHeader, getRequestURL, getHeaders, createError } from "h3";

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
  const fullTargetUrl = `${targetBaseUrl.replace(/\/$/, "")}/${proxyPath}`;

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
    console.log(`[chat-proxy] ${event.method} ${proxyPath} -> ${targetBaseUrl} (auth=${hasAuth})`);
  }

  return proxyRequest(event, fullTargetUrl, {
    headers,
  });
});
