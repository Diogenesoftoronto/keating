import { createError, getRequestURL, type H3Event } from "h3";

export const ROOM_REQUEST_MAX_BYTES = 64 * 1024;

/** Cookies authorize the account; an untrusted origin must not spend that authority. */
export function assertRoomRequestOrigin(event: H3Event): void {
  const origin = event.req.headers.get("origin");
  const url = getRequestURL(event);
  // Railway terminates TLS, so the server sees http:// while browsers send
  // https:// origins. Accept the proxy's scheme for the same host.
  const forwarded = event.req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const allowed = new Set([url.origin, ...(forwarded === "https" || forwarded === "http" ? [`${forwarded}://${url.host}`] : [])]);
  if (origin && !allowed.has(origin)) {
    throw createError({ statusCode: 403, statusMessage: "Room requests must come from the same origin.", data: { code: "room_origin_forbidden" } });
  }
}

/** Bound actual streamed bytes as well as Content-Length; never reflect input in errors. */
export async function readRoomBody(event: H3Event): Promise<unknown> {
  const length = event.req.headers.get("content-length");
  const tooLarge = () => createError({ statusCode: 413, statusMessage: "Room request is too large.", data: { code: "room_request_too_large" } });
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > ROOM_REQUEST_MAX_BYTES)) throw tooLarge();
  if (!event.req.body) return undefined;
  if (!/^application\/json(?:\s*;|$)/i.test(event.req.headers.get("content-type") ?? "")) {
    throw createError({ statusCode: 415, statusMessage: "Room requests require JSON.", data: { code: "room_invalid_request" } });
  }
  const reader = event.req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ROOM_REQUEST_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) return undefined;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw createError({ statusCode: 400, statusMessage: "Invalid room JSON.", data: { code: "room_invalid_request" } }); }
}
