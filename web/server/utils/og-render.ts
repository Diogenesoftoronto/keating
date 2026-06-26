// Renders a per-share OpenGraph card to PNG. satori converts the layout (and
// its text) into vector paths using the bundled Inter font; resvg-wasm then
// rasterizes those paths to PNG (this resvg build has no font support of its
// own, which is fine because satori has already emitted glyph paths). Both the
// font and the wasm binary ship as server assets (web/server/assets/**).
// Callers MUST fall back to the static /og-image.png if this throws.
import { useStorage } from "nitro/storage";

let wasmReady: Promise<void> | null = null;
let fontBuffer: Uint8Array | null = null;

async function readAsset(key: string): Promise<Uint8Array> {
	const raw = (await useStorage("assets:server").getItemRaw(key)) as
		| ArrayBuffer
		| Uint8Array
		| null;
	if (!raw) throw new Error(`Missing server asset: ${key}`);
	return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
}

async function ensureWasm(): Promise<void> {
	if (!wasmReady) {
		wasmReady = (async () => {
			const { initWasm } = await import("@resvg/resvg-wasm");
			// Named .bin (not .wasm) so Nitro's wasm plugin doesn't transform it
			// into a JS wrapper before serverAssets bundling.
			await initWasm(await readAsset("resvg-wasm.bin"));
		})();
	}
	return wasmReady;
}

async function getFont(): Promise<Uint8Array> {
	if (!fontBuffer) fontBuffer = await readAsset("fonts/Inter-SemiBold.ttf");
	return fontBuffer;
}

// Minimal h()-style node builder for satori (accepts {type, props} trees).
function node(type: string, style: Record<string, unknown>, children?: unknown) {
	return { type, props: { style, ...(children !== undefined ? { children } : {}) } };
}

function buildTree(title: string, subtitle: string) {
	return node(
		"div",
		{
			width: "1200px",
			height: "630px",
			display: "flex",
			flexDirection: "column",
			justifyContent: "space-between",
			backgroundColor: "#0c0e10",
			padding: "72px 80px",
			borderTop: "8px solid #d4a373",
			fontFamily: "Inter",
		},
		[
			node("div", { display: "flex", flexDirection: "column" }, [
				node("div", { color: "#d4a373", fontSize: "30px", fontWeight: 700 }, "Keating"),
				node(
					"div",
					{ color: "#6b7178", fontSize: "22px", marginTop: "6px" },
					"The Hyperteacher · Shared session",
				),
			]),
			node(
				"div",
				{ color: "#f1ece0", fontSize: "60px", fontWeight: 700, lineHeight: 1.1, display: "flex" },
				title || "Shared Keating session",
			),
			node("div", { display: "flex", flexDirection: "column" }, [
				node(
					"div",
					{ color: "#9aa0a6", fontSize: "28px", lineHeight: 1.3, display: "flex" },
					subtitle || "A Socratic tutoring session.",
				),
				node("div", { color: "#6b7178", fontSize: "22px", marginTop: "16px" }, "keating.help"),
			]),
		],
	);
}

/** Render the per-share OG card to a PNG. Throws on any failure. */
export async function renderShareOgPng(title: string, subtitle: string): Promise<Uint8Array> {
	const [{ default: satori }, font] = await Promise.all([import("satori"), getFont(), ensureWasm()]);
	const svg = await satori(buildTree(title, subtitle) as any, {
		width: 1200,
		height: 630,
		fonts: [{ name: "Inter", data: Buffer.from(font), weight: 600, style: "normal" }],
	});
	const { Resvg } = await import("@resvg/resvg-wasm");
	const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
	return resvg.render().asPng();
}
