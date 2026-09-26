// Dynamic imports keep @huggingface/transformers out of the main bundle: the
// library plus its ONNX runtime is ~100MB and is only needed once a browser
// model is actually selected.

import {
	deleteCachedModel,
	readCachedModelInfo,
	type CachedModelInfo,
} from "../lib/model-cache";
import {
	DownloadTracker,
	IDLE_DOWNLOAD_PROGRESS,
	parseSizeLabel,
	type DownloadProgress,
} from "../lib/model-download-progress";
import {
	LocalModelDiagnostics,
	localModelDebugEnabled,
	localModelErrorMessage,
} from "../lib/local-model-diagnostics";

export type BrowserModelKind = "multimodal" | "text";

export interface BrowserModelSpec {
	/** Hugging Face repo id, passed straight to transformers.js. */
	id: string;
	name: string;
	/** Approximate download for the dtype below, so the size is visible before committing. */
	downloadLabel: string;
	/**
	 * `multimodal` repos ship a processor_config.json and load through
	 * AutoProcessor. `text` repos ship only a tokenizer — AutoProcessor throws
	 * "No `image_processor_type` or `feature_extractor_type` found in the
	 * config" on those, so they must load through AutoTokenizer.
	 */
	kind: BrowserModelKind;
	/**
	 * Per-session dtype. The QAT mobile exports only ship q2f16 weights (plus an
	 * fp16 vision encoder), so a single dtype string 404s against those repos.
	 */
	dtype: string | Record<string, string>;
	blurb: string;
}

/**
 * Hugging Face exports that ship weights for the dtype named here. Adding an
 * entry means verifying both model and runtime integration before exposing it in
 * the selector.
 */
export const BROWSER_MODELS: readonly BrowserModelSpec[] = [
	{
		id: "RASMUS/MiniCPM5-2B-ONNX",
		name: "MiniCPM5 2B (Browser)",
		downloadLabel: "~1.84 GB",
		kind: "text",
		dtype: "q4f16",
		blurb: "Default browser model. Text-only English and Chinese tutoring, running on your device.",
	},
	{
		// LiquidAI's own export, and the only LFM2.5 published as ONNX.
		id: "LiquidAI/LFM2.5-2.6B-ONNX",
		name: "LFM 2.5 2.6B (Browser)",
		downloadLabel: "~1.6 GB",
		kind: "text",
		dtype: "q4f16",
		blurb: "Smaller download: a text-only alternative for on-device tutoring.",
	},
	{
		id: "onnx-community/gemma-4-E4B-it-ONNX",
		name: "Gemma 4 E4B (Browser)",
		downloadLabel: "~5.2 GB",
		kind: "multimodal",
		dtype: "q4f16",
		blurb: "Largest and most capable. Needs a discrete GPU and a stable connection.",
	},
	{
		id: "onnx-community/gemma-4-E2B-it-ONNX",
		name: "Gemma 4 E2B (Browser)",
		downloadLabel: "~3.4 GB",
		kind: "multimodal",
		dtype: "q4f16",
		blurb: "Same generation as E4B, roughly two thirds the download.",
	},
	// Models evaluated and not shipped — the ones that load but were held back,
	// and the ones that cannot load at all — are recorded with their measured
	// sizes and the reason in docs/browser-models.md. Read it before adding an
	// entry here; several obvious candidates are already ruled out.
];

/**
 * MiniCPM5's Transformers.js-compatible ONNX export. The native LiteRT bundle
 * cannot be used by this loader. Browser chat currently accepts text only.
 */
export const DEFAULT_BROWSER_MODEL_ID = "RASMUS/MiniCPM5-2B-ONNX";

export function getBrowserModel(id: string): BrowserModelSpec | undefined {
	return BROWSER_MODELS.find((entry) => entry.id === id);
}

/**
 * `GPUAdapter.features` is a set-like `GPUSupportedFeatures` at runtime, but the
 * TS DOM lib in this project types it as an array. Handle both shapes.
 */
function adapterHasFeature(adapter: GPUAdapter, name: string): boolean {
	const features: unknown = adapter.features;
	if (Array.isArray(features)) return features.includes(name);
	return (features as { has(value: string): boolean }).has(name);
}

/** True when any session of this spec is loaded as an f16 variant. */
function needsShaderF16(spec: BrowserModelSpec): boolean {
	const values = typeof spec.dtype === "string" ? [spec.dtype] : Object.values(spec.dtype);
	return values.some((value) => value.includes("f16"));
}

