/**
 * Tags a published tutor turn that did not pass the full draft review so the
 * chat can render it distinctly. The marker is an HTML comment, so a renderer
 * that does not understand it still hides it; model input strips it.
 */
export type ReviewNoticeKind = "unverified" | "withheld";

const MARKER = /^<!--keating:review=(unverified|withheld)-->\n?/;

export function withReviewNotice(kind: ReviewNoticeKind, text: string): string {
  return `<!--keating:review=${kind}-->\n${text}`;
}

export function parseReviewNotice(text: string): { kind: ReviewNoticeKind; text: string } | null {
  const match = MARKER.exec(text);
  return match ? { kind: match[1] as ReviewNoticeKind, text: text.slice(match[0].length) } : null;
}

export function stripReviewNotice(text: string): string {
  return text.replace(MARKER, "");
}
