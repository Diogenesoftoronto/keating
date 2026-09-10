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
export interface OfflineRequest { prompt: string; maxTokens?: number; temperature?: number }
export interface KeatingOfflineBridge {
  status(): Promise<OfflineStatus>;
  download(): Promise<void>;
  cancelDownload(): Promise<void>;
  remove(): Promise<void>;
  generate(request: OfflineRequest): Promise<string>;
  cancelGeneration(): Promise<void>;
}
export const OFFLINE_MODEL = {
  file: "MiniCPM5-2B_int4.litertlm",
  url: "https://huggingface.co/mlboydaisuke/MiniCPM5-2B-LiteRT/resolve/02e8a867ae318e633f2372ac81fc78dc4d8448e7/MiniCPM5-2B_int4.litertlm",
  bytes: 1553670064,
  sha256: "9858563beafbc6d5e0d25fcee3827541515296a9302ed3d088b16a58d4fbe7b8",
};

export function offlineRequest(value: unknown): Required<OfflineRequest> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid offline tutor request.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["prompt", "maxTokens", "temperature"].includes(key)))
    throw new Error("The offline tutor accepts text only. Configure a vision or transcription model for attachments.");
  if (typeof input.prompt !== "string" || !input.prompt.trim() || Buffer.byteLength(input.prompt) > 24000)
    throw new Error("Enter text under 24 KB for the offline tutor.");
  const maxTokens = input.maxTokens ?? 1024;
  const temperature = input.temperature ?? 0.7;
  if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096)
    throw new Error("Output token limit must be an integer from 1 to 4096.");
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < 0 || temperature > 2)
    throw new Error("Temperature must be from 0 to 2.");
  return { prompt: input.prompt, maxTokens, temperature };
}

/** Accept the coordinator's text conversation envelope as well as a plain prompt. */
export function offlineMessages(prompt: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(prompt); } catch { /* Plain text is also supported. */ }
  const message = (role: string, text: string) => ({ role, content: [{ type: "text", text }] });
  if (parsed && typeof parsed === "object" && "conversation" in parsed) {
    const envelope = parsed as { system?: unknown; conversation: unknown };
    if ((envelope.system !== undefined && typeof envelope.system !== "string") || !Array.isArray(envelope.conversation) || !envelope.conversation.length)
      throw new Error("Invalid offline conversation.");
    const turns = envelope.conversation.map((turn: unknown) => {
      if (!turn || typeof turn !== "object") throw new Error("Invalid offline conversation turn.");
      const item = turn as { role?: unknown; content?: unknown };
      if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") throw new Error("Offline conversations accept user and assistant text only.");
      return message(item.role, item.content);
    });
    const last = turns.pop()!;
    if (last.role !== "user") throw new Error("The offline conversation must end with a user message.");
    // The C API adds role=system itself; this argument is JSON content only.
    return [envelope.system || null, turns, last].map(value => JSON.stringify(value)).join("\n");
  }
  return [null, [], message("user", prompt)].map(value => JSON.stringify(value)).join("\n");
}
