// Tag payloads are JSON string literals (double-stringified by the emitting
// tools) and may contain literal ">" characters — e.g. HTML/JS source in an
// animation body — so match a complete quoted string first and only fall back
// to the legacy "anything up to >" form for old unquoted payloads.
const TAG_PAYLOAD = String.raw`("(?:[^"\\]|\\.)*"|[^>]+)`;
export const quizTagPattern = new RegExp(
  String.raw`<keating-quiz\s+json=${TAG_PAYLOAD}\s*\/>`,
  "g",
);
export const questionTagPattern = new RegExp(
  String.raw`<keating-question\s+json=${TAG_PAYLOAD}\s*\/>`,
  "g",
);
export const goalTagPattern = new RegExp(
  String.raw`<keating-goal\s+json=${TAG_PAYLOAD}\s*\/>`,
  "g",
);
export const generatedImageTagPattern = new RegExp(
  String.raw`<keating-image\s+json=${TAG_PAYLOAD}\s*\/>`,
  "g",
);
const interactiveTagPattern = new RegExp(
  String.raw`<keating-(quiz|scene|question|goal|image|quiz-result|quiz-grade|animation|deck)\s+(json|markdown)=${TAG_PAYLOAD}\s*\/>`,
  "g",
);
export function parseInteractiveSegments(
  text: string,
): Array<
  | { type: "text"; content: string }
  | { type: "quiz"; json: string }
  | { type: "scene"; markdown: string }
  | { type: "question"; json: string }
  | { type: "goal"; json: string }
  | { type: "image"; json: string }
  | { type: "quiz-result"; json: string }
  | { type: "quiz-grade"; json: string }
  | { type: "animation"; json: string }
  | { type: "deck"; json: string }
> {
  const segments: ReturnType<typeof parseInteractiveSegments> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(interactiveTagPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, index) });
    }

    const tag = match[1];
    const payload = match[3];
    if (tag === "quiz") segments.push({ type: "quiz", json: payload });
    if (tag === "quiz-result")
      segments.push({ type: "quiz-result", json: payload });
    if (tag === "quiz-grade")
      segments.push({ type: "quiz-grade", json: payload });
    if (tag === "scene") {
      let markdown = payload;
      try {
        markdown = JSON.parse(payload);
      } catch {
        // Older tags may already carry raw markdown.
      }
      segments.push({ type: "scene", markdown });
    }
    if (tag === "question") segments.push({ type: "question", json: payload });
    if (tag === "goal") segments.push({ type: "goal", json: payload });
    if (tag === "image") segments.push({ type: "image", json: payload });
    if (tag === "animation")
      segments.push({ type: "animation", json: payload });
    if (tag === "deck") segments.push({ type: "deck", json: payload });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  if (segments.length === 0) segments.push({ type: "text", content: text });
  return segments;
}
