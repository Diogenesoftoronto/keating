// Offline teaching fixtures. Each source is a verbatim excerpt of the visible
// tutor turn, indexed from zero. The engine expects the right answer first.
export function displayedTurn(turn) {
  return (turn.me ?? turn.k ?? turn.code).replace(/\{(?:spin|worm|myth):([^}]+)\}/g, "$1");
}

function question(id, kind, q, a, turn, quote) {
  return { id, kind, q, a, source: { turn, quote }, origin: "authored" };
}

const calculus = {
  sine: "d/dx sin(2x) = cos(2x) · 2",
  exp: "The inside, 3x, contributes the 3. The derivative of e^(3x) is 3e^(3x).",
  structure: "The outside operation in x sin(x) is multiplication, so start with the product rule. In sin(2x), e^(3x) and cos(x²), the outside operation is a function applied to an inner expression.",
  product: "For a product, differentiate one factor at a time and add the two terms. That gives (fg)′ = f′g + fg′.",
  inner: "The symbol du/dx measures how fast the inner value u changes with x.",
  slope: "The inner value 2x changes twice as fast as x, so its derivative supplies the factor of 2.",
  transfer: "For any constant k, the derivative of sin(kx) is k cos(kx).",
  steps: "First, identify the inner function. Next, differentiate the outer function at that inner value. Finally, multiply by the inner derivative.",
};

function maths(pack) {
  const thread = [
    ...pack.thread.slice(0, 4),
    { k: "Yes. " + calculus.exp + " For a product, {myth:(f·g)′ is not f′·g′}. " + calculus.product },
    { me: "How can I tell which rule to start with?" },
    { k: calculus.structure },
    { me: "Where does the multiplier come from? Would it work with a different number?" },
    { k: [calculus.inner, calculus.slope, calculus.transfer, calculus.steps].join(" ") },
  ];
  return {
    ...pack,
    thread,
    meta: "calculus · " + thread.length + " turns",
    gates: [
      { ...pack.gates[0], id: "maths-gate-sine", kind: "formula", origin: "authored", source: { turn: 2, quote: calculus.sine } },
      { ...pack.gates[1], id: "maths-gate-exp", kind: "formula", origin: "authored", source: { turn: 4, quote: calculus.exp } },
    ],
    examples: [
      question("maths-outer-operation", "oddone", "Which expression has **multiplication** on the outside?",
        ["$x\\sin(x)$", "$\\sin(2x)$", "$e^{3x}$", "$\\cos(x^2)$"], 6, calculus.structure),
      question("maths-product-or-chain", "compare", "Which rule do you start with for $x\\sin(x)$?",
        ["Product rule", "Chain rule", "Sum rule"], 6, calculus.structure),
      question("maths-missing-factor", "truefalse", "The derivative of $e^{3x}$ is $e^{3x}$.",
        ["False", "True"], 4, calculus.exp),
      question("maths-inner-slope", "why", "Why is there a **2** in the derivative of $\\sin(2x)$?",
        ["The slope of $2x$ is 2", "Sine always doubles its input", "The slope of $\\sin(x)$ is 2"], 8, calculus.slope),
      question("maths-new-sine", "apply", "Use the same rule on a new input. What is the derivative of $\\sin(5x)$?",
        ["$5\\cos(5x)$", "$\\cos(5x)$", "$5\\sin(5x)$"], 8, calculus.transfer),
      question("maths-product-rule", "formula", "Which formula differentiates a product $fg$?",
        ["$f'g+fg'$", "$f'g'$", "$f'g-fg'$"], 4, calculus.product),
      question("maths-inner-rate", "meaning", "In the chain rule, what does `du/dx` measure?",
        ["How fast $u$ changes with $x$", "The value of $u$ at zero", "How fast $x$ changes with $u$"], 8, calculus.inner),
      question("maths-name-chain", "name", "What rule does $\\frac{dy}{dx}=\\frac{dy}{du}\\frac{du}{dx}$ express?",
        ["Chain rule", "Product rule", "Sum rule"], 1, "The chain rule says: differentiate the outside, keep the inside, then multiply by the derivative of the inside."),
      question("maths-fix-product", "correction", "A friend differentiates both factors at once and writes $(fg)'=f'g'$. Which edit fixes it?",
        ["Differentiate one factor per term and add", "Add the two derivatives without the factors", "Multiply the two derivatives by $fg$"], 4, calculus.product),
    ],
    myths: [
      { wrong: "(fg)′ = f′g′", right: "(fg)′ = f′g + fg′", source: { turn: 4, quote: calculus.product } },
      { wrong: "d/dx sin(2x) = cos(2x)", right: "d/dx sin(2x) = 2 cos(2x)", source: { turn: 2, quote: calculus.sine } },
      { wrong: "d/dx e³ˣ = e³ˣ", right: "d/dx e³ˣ = 3e³ˣ", source: { turn: 4, quote: calculus.exp } },
    ],
    revive: [
      question("maths-revive-rate", "apply", "If $u=2x$, which factor does $du/dx$ supply?",
        ["2", "$2x$", "1"], 8, calculus.slope),
    ],
    explain: {
      prompt: "A friend writes $\\cos(2x)$ for the derivative of $\\sin(2x)$. Explain the missing factor in your own words.",
      reference: "The **inner** value $2x$ changes twice as fast as $x$. The chain rule multiplies the outer derivative $\\cos(2x)$ by that inner derivative, giving $2\\cos(2x)$.",
      source: { turn: 8, quote: calculus.slope },
    },
  };
}

