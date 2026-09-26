// Central source of truth for image-generation backends and their model
// choices. The `generate_image` tool and the settings UI both read from here so
// model ids never get hardcoded in more than one place.

import { NOTORGANIC_IMAGE_MODEL_ALIAS } from "../notorganic-provider";

export type ImageGeneratorId = "openai" | "gemini" | "local" | "notorganic";

/**
 * Request shape a generator speaks. OpenAI and local servers expose the Images
 * API; Gemini exposes generateContent with image output modalities.
 */
export type ImageGeneratorProtocol = "openai-images" | "gemini-generate-content";

export interface ImageGeneratorOption {
	id: ImageGeneratorId;
	label: string;
	description: string;
	/** Request shape this generator speaks. */
	protocol: ImageGeneratorProtocol;
	/** How the browser authenticates this generator. */
	auth: "api-key" | "notorganic-session";
	/**
	 * Fixed remote endpoint (full URL). A `{model}` placeholder is substituted
	 * with the selected model id when present. Local generators leave this
	 * undefined and derive the endpoint from the user-configured base URL.
	 */
	fixedEndpoint?: string;
	/** Provider name used to look up an API key for API-key generators. */
	providerKey?: string;
	/** Whether this generator needs a user-supplied base URL (local servers). */
	needsBaseUrl: boolean;
	/** Available models; the first entry is the default. May be empty (free-form). */
	models: string[];
	/** Available sizes; the first entry is the default. Pixels, or an aspect ratio for Gemini. */
	sizes: string[];
	/** Available qualities; the first entry is the default. */
	qualities: string[];
}

export const IMAGE_GENERATORS: ImageGeneratorOption[] = [
	{
		id: "openai",
		label: "OpenAI",
		description: "Hosted OpenAI image models. Needs an OpenAI API key in Providers & Models.",
		protocol: "openai-images",
		auth: "api-key",
		fixedEndpoint: "https://api.openai.com/v1/images/generations",
		providerKey: "openai",
		needsBaseUrl: false,
		// Newest first: the first entry is the default when no model is chosen.
		models: [
			"gpt-image-2.5-flare",
			"gpt-image-2.5-sunburst",
			"gpt-image-2",
			"gpt-image-1.5",
			"gpt-image-1",
			"gpt-image-1-mini",
		],
		sizes: ["1024x1024", "1536x1024", "1024x1536"],
		qualities: ["medium", "low", "high"],
	},
	{
		id: "gemini",
		label: "Google Gemini",
		description: "Hosted Gemini image models. Needs a Google API key in Providers & Models.",
		protocol: "gemini-generate-content",
		auth: "api-key",
		fixedEndpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
		providerKey: "google",
		needsBaseUrl: false,
		models: [
			"gemini-3.1-flash-image",
			"gemini-3.1-flash-lite-image",
			"gemini-3-pro-image",
			"gemini-2.5-flash-image",
		],
		// Gemini takes an aspect ratio rather than a pixel size.
		sizes: ["1:1", "3:2", "2:3", "16:9", "9:16"],
		// Gemini's quality knob is the output resolution tier.
		qualities: ["1K", "2K", "4K"],
	},
	{
		id: "local",
		label: "Local (OpenAI-compatible)",
		description:
			"A local server (ComfyUI, Automatic1111, llama.cpp, etc.) exposing an OpenAI-style /images/generations endpoint. Set the base URL below.",
		protocol: "openai-images",
		auth: "api-key",
		providerKey: "local-image",
		needsBaseUrl: true,
		// Model is free-form for local servers — supply it in settings.
		models: [],
		sizes: ["1024x1024", "1536x1024", "1024x1536"],
		qualities: ["medium", "low", "high"],
	},
	{
		id: "notorganic",
		label: "Not Organic",
		description: "Account-backed Not Organic image generation using your connected account credits.",
		protocol: "openai-images",
		auth: "notorganic-session",
		needsBaseUrl: false,
		// This is the provider's canonical capability alias, not an upstream
		// model id. The gateway owns the concrete image model route.
		models: [NOTORGANIC_IMAGE_MODEL_ALIAS],
		sizes: ["1024x1024", "1536x1024", "1024x1536"],
		qualities: ["medium", "low", "high"],
	},
];

