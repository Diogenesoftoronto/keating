import { describe, expect, it } from "bun:test";
import {
	IMAGE_GENERATORS,
	geminiAspectRatio,
	geminiImageSize,
	getImageGenerator,
	localImageEndpoint,
	resolveImageGeneratorEndpoint,
	resolveImageQuality,
} from "../lib/image-generators";

describe("image generator catalog", () => {
	it("preserves Gemini resolution selections and quality aliases through validation", () => {
		const generator = getImageGenerator("gemini")!;
		for (const [candidate, expected] of [["1K", "1K"], ["2K", "2K"], ["4K", "4K"], [" 4k ", "4K"], ["low", "1K"], ["medium", "2K"], ["HIGH", "4K"]]) {
			expect(geminiImageSize(resolveImageQuality(generator, candidate))).toBe(expected);
		}
		expect(resolveImageQuality(generator, "invalid")).toBe("1K");
		expect(resolveImageQuality(getImageGenerator("openai")!, "HIGH")).toBe("high");
		expect(resolveImageQuality(getImageGenerator("openai")!, "4K")).toBe("medium");
	});
	it("exposes the canonical Not Organic image capability alias", () => {
		const generator = getImageGenerator("notorganic");
		expect(generator).toMatchObject({
			id: "notorganic",
			auth: "notorganic-session",
			protocol: "openai-images",
			models: ["image"],
		});
		expect(IMAGE_GENERATORS.map((entry) => entry.id)).toContain("notorganic");
	});

	it("keeps local endpoint normalization independent of hosted generators", () => {
		expect(localImageEndpoint("http://localhost:1234/v1/")).toBe("http://localhost:1234/v1/images/generations");
		expect(resolveImageGeneratorEndpoint({
			generator: getImageGenerator("openai")!,
			model: "gpt-image-1",
			localBaseUrl: "",
		})).toBe("https://api.openai.com/v1/images/generations");
		expect(resolveImageGeneratorEndpoint({
			generator: getImageGenerator("gemini")!,
			model: "gemini-2.5-flash-image",
			localBaseUrl: "",
		})).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent");
		expect(resolveImageGeneratorEndpoint({
			generator: getImageGenerator("local")!,
			model: "local-model",
			localBaseUrl: "http://localhost:1234/v1",
		})).toBe("http://localhost:1234/v1/images/generations");
	});

	it("maps shared image settings onto Gemini's image contract", () => {
		expect(geminiAspectRatio("1536x1024")).toBe("3:2");
		expect(geminiAspectRatio("1024x1536")).toBe("2:3");
		expect(geminiAspectRatio("not-a-size")).toBe("1:1");
		expect(geminiImageSize("low")).toBe("1K");
		expect(geminiImageSize("medium")).toBe("2K");
		expect(geminiImageSize("high")).toBe("4K");
	});
});
