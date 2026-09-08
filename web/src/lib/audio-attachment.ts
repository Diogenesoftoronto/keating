export const MAX_AUDIO_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const TARGET_SAMPLE_RATE = 16_000;

/** Encode little-endian, mono PCM16 with a standard RIFF/WAVE header. */
export function encodeMonoPcm16Wav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): ArrayBuffer {
	if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 384_000) throw new Error("Invalid WAV sample rate.");
	const buffer = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(buffer);
	function ascii(offset: number, text: string) {
		for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
	}
	ascii(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, "WAVE");
	ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
	view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, samples.length * 2, true);
	for (let index = 0; index < samples.length; index++) {
		const sample = Number.isFinite(samples[index]) ? Math.max(-1, Math.min(1, samples[index])) : 0;
		view.setInt16(44 + index * 2, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
	}
	return buffer;
}

/** Keep provider-supported WAV/MP3; normalize browser recordings and other audio to mono 16 kHz WAV. */
export async function prepareAudioAttachment(file: File): Promise<File> {
	if (file.size > MAX_AUDIO_ATTACHMENT_BYTES) throw new Error("Audio attachments must be 25 MB or smaller.");
	if (file.size === 0) throw new Error("The audio file is empty. Record or choose audio before attaching it.");
	const mime = file.type.toLowerCase().split(";")[0].trim();
	const extension = file.name.split(".").pop()?.toLowerCase();
	const normalizedMime = ["audio/wav", "audio/wave", "audio/x-wav", "audio/vnd.wave"].includes(mime) || extension === "wav"
		? "audio/wav"
		: ["audio/mpeg", "audio/mp3", "audio/x-mp3"].includes(mime) || extension === "mp3" ? "audio/mpeg" : undefined;
	if (normalizedMime) return file.type === normalizedMime ? file : new File([file], file.name, { type: normalizedMime, lastModified: file.lastModified });
	if (typeof AudioContext === "undefined" || typeof OfflineAudioContext === "undefined") throw new Error("This browser cannot convert this audio format. Attach a WAV or MP3 file instead.");
	let context: AudioContext | undefined;
	try {
		context = new AudioContext();
		const decoded = await context.decodeAudioData(await file.arrayBuffer());
		if (!decoded.length || !decoded.numberOfChannels || !Number.isFinite(decoded.duration)) throw new Error("The audio file contains no playable audio.");
		const targetLength = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
		if (44 + targetLength * 2 > MAX_AUDIO_ATTACHMENT_BYTES) throw new Error("This recording would exceed 25 MB after conversion to WAV. Choose a shorter recording.");
		const offline = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
		const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate);
		const samples = mono.getChannelData(0);
		for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
			const channelSamples = decoded.getChannelData(channel);
			for (let index = 0; index < samples.length; index++) samples[index] += channelSamples[index] / decoded.numberOfChannels;
		}
		const source = offline.createBufferSource(); source.buffer = mono; source.connect(offline.destination); source.start();
		const rendered = await offline.startRendering();
		const wav = encodeMonoPcm16Wav(rendered.getChannelData(0));
		const basename = file.name.replace(/\.[^.]+$/, "") || "recording";
		return new File([wav], `${basename}.wav`, { type: "audio/wav", lastModified: file.lastModified });
	} catch (cause) {
		if (cause instanceof Error && (cause.message.includes("25 MB") || cause.message.includes("no playable audio"))) throw cause;
		throw new Error("This audio could not be decoded. Try a WAV or MP3 file, or record again.", { cause });
	} finally {
		if (context && context.state !== "closed") await context.close().catch(() => {});
	}
}
