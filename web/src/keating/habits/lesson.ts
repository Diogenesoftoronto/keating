import { isPrivateForkContextMessage } from "../private-fork-provenance";

export type HabitLesson = readonly { role: "learner" | "tutor"; text: string }[];

/** Only completed visible text goes into the game or its optional model request. */
export function habitLesson(messages: readonly unknown[]): HabitLesson {
  const lesson: { role: "learner" | "tutor"; text: string }[] = [];
  let remaining = 5200;
  for (const message of messages.slice(-18).reverse()) {
    if (!message || typeof message !== "object" || isPrivateForkContextMessage(message)) continue;
    const row = message as Record<string, unknown>;
    if (row.__keatingStreaming || row.stopReason === "error" || row.stopReason === "aborted") continue;
    const role = row.role === "assistant" ? "tutor" : row.role === "user" || row.role === "user-with-attachments" ? "learner" : null;
    if (!role) continue;
    const content = row.content;
    const text = (typeof content === "string" ? content : Array.isArray(content)
      ? content.flatMap(part => part?.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n") : "")
      .trim().slice(0, Math.min(remaining, 1800));
    if (!text) continue;
    lesson.unshift({ role, text });
    remaining -= text.length;
    if (lesson.length === 8 || remaining <= 0) break;
  }
  return lesson;
}