const cells = {
  copy: "DNA is copied once before mitosis or meiosis.",
  count: "After mitosis and cytokinesis, one skin cell gives two daughter cells with the parent's chromosome number.",
  meiosis: "Meiosis has two divisions and can give four haploid products. Each has one chromosome set, half the original diploid number.",
  respiration: "Respiration releases usable energy from sugar, day and night.",
  light: "Photosynthesis uses light to store energy in sugar.",
  stages: "Prophase, metaphase, anaphase and telophase are stages of mitosis. Interphase comes before mitosis.",
  order: "First, chromosomes condense in prophase. Next, chromosomes line up in metaphase. Then, sister chromatids separate in anaphase. Finally, new nuclei form in telophase.",
  repair: "A skin cell divides by mitosis to replace a cell lost in a scrape. Cells that give rise to sperm undergo meiosis.",
};

function biology(pack) {
  const thread = [
    pack.thread[0],
    { k: cells.copy.replace("DNA is copied", "{spin:DNA is copied}") + " " + cells.count + " " + cells.meiosis },
    { code: "{worm:1 cell → mitosis → 2 cells}      with cytokinesis" },
    pack.thread[3],
    { k: "It is a common slip to think {myth:plants do not respire}. " + cells.light + " " + cells.respiration },
    { me: "Does copying the DNA count as a stage of mitosis?" },
    { k: cells.stages + " DNA replication takes place in interphase. " + cells.order },
    { me: "I understand how chromosomes separate during mitosis. Would a skin cell use mitosis or meiosis to repair a scrape?" },
    { k: cells.repair },
  ];
  return {
    ...pack,
    thread,
    meta: "cell division · " + thread.length + " turns",
    gates: [
      { ...pack.gates[0], id: "biology-gate-count", kind: "apply", origin: "authored", source: { turn: 1, quote: cells.count } },
      { ...pack.gates[1], id: "biology-gate-respiration", kind: "cloze", origin: "authored", source: { turn: 4, quote: cells.respiration } },
    ],
    examples: [
      question("biology-mitosis-stages", "oddone", "Which one falls **outside mitosis**?",
        ["Interphase", "Prophase", "Metaphase", "Anaphase"], 6, cells.stages),
      question("biology-division-count", "compare", "Which process halves the chromosome number of a diploid cell?",
        ["Meiosis", "Mitosis", "DNA replication"], 1, cells.meiosis),
      question("biology-plants-at-night", "truefalse", "A living plant cell stops respiring when the sun sets.",
        ["False", "True"], 4, cells.respiration),
      question("biology-respiration-energy", "why", "Why does a living leaf need respiration in the dark?",
        ["To release energy from sugar", "To use sunlight to make sugar", "To copy its DNA every night"], 4, cells.respiration),
      question("biology-skin-repair", "example", "Which is an example of a cell undergoing **mitosis**?",
        ["A skin cell dividing to repair a scrape", "A germ cell halving its chromosome number", "A leaf cell making sugar from light"], 8, cells.repair),
      question("biology-haploid", "meaning", "In this chat, what does *haploid* tell you about a meiotic product?",
        ["It has one chromosome set", "It has two chromosome sets", "It has no chromosomes"], 1, cells.meiosis),
      question("biology-chromosome-count", "apply", "A diploid cell has 12 chromosomes. How many will each normal meiotic product have?",
        ["6", "12", "24"], 1, cells.meiosis),
      question("biology-copy-timing", "swap", "Which statement keeps the DNA-copying step in the right place?",
        ["DNA is copied before meiosis begins", "DNA is copied between the two meiotic divisions", "DNA is copied after both meiotic divisions"], 1, cells.copy),
      question("biology-store-energy", "cloze", "Fill the gap. A leaf uses light to store energy in sugar during ____.",
        ["Photosynthesis", "Respiration", "Mitosis"], 4, cells.light),
    ],
    myths: [
      { wrong: "Plants do not respire", right: "Plants respire day and night", source: { turn: 4, quote: cells.respiration } },
      { wrong: "Mitosis gives four skin cells", right: "A dividing skin cell gives two daughters", source: { turn: 1, quote: cells.count } },
      { wrong: "DNA copies during anaphase", right: "DNA copies in interphase", source: { turn: 6, quote: "DNA replication takes place in interphase." } },
    ],
    revive: [
      question("biology-revive-stage", "order", "Sister chromatids are moving apart. Which stage are you seeing?",
        ["Anaphase", "Metaphase", "Interphase"], 6, cells.order),
    ],
    explain: {
      prompt: "A friend expects four cells when a skin cell divides to repair a scrape. How would you explain what happens?",
      reference: "A skin cell divides by **mitosis** and cytokinesis. That gives two daughter cells with the same chromosome number. *Meiosis* uses two divisions and can produce four haploid products.",
      source: { turn: 1, quote: cells.count + " " + cells.meiosis },
    },
    tldr: "Mitosis and cytokinesis give two cells with the parent's chromosome number.",
  };
}

