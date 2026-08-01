import { describe, expect, test } from "bun:test";
import {
	createAnimationArgAccumulator,
	extractPartialJsonString,
} from "../keating/tool-arg-stream";

describe("extractPartialJsonString", () => {
	test("returns null before the field appears", () => {
		expect(extractPartialJsonString('{"topic":"Ent', "body")).toBeNull();
	});

	test("reads a complete value", () => {
		expect(extractPartialJsonString('{"body":"<h1>Hi</h1>","kind":"hyperframes"}', "body")).toBe(
			"<h1>Hi</h1>",
		);
	});

	test("reads a value that is still being written", () => {
		expect(extractPartialJsonString('{"topic":"Entropy","body":"<!doctype html><h1>Ent', "body")).toBe(
			"<!doctype html><h1>Ent",
		);
	});

	test("decodes escapes inside the partial value", () => {
		expect(extractPartialJsonString('{"body":"line\\nnext \\"quoted\\" a\\\\b', "body")).toBe(
			'line\nnext "quoted" a\\b',
		);
	});

	test("drops a trailing incomplete escape rather than mis-decoding it", () => {
		expect(extractPartialJsonString('{"body":"safe\\', "body")).toBe("safe");
		expect(extractPartialJsonString('{"body":"safe\\u00', "body")).toBe("safe");
	});

	test("decodes complete unicode escapes", () => {
		expect(extractPartialJsonString('{"body":"a\\u0041b"', "body")).toBe("aAb");
	});

	test("tolerates whitespace around the colon", () => {
		expect(extractPartialJsonString('{"body"  :   "x"', "body")).toBe("x");
	});

	test("does not confuse a different field", () => {
		expect(extractPartialJsonString('{"summary":"nope","body":"yes"}', "body")).toBe("yes");
	});
});

describe("createAnimationArgAccumulator", () => {
	test("reports HTML once it grows past the threshold", () => {
		const acc = createAnimationArgAccumulator(10);
		acc.start(0, "animate");
		expect(acc.delta(0, '{"topic":"Entropy","body":"<h1>')).toBeNull();
		const html = acc.delta(0, "0123456789abcdef");
		expect(html).toBe("<h1>0123456789abcdef");
	});

	test("ignores tool calls that are not animate", () => {
		const acc = createAnimationArgAccumulator(1);
		acc.start(0, "generate_image");
		expect(acc.delta(0, '{"body":"0123456789"')).toBeNull();
	});

	test("keeps concurrent tool calls separate", () => {
		const acc = createAnimationArgAccumulator(5);
		acc.start(0, "animate");
		acc.start(1, "animate");
		acc.delta(0, '{"body":"AAAAAAAAAA');
		const second = acc.delta(1, '{"body":"BBBBBBBBBB');
		expect(second).toBe("BBBBBBBBBB");
	});

	test("exposes the topic as it arrives", () => {
		const acc = createAnimationArgAccumulator(1000);
		acc.start(0, "animate");
		acc.delta(0, '{"topic":"Entropy","body":"<h1>');
		expect(acc.topic(0)).toBe("Entropy");
	});

	test("end() forgets the buffer", () => {
		const acc = createAnimationArgAccumulator(1);
		acc.start(0, "animate");
		acc.delta(0, '{"body":"0123456789');
		acc.end(0);
		expect(acc.topic(0)).toBeUndefined();
	});
});
