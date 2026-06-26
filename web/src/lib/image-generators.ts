// Central source of truth for image-generation backends and their model
// choices. The `generate_image` tool and the settings UI both read from here so
// model ids never get hardcoded in more than one place.

export type ImageGeneratorId = "openai" | "local";

export interface ImageGeneratorOption {
	id: ImageGeneratorId;
	label: string;
	description: string;
	/**
	 * Fixed remote endpoint (full URL). Used by hosted generators like OpenAI.
	 * Local generators leave this undefined and derive the endpoint from the
	 * user-configured base URL instead.
	 */
	fixedEndpoint?: string;
	/** Provider name used to look up an API key via getProviderApiKey(). */
	providerKey: string;
	/** Whether this generator needs a user-supplied base URL (local servers). */
	needsBaseUrl: boolean;
	/** Available models; the first entry is the default. May be empty (free-form). */
	models: string[];
	/** Available sizes; the first entry is the default. */
	sizes: string[];
	/** Available qualities; the first entry is the default. */
	qualities: string[];
}

export const IMAGE_GENERATORS: ImageGeneratorOption[] = [
	{
		id: "openai",
		label: "OpenAI",
		description: "Hosted OpenAI image models. Needs an OpenAI API key in Providers & Models.",
		fixedEndpoint: "https://api.openai.com/v1/images/generations",
		providerKey: "openai",
		needsBaseUrl: false,
		models: ["gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"],
		sizes: ["1024x1024", "1536x1024", "1024x1536"],
		qualities: ["medium", "low", "high"],
	},
	{
		id: "local",
		label: "Local (OpenAI-compatible)",
		description:
			"A local server (ComfyUI, Automatic1111, llama.cpp, etc.) exposing an OpenAI-style /images/generations endpoint. Set the base URL below.",
		providerKey: "local-image",
		needsBaseUrl: true,
		// Model is free-form for local servers — supply it in settings.
		models: [],
		sizes: ["1024x1024", "1536x1024", "1024x1536"],
		qualities: ["medium", "low", "high"],
	},
];

export const DEFAULT_IMAGE_GENERATOR_ID: ImageGeneratorId = "openai";

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