// Compile the order challenges from the actual displayed conversation up to
// the cited turn. Keep the reviewed candidate, including its real ID and
// distractors. Quote the full sequence so the answer is visible in context.
function addGeneratedOrder(pack, candidatesFor, id, answer, source) {
  const turns = pack.thread.slice(0, source.turn + 1).map(turn => ({
    role: turn.me ? "learner" : "tutor", text: displayedTurn(turn),
  }));
  const selected = candidatesFor(turns).find(item => item.id === id);
  if (selected?.kind !== "order" || selected.a[0] !== answer || selected.source?.turn !== source.turn) {
    throw new Error("Review the changed order candidate for " + pack.label);
  }
  pack.examples.splice(4, 0, { ...selected, source, origin: "generated" });
}

function validatePack(pack) {
  const items = [...pack.gates, ...pack.examples, ...pack.revive];
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error("Duplicate question ID");
  for (const item of items) {
    const count = item.a.length;
    const validCount = item.kind === "truefalse" ? count === 2 : item.kind === "oddone" ? count === 4 : count >= 3 && count <= 4;
    if (!validCount || new Set(item.a).size !== count) throw new Error("Invalid answers in " + item.id);
  }
  for (const { source } of [...items, ...pack.myths, pack.explain]) {
    const turn = pack.thread[source.turn];
    if (!turn || turn.me || !source.quote || !displayedTurn(turn).includes(source.quote)) {
      throw new Error("Unmatched source in " + pack.label + ": " + source.quote);
    }
  }
}

export function practiceLessons(packs, candidatesFor) {
  const lessons = { maths: maths(packs.maths), biology: biology(packs.biology) };
  addGeneratedOrder(lessons.maths, candidatesFor, "rq_1ed046a2", "Identify the inner function",
    { turn: 8, quote: calculus.steps });
  addGeneratedOrder(lessons.biology, candidatesFor, "rq_14f79a5b", "Sister chromatids separate in anaphase",
    { turn: 6, quote: "Next, chromosomes line up in metaphase. Then, sister chromatids separate in anaphase." });
  Object.values(lessons).forEach(validatePack);
  return lessons;
}

export function shortChatFixture(lessons, rules, continuePrompt) {
  const others = Object.entries(lessons).map(([id, pack]) => {
    const turns = pack.thread.map(turn => ({ role: turn.me ? "learner" : "tutor", text: displayedTurn(turn) }));
    const { level } = rules(turns);
    if (level !== "ready") throw new Error("The sample chat picker needs a ready lesson for " + id);
    return { id, title: pack.title, level };
  });
  const question = "What is mitosis?";
  const reply = "Mitosis separates copied chromosomes into two nuclei.";
  const readiness = rules([{ role: "learner", text: question }, { role: "tutor", text: reply }], others);
  if (readiness.level !== "thin" || readiness.source !== "rules") throw new Error("Check the short-chat fixture");
  return { question, reply, reason: readiness.reason, draft: continuePrompt(readiness) };
}
