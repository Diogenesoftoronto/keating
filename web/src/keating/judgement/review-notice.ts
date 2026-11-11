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

/**
 * The learner-facing reason a reply was withheld: the first paragraph of the
 * stored explanation, without check identifiers or the diagnostic counts line
 * (those remain in the transcript for developer details). Works on messages
 * stored by earlier versions too.
 */
export function withheldSummary(text: string): string {
  const first = text.split(/\n{2,}/).map(part => part.trim()).find(part => part && !/^Failure:/.test(part)) ?? "";
  return first.replace(/\s*Blocking checks:[^.]*\.?/, "").trim();
}
