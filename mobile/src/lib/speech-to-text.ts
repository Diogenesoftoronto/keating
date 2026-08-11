import type { ProviderId } from "./types";

export type TranscriptionProvider = "openai" | "google";

export interface TranscriptionCredential {
  provider: TranscriptionProvider;
  apiKey: string;
}

type KeyReader = (provider: ProviderId) => Promise<string | null>;

export async function resolveTranscriptionCredential(
  activeProvider: ProviderId,
  readKey?: KeyReader,
): Promise<TranscriptionCredential | null> {
  const keyReader = readKey ?? (async (provider: ProviderId) => {
    const { getProviderKey } = await import("./storage");
    return getProviderKey(provider);
  });
  const preferred: TranscriptionProvider[] = activeProvider === "google"
    ? ["google", "openai"]
    : ["openai", "google"];
  for (const provider of preferred) {
    const apiKey = await keyReader(provider);
    if (apiKey?.trim()) return { provider, apiKey: apiKey.trim() };
  }
  return null;
}

export async function transcribeAudioUri(
  uri: string,
  mimeType: string,
  activeProvider: ProviderId,
  options: {
    fetchImpl?: typeof fetch;
    readKey?: KeyReader;
    readBase64?: (uri: string) => Promise<string>;
  } = {},
): Promise<string> {
  const credential = await resolveTranscriptionCredential(activeProvider, options.readKey);
  if (!credential) throw new Error("Add an OpenAI or Google API key in Settings to dictate a message.");
  if (credential.provider === "openai") {
    return transcribeOpenAi(uri, mimeType, credential.apiKey, options.fetchImpl ?? fetch);
  }
  const readBase64 = options.readBase64 ?? (async (fileUri: string) => {
    const { File } = await import("expo-file-system");
    return new File(fileUri).base64();
  });
  return transcribeGoogle(await readBase64(uri), mimeType, credential.apiKey, options.fetchImpl ?? fetch);
}

async function transcribeOpenAi(uri: string, mimeType: string, apiKey: string, fetchImpl: typeof fetch): Promise<string> {
  const form = new FormData();
  form.append("file", { uri, name: "keating-dictation.m4a", type: mimeType } as unknown as Blob);
  form.append("model", "gpt-4o-transcribe");
  const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(transcriptionError(payload, response.status));
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) throw new Error("The transcription service returned no speech.");
  return text;
}

async function transcribeGoogle(audio: string, mimeType: string, apiKey: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: "Transcribe this audio verbatim. Return only the transcript text, with no commentary." },
          { inlineData: { mimeType, data: audio } },
        ] }],
      }),
    },
  );
  const payload = await readJson(response);
  if (!response.ok) throw new Error(transcriptionError(payload, response.status));
  const text = Array.isArray(payload.candidates?.[0]?.content?.parts)
    ? payload.candidates[0].content.parts.map((part: unknown) =>
      typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "").join("").trim()
    : "";
  if (!text) throw new Error("The transcription service returned no speech.");
  return text;
}

async function readJson(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: { message: text.slice(0, 500) } };
  }
}

function transcriptionError(payload: Record<string, any>, status: number): string {
  const message = payload.error?.message ?? payload.message;
  return `Transcription failed (${status}): ${typeof message === "string" && message.trim() ? message.slice(0, 500) : "provider request failed"}`;
}
