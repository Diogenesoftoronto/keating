import { expect, test } from "bun:test";
import { checkLessonPack } from "../keating/habits/director";
import type { HabitLesson } from "../keating/habits/lesson";
import { analyzeRecessLesson, buildChatRecessPack, recessDollarsBalanced, recessPlainText, recessQuestionCandidates, type RecessQuestionKind } from "../keating/habits/recess-lesson";

type Kinded = { kind: RecessQuestionKind; q: string; a: readonly string[]; id?: string; source?: { turn: number; quote: string } };

const chainRule: HabitLesson = [
  { role: "learner", text: "Can you explain the chain rule? I keep getting derivatives of nested functions wrong." },
  { role: "tutor", text: "The **chain rule** tells you how to differentiate a *composition* of functions. If $y = f(g(x))$, then\n\n$$\\frac{dy}{dx} = f'(g(x)) \\cdot g'(x)$$\n\nThink of it as: differentiate the **outer function**, leave the inside alone, then multiply by the derivative of the **inner function**.\n\nA common mistake is to forget the inner derivative. For $\\sin(3x)$ the derivative is not $\\cos(3x)$ but $3\\cos(3x)$." },
  { role: "learner", text: "So for (x^2+1)^5 I would get 5(x^2+1)^4 times 2x?" },
  { role: "tutor", text: "Exactly right. The outer function is $u^5$, whose derivative is $5u^4$. The inner function is $u = x^2 + 1$, whose derivative is $2x$. Multiply them: $10x(x^2+1)^4$.\n\nA **composition** is just a function inside another function. Leibniz notation makes this feel like fractions cancelling: $\\frac{dy}{du} \\cdot \\frac{du}{dx}$.\n\nTry one yourself: what is the derivative of $e^{2x}$?" },
  { role: "learner", text: "2e^{2x}" },
  { role: "tutor", text: "Yes! The outer function $e^u$ is its own derivative, and the inner derivative is $2$. You are applying the chain rule correctly now. Next time we can look at **implicit differentiation**, which uses the chain rule on equations like $x^2 + y^2 = 1$." },
];

/** Biology: because, for example, a numbered list of stages, whereas, and a group the tutor names together. */
const cells: HabitLesson = [
  { role: "learner", text: "What is the difference between mitosis and meiosis?" },
  { role: "tutor", text: "**Mitosis** produces two identical daughter cells, whereas **meiosis** produces four genetically different gametes.\n\nMitosis happens in four stages:\n\n1. **Prophase** condenses the chromosomes.\n2. **Metaphase** lines the chromosomes up in the middle.\n3. **Anaphase** pulls the sister chromatids apart.\n4. **Telophase** forms two new nuclei.\n\nYour body uses mitosis for growth and repair, for example healing a cut. Meiosis makes sex cells, for example sperm and egg cells." },
  { role: "learner", text: "Why are the gametes different from each other?" },
  { role: "tutor", text: "Gametes differ because **crossing over** swaps DNA between paired chromosomes. Meiosis halves the chromosome number, so a fertilised egg ends up with a full set. Prophase, metaphase and anaphase all happen in meiosis too, but twice. A common mistake is to think meiosis copies cells; it is not copying but reshuffling." },
];

/** A Spanish vocabulary lesson with dash, parenthesis and "means" glosses. */
const greetings: HabitLesson = [
  { role: "learner", text: "Can you teach me some basic Spanish greetings?" },
  { role: "tutor", text: "Here are the essentials:\n\n- *hola* — hello\n- *adiós* — goodbye\n- *gracias* — thank you\n- *por favor* — please\n\nIn the morning say *buenos días* (good morning), and at night *buenas noches* (good night). *De nada* means you're welcome, which is the usual reply to *gracias*." },
];

/** Ser and estar, with two mnemonic groups and an explicit correction. */
const serEstar: HabitLesson = [
  { role: "learner", text: "When do I use ser and when do I use estar in Spanish?" },
  { role: "tutor", text: "Both verbs mean *to be*, but they split the job. Use **ser** for permanent traits and identity, like origin or profession: *soy de México*. Use **estar** for temporary states and locations: *estoy cansado* means you are tired right now.\n\nA handy way to remember it is **DOCTOR** for ser (description, occupation, characteristic, time, origin, relationship) and **PLACE** for estar (position, location, action, condition, emotion)." },
  { role: "learner", text: "So for being tired I say estoy cansada?" },
  { role: "tutor", text: "Exactly. Tiredness is a **condition**, so it takes **estar**. Say *estoy cansada*, not *soy cansada*. Location also takes estar, even for permanent places: *Madrid está en España*.\n\nQuick check: which verb goes with a profession, like teacher?" },
  { role: "learner", text: "ser" },
  { role: "tutor", text: "Right! A profession is part of **DOCTOR**, so *soy profesora* uses **ser**. Next time we can practise adjectives that change meaning with each verb." },
];

