import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const WEB_ROOT = resolve(import.meta.dir, "..");

async function pngDimensions(path: string): Promise<[number, number]> {
	const bytes = await readFile(resolve(WEB_ROOT, path));
	expect(bytes.subarray(0, 8)).toEqual(
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	);
	return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe("PWA identity assets", () => {
	test("manifest uses real PNG artwork at declared sizes", async () => {
		const config = await readFile(resolve(WEB_ROOT, "vite.config.ts"), "utf8");
		expect(config).toContain('src: "pwa-lockup-192x192.png"');
		expect(config).toContain('src: "pwa-lockup-512x512.png"');
		expect(config).toContain('src: "pwa-lockup-maskable-512x512.png"');
		expect(config).toContain('purpose: "maskable"');
		expect(config).not.toContain('src: "pwa-192x192.svg"');

		expect(await pngDimensions("public/pwa-lockup-192x192.png")).toEqual([192, 192]);
		expect(await pngDimensions("public/pwa-lockup-512x512.png")).toEqual([512, 512]);
		expect(await pngDimensions("public/pwa-lockup-maskable-512x512.png")).toEqual([
			512,
			512,
		]);
	});

	test("Apple touch identity has its own correctly sized asset", async () => {
		const html = await readFile(resolve(WEB_ROOT, "index.html"), "utf8");
		expect(html).toContain(
			'<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-lockup.png">',
		);
		expect(await pngDimensions("public/apple-touch-icon-lockup.png")).toEqual([
			180,
			180,
		]);
	});

	test("favicon uses the canonical lockup derivative", async () => {
		const html = await readFile(resolve(WEB_ROOT, "index.html"), "utf8");
		expect(html).toContain(
			'<link rel="icon" href="/favicon-lockup.png" type="image/png" sizes="64x64">',
		);
		expect(await pngDimensions("public/favicon-lockup.png")).toEqual([64, 64]);
	});
});
