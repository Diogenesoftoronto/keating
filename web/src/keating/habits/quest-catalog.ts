export interface HabitKitPiece {
  id: string;
  name: string;
  slot: "topper" | "visor" | "pack" | "blaster" | "boots" | "trail" | "perch";
  subject: string;
  blueprints: number;
  parts: number;
  art?: { sheet: "toppers" | "packs" | "blasters"; cell: number };
}

export interface HabitQuest {
  id: string;
  title: string;
  subject: string;
  prompt: string;
  why: string;
  minutes: number;
  kitId: string;
  blueprints: number;
  parts: number;
  expedition?: "Kitchen chemistry" | "A month of money";
  requires?: string;
}

export const HABIT_KIT: readonly HabitKitPiece[] = [
  { id: "jetpack", name: "Jetpack", slot: "pack", subject: "standard", blueprints: 0, parts: 0, art: { sheet: "packs", cell: 0 } },
  { id: "blaster", name: "Blaster", slot: "blaster", subject: "standard", blueprints: 0, parts: 0, art: { sheet: "blasters", cell: 0 } },
  { id: "star", name: "First-quest star", slot: "topper", subject: "standard", blueprints: 0, parts: 0, art: { sheet: "toppers", cell: 7 } },
  { id: "protractor", name: "Protractor topper", slot: "topper", subject: "maths", blueprints: 2, parts: 5, art: { sheet: "toppers", cell: 0 } },
  { id: "sprout", name: "Leaf-sprout topper", slot: "topper", subject: "biology", blueprints: 2, parts: 5, art: { sheet: "toppers", cell: 2 } },
  { id: "tilde", name: "Tilde topper", slot: "topper", subject: "spanish", blueprints: 2, parts: 5, art: { sheet: "toppers", cell: 6 } },
  { id: "keyboots", name: "Keycap boots", slot: "boots", subject: "coding", blueprints: 2, parts: 5 },
  { id: "hourglass", name: "Hourglass pack", slot: "pack", subject: "history", blueprints: 2, parts: 6, art: { sheet: "packs", cell: 2 } },
  { id: "quill", name: "Quill topper", slot: "topper", subject: "literature", blueprints: 2, parts: 5, art: { sheet: "toppers", cell: 3 } },
  { id: "metronome", name: "Metronome topper", slot: "topper", subject: "music", blueprints: 2, parts: 5, art: { sheet: "toppers", cell: 1 } },
  { id: "gavel", name: "Gavel blaster", slot: "blaster", subject: "law", blueprints: 2, parts: 5, art: { sheet: "blasters", cell: 1 } },
  { id: "flask", name: "Flask pack", slot: "pack", subject: "chemistry", blueprints: 8, parts: 12, art: { sheet: "packs", cell: 1 } },
  { id: "calc", name: "Calculator pack", slot: "pack", subject: "finance", blueprints: 8, parts: 12, art: { sheet: "packs", cell: 4 } },
];

