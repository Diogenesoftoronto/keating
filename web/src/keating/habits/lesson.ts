import { parseInteractiveSegments } from "../../components/interactive-segments";
import { isPrivateForkContextMessage } from "../private-fork-provenance";

/**
 * A picture the learner saw in this chat: one they attached, one the tutor
 * generated, or one the tutor's reply showed. `src` is a data or https URL and
 * stays on the device; model and Jev requests get `id` and `alt` only, through
 * `lessonForPrompt`.
 */
export interface HabitLessonImage { id: string; alt: string; src: string }
export interface HabitLessonTurn { role: "learner" | "tutor"; text: string; images?: readonly HabitLessonImage[] }
export type HabitLesson = readonly HabitLessonTurn[];

const MAX_IMAGES_PER_TURN = 4;
const MAX_IMAGE_URL = 12_000_000;

/** Cheap and stable for the same picture: length plus a sample of its characters, FNV-1a. */
function imageId(src: string): string {
  let hash = 0x811c9dc5;
  const step = Math.max(1, Math.floor(src.length / 4096));
  const mix = (code: number) => { hash ^= code; hash = Math.imul(hash, 0x01000193) >>> 0; };
  for (const char of String(src.length)) mix(char.charCodeAt(0));
  for (let index = 0; index < src.length; index += step) mix(src.charCodeAt(index));
  for (let index = Math.max(0, src.length - 64); index < src.length; index++) mix(src.charCodeAt(index));
  return `img_${hash.toString(16).padStart(8, "0")}`;
}

function usableSrc(src: unknown): src is string {
  if (typeof src !== "string" || src.length > MAX_IMAGE_URL) return false;
  return /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml);base64,/i.test(src) || /^https:\/\/\S+$/i.test(src);
}

const cleanAlt = (alt: unknown, fallback: string) => (typeof alt === "string" ? alt : "").replace(/\s+/g, " ").trim().slice(0, 200) || fallback;

function imageOf(src: unknown, alt: unknown, fallback: string): HabitLessonImage | null {
  return usableSrc(src) ? { id: imageId(src), alt: cleanAlt(alt, fallback), src } : null;
}

/** `![alt](src)` and OpenUI `LearningImage("src", "alt", …)` in a tutor's text. */
function imagesInText(text: string): HabitLessonImage[] {
  const found: HabitLessonImage[] = [];
  for (const match of text.matchAll(/!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const image = imageOf(match[2], match[1], "Picture from the lesson");
    if (image) found.push(image);
  }
  for (const match of text.matchAll(/\bLearningImage\(\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")/g)) {
    try {
      const image = imageOf(JSON.parse(match[1]), JSON.parse(match[2]), "Picture from the lesson");
      if (image) found.push(image);
    } catch { /* not a string literal pair */ }
  }
  return found;
}

/** A generated image comes back as a `<keating-image json=…>` tag in the tool's result. */
function generatedImages(text: string): HabitLessonImage[] {
  return parseInteractiveSegments(text).flatMap(segment => {
    if (segment.type !== "image") return [];
    try {
      const raw = JSON.parse(segment.json) as unknown;
      const payload = (typeof raw === "string" ? JSON.parse(raw) : raw) as { dataUrl?: unknown; alt?: unknown; title?: unknown };
      const image = imageOf(payload.dataUrl, payload.alt || payload.title, "Generated picture");
      return image ? [image] : [];
    } catch { return []; }
  });
}

function partImages(content: unknown): HabitLessonImage[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap(part => {
    if (part?.type !== "image" || typeof part.data !== "string" || typeof part.mimeType !== "string" || !part.mimeType.startsWith("image/")) return [];
    const image = imageOf(`data:${part.mimeType};base64,${part.data}`, part.filename, "Picture the learner attached");
    return image ? [image] : [];
  });
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap(part => part?.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n");
}

/** Inline data URLs would eat the text budget and every model request; the picture is kept in `images`. */
const withoutInlineData = (text: string) => text.replace(/!\[([^\]\n]*)\]\(\s*<?data:image\/[^)\s>]+>?\s*\)/g, (_, alt: string) => `![${alt}](#picture)`);

function unique(images: readonly HabitLessonImage[], limit = MAX_IMAGES_PER_TURN): HabitLessonImage[] {
  const seen = new Set<string>();
  return images.filter(image => !seen.has(image.id) && seen.add(image.id)).slice(0, limit);
}

/** Only completed visible text goes into the game or its optional model request, with the pictures shown beside it. */
export function habitLesson(messages: readonly unknown[]): HabitLesson {
  const lesson: HabitLessonTurn[] = [];
  let remaining = 5200;
  // Walking newest first, a tool's picture belongs to the tutor reply that came after it.
  let pending: HabitLessonImage[] = [];
  for (const message of messages.slice(-18).reverse()) {
    if (!message || typeof message !== "object" || isPrivateForkContextMessage(message)) continue;
    const row = message as Record<string, unknown>;
    if (row.__keatingStreaming || row.stopReason === "error" || row.stopReason === "aborted") continue;
    if (row.role === "toolResult") {
      const images = generatedImages(textOf(row.content));
      if (!images.length) continue;
      const reply = lesson[0];
      if (reply?.role === "tutor") lesson[0] = { ...reply, images: unique([...images, ...(reply.images ?? [])]) };
      else pending = [...images, ...pending];
      continue;
    }
    const role = row.role === "assistant" ? "tutor" : row.role === "user" || row.role === "user-with-attachments" ? "learner" : null;
    if (!role) continue;
    const full = textOf(row.content);
    const text = withoutInlineData(full).trim().slice(0, Math.min(remaining, 1800));
    const images = unique([...(role === "tutor" ? [...pending, ...imagesInText(full)] : []), ...partImages(row.content)]);
    if (role === "tutor") pending = [];
    if (!text && !images.length) continue;
    lesson.unshift(images.length ? { role, text, images } : { role, text });
    remaining -= text.length;
    if (lesson.length === 8 || remaining <= 0) break;
  }
  return lesson;
}

/** The lesson as a model or Jev reads it: each picture by id and description, never its pixels or URL. */
export function lessonForPrompt(lesson: HabitLesson) {
  return lesson.map(turn => turn.images?.length
    ? { role: turn.role, text: turn.text, images: turn.images.map(({ id, alt }) => ({ id, alt })) }
    : { role: turn.role, text: turn.text });
}

export function lessonImages(lesson: HabitLesson): HabitLessonImage[] {
  return unique(lesson.flatMap(turn => turn.images ?? []), 12);
}