export function classifyLocalModelError(message: string, spec: BrowserModelSpec): string {
	const lower = message.toLowerCase();

	// AutoProcessor throws this for text-only repos. It is a catalog bug, not a
	// GPU problem — reporting it as one sends people into their driver settings.
	if (lower.includes("image_processor_type") || lower.includes("feature_extractor_type")) {
		return `${spec.name} has no processor config, so it must load as a text-only model. This is a Keating configuration bug — please report it.`;
	}

	if (lower.includes("device lost") || lower.includes("device was lost") || lower.includes("device is lost") || lower.includes("device-lost")) {
		return `The GPU device was lost while running ${spec.name}. Reload the page before retrying. See the device-loss reason in the diagnostic details.`;
	}

	if (/out of memory|outofmemory|memory allocation|not enough memory|failed to allocate/.test(lower)) {
		return `A memory allocation failed while running ${spec.name}. Close other GPU-heavy apps or try a smaller model. This error does not measure available GPU memory.`;
	}

	if (/maxbuffersize|maxstoragebufferbindingsize|buffer size.*(exceed|limit)|size.*exceeds.*(buffer|limit)/.test(lower)) {
		return `${spec.name} hit a WebGPU buffer-size or binding limit. The diagnostic report includes the limits of ONNX's actual device.`;
	}

	if (/invalid buffer|mapasync|map_async|failed to download data from buffer/.test(lower)) {
		return `${spec.name} could not read inference data back from a GPU buffer. An earlier GPU error may explain why; this does not establish that WebGPU is unsupported or that memory ran out.`;
	}

	if (/shader[-_]f16/.test(lower) && /not support|unsupported|not available|unavailable|missing/.test(lower)) {
		return `The runtime reports that shader-f16 is unavailable for ${spec.name}. Check the actual device's enabled features in the diagnostic report.`;
	}

	// ONNX Runtime's MatMulNBits kernel accepts 4-bit and 8-bit weights only, so
	// q2/ternary exports fail at session creation no matter how they are loaded.
	if (/bits must be (4 or 8|4,? 8)/.test(lower)) {
		return `${spec.name} ships weights quantized below 4 bits, which the browser ONNX runtime cannot execute yet. Pick a 4-bit model from the list instead.`;
	}

	if (/no (webgpu )?adapter|failed to get gpu adapter|webgpu is not supported|webgpu is unavailable/.test(lower)) {
		return "The runtime could not access a WebGPU adapter. Check browser hardware acceleration and the GPU driver.";
	}

	if (/webgpu|ortrun|matmulnbits|shader[-_]f16/.test(lower)) {
		return `${spec.name} failed during WebGPU execution. See the original runtime error and GPU diagnostic details below.`;
	}

	if (lower.includes("404") || lower.includes("could not locate") || lower.includes("unauthorized")) {
		return `Could not find the model files for ${spec.id} on Hugging Face. The model may have been renamed or removed.`;
	}

	if (
		lower.includes("not allowed to load from")
		|| lower.includes("failed to fetch")
		|| lower.includes("networkerror")
		|| lower.includes("net::")
	) {
		return `Could not download ${spec.name}. Check your internet connection and try again — the download is ${spec.downloadLabel}.`;
	}

	if (lower.includes("aborted") || lower.includes("cancelled")) {
		return "Browser model operation was cancelled.";
	}

	return message;
}

export async function checkWebGpuAvailable(
	spec: BrowserModelSpec,
): Promise<{ available: boolean; reason?: string }> {
	if (typeof navigator === "undefined" || !navigator.gpu) {
		return {
			available: false,
			reason: "WebGPU is not supported in this browser. The browser model requires Chrome 113+ or Edge 113+ with hardware acceleration enabled.",
		};
	}
	try {
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) {
			return {
				available: false,
				reason: "No WebGPU adapter found. Your GPU may not support WebGPU, or hardware acceleration may be disabled. Enable it in your browser settings.",
			};
		}
		// Every f16 export fails at session creation without this feature, with an
		// error that is far less legible than saying so up front.
		if (needsShaderF16(spec) && !adapterHasFeature(adapter, "shader-f16")) {
			return {
				available: false,
				reason: `Your GPU reports no shader-f16 support, which ${spec.name} requires. Try a smaller browser model instead.`,
			};
		}
		return { available: true };
	} catch {
		return {
			available: false,
			reason: "WebGPU adapter request failed. Your GPU may not support WebGPU, or hardware acceleration may be disabled in your browser settings.",
		};
	}
}

