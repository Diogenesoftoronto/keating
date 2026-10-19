import { describe, expect, test } from "bun:test";
import { createStreamBuffer } from "../src/state/stream-buffer";

describe("stream buffer", () => {
  test("flushes only when text or trace changed", () => {
    const buffer = createStreamBuffer();
    const writes: string[] = [];
    const write = (content: string) => { writes.push(content); };
    expect(buffer.flush(() => false, write)).toBe(false);
    buffer.append("he");
    buffer.append("llo");
    expect(buffer.flush(() => false, write)).toBe(true);
    expect(buffer.flush(() => false, write)).toBe(false);
    expect(writes).toEqual(["hello"]);
  });

  test("a dirty trace forces a write even when the text is unchanged", () => {
    const buffer = createStreamBuffer();
    const writes: string[] = [];
    buffer.flush(() => true, (content) => writes.push(content));
    expect(writes).toEqual([""]);
  });

  test("always consults the trace so its dirty flag is cleared", () => {
    const buffer = createStreamBuffer();
    let reads = 0;
    buffer.append("x");
    buffer.flush(() => { reads++; return false; }, () => undefined);
    expect(reads).toBe(1);
  });

  test("separateRound trims trailing space and adds a blank line; set replaces the text", () => {
    const buffer = createStreamBuffer();
    buffer.append("round one  \n");
    buffer.separateRound();
    expect(buffer.pending()).toBe("round one\n\n");
    buffer.set("final");
    expect(buffer.pending()).toBe("final");
  });
});
