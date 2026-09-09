import type { ProviderModelDescriptor } from "../providers";
import { normalizeProviderSearchResult, type RawSearchCitation } from "./provenance";

// Pi currently discards Responses URL annotations. Preserve them in the final
// text item so the existing Markdown renderer and saved history retain sources.
function preserveCitations(event: any, model: ProviderModelDescriptor): void {
  if (event.type !== "response.output_item.done" || event.item?.type !== "message") return;
  const citations: RawSearchCitation[] = [];
  for (const part of event.item.content ?? []) {
    if (part.type !== "output_text" || typeof part.text !== "string") continue;
    const links = new Map<string, string>();
    for (const annotation of part.annotations ?? []) {
      if (annotation.type !== "url_citation" || typeof annotation.url !== "string") continue;
      let url: URL;
      try { url = new URL(annotation.url); } catch { continue; }
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      const title = typeof annotation.title === "string" ? annotation.title : url.hostname;
      const label = title.replace(/[\[\]<>\r\n]/g, " ").replace(/\\/g, "");
      links.set(url.href, `[${label || url.hostname}](<${url.href.replace(/>/g, "%3E")}>)`);
      citations.push({ url: url.href, title });
    }
    if (links.size) part.text += `\n\nSources: ${[...links.values()].join(" · ")}`;
  }
  if (citations.length) normalizeProviderSearchResult({
    model,
    route: { provider: model.provider, modelId: model.id, kind: "native", tool: "openai-web-search", citationKind: "provider-annotations", providerNative: true },
    citations,
  });
}

export function createCodexSearchFetch(model: ProviderModelDescriptor, fetcher?: typeof fetch): typeof fetch {
  const request = fetcher && fetcher !== globalThis.fetch ? fetcher : globalThis.fetch.bind(globalThis);
  return (async (input, init) => {
    const response = await request(input, init);
    if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return response;
    let pending = "";
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const transformFrame = (frame: string): string => {
      const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") return frame;
      let event: any;
      try { event = JSON.parse(data); } catch { return frame; }
      if (event.type !== "response.output_item.done" || event.item?.type !== "message") return frame;
      preserveCitations(event, model);
      return `data: ${JSON.stringify(event)}`;
    };
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(pending))) {
          controller.enqueue(encoder.encode(transformFrame(pending.slice(0, boundary.index)) + "\n\n"));
          pending = pending.slice(boundary.index + boundary[0].length);
        }
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending) controller.enqueue(encoder.encode(transformFrame(pending) + "\n\n"));
      },
    }));
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }) as typeof fetch;
}
