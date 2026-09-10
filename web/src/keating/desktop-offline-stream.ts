import { createAssistantMessageEventStream, type AssistantMessage, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { desktopOfflineBridge, DESKTOP_OFFLINE_MODEL } from "../lib/desktop-offline";

/** Keep native inference in Electron; the renderer never receives file paths or a local server credential. */
export function desktopOfflineStream(context: Context, options?: SimpleStreamOptions) {
	const stream = createAssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant", api: DESKTOP_OFFLINE_MODEL.api, provider: DESKTOP_OFFLINE_MODEL.provider,
		model: DESKTOP_OFFLINE_MODEL.id, timestamp: Date.now(), content: [], stopReason: "stop",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
	void (async () => {
		const bridge = desktopOfflineBridge();
		const cancel = () => { void bridge?.cancelGeneration().catch(() => {}); };
		try {
			options?.signal?.throwIfAborted();
			if (!bridge) throw new Error("The offline tutor requires the desktop app.");
			const status = await bridge.status();
			if (!status.available) throw new Error(status.error || "The offline runtime is unavailable. Reinstall the desktop app.");
			if (!status.installed) throw new Error("Download the offline tutor in Settings → Providers & Models before sending. Your message is kept here.");
			const turns = context.messages.map(turn => {
				const parts = typeof turn.content === "string" ? [{ type: "text" as const, text: turn.content }] : turn.content;
				if (parts.some(part => part.type === "image" || (part as { type: string }).type === "audio")) {
					throw new Error("The offline tutor accepts text only. Choose a vision or audio model, or transcribe your recording before sending.");
				}
				return { role: turn.role, content: parts.filter(part => part.type === "text").map(part => part.text).join("\n") };
			});
			options?.signal?.throwIfAborted();
			options?.signal?.addEventListener("abort", cancel, { once: true });
			stream.push({ type: "start", partial: message });
			const result = await bridge.generate({
				prompt: JSON.stringify({ system: context.systemPrompt || "", conversation: turns }),
				maxTokens: options?.maxTokens ?? 1024, temperature: options?.temperature ?? 0.7,
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
