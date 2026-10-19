import { expect, test } from "bun:test";
import { parseReviewNotice, stripReviewNotice, withReviewNotice } from "../keating/judgement/review-notice";

test("review notices round-trip and strip only a leading marker", () => {
  const tagged = withReviewNotice("unverified", "Body\n\nMore");
  expect(parseReviewNotice(tagged)).toEqual({ kind: "unverified", text: "Body\n\nMore" });
  expect(parseReviewNotice(withReviewNotice("withheld", "Why"))?.kind).toBe("withheld");
  expect(stripReviewNotice(tagged)).toBe("Body\n\nMore");
  expect(parseReviewNotice("Body <!--keating:review=withheld-->")).toBeNull();
  expect(stripReviewNotice("plain")).toBe("plain");
});