const lessonText = (lesson: HabitLesson) => recessPlainText(lesson.filter(turn => turn.role === "tutor").map(turn => turn.text).join(" ")).toLowerCase();
const packQuestions = (lesson: HabitLesson) => {
  const pack = buildChatRecessPack(lesson)!;
  return [...pack.gates, ...pack.revive ?? []] as Kinded[];
};

function expectSound(questions: readonly Kinded[]) {
  for (const item of questions) {
    expect(item.q.length).toBeLessThanOrEqual(115);
    for (const text of [item.q, ...item.a]) expect(recessDollarsBalanced(text)).toBe(true);
    for (const answer of item.a) expect(answer.length).toBeLessThanOrEqual(60);
    expect(new Set(item.a.map(answer => recessPlainText(answer).toLowerCase())).size).toBe(item.a.length);
    if (item.kind === "truefalse") expect(item.a.length === 2 && [...item.a].sort().join() === "False,True").toBe(true);
    else expect(item.a.length).toBeGreaterThanOrEqual(3);
    expect(item.a.length).toBeLessThanOrEqual(4);
    if (item.kind === "oddone") expect(item.a).toHaveLength(4);
  }
}
const ofKind = (questions: readonly Kinded[], kind: RecessQuestionKind) => questions.filter(item => item.kind === kind);

test("the chain-rule pack mixes at least five kinds and never repeats a kind in its gates", () => {
  const questions = packQuestions(chainRule);
  expectSound(questions);
  expect(new Set(questions.map(item => item.kind)).size).toBeGreaterThanOrEqual(5);
  const gates = buildChatRecessPack(chainRule)!.gates as Kinded[];
  expect(new Set(gates.map(item => item.kind)).size).toBe(gates.length);
  // Four choices are kept for the hardest gates only; earlier gates have three.
  expect(gates[0].a).toHaveLength(3);
});

test("the biology lesson grounds compare, why, example, order and odd-one-out in the tutor's text", () => {
  const questions = recessQuestionCandidates(cells);
  expectSound(questions);
  const text = lessonText(cells);
  const compare = ofKind(questions, "compare");
  expect(compare[0]).toMatchObject({ q: "Which describes **meiosis**, not **mitosis**?" });
  expect(compare[0].a.slice(0, 2)).toEqual(["produces four genetically different gametes", "produces two identical daughter cells"]);
  const why = ofKind(questions, "why")[0];
  expect(why.q).toBe("“A fertilised egg ends up with a full set.” Why?");
  expect(why.a[0]).toBe("Because meiosis halves the chromosome number");
  const example = ofKind(questions, "example")[0];
  expect(example).toMatchObject({ q: "Which is an example of **mitosis**?" });
  expect(example.a[0]).toBe("healing a cut");
  expect(example.a).toContain("sperm");
  const order = ofKind(questions, "order");
  expect(order[0].q).toContain("“**Prophase** condenses the chromosomes”");
  expect(order[0].a[0]).toBe("**Metaphase** lines the chromosomes up in the middle");
  const odd = ofKind(questions, "oddone")[0];
  expect(odd.q).toBe("Which was NOT in Keating’s list?");
  expect(odd.a.slice(1)).toEqual(["prophase", "metaphase", "anaphase"]);
  // Every correct non-boolean answer is the tutor's own words.
  for (const item of questions) if (item.kind !== "truefalse" && item.kind !== "why" && item.kind !== "oddone") {
    expect(text).toContain(recessPlainText(item.a[0]).toLowerCase());
  }
  const pack = buildChatRecessPack(cells)!;
  expect(new Set(pack.gates.map(item => (item as Kinded).kind)).size).toBe(pack.gates.length);
});

test("a vocabulary lesson asks meanings both ways from the tutor's glosses", () => {
  const questions = recessQuestionCandidates(greetings);
  expectSound(questions);
  const meaning = ofKind(questions, "meaning");
  expect(meaning.length).toBeGreaterThanOrEqual(6);
  expect(meaning).toContainEqual(expect.objectContaining({ kind: "meaning", q: "What does *hola* mean?", a: ["hello", "goodbye", "thank you", "please"] }));
  expect(meaning.some(item => item.q === "How do you say “goodbye”?" && item.a[0] === "*adiós*")).toBe(true);
  expect(meaning.some(item => item.q === "What does *buenos días* mean?" && item.a[0] === "good morning")).toBe(true);
  expect(buildChatRecessPack(greetings)!.title).toBe("Basic Spanish greetings");
});

