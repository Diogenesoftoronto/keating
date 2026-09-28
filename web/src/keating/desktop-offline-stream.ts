import { createAssistantMessageEventStream, type AssistantMessage, type Context, type SimpleStreamOptions, type Model, type Api } from "@earendil-works/pi-ai";
import { prepareAudioAttachment } from "../lib/audio-attachment";
import { desktopOfflineBridge, DESKTOP_OFFLINE_MODEL, DESKTOP_GEMMA_OFFLINE_MODEL } from "../lib/desktop-offline";

/** Keep native inference in Electron; the renderer never receives file paths or a local server credential. */
export function desktopOfflineStream(context: Context, options?: SimpleStreamOptions, model: Model<Api> = DESKTOP_OFFLINE_MODEL) {
	const stream = createAssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant", api: model.api, provider: model.provider,
		model: model.id, timestamp: Date.now(), content: [], stopReason: "stop",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
	void (async () => {
		const bridge = desktopOfflineBridge();
		const cancel = () => { void bridge?.cancelGeneration().catch(() => {}); };
		try {
			options?.signal?.throwIfAborted();
			if (!bridge) throw new Error("The offline tutor requires the desktop app.");
			const status = await bridge.status(model.id);
			if (!status.available) throw new Error(status.error || "The offline runtime is unavailable. Reinstall the desktop app.");
			if (!status.installed) throw new Error("Download the offline tutor in Settings → Providers & Models before sending. Your message is kept here.");
			const media: Array<{ turn: number; type: "image" | "audio"; data: string; mimeType: string }> = [];
			const turns = context.messages.map((turn, index) => {
				const parts = typeof turn.content === "string" ? [{ type: "text" as const, text: turn.content }] : turn.content;
				if (parts.some(part => (part.type === "image" && !model.input.includes("image")) || ((part as { type: string }).type === "audio" && model.id !== DESKTOP_GEMMA_OFFLINE_MODEL.id))) {
					throw new Error("The offline tutor accepts text only. Choose a vision or audio model, or transcribe your recording before sending.");
				}
				for (const part of parts) {
          const item = part as { type: string; data?: string; mimeType?: string };
          if (item.type === "image" || item.type === "audio") {
            if (typeof item.data !== "string" || typeof item.mimeType !== "string") throw new Error("Offline attachments require local image or WAV bytes.");
            media.push({ turn: index, type: item.type, data: item.data, mimeType: item.mimeType });
          }
        }
        return { role: turn.role, content: parts.filter(part => part.type === "text").map(part => part.text).join("\n") };
			});
			options?.signal?.throwIfAborted();
			options?.signal?.addEventListener("abort", cancel, { once: true });
			stream.push({ type: "start", partial: message });
			for (const item of media) {
        if (item.type !== "audio" || ["audio/wav", "audio/x-wav"].includes(item.mimeType)) continue;
        if (item.data.length > 28 * 1024 * 1024) throw new Error("Keep offline audio under 20 MB.");
        const binary = atob(item.data);
        const wav = await prepareAudioAttachment(new File([Uint8Array.from(binary, char => char.charCodeAt(0))], "recording", { type: item.mimeType }), { forceWav: true });
        const bytes = new Uint8Array(await wav.arrayBuffer());
        let encoded = "";
        for (let offset = 0; offset < bytes.length; offset += 32768) encoded += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        item.data = btoa(encoded);
        item.mimeType = "audio/wav";
      }
      options?.signal?.throwIfAborted();
      const result = await bridge.generate({
        ...(model.id !== DESKTOP_OFFLINE_MODEL.id ? { modelId: model.id } : {}),
        ...(media.length ? { media } : {}),
				prompt: JSON.stringify({ system: context.systemPrompt || "", conversation: turns }),
				maxTokens: options?.maxTokens ?? model.maxTokens, temperature: options?.temperature ?? 0.7,
			});
			options?.signal?.throwIfAborted();
			if (!result.trim()) throw new Error("The offline tutor returned no answer. Try a shorter conversation.");
			message.content = [{ type: "text", text: result }];
			stream.push({ type: "text_start", contentIndex: 0, partial: message });
			stream.push({ type: "text_delta", contentIndex: 0, delta: result, partial: message });
			stream.push({ type: "text_end", contentIndex: 0, content: result, partial: message });
			stream.push({ type: "done", reason: "stop", message });
		} catch (error) {
			message.stopReason = options?.signal?.aborted ? "aborted" : "error";
			message.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: message.stopReason, error: message });
		} finally {
			options?.signal?.removeEventListener("abort", cancel);
			stream.end(message);
		}
	})();
	return stream;
}
