import { describe, expect, test } from "bun:test";

import {
	MAX_LIVE_IMAGE_BYTES,
	validateLiveImageFile,
} from "../keating/live-image";

describe("live still-image input", () => {
	test("accepts the two image formats sent through Realtime", () => {
		for (const type of ["image/jpeg", "image/png"]) {
			expect(validateLiveImageFile({ name: "work.png", size: 1024, type })).toBeNull();
		}
	});

	test("rejects empty, oversized, and unsupported images before browser decoding", () => {
		expect(validateLiveImageFile({ name: "empty.png", size: 0, type: "image/png" })).toContain("empty");
		expect(validateLiveImageFile({ name: "huge.jpg", size: MAX_LIVE_IMAGE_BYTES + 1, type: "image/jpeg" }))
			.toContain("20 MB");
		expect(validateLiveImageFile({ name: "work.webp", size: 1024, type: "image/webp" })).toContain("JPEG or PNG");
	});
});
