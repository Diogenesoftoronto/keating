export function publicRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  // Railway terminates TLS at its edge. Preserve the request authority and port.
  if (process.env.RAILWAY_ENVIRONMENT_ID && request.headers.get("x-forwarded-proto") === "https") {
    url.protocol = "https:";
  }
  return url.origin;
}