test("ser and estar yields a list-memory odd-one-out, a why and a correction", () => {
  const questions = recessQuestionCandidates(serEstar);
  expectSound(questions);
  expect(questions).toContainEqual(expect.objectContaining({ kind: "oddone", q: "Which was NOT in Keating’s first list?", a: ["position", "description", "occupation", "characteristic"] }));
  expect(ofKind(questions, "why")[0]).toMatchObject({ q: "“*Soy profesora* uses **ser**.” Why?" });
  expect(ofKind(questions, "why")[0].a[0]).toBe("Because a profession is part of **DOCTOR**");
  expect(ofKind(questions, "correction")[0].a.slice(0, 2)).toEqual(["*estoy cansada*", "*soy cansada*"]);
});

test("true/false items alternate truths and false ones really change the claim", () => {
  const items = ofKind(recessQuestionCandidates(chainRule), "truefalse");
  expect(items.length).toBeGreaterThanOrEqual(2);
  expect(new Set(items.map(item => item.a[0]))).toEqual(new Set(["True", "False"]));
  const text = chainRule.filter(turn => turn.role === "tutor").map(turn => turn.text).join(" ");
  for (const item of items) {
    const claim = item.q.replace(/^True or false: /, "");
    expect(text.includes(claim)).toBe(item.a[0] === "True");
  }
});

test("the candidate pool is deduplicated, capped, deterministic and rotates kinds", () => {
  for (const lesson of [chainRule, cells, greetings, serEstar]) {
    const pool = recessQuestionCandidates(lesson);
    expect(pool.length).toBeLessThanOrEqual(16);
    expect(new Set(pool.map(item => item.q)).size).toBe(pool.length);
    // True/false items share "True"/"False", so their claim (the question) is their identity.
    const answers = pool.filter(item => item.kind !== "truefalse").map(item => `${item.kind}:${recessPlainText(item.a[0]).toLowerCase()}`);
    expect(new Set(answers).size).toBe(answers.length);
    expect(JSON.stringify(recessQuestionCandidates(lesson))).toBe(JSON.stringify(pool));
    const kinds = new Set(pool.map(item => item.kind));
    // The first item of each kind appears before any kind repeats.
    expect(new Set(pool.slice(0, kinds.size).map(item => item.kind)).size).toBe(kinds.size);
  }
  expect(recessQuestionCandidates([{ role: "learner", text: "hi" }])).toEqual([]);
  expect(recessQuestionCandidates([{ role: "learner", text: "hi" }, { role: "tutor", text: "Hello! What would you like to learn today?" }])).toEqual([]);
});

test("kinds the text does not support are never produced", () => {
  const kinds = new Set(recessQuestionCandidates(chainRule).map(item => item.kind));
  for (const absent of ["meaning", "order", "oddone", "example", "compare"] as const) expect(kinds.has(absent)).toBe(false);
  const greetingKinds = new Set(recessQuestionCandidates(greetings).map(item => item.kind));
  expect(greetingKinds.has("formula")).toBe(false);
  expect(greetingKinds.has("order")).toBe(false);
});

test("the model schema accepts 2 to 4 choices and only True/False for two lanes", () => {
  const myths = [{ wrong: "2", right: "4", tutorQuote: "2 + 2 is 4." }];
  const base = {
    title: "Doubling", tldr: "Add a number to itself.", myths, wall: ["One", "Two", "Three", "Four", "Five", "Six"],
    gates: [{ kind: "truefalse", q: "True or false: 2 + 2 is 4.", a: ["True", "False"] }, { kind: "oddone", q: "Odd one?", a: ["5", "2", "4", "6"] }],
    revive: [{ q: "Double 4?", a: ["8", "12", "4"] }],
    boss: { name: "The Long Sum", taunts: { intro: "A sum begins", phase: ["Again"], low: "Last line", defeat: "Summed" } },
  };
  const lesson = [{ role: "tutor", text: "2 + 2 is 4." }] as const;
  expect(checkLessonPack(base, lesson)?.gates).toHaveLength(2);
  expect(checkLessonPack({ ...base, revive: [{ q: "Pick", a: ["8", "12"] }] }, lesson)).toBeNull();
  expect(checkLessonPack({ ...base, revive: [{ kind: "truefalse", q: "True?", a: ["Yes", "No"] }] }, lesson)).toBeNull();
  expect(checkLessonPack({ ...base, revive: [{ kind: "truefalse", q: "True?", a: ["True", "False", "Maybe"] }] }, lesson)).toBeNull();
  expect(checkLessonPack({ ...base, revive: [{ kind: "apply", q: "Five?", a: ["1", "2", "3", "4", "5"] }] }, lesson)).toBeNull();
  expect(checkLessonPack({ ...base, revive: [{ kind: "made-up", q: "Double 4?", a: ["8", "12", "4"] }] }, lesson)).toBeNull();
});

