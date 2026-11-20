import { expect, test } from "bun:test";
import { checkLessonPack } from "../keating/habits/director";
import { habitLesson } from "../keating/habits/lesson";
import { buildChatRecessPack, recessDollarsBalanced, recessPlainText } from "../keating/habits/recess-lesson";
import type { RecessPack } from "../components/recess/types";

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
  expect(level).toMatchObject({ id: "coding", cast: "coding", label: "Coding", myths: [] });
  expect(level?.title.toLowerCase()).toContain("recursion");
  expect(level?.thread).toBeUndefined();
  expect(level?.wall[0]).toContain("Recursion keeps a stack frame");
  expect(level?.gates.length).toBeGreaterThanOrEqual(2);
  expect(level?.gates.length).toBeLessThanOrEqual(4);
  for (const question of [...level!.gates, ...level!.revive!]) {
    if ((question as { kind?: string }).kind !== "truefalse") expect(text.toLowerCase()).toContain(question.a[0].toLowerCase());
    expect(new Set(question.a.map(answer => answer.toLowerCase())).size).toBe(question.a.length);
  }
});

test("unfamiliar and short chats keep their own context without borrowing demo questions", () => {
  expect(buildChatRecessPack([{ role: "learner", text: "Show me a lesson" }])).toBeNull();
  expect(buildChatRecessPack([{ role: "tutor", text: "Yes." }])).toMatchObject({
    id: "general", label: "General", title: "Quick review", wall: ["Yes."], gates: [], revive: [],
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
  expect(level).toMatchObject({ id: "music", title: "Metronome", tldr: "A metronome keeps a steady beat." });
});

const chainRule = [
  { role: "learner", text: "Can you explain the chain rule? I keep getting derivatives of nested functions wrong." },
  { role: "tutor", text: "The **chain rule** tells you how to differentiate a *composition* of functions. If $y = f(g(x))$, then\n\n$$\\frac{dy}{dx} = f'(g(x)) \\cdot g'(x)$$\n\nThink of it as: differentiate the **outer function**, leave the inside alone, then multiply by the derivative of the **inner function**.\n\nA common mistake is to forget the inner derivative. For $\\sin(3x)$ the derivative is not $\\cos(3x)$ but $3\\cos(3x)$." },
  { role: "learner", text: "So for (x^2+1)^5 I would get 5(x^2+1)^4 times 2x?" },
  { role: "tutor", text: "Exactly right. The outer function is $u^5$, whose derivative is $5u^4$. The inner function is $u = x^2 + 1$, whose derivative is $2x$. Multiply them: $10x(x^2+1)^4$.\n\nA **composition** is just a function inside another function. Leibniz notation makes this feel like fractions cancelling: $\\frac{dy}{du} \\cdot \\frac{du}{dx}$.\n\nTry one yourself: what is the derivative of $e^{2x}$?" },
  { role: "learner", text: "2e^{2x}" },
  { role: "tutor", text: "Yes! The outer function $e^u$ is its own derivative, and the inner derivative is $2$. You are applying the chain rule correctly now. Next time we can look at **implicit differentiation**, which uses the chain rule on equations like $x^2 + y^2 = 1$." },
] as const;

const serEstar = [
  { role: "learner", text: "When do I use ser and when do I use estar in Spanish?" },
  { role: "tutor", text: "Both verbs mean *to be*, but they split the job. Use **ser** for permanent traits and identity, like origin or profession: *soy de México*. Use **estar** for temporary states and locations: *estoy cansado* means you are tired right now.\n\nA handy way to remember it is **DOCTOR** for ser (description, occupation, characteristic, time, origin, relationship) and **PLACE** for estar (position, location, action, condition, emotion)." },
  { role: "learner", text: "So for being tired I say estoy cansada?" },
  { role: "tutor", text: "Exactly. Tiredness is a **condition**, so it takes **estar**. Say *estoy cansada*, not *soy cansada*. Location also takes estar, even for permanent places: *Madrid está en España*.\n\nQuick check: which verb goes with a profession, like teacher?" },
  { role: "learner", text: "ser" },
  { role: "tutor", text: "Right! A profession is part of **DOCTOR**, so *soy profesora* uses **ser**. Next time we can practise adjectives that change meaning with each verb." },
] as const;

const comprehensions = [
  { role: "learner", text: "How do list comprehensions work in Python?" },
  { role: "tutor", text: "A **list comprehension** builds a new list from an iterable in one expression:\n\n```python\nsquares = [n * n for n in range(5)]\nprint(squares)  # [0, 1, 4, 9, 16]\n```\n\nThe `for` clause walks the iterable, and the expression before it runs once for each item. You can add a filter with an `if` clause: `[n for n in nums if n > 0]` keeps only the positive numbers.\n\nA **generator expression** looks the same but uses parentheses instead of brackets, so it produces values lazily rather than building the whole list at once. Reach for a **list comprehension** when you need the whole list, and a **generator expression** when you only loop over the values once." },
] as const;

const FILLER = ["time", "applying", "exactly", "next", "think", "now", "correctly", "right", "yes", "try"];
const domStrings = (pack: RecessPack) => [pack.title, pack.tldr, ...[...pack.gates, ...pack.revive ?? []].flatMap(item => [item.q, ...item.a])];
const canvasStrings = (pack: RecessPack) => [...pack.drift, pack.spin, ...pack.split, pack.dart, pack.worm, ...pack.wall,
  ...pack.myths.flatMap(myth => [myth.wrong, myth.right]), ...(pack.boss ? [pack.boss.name] : [])];

function expectWellFormed(pack: RecessPack) {
  for (const text of domStrings(pack)) expect(recessDollarsBalanced(text)).toBe(true);
  for (const text of canvasStrings(pack)) {
    expect(text).not.toContain("$");
    expect(text).not.toContain("**");
    expect(text).not.toContain("`");
    expect(text).not.toContain("\\");
  }
  const questions = [...pack.gates, ...pack.revive ?? []];
  const answers = questions.map(item => recessPlainText(item.a[0]).toLowerCase());
  expect(new Set(answers).size).toBe(answers.length);
  for (const item of questions) {
    expect(item.q.length).toBeLessThanOrEqual(115);
    const kind = (item as { kind?: string }).kind;
    if (kind === "truefalse") expect([...item.a].sort()).toEqual(["False", "True"]);
    else expect(item.a.length === 3 || item.a.length === 4).toBe(true);
    for (const answer of item.a) expect(answer.length).toBeLessThanOrEqual(60);
    expect(new Set(item.a.map(answer => recessPlainText(answer).toLowerCase())).size).toBe(item.a.length);
    expect(item.q).not.toContain("```");
    for (const answer of item.a) expect(FILLER).not.toContain(answer.toLowerCase());
  }
  expect(pack.tldr.length).toBeLessThanOrEqual(145);
  expect(pack.tldr).not.toContain("```");
  expect(pack.tldr).not.toMatch(/^(?:Next time|Try|Yes)/);
}

test("the chain-rule lesson becomes a mixed, well-formed level about the chain rule", () => {
  const pack = buildChatRecessPack(chainRule)!;
  expectWellFormed(pack);
  expect(pack.title.toLowerCase()).toContain("chain rule");
  expect(pack.label).toBe("Maths");
  expect(pack.tldr).toContain("chain rule");
  expect(pack.gates.length).toBeGreaterThanOrEqual(2);
  expect(pack.gates.length).toBeLessThanOrEqual(4);
  expect(pack.revive?.length).toBeGreaterThanOrEqual(1);
  const questions = [...pack.gates, ...pack.revive!] as (RecessPack["gates"][number] & { kind?: string })[];
  expect(new Set(questions.map(item => item.kind)).size).toBeGreaterThanOrEqual(5);
  // No kind repeats in the gates while another supported kind is left over.
  expect(new Set(pack.gates.map(item => (item as { kind?: string }).kind)).size).toBe(pack.gates.length);
  const formula = questions.find(item => item.kind === "formula");
  expect(formula?.a[0]).toBe("$f'(g(x)) \\cdot g'(x)$");
  expect(questions.find(item => item.kind === "correction")?.a[0]).toBe("$3\\cos(3x)$");
  expect(pack.myths).toContainEqual({ wrong: "cos(3x)", right: "3cos(3x)" });
  expect(questions.find(item => item.kind === "apply")?.a[0]).toBe("$2e^{2x}$");
  // Filler from the old builder never becomes an answer, and no blank cuts a span.
  for (const item of questions) for (const math of [item.q, ...item.a].flatMap(text => text.match(/\$[^$]+\$/g) ?? [])) {
    expect(math).not.toContain("…");
    expect(math).not.toContain("____");
  }
  expect(pack.drift).not.toContain("time");
  expect(pack.drift).not.toContain("applying");
});

test("plain text turns Markdown and simple LaTeX into readable Unicode", () => {
  expect(recessPlainText("$$\\frac{dy}{dx} = f'(g(x)) \\cdot g'(x)$$")).toBe("dy/dx = f'(g(x)) · g'(x)");
  expect(recessPlainText("The **outer function** $e^{2x}$ and $x^2$ and $3\\cos(3x)$ via *Leibniz*")).toBe("The outer function e²ˣ and x² and 3cos(3x) via Leibniz");
  expect(recessPlainText("$a^{n+q}$ and `code` and $\\sin x$")).toBe("a^(n+q) and code and sin x");
  expect(recessPlainText("$\\frac{a+b}{2}$")).toBe("(a+b)/2");
});

test("a Spanish lesson with no maths quizzes its bold terms and records the explicit correction", () => {
  const pack = buildChatRecessPack(serEstar)!;
  expectWellFormed(pack);
  expect(pack.id).toBe("spanish");
  expect(pack.title).toBe("Ser and estar");
  expect(pack.gates.length).toBeGreaterThanOrEqual(2);
  expect(pack.myths).toContainEqual({ wrong: "soy cansada", right: "estoy cansada" });
  for (const text of domStrings(pack)) expect(text).not.toContain("$");
});

test("a code lesson never cuts or quizzes its fenced block", () => {
  const pack = buildChatRecessPack(comprehensions)!;
  expectWellFormed(pack);
  expect(pack.id).toBe("coding");
  expect(pack.title.toLowerCase()).toContain("list comprehension");
  expect(pack.gates.length).toBeGreaterThanOrEqual(2);
  for (const text of [...domStrings(pack), ...canvasStrings(pack)]) expect(text).not.toContain("squares =");
});

test("thin chats still build a level but without invented questions", () => {
  const hello = buildChatRecessPack([{ role: "learner", text: "hi" }, { role: "tutor", text: "Hello! What would you like to learn today?" }])!;
  expectWellFormed(hello);
  expect(hello.gates).toEqual([]);
  const oneLine = buildChatRecessPack([{ role: "learner", text: "What is photosynthesis?" },
    { role: "tutor", text: "Photosynthesis is how plants turn light into chemical energy." }])!;
  expectWellFormed(oneLine);
  expect(oneLine.title.toLowerCase()).toContain("photosynthesis");
});

test("the local builder is deterministic", () => {
  expect(JSON.stringify(buildChatRecessPack(chainRule))).toBe(JSON.stringify(buildChatRecessPack(chainRule)));
});
