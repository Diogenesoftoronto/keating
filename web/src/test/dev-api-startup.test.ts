import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createNitro } from "nitro/builder";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { isApiValidationResponse } from "../../scripts/dev-readiness.mjs";

test("Nitro's resolved development assets mount without collisions", async () => {
	const nitro = await createNitro({ rootDir: fileURLToPath(new URL("../..", import.meta.url)), dev: true });
	const storage = createStorage();
	try {
		// The real option resolver adds Nitro's reserved `server` mount. Loading
		// only nitro.config.ts misses the collision that crashes the dev worker.
		for (const asset of nitro.options.serverAssets) storage.mount(asset.baseName, memoryDriver());
		expect(nitro.options.serverAssets.some((asset) => asset.baseName === "keating-og")).toBe(true);
	} finally {
		await storage.dispose();
		await nitro.close();
	}
});

test("API readiness rejects unavailable workers and frontend HTML", async () => {
	expect(await isApiValidationResponse(Response.json({ error: "Dev server is unavailable." }, { status: 503 }))).toBe(false);
	expect(await isApiValidationResponse(new Response("<!DOCTYPE html>", { status: 200, headers: { "content-type": "text/html" } }))).toBe(false);
	expect(await isApiValidationResponse(new Response("<!DOCTYPE html>", { status: 400, headers: { "content-type": "application/json" } }))).toBe(false);
	expect(await isApiValidationResponse(Response.json(null, { status: 400 }))).toBe(false);
	expect(await isApiValidationResponse(Response.json({ message: "Missing x-target-url header" }, { status: 400 }))).toBe(true);
	expect(await isApiValidationResponse(Response.json({ message: "Method not allowed" }, { status: 405 }), 405)).toBe(true);
});
