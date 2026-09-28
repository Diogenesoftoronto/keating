export interface OfflineStatus {
  available: boolean;
  installed: boolean;
  downloading: boolean;
  bundled: boolean;
  generating: boolean;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
}
export interface OfflineMedia { turn: number; type: "image" | "audio"; data: string; mimeType: string }
export interface OfflineRequest { prompt: string; maxTokens?: number; temperature?: number; modelId?: string; media?: OfflineMedia[] }
/** Identity of the verified native weights, selected independently of the tutor. */
export const OFFLINE_JUDGEMENT_MODEL_ID = "mlboydaisuke/MiniCPM5-2B-LiteRT";
export interface OfflineLabelRequest {
  requestId: string;
  modelId: string;
  prompt: string;
  /** Candidate continuations are the decimal indices 0 through labelCount - 1. */
  labelCount: number;
}
export interface OfflineLabelScores { modelId: string; negativeLogLikelihoods: readonly number[] }
export interface KeatingOfflineBridge {
  supportedModels?: readonly string[];
  status(modelId?: string): Promise<OfflineStatus>;
  download(modelId?: string): Promise<void>;
  cancelDownload(modelId?: string): Promise<void>;
  remove(modelId?: string): Promise<void>;
  generate(request: OfflineRequest): Promise<string>;
  cancelGeneration(): Promise<void>;
  scoreLabels(request: OfflineLabelRequest): Promise<OfflineLabelScores | null>;
  cancelScoring(requestId: string): Promise<void>;
}
export const OFFLINE_MODEL = {
  file: "MiniCPM5-2B_int4.litertlm",
  url: "https://huggingface.co/mlboydaisuke/MiniCPM5-2B-LiteRT/resolve/02e8a867ae318e633f2372ac81fc78dc4d8448e7/MiniCPM5-2B_int4.litertlm",
  bytes: 1553670064,
  sha256: "9858563beafbc6d5e0d25fcee3827541515296a9302ed3d088b16a58d4fbe7b8",
};

export const GEMMA_OFFLINE_MODEL_ID = "litert-community/gemma-4-E4B-it-litert-lm";
export const GEMMA_OFFLINE_MODEL = {
  file: "gemma-4-E4B-it.litertlm",
  url: "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/2eee7ac325f20eb8c9ac1d0e972f7c84663062da/gemma-4-E4B-it.litertlm",
  bytes: 3659530240,
  sha256: "0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0",
};

export function offlineLabelRequest(value: unknown): OfflineLabelRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid offline scoring request.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["requestId", "modelId", "prompt", "labelCount"].includes(key))
    || typeof input.requestId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(input.requestId)
    || input.modelId !== OFFLINE_JUDGEMENT_MODEL_ID
    || typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.includes("\0") || Buffer.byteLength(input.prompt) > 24000
    || typeof input.labelCount !== "number" || !Number.isInteger(input.labelCount) || input.labelCount < 2 || input.labelCount > 64) {
    throw new Error("Invalid offline scoring request.");
  }
  return { requestId: input.requestId, modelId: input.modelId, prompt: input.prompt, labelCount: input.labelCount };
}

export function offlineRequest(value: unknown): { prompt: string; maxTokens: number; temperature: number; media?: OfflineMedia[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid offline tutor request.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["prompt", "maxTokens", "temperature", "media"].includes(key)))
    throw new Error("The offline tutor accepts text only. Configure a vision or transcription model for attachments.");
  if (typeof input.prompt !== "string" || !input.prompt.trim() || Buffer.byteLength(input.prompt) > 24000)
    throw new Error("Enter text under 24 KB for the offline tutor.");
  const maxTokens = input.maxTokens ?? 1024;
  const temperature = input.temperature ?? 0.7;
  if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096)
    throw new Error("Output token limit must be an integer from 1 to 4096.");
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < 0 || temperature > 2)
    throw new Error("Temperature must be from 0 to 2.");
  if (input.media !== undefined) {
    if (!Array.isArray(input.media) || input.media.length > 4) throw new Error("Attach up to four images or recordings.");
    let bytes = 0;
    for (const item of input.media) {
      if (!item || typeof item !== "object" || Object.keys(item).some(key => !["turn", "type", "data", "mimeType"].includes(key))
        || !Number.isSafeInteger(item.turn) || item.turn < 0 || (item.type !== "image" && item.type !== "audio")
        || typeof item.data !== "string" || !item.data.length || item.data.length > 28 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data) || item.data.length % 4 !== 0
        || !["image/png", "image/jpeg", "image/webp", "audio/wav", "audio/x-wav"].includes(item.mimeType)
        || !item.mimeType.startsWith(item.type + "/")) throw new Error("Offline attachments accept PNG, JPEG, WebP, or WAV data only.");
      bytes += Buffer.from(item.data, "base64").length;
    }
    if (bytes > 20 * 1024 * 1024) throw new Error("Keep offline attachments under 20 MB in total.");
  }
  return { prompt: input.prompt, maxTokens, temperature, ...(input.media !== undefined ? { media: input.media as OfflineMedia[] } : {}) };
}

/** Accept the coordinator's text conversation envelope as well as a plain prompt. */
export function offlineMessages(prompt: string, media: readonly { turn: number; type: "image" | "audio"; path: string }[] = []): string {
  let parsed: unknown;
  try { parsed = JSON.parse(prompt); } catch { /* Plain text is also supported. */ }
  const message = (role: string, text: string, index = 0) => ({ role, content: [{ type: "text", text }, ...media.filter(item => item.turn === index).map(({ type, path }) => ({ type, path }))] });
  if (parsed && typeof parsed === "object" && "conversation" in parsed) {
    const envelope = parsed as { system?: unknown; conversation: unknown };
    if ((envelope.system !== undefined && typeof envelope.system !== "string") || !Array.isArray(envelope.conversation) || !envelope.conversation.length)
      throw new Error("Invalid offline conversation.");
    const turns = envelope.conversation.map((turn: unknown, index: number) => {
      if (!turn || typeof turn !== "object") throw new Error("Invalid offline conversation turn.");
      const item = turn as { role?: unknown; content?: unknown };
      if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") throw new Error("Offline conversations accept user and assistant text only.");
      if (media.some(part => part.turn === index) && item.role !== "user") throw new Error("Offline attachments must belong to a user turn.");
      return message(item.role, item.content, index);
    });
    if (media.some(part => part.turn >= turns.length)) throw new Error("Invalid attachment conversation turn.");
    const last = turns.pop()!;
    if (last.role !== "user") throw new Error("The offline conversation must end with a user message.");
    // The C API adds role=system itself; this argument is JSON content only.
    return [envelope.system || null, turns, last].map(value => JSON.stringify(value)).join("\n");
  }
  if (media.some(part => part.turn !== 0)) throw new Error("Invalid attachment conversation turn.");
  return [null, [], message("user", prompt)].map(value => JSON.stringify(value)).join("\n");
}
