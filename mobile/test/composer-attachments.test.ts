import { describe, expect, test } from "bun:test";
import {
  attachmentEncoding,
  attachmentMimeType,
  MAX_BINARY_ATTACHMENT_BYTES,
  validateComposerAttachment,
} from "../src/lib/composer-attachment-contract";

describe("mobile composer attachment validation", () => {
  test("recognizes text documents with weak picker MIME metadata", () => {
    expect(attachmentMimeType("lesson.md", "application/octet-stream")).toBe("text/markdown");
    expect(validateComposerAttachment({ name: "lesson.md", type: "", size: 120 }, "document")).toEqual({
      kind: "document",
      mimeType: "text/markdown",
    });
  });

  test("keeps images and PDFs binary and rejects misleading selections", () => {
    expect(attachmentEncoding({ kind: "image", name: "map.png", mimeType: "image/png" })).toBe("base64");
    expect(attachmentEncoding({ kind: "document", name: "paper.pdf", mimeType: "application/pdf" })).toBe("base64");
    expect(() => validateComposerAttachment({ name: "archive.zip", type: "application/zip", size: 20 }, "document")).toThrow(
      "not a readable text or PDF",
    );
    expect(() => validateComposerAttachment({
      name: "huge.png",
      type: "image/png",
      size: MAX_BINARY_ATTACHMENT_BYTES + 1,
    }, "image")).toThrow("too large");
  });
});
