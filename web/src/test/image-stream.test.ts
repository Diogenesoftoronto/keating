import { describe, expect, test } from "bun:test";
import {
	COMPLETED_IMAGE_EVENT,
	PARTIAL_IMAGE_EVENT,
	createSseParser,
	isEventStream,
	pngDataUrl,
	readImageStream,
} from "../keating/image-stream";

function sse(payload: Record<string, unknown>): string {
	return `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
}

describe("createSseParser", () => {
	test("decodes complete records and ignores the event: line", () => {
		const parse = createSseParser();
		const events = parse(sse({ type: PARTIAL_IMAGE_EVENT, b64_json: "AAA", partial_image_index: 0 }));
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe(PARTIAL_IMAGE_EVENT);
		expect(events[0].b64_json).toBe("AAA");
	});

	test("buffers a record split across chunks", () => {
		const parse = createSseParser();
		const record = sse({ type: PARTIAL_IMAGE_EVENT, b64_json: "SPLIT", partial_image_index: 0 });
		const mid = Math.floor(record.length / 2);
		expect(parse(record.slice(0, mid))).toHaveLength(0);
		const events = parse(record.slice(mid));
		expect(events).toHaveLength(1);
		expect(events[0].b64_json).toBe("SPLIT");
	});

	test("handles CRLF separators and skips [DONE]", () => {
		const parse = createSseParser();
		const record = `data: ${JSON.stringify({ type: COMPLETED_IMAGE_EVENT, b64_json: "Z" })}\r\n\r\ndata: [DONE]\r\n\r\n`;
		const events = parse(record);
		expect(events).toHaveLength(1);
		expect(events[0].b64_json).toBe("Z");
	});
});

describe("readImageStream", () => {
	test("reports each partial and resolves with the completed image", async () => {
		const partials: Array<{ dataUrl: string; index: number }> = [];
		const result = await readImageStream(
			streamOf([
				sse({ type: PARTIAL_IMAGE_EVENT, b64_json: "P0", partial_image_index: 0 }),
				sse({ type: PARTIAL_IMAGE_EVENT, b64_json: "P1", partial_image_index: 1 }),
				sse({ type: COMPLETED_IMAGE_EVENT, b64_json: "FINAL" }),
			]),
			(dataUrl, index) => partials.push({ dataUrl, index }),
		);

		expect(partials.map((p) => p.index)).toEqual([0, 1]);
		expect(partials[0].dataUrl).toBe(pngDataUrl("P0"));
		expect(result.b64).toBe("FINAL");
		expect(result.partialCount).toBe(2);
	});

	test("falls back to the last partial when no completed event arrives", async () => {
		const result = await readImageStream(
			streamOf([sse({ type: PARTIAL_IMAGE_EVENT, b64_json: "LAST", partial_image_index: 0 })]),
		);
		expect(result.b64).toBe("LAST");
	});

	test("surfaces an error event as a thrown error", async () => {
		await expect(
			readImageStream(streamOf([sse({ type: "error", error: { message: "quota exceeded" } })])),
		).rejects.toThrow("quota exceeded");
	});

	test("throws when the stream carries no image data", async () => {
		await expect(readImageStream(streamOf([sse({ type: "image_generation.in_progress" })]))).rejects.toThrow(
			"without image data",
		);
	});
});

describe("isEventStream", () => {
	test("detects the SSE content type and tolerates parameters", () => {
		expect(isEventStream("text/event-stream")).toBe(true);
		expect(isEventStream("text/event-stream; charset=utf-8")).toBe(true);
		expect(isEventStream("application/json")).toBe(false);
		expect(isEventStream(null)).toBe(false);
	});
});
