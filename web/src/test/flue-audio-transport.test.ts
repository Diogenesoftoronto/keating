import { expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { audioPlaybackParts, prepareAudioModelInput, supportsAudioProviderRoute } from "../keating/flue/conversation";

const recording = { type: "audio", mimeType: "audio/wav", data: "UklGRg==", filename: "recording.wav" };
const messages = (audio = recording): AgentMessage[] => [{ role: "user", timestamp: 1, content: [{ type: "text", text: "Transcript alongside recording" }, audio] } as unknown as AgentMessage];
const preparedContent = (result: ReturnType<typeof prepareAudioModelInput>) => (result.messages[0] as any).content;

it("sends actual WAV bytes as native OpenAI audio while preserving original messages", () => {
 const original = messages();
 const input = prepareAudioModelInput(original, { api: "openai-completions" });
 const payload = input.applyPayload({ messages: [{ role: "user", content: preparedContent(input) }] }) as any;
 expect(payload.messages[0].content).toEqual([{ type: "text", text: "Transcript alongside recording" }, { type: "input_audio", input_audio: { data: recording.data, format: "wav" } }]);
 expect((original[0] as any).content[1]).toEqual(recording);
 expect(JSON.stringify(payload)).not.toContain("image");
 expect(audioPlaybackParts(original[0])).toEqual([{ type: "file", mediaType: "audio/wav", filename: "recording.wav", url: `data:audio/wav;base64,${recording.data}` }]);
});

it("sends Google native inline audio data with its MIME type and transcript", () => {
 const original = messages({ ...recording, mimeType: "audio/webm;codecs=opus" });
 const input = prepareAudioModelInput(original, { api: "google-generative-ai" });
 const payload = input.applyPayload({ contents: [{ role: "user", parts: preparedContent(input).map((part: any) => ({ text: part.text })) }] }) as any;
 expect(payload.contents[0].parts).toEqual([{ text: "Transcript alongside recording" }, { inlineData: { mimeType: "audio/webm", data: recording.data } }]);
 expect(audioPlaybackParts(original[0])[0].mediaType).toBe("audio/webm;codecs=opus");
});

it("keeps transcript-only recordings playable without sending audio bytes", () => {
 const original = messages({ ...recording, sendToModel: false } as typeof recording);
 const input = prepareAudioModelInput(original, { api: "anthropic-messages" });
 expect(preparedContent(input)).toEqual([{ type: "text", text: "Transcript alongside recording" }]);
 expect(audioPlaybackParts(original[0])).toHaveLength(1);
 const payload = { messages: [{ role: "user", content: preparedContent(input) }] };
 expect(input.applyPayload(payload)).toBe(payload);
});

it("rejects unsupported routes and audio lost during provider conversion", () => {
 expect(supportsAudioProviderRoute({ api: "openai-completions" }, "audio/webm")).toBe(false);
 expect(supportsAudioProviderRoute({ api: "openai-responses" }, "audio/wav")).toBe(false);
 expect(() => prepareAudioModelInput(messages(), { api: "anthropic-messages" })).toThrow("cannot receive");
 const input = prepareAudioModelInput(messages(), { api: "openai-completions" });
 expect(() => input.applyPayload({ messages: [{ role: "user", content: "Transcript only" }] })).toThrow("dropped an audio attachment");
});

it("handles provider-joined text without leaving attachment markers in requests", () => {
 const input = prepareAudioModelInput(messages(), { api: "openai-completions" });
 const joined = preparedContent(input).map((part: any) => part.text).join("\n");
 const payload = input.applyPayload({ messages: [{ role: "user", content: joined }] }) as any;
 expect(payload.messages[0].content.at(-1)).toEqual({ type: "input_audio", input_audio: { data: recording.data, format: "wav" } });
 expect(JSON.stringify(payload)).not.toContain("keating-audio-");
});
