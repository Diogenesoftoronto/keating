import { describe, expect, test } from "bun:test";
import {
	REDACTED,
	combineContentTrust,
	containsLikelySecret,
	redactSecrets,
} from "../../keating/security";

describe("security redaction and provenance", () => {
	test("redacts sensitive keys recursively without mutating input", () => {
		const input = { headers: { authorization: "Bearer abcdefghijklmnop" }, nested: ["safe"] };
		const result = redactSecrets(input) as typeof input;
		expect(result.headers.authorization).toBe(REDACTED);
		expect(input.headers.authorization).toBe("Bearer abcdefghijklmnop");
	});

	test("redacts known secret shapes embedded in text", () => {
		expect(redactSecrets("key sk-abcdefghijklmnop leaked")).toBe(`key ${REDACTED} leaked`);
		expect(containsLikelySecret("Bearer abcdefghijklmnop")).toBe(true);
	});

	test("marks combined trusted and web provenance as mixed", () => {
		expect(combineContentTrust(["trusted", "untrusted-web"])).toBe("mixed");
	});
});
