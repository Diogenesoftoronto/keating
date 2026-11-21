import { expect, test } from "bun:test";
import { flightTouchGestures } from "../components/recess/engine/touch-gestures.js";

test("holding still focuses, stays focused while weaving, and releases immediately", () => {
  const gestures = flightTouchGestures();
  gestures.down(1, 90, 120, 0, true);
  gestures.move(1, 94, 126, 72);
  expect(gestures.isFocused(329)).toBe(false);
  expect(gestures.isFocused(330)).toBe(true);
  gestures.move(1, 169, 228, 440);
  expect(gestures.isFocused(840)).toBe(true);
  expect(gestures.up(1, 169, 228, 850, true)).toBe(false);
  expect(gestures.isFocused(1000)).toBe(false);
  // A touchmove can arrive before the next rendered frame marks the hold.
  gestures.down(1, 80, 130, 1100, true);
  gestures.move(1, 112, 165, 1460);
  expect(gestures.isFocused(1470)).toBe(true);
});

test("both overlapping taps must finish before one bomb is requested, in either lift order", () => {
  for (const lifts of [[1, 2], [2, 1]]) {
    const gestures = flightTouchGestures();
    gestures.down(1, 90, 120, 0, true);
    gestures.down(2, 90, 120, 125, true);
    expect(gestures.up(lifts[0], 95, 126, 200, true)).toBe(false);
    expect(gestures.up(lifts[1], 96, 125, 260, true)).toBe(true);
    expect(gestures.up(lifts[1], 96, 125, 261, false)).toBe(false);
  }
});

test("flying, aiming, sequential taps, slow chords and a third contact never spend a bomb", () => {
  const gestures = flightTouchGestures();
  const cases = [
    () => { gestures.move(1, 91, 136, 40); gestures.down(2, 150, 80, 60, true); },
    () => { gestures.down(2, 150, 80, 60, true); gestures.move(2, 161, 80, 85); },
    () => { gestures.up(1, 90, 120, 30, true); gestures.down(2, 150, 80, 60, true); },
    () => { gestures.down(2, 150, 80, 145, true); },
    () => { gestures.down(2, 150, 80, 60, true); gestures.up(1, 90, 120, 100, true); gestures.down(3, 50, 50, 120, true); gestures.up(3, 50, 50, 140, true); },
    () => { gestures.down(2, 150, 80, 60, true); gestures.down(3, 50, 50, 80, true); gestures.up(3, 50, 50, 120, true); },
  ];
  for (const sample of cases) {
    gestures.down(1, 90, 120, 0, true);
    sample();
    expect(gestures.up(1, 90, 120, 160, true)).toBe(false);
    expect(gestures.up(2, 150, 80, 180, true)).toBe(false);
    gestures.reset();
  }
  gestures.down(1, 90, 120, 0, true);
  gestures.down(2, 150, 80, 60, true);
  gestures.up(1, 90, 120, 230, true);
  expect(gestures.up(2, 150, 80, 261, true)).toBe(false);
  gestures.down(1, 90, 120, 300, true);
  expect(gestures.isFocused(680)).toBe(true);
  gestures.down(2, 150, 80, 720, true);
  expect(gestures.isFocused(730)).toBe(false);
  gestures.up(1, 90, 120, 735, true);
  expect(gestures.up(2, 150, 80, 750, true)).toBe(false);
});

test("cancelling, pausing, starting over UI, or losing capture discards a pending gesture", () => {
  const gestures = flightTouchGestures();
  for (const interrupt of [
    () => gestures.cancel(), () => gestures.reset(), () => gestures.up(1, 50, 50, 80, false),
  ]) {
    gestures.down(1, 50, 50, 20, true);
    gestures.down(2, 80, 80, 65, true);
    interrupt();
    expect(gestures.up(1, 50, 50, 100, true)).toBe(false);
    expect(gestures.up(2, 80, 80, 110, true)).toBe(false);
  }
  gestures.down(1, 50, 50, 200, false);
  expect(gestures.isFocused(650)).toBe(false);
  gestures.reset();
  gestures.down(1, 30, 30, 1000, true);
  gestures.move(1, 44, 30, 1060);
  expect(gestures.isFocused(1400)).toBe(false);
});
