import { createError } from "h3";

/** Bound bytes as they arrive, including chunked bodies without Content-Length. */
export async function readBoundedBody(request: Request, maxBytes: number, timeoutMs = 15_000): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    void request.body?.cancel().catch(() => {});
    throw createError({ statusCode: 413, statusMessage: "Request body is too large." });
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(createError({ statusCode: 408, statusMessage: "Request body timed out." }));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw createError({ statusCode: 413, statusMessage: "Request body is too large." });
      }
      chunks.push(chunk.value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock();
  }
}

export async function readBoundedJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readBoundedBody(request, maxBytes);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw createError({ statusCode: 400, statusMessage: "Invalid JSON request." }); }
}
