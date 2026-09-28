import type { Context } from "@earendil-works/pi-ai";
export type BrowserInputPart = { type: "text"; text: string } | { type: "image" | "audio"; data: string; mimeType: string };
export interface BrowserInputMessage { role: "system" | "user" | "assistant"; content: BrowserInputPart[] }
/** Bound the complete request before allocating decoded images or audio. */
export function browserInputMessages(context: Context, multimodal: boolean): BrowserInputMessage[] {
  const messages: BrowserInputMessage[] = [];
  if (context.systemPrompt) messages.push({ role: "system", content: [{ type: "text", text: context.systemPrompt }] });
  let bytes = 0; let images = 0; let audio = 0;
  for (const message of context.messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const parts: BrowserInputPart[] = [];
    for (const part of typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content as unknown[]) {
      if (!part || typeof part !== "object") continue;
      const item = part as Record<string, unknown>;
      if (item.type === "text" && typeof item.text === "string") parts.push({ type: "text", text: item.text });
      else if (item.type === "image" || item.type === "audio") {
        if (item.type === "audio" && item.sendToModel === false) continue;
        if (!multimodal) throw new Error("This browser model accepts text only. Choose Gemma or send a transcript/description; your attachment is saved.");
        if (typeof item.data !== "string" || typeof item.mimeType !== "string" || !item.mimeType.startsWith(`${item.type}/`) || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) throw new Error("The browser attachment has invalid media bytes. Reattach it and retry.");
        bytes += item.data.length * 3 / 4;
        if (item.type === "image") images++; else audio++;
        // Gemma4Processor 4.2 extracts only audio_array[0]. Never silently ignore a second recording.
        if (bytes > 16 * 1024 * 1024 || images > 2 || audio > 1) throw new Error("Browser Gemma supports up to two images, one recording and 16 MiB of media per lesson. Start a new lesson or use smaller files.");
        parts.push({ type: item.type, data: item.data, mimeType: item.mimeType });
      } else if (message.role === "user") throw new Error("This browser model cannot receive that attachment. Send extracted text or a supported image/audio file.");
    }
    if (parts.length) messages.push({ role: message.role, content: parts });
  }
  if (multimodal) {
    const textBytes = messages.reduce((total, message) => total + message.content.reduce((bytes, part) => bytes + (part.type === "text" ? new TextEncoder().encode(part.text).length : 0), 0), 0);
    if (textBytes > 10_000) throw new Error("The browser Gemma lesson is too long. Start a new lesson or shorten your message.");
  }
  return messages;
}
export function browserTemplateMessages(messages: readonly BrowserInputMessage[], multimodal: boolean) {
  return messages.map(message => ({ role: message.role, content: multimodal ? message.content.map(part => part.type === "text" ? part : { type: part.type }) : message.content.map(part => {
    if (part.type !== "text") throw new Error("This browser model accepts text only.");
    return part.text;
  }).join("\n") }));
}
/** Decode browser-supported audio formats and close the decoder promptly. */
export async function decodeBrowserAudio(part: Extract<BrowserInputPart, { data: string }>): Promise<Float32Array> {
  if (typeof AudioContext === "undefined") throw new Error("This browser cannot decode audio for Gemma. Send a transcript instead.");
  const binary = atob(part.data);
  const encoded = Uint8Array.from(binary, char => char.charCodeAt(0));
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await context.decodeAudioData(encoded.buffer);
    if (!decoded.length || decoded.duration > 30) throw new Error("Attach a recording of 30 seconds or less for browser Gemma.");
    const audio = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const samples = decoded.getChannelData(channel);
      for (let index = 0; index < samples.length; index++) audio[index] += samples[index] / decoded.numberOfChannels;
    }
    return audio;
  } finally { await context.close().catch(() => {}); }
}
