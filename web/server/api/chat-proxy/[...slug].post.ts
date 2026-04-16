import { defineEventHandler, proxyRequest, getHeader, getRequestURL, getHeaders, createError } from "h3";

export default defineEventHandler(async (event) => {
  // Get the target URL from the custom header
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

  // Define headers to strip (problematic for Minimax/CORS)
  const forbiddenHeaders = [
    "x-stainless-os",
    "x-stainless-lang",
    "x-stainless-package-version",
    "x-stainless-runtime",
    "x-stainless-runtime-version",
    "x-stainless-arch",
    "x-stainless-os-version",
    "origin",       // Let Nitro re-generate
    "host",         // Let Nitro re-generate
    "referer"       // Let Nitro re-generate
  ];

  const headersParams = { ...event.headers } as any;
  // If event.headers isn't a plain object (in H3 it might not be directly exposed as a plain object on some adapters)
  // we can use getHeaders(event)
  const currentHeaders = getHeaders(event);
  const h: Record<string, string> = { ...currentHeaders } as any;
  for (const forbidden of forbiddenHeaders) {
    if (h[forbidden] !== undefined) {
      delete h[forbidden];
    }
  }
  delete h["x-target-url"];

  return proxyRequest(event, fullTargetUrl, {
    headers: h
  });
});
