import { offlineMessages, OFFLINE_MODEL } from "./offline-model-contract";
import type { ProviderRoundRequestOptions, ProviderRound } from "./provider-client";
import type { ChatMessage, ProviderSettings } from "./types";

export interface OfflineRuntime {
  addListener(name: "onDelta", listener: (event: { requestId: string; text: string }) => void): { remove(): void };
  generateAsync(requestId: string, uri: string, system: string, messagesJson: string, temperature: number): Promise<string>;
  cancelGeneration(requestId: string): void;
}
export type OfflineModelLease = <T>(use: (uri: string, runtime: OfflineRuntime) => Promise<T>) => Promise<T>;

export async function requestOfflineRound(settings: ProviderSettings, messages: ChatMessage[], options: ProviderRoundRequestOptions,
  lease?: OfflineModelLease): Promise<ProviderRound> {
  if (settings.model !== OFFLINE_MODEL.id) throw new Error("Choose MiniCPM5 2B from the offline model options in Settings.");
  if (options.continuation) throw new Error("Offline MiniCPM5 cannot continue an online tool call. Start a new lesson or switch back to that model.");
  const history = offlineMessages(messages);
  if (history.at(-1)?.role !== "user") throw new Error("Send a text message to start the offline tutor.");
  const withModel = lease ?? (await import("./offline-model")).withOfflineModel;
  return withModel(async (uri, runtime) => {
    if (options.signal?.aborted) throw new DOMException("Response stopped.", "AbortError");
    const requestId = `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let accumulated = "";
    const listener = runtime.addListener("onDelta", (event) => {
      if (event.requestId !== requestId || options.signal?.aborted) return;
      accumulated += event.text;
      options.onTextDelta?.(event.text, accumulated);
    });
    const abort = () => runtime.cancelGeneration(requestId);
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const text = await runtime.generateAsync(requestId, uri, options.systemPrompt ?? "You are Keating, a patient tutor. Ask one useful question at a time.", JSON.stringify(history), settings.temperature);
      if (options.signal?.aborted) throw new DOMException("Response stopped.", "AbortError");
      if (!text.trim()) throw new Error("The offline model did not produce an answer. Shorten the message or start a new lesson.");
      return { text, calls: [], usage: null, assistantTurn: null };
    } finally {
      options.signal?.removeEventListener("abort", abort);
      listener.remove();
    }
  });
}