export interface LocalModel {
	loaded: boolean;
	loading: boolean;
	/** Rounded percentage of `download.percent`, kept for simple consumers. */
	loadingProgress: number;
	/** Size, rate and phase behind that percentage. */
	download: DownloadProgress;
	error: string | null;
	/** Repo id of the model that is loaded or currently loading. */
	modelId: string | null;
	model: any | null;
	/** Set for multimodal repos only. */
	processor: any | null;
	tokenizer: any | null;
}

const IDLE_STATE: LocalModel = {
	loaded: false,
	loading: false,
	loadingProgress: 0,
	download: IDLE_DOWNLOAD_PROGRESS,
	error: null,
	modelId: null,
	model: null,
	processor: null,
	tokenizer: null,
};

/** Progress fires far faster than a person can read; repaint at ~7fps. */
const PROGRESS_NOTIFY_INTERVAL_MS = 140;
/**
 * Files finish in bursts with gaps between them, so "every file done" is only
 * meaningful once it has held for a while. Past that, the remaining wait is
 * graph compilation rather than network.
 */
const PREPARING_DELAY_MS = 1200;

class LocalModelStore {
	private state: LocalModel = IDLE_STATE;
	private listeners: Set<(state: LocalModel) => void> = new Set();
	private inFlight: Promise<void> | null = null;
	private loadEpoch = 0;
	private preparingTimer: ReturnType<typeof setTimeout> | null = null;
	private lastProgressNotifyAt = 0;
	private abortLoad: AbortController | null = null;
	/** transformers.js's own fetch, before any cancellation wrapper. */
	private baseFetch: ((input: string | URL, init?: any) => Promise<any>) | null = null;
	private restoreFetch: (() => void) | null = null;

