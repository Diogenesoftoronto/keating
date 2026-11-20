import { expect, test } from "bun:test";
import { checkLessonPack } from "../keating/habits/director";
import { habitLesson } from "../keating/habits/lesson";

test("practice uses bounded completed text and omits quoted sources and attachments", () => {
  const lesson = habitLesson([
    { role: "user", keatingPrivateFork: { version: 1, kind: "imported-context" }, content: "Someone else's source" },
    { role: "user-with-attachments", content: [{ type: "text", text: "What is acceleration?" }, { type: "image", data: "image data" }] },
    { role: "toolResult", content: "Tool internals" },
    { role: "assistant", content: [{ type: "thinking", thinking: "Private reasoning" }, { type: "text", text: "Change in velocity per unit time." }] },
    { role: "assistant", stopReason: "error", content: "Provider failure" },
    { role: "assistant", __keatingStreaming: true, content: "Incomplete sentence" },
  ]);
  expect(lesson).toEqual([
    { role: "learner", text: "What is acceleration?" }, { role: "tutor", text: "Change in velocity per unit time." },
  ]);
  const long = habitLesson(Array.from({ length: 20 }, () => ({ role: "assistant", content: "x".repeat(3000) })));
  expect(long.reduce((size, turn) => size + turn.text.length, 0)).toBe(5200);
});

test("compiled misconceptions require verbatim completed tutor corrections", () => {
  const myths = [
    { wrong: "2", right: "4", tutorQuote: "2 + 2 is 4." },
    { wrong: "3", right: "6", tutorQuote: "3 + 3 is 6." },
    { wrong: "5", right: "8", tutorQuote: "4 + 4 is 8." },
  ];
  const valid = {
    title: "Doubling", tldr: "Add a number to itself.", myths,
    gates: [{ q: "Double 2?", a: ["4", "2", "6"] }, { q: "Double 3?", a: ["6", "9", "3"] }],
    revive: [{ q: "Double 4?", a: ["8", "12", "4"] }],
    wall: ["One", "Two", "Three", "Four", "Five", "Six"],
    boss: { name: "The Long Sum", taunts: { intro: "A sum begins", phase: ["Again"], low: "Last line", defeat: "Summed" } },
  };
  const lesson = [{ role: "tutor", text: myths.map(item => item.tutorQuote).join(" ") }] as const;
  expect(checkLessonPack(valid, lesson)?.title).toBe("Doubling");
  expect(checkLessonPack(valid, [{ role: "learner", text: lesson[0].text }])).toBeNull();
  expect(checkLessonPack({ ...valid, myths: [{ ...myths[0], right: "7" }, ...myths.slice(1)] }, lesson)).toBeNull();
  expect(checkLessonPack({ ...valid, revive: [{ q: "Duplicate?", a: ["yes", "Yes", "no"] }] }, lesson)).toBeNull();
});
