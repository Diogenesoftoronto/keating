import { expect, test } from "bun:test";
import { encodeMonoPcm16Wav, MAX_AUDIO_ATTACHMENT_BYTES, prepareAudioAttachment } from "./audio-attachment";

test("WAV encoder writes mono PCM16 RIFF header and clamps samples", () => {
	const buffer = encodeMonoPcm16Wav(new Float32Array([-2, -1, 0, 0.5, 1, 2, NaN]));
	const view = new DataView(buffer);
	const bytes = new Uint8Array(buffer);
	expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
	expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
	expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8);
	expect(view.getUint16(20, true)).toBe(1);
	expect(view.getUint16(22, true)).toBe(1);
	expect(view.getUint32(24, true)).toBe(16000);
	expect(view.getUint32(28, true)).toBe(32000);
	expect(view.getUint16(34, true)).toBe(16);
	expect(view.getUint32(40, true)).toBe(14);
	expect(Array.from({ length: 7 }, (_, index) => view.getInt16(44 + index * 2, true))).toEqual([-32768, -32768, 0, 16384, 32767, 32767, 0]);
});

test("WAV encoder rejects invalid sample rates", () => {
	expect(() => encodeMonoPcm16Wav(new Float32Array(), 0)).toThrow("sample rate");
	expect(() => encodeMonoPcm16Wav(new Float32Array(), 16000.5)).toThrow("sample rate");
});

test("supported audio passes through without requiring browser decoders", async () => {
	const mp3 = new File(["audio"], "voice.mp3", { type: "audio/mpeg" });
	expect(await prepareAudioAttachment(mp3)).toBe(mp3);
	const wav = new File(["audio"], "voice.WAV", { type: "audio/x-wav", lastModified: 123 });
	const prepared = await prepareAudioAttachment(wav);
	expect(prepared.type).toBe("audio/wav");
	expect(await prepared.text()).toBe("audio");
	expect(prepared.lastModified).toBe(123);
});

test("audio size and empty input errors happen before any decoder use", async () => {
	await expect(prepareAudioAttachment(new File([], "empty.wav"))).rejects.toThrow("empty");
	await expect(prepareAudioAttachment(new File([new Uint8Array(MAX_AUDIO_ATTACHMENT_BYTES + 1)], "large.mp3"))).rejects.toThrow("25 MB");
});

test("unsupported browser gives an actionable conversion error", async () => {
	await expect(prepareAudioAttachment(new File(["audio"], "recording.webm", { type: "audio/webm" }))).rejects.toThrow("WAV or MP3");
});
