import { expect, test } from "bun:test";
import { checkLessonPack } from "../keating/habits/director";
import { habitLesson } from "../keating/habits/lesson";
import { buildChatRecessPack } from "../keating/habits/recess-lesson";

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
  expect(checkLessonPack({ ...valid, subject: "maths", myths: [] }, lesson)?.subject).toBe("maths");
  expect(checkLessonPack({ ...valid, subject: "made-up", myths: [] }, lesson)).toBeNull();
  expect(checkLessonPack({ ...valid, myths: [] }, [])).toBeNull();
});

test("the local Recess level detects its subject and uses the real lesson for enemies, gates, and the wall", () => {
  const text = "Recursion keeps a stack frame for each pending call. A base case stops the recursive calls. Returning resumes the previous frame.";
  const level = buildChatRecessPack([
    { role: "learner", text: "What happens to each call during recursion?" },
    { role: "tutor", text },
  ]);
  expect(level).toMatchObject({ id: "coding", cast: "coding", label: "Coding", title: "What happens to each call during recursion?", myths: [] });
  expect(level?.thread).toBeUndefined();
  expect(level?.wall[0]).toContain("Recursion keeps a stack frame");
  expect(level?.gates).toHaveLength(2);
  for (const question of [...level!.gates, ...level!.revive!]) {
    expect(text.toLowerCase()).toContain(question.a[0].toLowerCase());
    expect(new Set(question.a.map(answer => answer.toLowerCase())).size).toBe(3);
  }
});

test("unfamiliar and short chats keep their own context without borrowing demo questions", () => {
  expect(buildChatRecessPack([{ role: "learner", text: "Show me a lesson" }])).toBeNull();
  expect(buildChatRecessPack([{ role: "tutor", text: "Yes." }])).toMatchObject({
    id: "general", label: "General", title: "Yes.", wall: ["Yes."], gates: [], revive: [],
  });
  expect(buildChatRecessPack([{ role: "tutor", text: "Acceleration is the change in velocity per unit time." }])).toMatchObject({
    id: "general", label: "Physics", tldr: "Acceleration is the change in velocity per unit time.",
  });
});

test("Recess follows the newest answered topic in a mixed chat", () => {
  const level = buildChatRecessPack([
    { role: "learner", text: "Can you explain derivatives, calculus, and the chain rule?" },
    { role: "tutor", text: "In calculus the chain rule computes a derivative for a composite function." },
    { role: "learner", text: "What is a metronome?" },
    { role: "tutor", text: "A metronome keeps a steady beat." },
    { role: "learner", text: "Can we switch to Python and recursion?" },
  ]);
  expect(level).toMatchObject({ id: "music", title: "What is a metronome?", tldr: "A metronome keeps a steady beat." });
});
