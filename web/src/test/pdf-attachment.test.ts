import { expect, test } from "bun:test";
import { createCanvas, DOMMatrix as NodeDOMMatrix, Path2D as NodePath2D } from "@napi-rs/canvas";
import { readPdfAttachment, type CreatePreviewCanvas } from "../keating/pdf-attachment";
import { attachmentSegments } from "../keating/attachment-text";

/** A real two-page PDF with a text layer, built byte by byte so offsets are exact. */
function tinyPdf(pages: string[]): Uint8Array<ArrayBuffer> {
	const objects: string[] = [];
	const add = (body: string) => { objects.push(body); return objects.length; };
	const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
	const pagesId = objects.length + 1 + pages.length * 2;
	const kids: number[] = [];
	for (const text of pages) {
		const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
		const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
		kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
	}
	add(`<< /Type /Pages /Kids [${kids.map(id => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`);
	const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, index) => { offsets.push(out.length); out += `${index + 1} 0 obj\n${body}\nendobj\n`; });
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(out) as Uint8Array<ArrayBuffer>;
}

const nodeCanvas: CreatePreviewCanvas = (width, height) => createCanvas(width, height) as never;

test("an attached PDF gives the model its text and the chat a picture of page 1", async () => {
	// pdf.js draws with the global Path2D and DOMMatrix, and schedules drawing with
	// window.requestAnimationFrame whenever a `window` exists. Other suites leave DOM
	// stand-ins for all three, so this case runs against Node's canvas with no window.
	const scope = globalThis as Record<string, unknown>;
	const names = ["Path2D", "DOMMatrix", "window"] as const;
	const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(scope, name)] as const);
	for (const name of names) Object.defineProperty(scope, name, { configurable: true, writable: true,
		value: name === "Path2D" ? NodePath2D : name === "DOMMatrix" ? NodeDOMMatrix : undefined });
	try { await firstPageCase(); }
	finally { for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(scope, name, descriptor) : delete scope[name]; }
}, 30_000);

async function firstPageCase() {
	const file = Object.assign(new Blob([tinyPdf(["Concept Proposal: Keating", "Second page"])], { type: "application/pdf" }), { name: "draft.pdf" });
	const { text, preview } = await readPdfAttachment(file, { createCanvas: nodeCanvas });
	expect(text).toContain("Concept Proposal: Keating");
	expect(text).toContain('<page number="2">');
	expect(attachmentSegments(text)).toEqual([{ type: "attachment", file: { name: "draft.pdf", type: "application/pdf", kind: "PDF", pages: 2 } }]);
	expect(preview?.startsWith("data:image/jpeg;base64,")).toBe(true);
	// Small enough to save with the chat.
	expect(preview!.length).toBeLessThan(80_000);
}

test("a page that cannot be drawn still attaches the text", async () => {
	const file = Object.assign(new Blob([tinyPdf(["Only text"])], { type: "application/pdf" }), { name: "plain.pdf" });
	const broken: CreatePreviewCanvas = () => { throw new Error("no canvas here"); };
	const { text, preview } = await readPdfAttachment(file, { createCanvas: broken });
	expect(text).toContain("Only text");
	expect(preview).toBeUndefined();
}, 30_000);
