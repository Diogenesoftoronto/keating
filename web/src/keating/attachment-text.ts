/**
 * The chat composer turns an attached file into model text wrapped in
 * `<attachment name="…" type="…">…</attachment>` (a PDF also carries
 * `<pdf>`/`<page>` tags). That wrapper is for the model. A reader should see
 * the attachment, not the markup; the saved text stays the raw source.
 */
/** The model text for one attached file; `attachmentMarkdown` reads it back for display. */
export function attachmentText(name: string, type: string, body: string): string {
	return `<attachment name="${name}" type="${type}">\n${body}\n</attachment>`;
}

/**
 * A small picture of an attachment's first page, rendered on this device when
 * the file was attached. It rides on the attachment's text part as
 * `keatingPreview`: saved with the chat, shown in it, never sent to a model
 * (providers read a text part's `text` only).
 */
export const ATTACHMENT_PREVIEW_FIELD = "keatingPreview";

/** Display-only MIME parameter carrying "PDF, 2 pages" from the saved text to the file card. */
export const ATTACHMENT_DETAIL_PARAM = "keating-detail";

export function attachmentCardOf(mimeType: string | undefined): { type: string; detail: string } | null {
	const match = mimeType?.match(new RegExp(`^([^;]*);${ATTACHMENT_DETAIL_PARAM}=([^;]*)$`));
	if (!match) return null;
	try { return { type: match[1], detail: decodeURIComponent(match[2]) }; } catch { return null; }
}

export function attachmentPreviewOf(part: unknown): string | undefined {
	const value = part && typeof part === "object" ? (part as Record<string, unknown>)[ATTACHMENT_PREVIEW_FIELD] : undefined;
	return typeof value === "string" && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value) && value.length <= 400_000 ? value : undefined;
}

const ATTACHMENT_BLOCK =/<attachment name="([^"]*)" type="([^"]*)">[\s\S]*?(?:<\/attachment>|$)/g;

function kindLabel(type: string, name: string): string {
	if (type === "application/pdf" || /\.pdf$/i.test(name)) return "PDF";
	const extension = name.match(/\.([a-z0-9]{1,8})$/i)?.[1];
	return extension ? extension.toUpperCase() : "File";
}

function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_[\]<>#|~]/g, "\\$&");
}

export interface AttachedFile { name: string; type: string; kind: string; pages: number }
export type AttachmentSegment = { type: "text"; text: string } | { type: "attachment"; file: AttachedFile };

/** The learner's own words and each attached file, in order. Text without a wrapper is one text segment. */
export function attachmentSegments(text: string): AttachmentSegment[] {
	if (!text.includes("<attachment name=")) return [{ type: "text", text }];
	const segments: AttachmentSegment[] = [];
	let cursor = 0;
	const pushText = (value: string) => { if (value.trim()) segments.push({ type: "text", text: value.trim() }); };
	for (const match of text.matchAll(ATTACHMENT_BLOCK)) {
		pushText(text.slice(cursor, match.index));
		const [block, name = "", type = ""] = match;
		segments.push({ type: "attachment", file: { name: name || "file", type, kind: kindLabel(type, name), pages: block.match(/<page number="\d+">/g)?.length ?? 0 } });
		cursor = match.index + block.length;
	}
	pushText(text.slice(cursor));
	return segments;
}

/** "PDF, 2 pages", "MD", "File". */
export function attachmentDetail(file: Pick<AttachedFile, "kind" | "pages">): string {
	return file.pages > 0 ? `${file.kind}, ${file.pages} ${file.pages === 1 ? "page" : "pages"}` : file.kind;
}

/** One readable line per attached file, e.g. "Attached **draft.pdf** · PDF, 2 pages". */
export function attachmentMarkdown(text: string): string {
	if (!text.includes("<attachment name=")) return text;
	return attachmentSegments(text)
		.map(segment => segment.type === "text" ? segment.text : `*Attached* **${escapeMarkdown(segment.file.name)}** · ${attachmentDetail(segment.file)}`)
		.join("\n\n");
}
