import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

const ATLAS_DIR = new URL("../../public/brand/stop-motion-v1/", import.meta.url);
const ALPHA_URN = "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha";
const ONBOARDING = ["greeting", "listening-voice", "importing", "sorting", "settled"];

/** Every `ispe` (image spatial extent) property; colour and alpha items may share one. */
function extents(bytes: Uint8Array): { width: number; height: number }[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const found: { width: number; height: number }[] = [];
	for (let i = 0; i + 16 <= bytes.length; i++) {
		if (bytes[i] === 0x69 && bytes[i + 1] === 0x73 && bytes[i + 2] === 0x70 && bytes[i + 3] === 0x65) {
			found.push({ width: view.getUint32(i + 8), height: view.getUint32(i + 12) });
		}
	}
	return found;
}

describe("Keatingbot sprite atlases", () => {
	test("every installed atlas carries a full-size alpha plane over a 4x2 grid", async () => {
		const names = (await readdir(ATLAS_DIR)).filter(name => name.endsWith(".avif"));
		expect(names.length).toBeGreaterThan(100);
		for (const name of names) {
			const bytes = new Uint8Array(await Bun.file(new URL(name, ATLAS_DIR)).arrayBuffer());
			expect({ name, alpha: new TextDecoder("latin1").decode(bytes).includes(ALPHA_URN) }).toEqual({ name, alpha: true });
			const sizes = extents(bytes);
			expect(sizes.length).toBeGreaterThanOrEqual(1);
			for (const size of sizes) expect({ name, ratio: size.width / size.height }).toEqual({ name, ratio: 2 });
		}
	});

	test("credit-recovery sheets are transparent PNGs, not opaque boxes", async () => {
		for (const name of ["wallet-refresh-v1", "credits-ready-v1", "insufficient-funds-v3"]) {
			const bytes = new Uint8Array(await Bun.file(new URL(`../../public/brand/keatingbot-${name}.png`, import.meta.url)).arrayBuffer());
			// IHDR colour type sits at byte 25; 6 is truecolour with alpha.
			expect({ name, colourType: bytes[25] }).toEqual({ name, colourType: 6 });
		}
	});

	test("the session-start scenes are installed as full-body sheets", async () => {
		for (const state of ONBOARDING) {
			expect(await Bun.file(new URL(`keatingbot-body-${state}.avif`, ATLAS_DIR)).exists()).toBe(true);
		}
	});
});
