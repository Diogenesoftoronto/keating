import assert from "node:assert/strict";
import { it } from "node:test";
import { canonicalInvariantMetadata } from "../src/browser/canonical-error.ts";

it("projects only canonical invariant operation, path and reason through bounded causes", () => {
  const error = { cause: { type: "conversation_record_invariant", meta: { reason: "Tool outcome does not match its assistant tool request.", operation: "append", path: "record.type", recordId: "PRIVATE_ID", record: { text: "PRIVATE_LEARNER" }, prompt: "PRIVATE_PROMPT" } } };
  const projected = canonicalInvariantMetadata(error);
  assert.deepEqual(projected, { operation: "append", path: "record.type", reason: "Tool outcome does not match its assistant tool request." });
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE/);
  assert.equal(canonicalInvariantMetadata({ message: "PRIVATE_USER", meta: { reason: "PRIVATE_TEXT" } }), null);
  assert.equal(canonicalInvariantMetadata({ type: "provider_failed", meta: { reason: "PRIVATE_TEXT" } }), null);
});

it("bounds diagnostic size, refuses non-string values and terminates cause cycles", () => {
  assert.deepEqual(canonicalInvariantMetadata({ type: "conversation_stream_store_failure", meta: { operation: { token: "SECRET" }, path: "x".repeat(200), reason: "a\nb\tc".repeat(200) } }), { path: "x".repeat(160), reason: "a b c".repeat(200).slice(0,512) });
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic;
  assert.equal(canonicalInvariantMetadata(cyclic), null);
});
