import { expect, test } from "bun:test";
import { createJuliaEncoder } from "../../shared/julia/encoder";

// This tiny BPE has a double-space merge. Rust Metaspace splitting prevents
// that merge across word boundaries; the unadapted JS tokenizer incorrectly uses it.
const encoder = createJuliaEncoder({
  decoder: null, post_processor: null,
  added_tokens: [], normalizer: { type: "Replace", pattern: { String: " " }, content: "▁" },
  pre_tokenizer: { type: "Metaspace", replacement: "▁", prepend_scheme: "always", split: true },
  model: { type: "BPE", unk_token: "<unk>", fuse_unk: true, byte_fallback: false,
    vocab: { "<unk>": 0, "<eos>": 1, "<bos>": 2, x: 3, "<mask>": 4, "▁": 5, "▁▁": 6, a: 7 }, merges: [["▁", "▁"]] },
}, { bos_token: "<bos>", eos_token: "<eos>", mask_token: "<mask>", pad_token: "<unk>" });
const request = { state: "  a  ", question: "x", type: "choice" as const, options: ["a", "x"] };

test("Julia preserves leading, repeated and trailing whitespace using official Metaspace boundaries", () => {
  expect(encoder.encode(request).ids.slice(-6, -1)).toEqual([5, 5, 7, 5, 5]);
});
test("Julia rejects reserved markers, invalid Unicode and over-budget evidence instead of dropping it", () => {
  expect(() => encoder.encode({ ...request, state: "work <mask> prompt" })).toThrow();
  expect(() => encoder.encode({ ...request, state: "\ud800" })).toThrow();
  expect(() => encoder.encode({ ...request, state: "a ".repeat(1000) })).toThrow("lossless context");
});
test("Julia retains strict option and integer context boundaries", () => {
  expect(() => encoder.encode({ ...request, options: ["a"] })).toThrow();
  expect(() => encoder.encode({ ...request, options: ["a ".repeat(100), "x"] })).toThrow("48-token");
  expect(() => encoder.encode(request, { maxLength: 1024.5, headLength: 256 })).toThrow();
});
