import { expect, test } from "bun:test";
import { frameDelay, paperUniforms, renderSize, surfaceUniforms } from "../design-system/shaders/logic";

test("only visible and due surfaces draw, with static and reduced-motion frames driven by invalidation", () => {
  expect(frameDelay(false, true, 30, false, 100)).toBe(Infinity);
  expect(frameDelay(true, false, 0, false, 100)).toBe(Infinity);
  expect(frameDelay(true, false, 30, true, 100)).toBe(Infinity);
  expect(frameDelay(true, true, 0, true, 0)).toBe(0);
  expect(frameDelay(true, false, 30, false, 10)).toBeCloseTo(1000 / 30 - 10);
  expect(frameDelay(true, false, 30, false, 35)).toBe(0);
});

test("render dimensions preserve aspect ratio within the DPR and effect limits", () => {
  expect(renderSize(200, 100, 3, 900)).toEqual({ width: 400, height: 200, scale: 2 });
  expect(renderSize(2400, 1600, 2, 1200)).toEqual({ width: 1200, height: 800, scale: .5 });
});

test("paper repeat, field reveal, and ink strength use the prototype uniforms", () => {
  const frame = { scale: 2, textured: true, now: 0 };
  expect(paperUniforms(frame)).toEqual({ a: [520, .05, .022, .02], b: [1,0,0,0] });
  expect(surfaceUniforms({ effect: "field" }, frame, true, .7, [.1,.2])).toEqual({
    a: [6,.7,600,1], b: [.29,.89,.53,.5], pointer: [.1,.2],
  });
  expect(surfaceUniforms({ effect: "ink", variant: "progress", tint: [1,.5,.2], strength: 2 },
    { ...frame, textured: false }, false, 0, [0,0])).toEqual({ a: [.11,.35,.09,1], b: [0,1,.5,.2] });
});
