import { defineEventHandler, proxyRequest, getHeader, getRequestURL } from "h3";

export default defineEventHandler(async (event) => {
  // Get the target URL from the custom header
  const targetBaseUrl = getHeader(event, "x-target-url");

  if (!targetBaseUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing x-target-url header",
    });
  }

  // The request path might have extra segments appended by the SDK (e.g., /messages)
  // We need to re-attach those to the target base URL.
  const proxyPath = event.context.params?.slug || "";
  const fullTargetUrl = `${targetBaseUrl.replace(/\/$/, "")}/${proxyPath.replace(/^\//, "")}`;

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

  return proxyRequest(event, fullTargetUrl, {
    fetchOptions: {
      headers: (headers) => {
        const h = { ...headers };
        for (const forbidden of forbiddenHeaders) {
          delete h[forbidden];
        }
        return h;
      }
    }
  });
});
