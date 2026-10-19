import { describe, expect, test } from "bun:test";
import { isNearBottom, shouldFollowContent, shouldShowLatest } from "../src/lib/chat-scroll";

describe("chat scroll", () => {
  test("near bottom within threshold", () => {
    expect(isNearBottom({ contentHeight: 1000, viewportHeight: 500, offsetY: 430 })).toBe(true);
    expect(isNearBottom({ contentHeight: 1000, viewportHeight: 500, offsetY: 500 })).toBe(true);
  });
  test("not near bottom when scrolled up", () => {
    expect(isNearBottom({ contentHeight: 1000, viewportHeight: 500, offsetY: 200 })).toBe(false);
  });
  test("short content counts as near bottom", () => {
    expect(isNearBottom({ contentHeight: 200, viewportHeight: 500, offsetY: 0 })).toBe(true);
  });
  test("follow and Latest button decisions", () => {
    expect(shouldFollowContent(true)).toBe(true);
    expect(shouldFollowContent(false)).toBe(false);
    expect(shouldShowLatest(false, true)).toBe(true);
    expect(shouldShowLatest(true, true)).toBe(false);
    expect(shouldShowLatest(false, false)).toBe(false);
  });
});
