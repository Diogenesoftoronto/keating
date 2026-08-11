import { describe, expect, test } from "bun:test";
import { normalizeComposerDraft } from "../src/lib/composer-draft-storage";

describe("mobile composer draft validation", () => {
  test("keeps bounded text and URI-only attachment metadata", () => {
    const draft = normalizeComposerDraft({
      text: "Compare these",
      attachments: [{
        id: "attachment-1",
        kind: "image",
        name: "diagram.png",
        mimeType: "image/png",
        size: 42,
        uri: "file:///documents/diagram.png",
        data: "must be dropped",
        encoding: "base64",
      }],
    });
    expect(draft.text).toBe("Compare these");
    expect(draft.attachments).toEqual([{
      id: "attachment-1",
      kind: "image",
      name: "diagram.png",
      mimeType: "image/png",
      size: 42,
      uri: "file:///documents/diagram.png",
    }]);
  });

  test("drops temporary and malformed attachment references", () => {
    expect(normalizeComposerDraft({
      text: 12,
      attachments: [{ id: "bad", kind: "document", name: "x", mimeType: "text/plain", size: 1, uri: "content://picker/x" }],
    })).toEqual({ text: "", attachments: [] });
  });
});