	subscribe(listener: (state: LocalModel) => void): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((l) => l(this.state));
	}

	private fail(spec: BrowserModelSpec, error: unknown, diagnostics: LocalModelDiagnostics): void {
		const failure = diagnostics.error(error, classifyLocalModelError(localModelErrorMessage(error), spec));
		this.clearPreparingTimer();
		this.state = { ...IDLE_STATE, error: failure.message, modelId: spec.id };
		this.notify();
		console.error(`[local-model] ${spec.id} failed:`, failure);
	}

	private clearPreparingTimer(): void {
		if (this.preparingTimer === null) return;
		clearTimeout(this.preparingTimer);
		this.preparingTimer = null;
	}

	/** Store a progress snapshot, repainting no more often than the interval. */
	private applyProgress(download: DownloadProgress, epoch: number, immediate: boolean): void {
		if (!this.isCurrentLoad(epoch)) return;
		this.state = { ...this.state, download, loadingProgress: Math.round(download.percent) };
		const now = Date.now();
		if (!immediate && now - this.lastProgressNotifyAt < PROGRESS_NOTIFY_INTERVAL_MS) return;
		this.lastProgressNotifyAt = now;
		this.notify();
	}

	/** Flip to "preparing" once the transfers have stayed quiet long enough. */
	private schedulePreparingPhase(tracker: DownloadTracker, epoch: number): void {
		this.clearPreparingTimer();
		if (tracker.getPhase() !== "downloading" || !tracker.snapshot().allFilesDone) return;
		this.preparingTimer = setTimeout(() => {
			this.preparingTimer = null;
			this.applyProgress(tracker.setPhase("preparing"), epoch, true);
		}, PREPARING_DELAY_MS);
	}

	async load(modelId: string = DEFAULT_BROWSER_MODEL_ID): Promise<void> {
		if (this.state.loaded && this.state.modelId === modelId) return;
		// A load for a different model supersedes the one in flight.
		if (this.state.loading && this.state.modelId === modelId) {
			await this.inFlight;
			return;
		}
		const epoch = ++this.loadEpoch;
		const pending = this.performLoad(modelId, epoch);
		this.inFlight = pending;
		try {
			await pending;
		} finally {
			if (this.inFlight === pending) {
				this.inFlight = null;
			}
		}
	}

	private isCurrentLoad(epoch: number): boolean {
		return epoch === this.loadEpoch;
	}

	/**
	 * Stop an in-flight download. Bumping the epoch makes the abort error that
	 * surfaces inside `from_pretrained` a no-op instead of a failure banner.
	 */
	cancel(): void {
		if (!this.state.loading) return;
		this.loadEpoch += 1;
		this.clearPreparingTimer();
		this.abortLoad?.abort();
		// Unhook the aborted signal now; the rejected load may settle much later.
		this.restoreFetch?.();
		this.restoreFetch = null;
		this.abortLoad = null;
		this.state = { ...IDLE_STATE };
		this.notify();
	}

	/** Drop the loaded model, freeing GPU memory. Cached files are untouched. */
	async unload(): Promise<void> {
		this.cancel();
		const model = this.state.model as { dispose?: () => Promise<void> | void } | null;
		this.state = { ...IDLE_STATE };
		this.notify();
		try {
			await model?.dispose?.();
		} catch {
			// A model that fails to dispose is still unreachable from here.
		}
	}

	/** How much of a model is already downloaded, in bytes. */
	async cachedSize(modelId: string): Promise<number> {
		return (await readCachedModelInfo(modelId)).bytes;
	}

	/**
	 * Delete a model's cached weights. Unloads first when it is the live model,
	 * so the deletion also frees GPU memory rather than only disk.
	 */
	async removeDownload(modelId: string): Promise<CachedModelInfo> {
		if (this.state.modelId === modelId) await this.unload();
		return deleteCachedModel(modelId);
	}

	private async performLoad(modelId: string, epoch: number): Promise<void> {
		const spec = getBrowserModel(modelId);
		if (!spec) {
			if (!this.isCurrentLoad(epoch)) return;
			this.state = {
				...IDLE_STATE,
				error: `Unknown browser model: ${modelId}`,
				modelId,
			};
			this.notify();
			console.error(`[local-model] unknown browser model: ${modelId}`);
			return;
		}

		if (!this.isCurrentLoad(epoch)) return;
		this.clearPreparingTimer();
		this.lastProgressNotifyAt = 0;
		const tracker = new DownloadTracker(parseSizeLabel(spec.downloadLabel));
		this.state = {
			...IDLE_STATE,
			loading: true,
			modelId,
			download: tracker.setPhase("checking"),
		};
		this.notify();

		let restoreFetch: (() => void) | null = null;
		const diagnostics = new LocalModelDiagnostics(spec.id, spec.dtype, "loading", localModelDebugEnabled());
		let runtime: Parameters<LocalModelDiagnostics["attach"]>[0] | undefined;
		try {
			const gpuCheck = await checkWebGpuAvailable(spec);
			if (!this.isCurrentLoad(epoch)) return;
			if (!gpuCheck.available) {
				this.state = { ...IDLE_STATE, error: gpuCheck.reason!, modelId };
				this.notify();
				console.error("[local-model] WebGPU unavailable:", gpuCheck.reason);
				return;
			}

			const { AutoProcessor, AutoTokenizer, AutoModelForCausalLM, env, LogLevel } = await import(
				"@huggingface/transformers"
			);
			if (!this.isCurrentLoad(epoch)) return;
			runtime = env.backends.onnx;
			diagnostics.transformersVersion = env.version;

			// Never attempt to resolve models from the app's own origin.
			env.allowLocalModels = false;
			env.useBrowserCache = true;
			// `from_pretrained` takes no abort signal, but every request it makes
			// goes through this hook, so cancelling really does stop the transfer.
			const controller = new AbortController();
			this.abortLoad = controller;
			// Captured once. Wrapping whatever is currently installed would chain a
			// cancelled load's wrapper — and its already-aborted signal — into the
			// retry that replaced it.
			this.baseFetch ??= env.fetch;
			const baseFetch = this.baseFetch;
			env.fetch = (input: string | URL, init?: any) =>
				baseFetch(input, { ...init, signal: controller.signal });
			restoreFetch = () => {
				// Whichever of cancel() and the finally block runs first restores the
				// hook; a newer load owning it means neither should touch it.
				if (this.abortLoad !== controller) return;
				env.fetch = baseFetch;
				this.abortLoad = null;
			};
			this.restoreFetch = restoreFetch;
			// Transformers.js sets per-session severity from its own log level.
			// Enable both layers before creating a session for diagnostic retries.
			if (diagnostics.debug) {
				env.logLevel = LogLevel.DEBUG;
				env.backends.onnx.debug = true;
				env.backends.onnx.logLevel = "verbose";
				console.info("[local-model] verbose runtime diagnostics enabled");
			}

			// Cached weights emit no progress events at all, so say "preparing"
			// rather than sitting at 0% for the whole load.
			this.applyProgress(tracker.setPhase("preparing"), epoch, true);

			// Text-only repos have no processor_config.json; AutoProcessor throws on them.
			const processor =
				spec.kind === "multimodal" ? await AutoProcessor.from_pretrained(spec.id) : null;
			const tokenizer = processor
				? processor.tokenizer
				: await AutoTokenizer.from_pretrained(spec.id);

			const model = await AutoModelForCausalLM.from_pretrained(spec.id, {
				dtype: spec.dtype as any,
				device: "webgpu",
				progress_callback: (event: any) => {
					if (!this.isCurrentLoad(epoch)) return;
					this.applyProgress(tracker.update(event), epoch, false);
					this.schedulePreparingPhase(tracker, epoch);
				},
			});
			await diagnostics.attach(runtime);

			this.clearPreparingTimer();
			if (!this.isCurrentLoad(epoch)) return;

			this.state = {
				loaded: true,
				loading: false,
				loadingProgress: 100,
				download: tracker.setPhase("ready"),
				error: null,
				modelId: spec.id,
				model,
				processor,
				tokenizer,
			};
			this.notify();
		} catch (error) {
			// A cancelled load has already bumped the epoch, so its abort error
			// lands here and is correctly ignored.
			if (!this.isCurrentLoad(epoch)) return;
			if (runtime) await diagnostics.attach(runtime, false);
			if (!this.isCurrentLoad(epoch)) return;
			this.fail(spec, error, diagnostics);
		} finally {
			diagnostics.finish();
			restoreFetch?.();
		}
	}

	async generate(
		prompt: string,
		options?: { max_length?: number; temperature?: number },
		onToken?: (token: string) => void,
	): Promise<string> {
		const { model, processor, tokenizer, modelId } = this.state;
		if (!model || !tokenizer || !modelId) {
			throw new Error("Browser model is not loaded");
		}
		const spec = getBrowserModel(modelId);
		if (!spec) throw new Error(`Unknown browser model: ${modelId}`);
		const diagnostics = new LocalModelDiagnostics(spec.id, spec.dtype, "generation", localModelDebugEnabled());
		diagnostics.maxNewTokens = Math.max(1, options?.max_length ?? 512);

		try {
			const { TextStreamer, env } = await import("@huggingface/transformers");
			diagnostics.transformersVersion = env.version;
			await diagnostics.attach(env.backends.onnx);
				// Multimodal templates expect typed content parts; text-only templates
				// take a plain string.
				const messages = [
					{
						role: "user",
						content:
							spec.kind === "multimodal" ? [{ type: "text", text: prompt }] : prompt,
				},
			];

			const formattedPrompt = tokenizer.apply_chat_template(messages, {
				add_generation_prompt: true,
				// Gemma 4 ships a thinking channel that is on unless disabled. Keating
				// renders the reply directly, so the raw thinking tokens are noise.
				enable_thinking: false,
				tokenize: false,
			});

			// The chat template already inserted the special tokens.
			// Processors vary across Transformers.js versions; try both the explicit
			// multimodal argument shape and the legacy single-signature shape.
			const processMultimodal = async () => {
				try {
					return await processor(formattedPrompt, null, null, { add_special_tokens: false });
				} catch (error) {
					return await processor(formattedPrompt, { add_special_tokens: false });
				}
			};
			const inputs =
				spec.kind === "multimodal" ? await processMultimodal() : tokenizer(formattedPrompt, { add_special_tokens: false });

			diagnostics.inputTokens = inputs.input_ids.dims.at(-1) ?? null;

			const streamer = new TextStreamer(tokenizer, {
				skip_prompt: true,
				skip_special_tokens: true,
				callback_function: onToken ? (text: string) => onToken(text) : undefined,
			});

			const temperature = options?.temperature ?? 0.7;
			const doSample = temperature > 0;

			const outputs = await model.generate({
				...inputs,
				max_new_tokens: diagnostics.maxNewTokens,
				do_sample: doSample,
				...(doSample ? { temperature } : {}),
				streamer,
			});

			const decoded = tokenizer.batch_decode(
				outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
				{ skip_special_tokens: true },
			);

			return decoded[0] ?? "";
		} catch (error) {
			const failure = diagnostics.error(error, classifyLocalModelError(localModelErrorMessage(error), spec));
			console.error(`[local-model] ${spec.id} generation failed:`, failure);
			throw failure;
		} finally {
			diagnostics.finish();
		}
	}

	getState(): LocalModel {
		return this.state;
	}
}

export const localModel = new LocalModelStore();