export const DEFAULT_IMAGE_GENERATOR_ID: ImageGeneratorId = "openai";

/** Validate case-insensitively while preserving the provider's canonical value. */
export function resolveImageQuality(generator: ImageGeneratorOption, candidate: string): string {
 const normalized = candidate.trim().toLowerCase();
 const canonical = generator.qualities.find(value => value.toLowerCase() === normalized);
 if (canonical) return canonical;
 if (generator.protocol === "gemini-generate-content" && ["low", "medium", "high"].includes(normalized)) {
  return geminiImageSize(normalized);
 }
 return generator.qualities[0];
}

export function getImageGenerator(id: string | undefined): ImageGeneratorOption | undefined {
	return IMAGE_GENERATORS.find((generator) => generator.id === id);
}

export function isImageGeneratorId(value: unknown): value is ImageGeneratorId {
	return typeof value === "string" && IMAGE_GENERATORS.some((generator) => generator.id === value);
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

/**
 * Build the /images/generations endpoint for a local OpenAI-compatible server
 * from its base URL. Mirrors the trailing-slash + `/v1` handling used for chat
 * provider discovery in provider-models.ts.
 */
export function localImageEndpoint(baseUrl: string): string {
	const trimmed = trimTrailingSlash(baseUrl.trim());
	if (!trimmed) return "";
	if (trimmed.endsWith("/images/generations")) return trimmed;
	if (trimmed.endsWith("/v1")) return `${trimmed}/images/generations`;
	return `${trimmed}/v1/images/generations`;
}

/**
 * Resolve the endpoint for the active generator. Remote generators carry a
 * fixed endpoint that may embed `{model}` (Gemini keeps the model in the URL);
 * local servers derive the endpoint from the learner's base URL.
 */
export function resolveImageGeneratorEndpoint(params: {
	generator: ImageGeneratorOption;
	model: string;
	localBaseUrl: string;
}): string {
	const { generator, model, localBaseUrl } = params;
	if (generator.needsBaseUrl) return localImageEndpoint(localBaseUrl);
	return (generator.fixedEndpoint ?? "").replace("{model}", encodeURIComponent(model));
}

/** Aspect ratios Gemini accepts for image output. */
const GEMINI_ASPECT_RATIOS = ["1:1", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4"] as const;
const GEMINI_DEFAULT_ASPECT_RATIO = "1:1";

function greatestCommonDivisor(a: number, b: number): number {
	return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * Gemini takes an aspect ratio, so a pixel size like 1536x1024 is reduced to
 * 3:2. Anything unrecognized falls back to a square.
 */
export function geminiAspectRatio(size: string): string {
	const value = size.trim();
	if ((GEMINI_ASPECT_RATIOS as readonly string[]).includes(value)) return value;
	const pixels = value.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
	if (!pixels) return GEMINI_DEFAULT_ASPECT_RATIO;
	const width = Number(pixels[1]);
	const height = Number(pixels[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return GEMINI_DEFAULT_ASPECT_RATIO;
	}
	const divisor = greatestCommonDivisor(width, height);
	const reduced = `${width / divisor}:${height / divisor}`;
	return (GEMINI_ASPECT_RATIOS as readonly string[]).includes(reduced) ? reduced : GEMINI_DEFAULT_ASPECT_RATIO;
}

const GEMINI_IMAGE_SIZES = new Set(["1K", "2K", "4K"]);
const GEMINI_QUALITY_TO_IMAGE_SIZE: Record<string, string> = { low: "1K", medium: "2K", high: "4K" };

/**
 * Gemini's quality knob is the output resolution tier. The OpenAI low/medium/
 * high labels map onto it so one settings row works for every generator.
 */
export function geminiImageSize(quality: string): string {
	const value = quality.trim();
	if (GEMINI_IMAGE_SIZES.has(value)) return value;
	return GEMINI_QUALITY_TO_IMAGE_SIZE[value.toLowerCase()] ?? "2K";
}
