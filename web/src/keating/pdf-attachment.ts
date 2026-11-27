import { attachmentText } from "./attachment-text";

/**
 * Reads an attached PDF on this device: its text for the model, and a small
 * picture of page 1 for the chat. Nothing leaves the device here, and no OCR
 * runs: a scanned PDF with no text layer is refused with a plain message.
 */

/** Long edge of the drawn first page, in CSS pixels at 2x: crisp at 3.25rem, about 10–30 KB as JPEG. */
const PREVIEW_WIDTH = 240;

interface PreviewCanvas {
	width: number;
	height: number;
	getContext(type: "2d"): unknown;
	toDataURL(type: string, quality?: number): string;
}
export type CreatePreviewCanvas = (width: number, height: number) => PreviewCanvas;

const browserCanvas: CreatePreviewCanvas = (width, height) => {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas;
};

interface PdfPage {
	getViewport(options: { scale: number }): { width: number; height: number };
	render(options: Record<string, unknown>): { promise: Promise<unknown> };
}

/** Page 1 as a small JPEG. Optional: a page that will not draw leaves the attachment without a picture. */
async function drawFirstPage(page: PdfPage, createCanvas: CreatePreviewCanvas): Promise<string | undefined> {
	try {
		const base = page.getViewport({ scale: 1 });
		const viewport = page.getViewport({ scale: Math.min(2, PREVIEW_WIDTH / Math.max(1, base.width)) });
		const canvas = createCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)));
		const context = canvas.getContext("2d");
		if (!context) return undefined;
		await page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" }).promise;
		const preview = canvas.toDataURL("image/jpeg", 0.72);
		return preview.startsWith("data:image/jpeg;base64,") ? preview : undefined;
	} catch {
		return undefined;
	}
}

export async function readPdfAttachment(file: Blob & { name: string }, options: { createCanvas?: CreatePreviewCanvas } = {}): Promise<{ text: string; preview?: string }> {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	pdfjs.GlobalWorkerOptions.workerSrc ||= new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
	const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });

	let extractedText = `<pdf filename="${file.name}">`;
	let hasReadableText = false;
	let preview: string | undefined;
	try {
		const pdf = await loadingTask.promise;
		for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
			const page = await pdf.getPage(pageNumber);
			if (pageNumber === 1) preview = await drawFirstPage(page as unknown as PdfPage, options.createCanvas ?? browserCanvas);
			const textContent = await page.getTextContent();
			const pageText = textContent.items
				.map((item: unknown) => (item && typeof item === "object" && "str" in item ? String((item as { str: unknown }).str) : ""))
				.filter((text: string) => text.trim())
				.join(" ");
			if (pageText.trim()) hasReadableText = true;
			extractedText += `\n<page number="${pageNumber}">\n${pageText}\n</page>`;
			page.cleanup();
		}
	} finally {
		await loadingTask.destroy();
	}
	extractedText += "\n</pdf>";

	if (!hasReadableText) {
		throw new Error(`${file.name} did not contain readable PDF text. Scanned PDFs need OCR before attaching.`);
	}
	return { text: attachmentText(file.name, "application/pdf", extractedText), preview };
}
