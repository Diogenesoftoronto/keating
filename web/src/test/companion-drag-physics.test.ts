import { expect, test } from "bun:test";
import { crossesSide, gripProbes, releasingAway, touchesEdge } from "../components/companion/surface-contact";
import { crossesLedge, dragVelocity, heldMotion, releaseVelocity } from "../components/companion/drag-physics";

test("held motion accelerates the sprite and leans through a reversal", () => {
	const still = { x: 0, y: 0 };
	const left = dragVelocity(still, { x: -60, y: 12 }, 20);
	const first = heldMotion(0, 0, left, 0.05);
	const slow = heldMotion(0, 0, { x: -140, y: 0 }, 0.05);
	expect(first.angle).toBeLessThan(0);
	expect(first.phase).toBeGreaterThan(slow.phase);
	expect(first.stretch).toBeLessThan(1);

	const right = dragVelocity(left, { x: 120, y: -20 }, 30);
	const reversed = heldMotion(first.angle, first.phase, right, 0.1);
	expect(reversed.angle).toBeGreaterThan(0);
	expect(reversed.stretch).toBeGreaterThan(1);
});

test("holding still settles on the hanging frame and sheds throw momentum", () => {
	const held = releaseVelocity({ x: 1100, y: -950 }, 320);
	expect(Math.hypot(held.x, held.y)).toBeLessThan(4);
	let pose = heldMotion(25, 3, held, 1 / 60);
	for (let i = 0; i < 60; i++) pose = heldMotion(pose.angle, pose.phase, held, 1 / 60);
	expect(pose.settled).toBe(true);
	expect(pose.frame).toBe(0);
});

test("flight lands on the first supported ledge at the instant the feet cross it", () => {
	const highest = { top: 105, left: 70, right: 104 };
	const lower = { top: 130, left: 0, right: 180 };
	const from = { x: 40, y: 0 }, to = { x: 130, y: 50 };
	expect(crossesLedge([lower, highest], from, to, 100)).toEqual({ edge: highest, x: 49 });
	expect(crossesLedge([highest], to, from, 100)).toBeUndefined();
	expect(crossesLedge([highest], { x: 0, y: 0 }, { x: 0, y: 50 }, 80)).toBeUndefined();
});

test("a hand, a foot and an overhead grip only catch their corresponding nearby edge", () => {
	const box = { left: 250, right: 750, top: 200, bottom: 600 };
	const grips = (x: number, y: number) => gripProbes({ x, y }, 100)
		.filter(site => touchesEdge(site, box)).map(site => site.grip);
	expect(grips(400, 104)).toEqual(["top"]);
	expect(grips(167, 330)).toEqual(["left"]);
	expect(grips(733, 330)).toEqual(["right"]);
	expect(grips(400, 585)).toEqual(["underside"]);
	expect(grips(400, 330)).toEqual([]);
	expect(grips(143, 330)).toEqual([]);
	expect(grips(167, 625)).toEqual([]);
});

test("a flick away from a grip releases, and an approaching hand encounters the nearer wall first", () => {
	expect(releasingAway("left", { x: -400, y: 0 })).toBe(true);
	expect(releasingAway("right", { x: -400, y: 0 })).toBe(false);
	const near = { left: 100, right: 250, top: 80, bottom: 190 };
	const far = { ...near, left: 140 };
	const contact = crossesSide([far, near], { x: 0, y: 60 }, { x: 100, y: 70 }, 100);
	expect(contact?.face).toBe(near);
	expect(contact?.x).toBe(17);
	expect(crossesSide([near], { x: 0, y: 0 }, { x: 100, y: 0 }, 100)).toBeUndefined();
});
