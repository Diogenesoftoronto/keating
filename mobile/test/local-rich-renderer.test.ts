import { describe, expect, test } from "bun:test";
import {
  MAX_MATH_SOURCE_LENGTH,
  createInitialDocumentNavigationGuard,
  validateLocalMathSource,
} from "../src/lib/local-rich-renderer";

describe("local rich-renderer safety", () => {
  test("accepts bounded KaTeX while rejecting active and excessive input", () => {
    expect(validateLocalMathSource(String.raw`p(\theta \mid x) = \frac{p(x \mid \theta)p(\theta)}{p(x)}`)).toMatchObject({ ok: true, kind: "math" });
    for (const source of [
      String.raw`\href{https://example.com}{leave}`,
      String.raw`\htmlStyle{background:url(https://example.com)}{x}`,
      String.raw`\newcommand{\x}{y}\x`,
      "x<script>alert(1)</script>",
      "x\u0000y",
      "x".repeat(MAX_MATH_SOURCE_LENGTH + 1),
    ]) expect(validateLocalMathSource(source).ok).toBe(false);
  });

  test("allows only the initial DOM document and its hash/reload", () => {
    const guard = createInitialDocumentNavigationGuard();
    expect(guard({ url: "file:///android_asset/www.bundle/math.html" })).toBe(true);
    expect(guard({ url: "file:///android_asset/www.bundle/math.html#formula" })).toBe(true);
    expect(guard({ url: "https://example.com/" })).toBe(false);
    expect(guard({ url: "javascript:alert(1)" })).toBe(false);
  });
});
