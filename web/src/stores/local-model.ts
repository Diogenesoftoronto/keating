// Dynamic imports keep @huggingface/transformers out of the main bundle: the
// library plus its ONNX runtime is ~100MB and is only needed once a browser
// model is actually selected.

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
 * Gemma-family ONNX exports that exist under the `onnx-community` org and ship
 * the weights for the dtype named here. Adding an entry means verifying both.
 */
export const BROWSER_MODELS: readonly BrowserModelSpec[] = [
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
	{
		id: "onnx-community/gemma-4-E2B-it-qat-mobile-ONNX",
		name: "Gemma 4 E2B QAT (Browser)",
		downloadLabel: "~2.6 GB",
		kind: "multimodal",
		// This repo publishes only q2f16 weights; the vision encoder is fp16 only.
		dtype: {
			embed_tokens: "q2f16",
			decoder_model_merged: "q2f16",
			audio_encoder: "q2f16",
			vision_encoder: "fp16",
		},
		blurb: "Quantization-aware export tuned for low-memory devices.",
	},
	{
		id: "onnx-community/gemma-3n-E2B-it-ONNX",
		name: "Gemma 3n E2B (Browser)",
		downloadLabel: "~3.3 GB",
		kind: "multimodal",
		dtype: "q4f16",
		blurb: "Previous generation. Useful as a fallback if Gemma 4 misbehaves.",
	},
	{
		id: "onnx-community/gemma-3-1b-it-ONNX",
		name: "Gemma 3 1B (Browser)",
		downloadLabel: "~760 MB",
		kind: "text",
		dtype: "q4f16",
		blurb: "Text only, but downloads in about a minute on a normal connection.",
	},
	{
		id: "onnx-community/gemma-3-270m-it-ONNX",
		name: "Gemma 3 270M (Browser)",
		downloadLabel: "~270 MB",
		kind: "text",
		dtype: "q4f16",
		blurb: "Text only and very small. Best for trying the offline path out.",
	},
];

export const DEFAULT_BROWSER_MODEL_ID = "onnx-community/gemma-4-E4B-it-ONNX";

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

	if (lower.includes("shader-f16") || lower.includes("shader_f16")) {
		return `Your GPU does not support the WebGPU shader-f16 feature, which ${spec.name} needs. Try Gemma 3 1B or Gemma 3 270M instead.`;
	}

	if (lower.includes("webgpu") || lower.includes("no adapter")) {
		return "WebGPU is not supported in this browser. The browser model requires Chrome 113+ or Edge 113+. Enable hardware acceleration in your browser settings.";
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

	if (
		lower.includes("out of memory")
		|| lower.includes("memory allocation")
		|| lower.includes("not enough memory")
	) {
		return `Not enough GPU memory to load ${spec.name} (${spec.downloadLabel}). Close other GPU-heavy tabs, or pick a smaller model from the list.`;
	}

	if (lower.includes("aborted") || lower.includes("cancelled")) {
		return "Model loading was cancelled.";
	}

	return message;
}

async function checkWebGpuAvailable(
	spec: BrowserModelSpec,
): Promise<{ available: boolean; reason?: string }> {
	if (!navigator.gpu) {
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
				reason: `Your GPU reports no shader-f16 support, which ${spec.name} requires. Try Gemma 3 1B or Gemma 3 270M instead.`,
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
	loadingProgress: number;
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
	error: null,
	modelId: null,
	model: null,
	processor: null,
	tokenizer: null,
};

class LocalModelStore {
	private state: LocalModel = IDLE_STATE;
	private listeners: Set<(state: LocalModel) => void> = new Set();
	private inFlight: Promise<void> | null = null;
	private loadEpoch = 0;

	subscribe(listener: (state: LocalModel) => void): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((l) => l(this.state));
	}

	private fail(spec: BrowserModelSpec, rawMessage: string): void {
		const message = classifyLocalModelError(rawMessage, spec);
		this.state = { ...IDLE_STATE, error: message, modelId: spec.id };
		this.notify();
		console.error(`[local-model] ${spec.id} failed:`, rawMessage);
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
		this.state = { ...IDLE_STATE, loading: true, modelId };
		this.notify();

		try {
			const gpuCheck = await checkWebGpuAvailable(spec);
			if (!this.isCurrentLoad(epoch)) return;
			if (!gpuCheck.available) {
				this.state = { ...IDLE_STATE, error: gpuCheck.reason!, modelId };
				this.notify();
				console.error("[local-model] WebGPU unavailable:", gpuCheck.reason);
				return;
			}

			console.log(`[local-model] loading ${spec.id} (${spec.downloadLabel})`);

			const { AutoProcessor, AutoTokenizer, AutoModelForCausalLM, env } = await import(
				"@huggingface/transformers"
			);

			// Never attempt to resolve models from the app's own origin.
			env.allowLocalModels = false;
			env.useBrowserCache = true;

			// Text-only repos have no processor_config.json; AutoProcessor throws on them.
			const processor =
				spec.kind === "multimodal" ? await AutoProcessor.from_pretrained(spec.id) : null;
			const tokenizer = processor
				? processor.tokenizer
				: await AutoTokenizer.from_pretrained(spec.id);

			const model = await AutoModelForCausalLM.from_pretrained(spec.id, {
				dtype: spec.dtype as any,
				device: "webgpu",
				progress_callback: (progress: any) => {
					if (!this.isCurrentLoad(epoch)) return;
					if (progress.status === "progress" || progress.status === "progress_total") {
						const pct = Math.round(progress.progress ?? 0);
						this.state = { ...this.state, loadingProgress: pct };
						this.notify();
					}
				},
			});

			if (!this.isCurrentLoad(epoch)) return;

			this.state = {
				loaded: true,
				loading: false,
				loadingProgress: 100,
				error: null,
				modelId: spec.id,
				model,
				processor,
				tokenizer,
			};
			this.notify();
			console.log(`[local-model] ${spec.id} ready`);
		} catch (error) {
			if (!this.isCurrentLoad(epoch)) return;
			this.fail(spec, error instanceof Error ? error.message : String(error));
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

		try {
			// Multimodal templates expect typed content parts; the text-only Gemma 3
			// templates take a plain string.
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

			const { TextStreamer } = await import("@huggingface/transformers");

			const streamer = new TextStreamer(tokenizer, {
				skip_prompt: true,
				skip_special_tokens: true,
				callback_function: onToken ? (text: string) => onToken(text) : undefined,
			});

			const temperature = options?.temperature ?? 0.7;
			const doSample = temperature > 0;

			const outputs = await model.generate({
				...inputs,
				max_new_tokens: Math.max(1, options?.max_length ?? 512),
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
			const rawMessage = error instanceof Error ? error.message : String(error);
			console.error(`[local-model] ${spec.id} generation failed:`, rawMessage);
			throw new Error(classifyLocalModelError(rawMessage, spec));
		}
	}

	getState(): LocalModel {
		return this.state;
	}
}

export const localModel = new LocalModelStore();
