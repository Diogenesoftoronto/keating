import { randomInt } from "node:crypto";

export const RANKED_SUBJECTS = {
  maths: "Maths",
  coding: "Coding",
  chemistry: "Chemistry",
  biology: "Biology",
  music: "Music",
  spanish: "Spanish",
  history: "History",
  law: "Law",
} as const;

export type RankedSubject = keyof typeof RANKED_SUBJECTS;
export type RankedItem = {
  family: string;
  objective: string;
  route: "micro" | "transfer";
  prompt: string;
  choices: string[];
  correct: number;
  explanation: string;
};

type ItemContent = {
  prompt: string;
  choices: [string, string, string];
  explanation: string;
};
type ItemFamily = {
  id: string;
  objective: string;
  route: RankedItem["route"];
  create(): ItemContent;
};

const families: Record<RankedSubject, ItemFamily[]> = {
  maths: [
    { id: "discount", objective: "percent-of-current-total", route: "transfer", create: () => {
      const cost = 10 * randomInt(7, 60);
      const discount = randomInt(1, 4);
      const fraction = discount / 10;
      const sale = Math.round(cost * (1 - fraction));
      return {
        prompt: `A $${cost} instrument is discounted by ${discount * 10}%. A ${discount * 10}% fee then applies to the sale price. What is the final cost?`,
        choices: [`$${(sale * (1 + fraction)).toFixed(2)}`, `$${cost.toFixed(2)}`, `$${sale.toFixed(2)}`],
        explanation: `The fee applies to $${sale}, the lower sale price. Multiply the sale price by ${1 + fraction}.`,
      };
    } },
    { id: "linear-repair", objective: "inverse-operations", route: "micro", create: () => {
      const slope = randomInt(2, 10), shift = randomInt(2, 15), root = randomInt(3, 18);
      const total = slope * root + shift;
      return {
        prompt: `A learner starts with ${slope}x + ${shift} = ${total} and writes ${slope}x = ${total + shift}. Which step repairs the solution?`,
        choices: [`Subtract ${shift} from both sides first.`, `Add ${shift} to both sides first.`, `Divide only the right side by ${slope} first.`],
        explanation: `Subtracting ${shift} from both sides preserves the equality and isolates ${slope}x.`,
      };
    } },
  ],
  coding: [
    { id: "step-range", objective: "exclusive-stop", route: "transfer", create: () => {
      const start = randomInt(2, 12), step = randomInt(2, 6), count = randomInt(3, 8);
      const stop = start + step * count;
      return {
        prompt: `How many times does the body of \`for i in range(${start}, ${stop}, ${step})\` run in Python?`,
        choices: [String(count), String(count + 1), String(count - 1)],
        explanation: `The first value is ${start}, the last is ${stop - step}, and the stop value ${stop} is excluded.`,
      };
    } },
    { id: "copy-list", objective: "reference-aliasing", route: "micro", create: () => {
      const original = randomInt(10, 50), replacement = original + randomInt(2, 18);
      return {
        prompt: `In Python, a = [${original}], b = a, and b[0] = ${replacement}. What is a[0] now?`,
        choices: [String(replacement), String(original), "The assignment raises an error."],
        explanation: "The assignment b = a gives the same list a second name. Mutating through b also changes what a sees.",
      };
    } },
  ],
  chemistry: [
    { id: "dilution", objective: "conservation-of-solute", route: "transfer", create: () => {
      const initial = randomInt(2, 8);
      const volume = 10 * randomInt(5, 15);
      return {
        prompt: `You add ${volume} mL of pure water to ${volume} mL of a ${initial} mol/L salt solution. What is the final salt concentration, assuming additive volumes?`,
        choices: [`${initial / 2} mol/L`, `${initial} mol/L`, `${initial * 2} mol/L`],
        explanation: "The amount of salt stays constant while the volume doubles. Concentration is amount divided by volume.",
      };
    } },
    { id: "catalyst", objective: "activation-energy", route: "micro", create: () => ({
      prompt: "A catalyst speeds a reaction that was already at equilibrium. What does it change?",
      choices: ["The rates of both forward and reverse reactions.", "The equilibrium constant.", "The equilibrium concentrations."],
      explanation: "A catalyst speeds both reactions. The equilibrium constant and concentrations stay the same at the same temperature.",
    }) },
  ],
  biology: [
    { id: "selective-membrane", objective: "osmosis", route: "transfer", create: () => ({
      prompt: "A cell with low internal salt concentration enters a concentrated salt solution. The membrane lets water through but retains salt. What happens first?",
      choices: ["Water leaves the cell.", "Water enters the cell.", "Salt leaves the cell."],
      explanation: "Water moves toward the higher solute concentration. The membrane blocks salt, so the effect begins with water leaving.",
    }) },
    { id: "enzymes", objective: "catalytic-function", route: "micro", create: () => ({
      prompt: "An enzyme loses activity after severe heating. Which observation supports denaturation?",
      choices: ["The enzyme's folded shape changes.", "The enzyme's concentration doubles.", "The solution's volume stays constant."],
      explanation: "Denaturation changes the folded structure, which can alter the active site and stop catalysis.",
    }) },
  ],
  music: [
    { id: "compound-meter", objective: "beat-subdivision", route: "transfer", create: () => ({
      prompt: "A phrase has six eighth notes grouped into two equal beats. Which metre fits that phrasing?",
      choices: ["6/8", "3/4", "2/8"],
      explanation: "6/8 is compound duple metre: two dotted-quarter-note beats, each divided into three eighth notes.",
    }) },
    { id: "interval", objective: "semitone-distance", route: "micro", create: () => {
      const start = ["C", "D", "E", "F", "G", "A", "B"][randomInt(7)];
      return {
        prompt: `On a piano, how many semitone steps above ${start} is its perfect fifth?`,
        choices: ["7", "5", "8"],
        explanation: "A perfect fifth spans seven semitone steps regardless of the starting pitch.",
      };
    } },
  ],
  spanish: [
    { id: "agreement", objective: "adjective-agreement", route: "transfer", create: () => ({
      prompt: "Choose the phrase that means “the red houses.”",
      choices: ["las casas rojas", "las casas rojos", "la casas roja"],
      explanation: "Casas is feminine plural. Las and rojas both agree with it.",
    }) },
    { id: "time-marker", objective: "past-event", route: "micro", create: () => ({
      prompt: "Which form completes “Ayer, yo ___ con mi hermana” for a single completed conversation?",
      choices: ["hablé", "hablo", "hablaré"],
      explanation: "Ayer locates the completed event in the past. Hablé is the first-person singular preterite.",
    }) },
  ],
  history: [
    { id: "contextual-source", objective: "source-context", route: "transfer", create: () => ({
      prompt: "A wartime poster urges citizens to buy government bonds. Which question can the poster itself help answer?",
      choices: ["What appeals did the government use to encourage bond purchases?", "How many citizens bought bonds after seeing it?", "How much did the war ultimately cost?"],
      explanation: "The poster shows its persuasive message. Participation and war costs require additional records.",
    }) },
    { id: "corroboration", objective: "independent-sources", route: "micro", create: () => ({
      prompt: "Three newspapers reproduce the same eyewitness wire report. Which evidence would best corroborate the event?",
      choices: ["A separately documented account by another witness.", "A fourth newspaper copying the report.", "A later book citing the same report."],
      explanation: "Independent evidence gives corroboration. Copies and later citations inherit the original report's limitations.",
    }) },
  ],
  law: [
    { id: "rule-application", objective: "necessary-conditions", route: "transfer", create: () => ({
      prompt: "A fictional contest rule requires both a signed form and submission by noon. A signed form arrives at 12:05. Which conclusion follows from that rule?",
      choices: ["The submission misses a required condition.", "The signature makes the submission timely.", "The filing time satisfies both conditions."],
      explanation: "Both conditions are necessary. The signature satisfies one condition, and the 12:05 filing misses the other.",
    }) },
    { id: "authority", objective: "sources-of-law", route: "micro", create: () => ({
      prompt: "To quote the current wording of a statute, what should you consult first?",
      choices: ["The official current text published for that jurisdiction.", "A textbook discussing an earlier version.", "An editorial arguing that it should change."],
      explanation: "The official current text supplies the wording. Commentary can help explain its context or interpretation.",
    }) },
  ],
};

export function createRankedItem(subject: RankedSubject, priorUses: (id: string) => number): RankedItem {
  const candidates = families[subject];
  const fewestUses = Math.min(...candidates.map(family => priorUses(family.id)));
  const available = candidates.filter(family => priorUses(family.id) === fewestUses);
  const family = available[randomInt(available.length)]!;
  const { prompt, choices, explanation } = family.create();
  const correct = randomInt(choices.length);
  [choices[0], choices[correct]] = [choices[correct]!, choices[0]];
  return { family: family.id, objective: family.objective, route: family.route, prompt, choices, correct, explanation };
}