/** Regression (review): the second list's members are also primes, so absence from the first list is no evidence of exclusion. */
const primes: HabitLesson = [
  { role: "learner", text: "What makes a number prime?" },
  { role: "tutor", text: "The **prime numbers** (two, three, five) each have exactly two positive divisors. The **larger primes** (seven, eleven, thirteen) have the same property. A **divisor** divides a number exactly.\n\nTo test a number, try each **divisor** up to its square root. If none divides it exactly, the number is prime. A **composite number** has more than two divisors, for example twelve. Every whole number above one is either prime or composite, and one is neither." },
];

test("odd-one-out only asks what a list held, never that an item is outside a category", () => {
  for (const lesson of [primes, cells, serEstar]) {
    const odd = ofKind(recessQuestionCandidates(lesson), "oddone");
    for (const item of odd) {
      expect(item.q).toMatch(/^Which was NOT in Keating’s (?:\w+ )?list\?$/);
      expect(item.q).not.toMatch(/belong|part of/);
    }
  }
  const odd = ofKind(recessQuestionCandidates(primes), "oddone");
  expect(odd[0]).toMatchObject({ q: "Which was NOT in Keating’s first list?", a: ["seven", "two", "three", "five"] });
});

test("false claims need the tutor's own evidence that the swapped ideas differ", () => {
  // "prime numbers" and "larger primes" are siblings the tutor says share a property: never swapped into a false claim.
  for (const item of ofKind(recessQuestionCandidates(primes), "truefalse")) {
    if (item.a[0] === "False") expect(item.q).not.toMatch(/larger primes[^.]*two, three, five|prime numbers\*\* \(seven/);
  }
  const lie = ofKind(recessQuestionCandidates(primes), "truefalse").find(item => item.a[0] === "False");
  if (lie) expect(lie.q).toContain("composite number"); // prime vs composite is an explicit antonym
  // mitosis vs meiosis is contrasted with "whereas", so their swap is a legitimate false claim.
  const cellLies = ofKind(recessQuestionCandidates(cells), "truefalse").filter(item => item.a[0] === "False");
  for (const item of cellLies) expect(item.q).not.toBe("True or false: Prophase, metaphase and anaphase all happen in mitosis too, but twice.");
});

test("every question carries a stable id and a verbatim source in the tutor turn that taught it", () => {
  for (const lesson of [chainRule, cells, greetings, serEstar, primes]) {
    const pool = recessQuestionCandidates(lesson) as Kinded[];
    const pack = buildChatRecessPack(lesson)!;
    const packItems = [...pack.gates, ...pack.revive ?? []] as Kinded[];
    for (const item of [...pool, ...packItems]) {
      expect(item.id).toMatch(/^rq_[0-9a-f]{8}$/);
      expect(item.source).toBeDefined();
      const turn = lesson[item.source!.turn];
      expect(turn.role).toBe("tutor");
      expect(item.source!.quote.length).toBeGreaterThan(0);
      expect(item.source!.quote.length).toBeLessThanOrEqual(120);
      expect(recessPlainText(turn.text)).toContain(item.source!.quote);
    }
    expect(new Set(pool.map(item => item.id)).size).toBe(pool.length);
    expect((recessQuestionCandidates(lesson) as Kinded[]).map(item => item.id)).toEqual(pool.map(item => item.id));
    // A pack item that keeps all its choices has the same id as its pool twin.
    for (const item of packItems) {
      const twin = pool.find(entry => entry.q === item.q);
      if (twin && twin.a.length === item.a.length) expect(item.id).toBe(twin.id);
    }
  }
  const formula = ofKind(recessQuestionCandidates(chainRule), "formula")[0];
  expect(formula.source).toEqual({ turn: 1, quote: "dy/dx = f'(g(x)) · g'(x)" });
  expect(ofKind(recessQuestionCandidates(chainRule), "apply")[0].source?.turn).toBe(5);
  // Turn indices point into the full lesson, not the trailing topic window.
  const mixed: HabitLesson = [{ role: "learner", text: "What is a metronome?" }, { role: "tutor", text: "A metronome keeps a steady beat." }, ...cells];
  const shifted = recessQuestionCandidates(mixed) as Kinded[];
  expect(shifted.length).toBeGreaterThan(0);
  for (const item of shifted) expect(item.source!.turn).toBeGreaterThanOrEqual(3);
});

test("the analysis is memoised but every caller gets its own copy", () => {
  const first = analyzeRecessLesson(cells)!;
  const second = analyzeRecessLesson(cells)!;
  expect(second).toEqual(first);
  expect(second).not.toBe(first);
  (first.pack.gates as unknown as unknown[]).length = 0;
  expect(buildChatRecessPack(cells)!.gates.length).toBeGreaterThan(0);
  const start = performance.now();
  for (let i = 0; i < 50; i++) analyzeRecessLesson(cells);
  expect(performance.now() - start).toBeLessThan(250);
});