export const HABIT_QUESTS: readonly HabitQuest[] = [
  { id: "receipt", subject: "maths", title: "Work out the tax on a receipt",
    prompt: "Use a receipt or a made-up total. Write the pre-tax amount and rate, calculate tax, then compare with the receipt or check your result another way. Explain one choice in your method.",
    why: "Apply percentages to a total and check the result.", minutes: 15, kitId: "protractor", blueprints: 2, parts: 5 },
  { id: "leaves", subject: "biology", title: "Five leaves, five different shapes",
    prompt: "Choose five leaves from plants or a field guide. Label each as lobed, toothed, smooth-edged, compound, or needle. Describe the features you observed and one tricky classification.",
    why: "Classify leaves by their observable features.", minutes: 30, kitId: "sprout", blueprints: 2, parts: 5 },
  { id: "room", subject: "spanish", title: "Describe your room in Spanish",
    prompt: "Write five sentences about things in a room. Use ser at least twice and estar at least twice. Explain why you chose the verb in two sentences.",
    why: "Choose between ser and estar in a concrete setting.", minutes: 10, kitId: "tilde", blueprints: 2, parts: 5 },
  { id: "trace", subject: "coding", title: "Trace a loop before you run it",
    prompt: "Write every value taken by i in range(1, 5), then compare with the program output. Explain what happens at the upper bound and predict what changes for range(0, 5, 2).",
    why: "Predict loop behavior and spot off-by-one errors.", minutes: 15, kitId: "keyboots", blueprints: 2, parts: 5 },
  { id: "datestone", subject: "history", title: "Read a date as a primary source",
    prompt: "Find an old date in a book, on a stamp, or in a museum catalogue. Describe the object, the date and what it actually establishes. Add one context fact and explain where you checked it.",
    why: "Separate historical evidence from interpretation.", minutes: 25, kitId: "hourglass", blueprints: 2, parts: 6 },
  { id: "simile", subject: "literature", title: "Catch a simile and a metaphor",
    prompt: "Find or write a short simile and metaphor. Label each one and explain what is compared. Change one into the other and explain what the wording changes.",
    why: "Recognize figurative language and explain its effect.", minutes: 15, kitId: "quill", blueprints: 2, parts: 5 },
  { id: "clap", subject: "music", title: "Clap a tune, then write its rhythm",
    prompt: "Choose a short tune and clap its first line. Write the beat counts or note values, mark the bar lines, and explain how you checked one difficult bar.",
    why: "Connect the rhythm you hear to written note values.", minutes: 10, kitId: "metronome", blueprints: 2, parts: 5 },
  { id: "library", subject: "law", title: "Read how a newspaper reports a trial",
    prompt: "Use a news report or an example from a lesson. Identify three words that signal an allegation and one phrase that reports a verdict. Explain why the distinction matters.",
    why: "Read the difference between a claim and a court finding.", minutes: 25, kitId: "gavel", blueprints: 2, parts: 5 },
  { id: "x-changes", subject: "chemistry", title: "Five changes while a meal is made",
    prompt: "List five changes you observe while someone cooks, or use an example from your lesson. Classify each as physical or chemical and explain one ambiguous case.",
    why: "Use the formation of a new substance as evidence.", minutes: 20, kitId: "flask", blueprints: 2, parts: 3, expedition: "Kitchen chemistry" },
  { id: "x-gas", subject: "chemistry", title: "Explain a gas-producing reaction",
    prompt: "Use a demonstration or a lesson description of vinegar and baking soda. Make a prediction about gas production, describe the evidence, then explain how it compares with your prediction.",
    why: "Use an observation to test a prediction about a reaction.", minutes: 20, kitId: "flask", blueprints: 2, parts: 3, expedition: "Kitchen chemistry", requires: "x-changes" },
  { id: "x-rust", subject: "chemistry", title: "Rust race",
    prompt: "Compare observations of steel in dry, tap-water and salt-water conditions from a published example or lesson. Explain which comparison matters and what you would control in a fair test.",
    why: "Isolate one variable in an oxidation experiment.", minutes: 15, kitId: "flask", blueprints: 2, parts: 3, expedition: "Kitchen chemistry", requires: "x-gas" },
  { id: "x-bonds", subject: "chemistry", title: "Add up the bonds",
    prompt: "Use a bond-energy table from your lesson. Show which bonds break and form when methane burns. Compute the net energy and explain the sign.",
    why: "Connect energy estimates to the bonds broken and formed.", minutes: 20, kitId: "flask", blueprints: 1, parts: 2, expedition: "Kitchen chemistry", requires: "x-rust" },
  { id: "x-page", subject: "chemistry", title: "Your lab page",
    prompt: "Write a short report tying together the physical changes, gas production, rust, and bond energies. Give one prediction, one observation, and one way you revised your explanation.",
    why: "Synthesize evidence across the expedition.", minutes: 40, kitId: "flask", blueprints: 1, parts: 3, expedition: "Kitchen chemistry", requires: "x-bonds" },
  { id: "b-1", subject: "finance", title: "Make a one-week spending record",
    prompt: "Build a week of fictional spending entries. Give several realistic amounts and check the total. Explain one choice in how you recorded them.",
    why: "Turn small purchases into a usable budget record.", minutes: 10, kitId: "calc", blueprints: 2, parts: 3, expedition: "A month of money" },
  { id: "b-2", subject: "finance", title: "Sort your spending into four piles",
    prompt: "Organize the entries from your fictional budget into needs, wants, savings, and uncertain. Show each subtotal and explain one borderline choice.",
    why: "Explain how categorization changes a budget decision.", minutes: 15, kitId: "calc", blueprints: 2, parts: 3, expedition: "A month of money", requires: "b-1" },
  { id: "b-3", subject: "finance", title: "Compare two prices",
    prompt: "Choose two hypothetical prices for the same item, normalize for the quantity, and work out the difference as a percentage. Explain which amount is your denominator.",
    why: "Use a common baseline when comparing prices.", minutes: 15, kitId: "calc", blueprints: 1, parts: 2, expedition: "A month of money", requires: "b-2" },
  { id: "b-4", subject: "finance", title: "What if you saved it instead?",
    prompt: "Use a figure from your fictional budget. Calculate what it would be worth after a year at a hypothetical 5% annual rate compounded monthly. Show the formula and check its assumptions.",
    why: "Distinguish annual and monthly rates in a compound-interest calculation.", minutes: 20, kitId: "calc", blueprints: 2, parts: 3, expedition: "A month of money", requires: "b-3" },
  { id: "b-5", subject: "finance", title: "Your money page",
    prompt: "Write a short analysis of the fictional budget, the comparison, and the savings calculation. Explain one choice you would change and what the figures tell you about it.",
    why: "Use calculations to defend a budget decision.", minutes: 30, kitId: "calc", blueprints: 1, parts: 3, expedition: "A month of money", requires: "b-4" },
];
