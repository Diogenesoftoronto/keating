import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import config from "../../nitro.config";

describe("share page shell", () => {
	// Production runs `.output-app/server/index.mjs` from /app, so cwd-relative
	// shell paths miss and /s/:id used to answer an empty 200.
	it("bundles the built shell as a server asset instead of reading it from cwd", () => {
		expect(config.serverAssets).toContainEqual({ baseName: "keating-shell", dir: "dist", pattern: "index.html" });
	});

	it("fails loudly rather than returning an empty page when the shell is missing", async () => {
		const source = await readFile(new URL("../../server/routes/s/[...path].ts", import.meta.url), "utf8");
		expect(source).toContain('useStorage("assets:keating-shell")');
		expect(source).toContain("statusCode: 503");
		expect(source).not.toMatch(/if \(!shell\) return;/);
	});
});
