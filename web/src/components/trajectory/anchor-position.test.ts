import { describe, expect, test } from "bun:test";
import { placeAgainstAnchor, toHostBox } from "./anchor-position";

const HOST = { width: 1000, height: 600 };
const SURFACE = { width: 320, height: 160 };

describe("placeAgainstAnchor", () => {
	test("centres horizontally on the anchor", () => {
		const placement = placeAgainstAnchor({ left: 400, top: 200, width: 100, height: 20 }, SURFACE, HOST);
		expect(placement.left).toBe(450 - 160);
	});

	test("clamps to the left edge rather than escaping the host", () => {
		const placement = placeAgainstAnchor({ left: 4, top: 200, width: 40, height: 20 }, SURFACE, HOST);
		expect(placement.left).toBe(8);
	});

	test("clamps to the right edge", () => {
		const placement = placeAgainstAnchor({ left: 960, top: 200, width: 40, height: 20 }, SURFACE, HOST);
		expect(placement.left).toBe(HOST.width - SURFACE.width - 8);
	});

	test("honours the preferred side when it fits", () => {
		const placement = placeAgainstAnchor({ left: 400, top: 300, width: 100, height: 20 }, SURFACE, HOST, {
			preferred: "above",
		});
		expect(placement.side).toBe("above");
		expect(placement.top).toBe(300 - 160 - 8);
	});

	test("flips below when there is no room above", () => {
		const placement = placeAgainstAnchor({ left: 400, top: 10, width: 100, height: 20 }, SURFACE, HOST, {
			preferred: "above",
		});
		expect(placement.side).toBe("below");
		expect(placement.top).toBe(38);
	});

	test("flips above when there is no room below", () => {
		const placement = placeAgainstAnchor({ left: 400, top: 560, width: 100, height: 20 }, SURFACE, HOST, {
			preferred: "below",
		});
		expect(placement.side).toBe("above");
	});

	test("pins inside the host when the surface is taller than the host", () => {
		const tall = { width: 320, height: 900 };
		const placement = placeAgainstAnchor({ left: 400, top: 300, width: 100, height: 20 }, tall, HOST);
		expect(placement.top).toBe(8);
	});
});

describe("toHostBox", () => {
	test("rebases a viewport rect onto the host", () => {
		const box = toHostBox({ left: 120, top: 240, width: 80, height: 18 }, { left: 100, top: 200 });
		expect(box).toEqual({ left: 20, top: 40, width: 80, height: 18 });
	});
});
