import type { KeatingBotState } from "./KeatingBot";

// Local presentation only: never send topic guesses or change the conversation.
const TOPICS: readonly [KeatingBotState, RegExp][] = [
  ["mycology", /\b(mycology|fungi|fungus|mushrooms?|myceli\w*)\b/i],
  ["palaeontology", /\b(pal[ae]+ontology|fossils?|dinosaurs?|trilobites?)\b/i],
  ["astronomy", /\b(astronomy|astrophysics|galax\w*|planets?|stars?|black holes?|cosmology)\b/i],
  ["electronics", /\b(electronics?|circuits?|resistors?|transistors?|arduino|semiconductors?)\b/i],
  ["chemistry", /\b(chemistry|chemical|molecules?|reactions?|periodic table|titration|stoichiometry)\b/i],
  ["biology", /\b(biology|biological|cells?|dna|genetics?|evolution|ecology|photosynthesis|anatomy)\b/i],
  ["physics", /\b(physics|quantum|gravity|mechanics|thermodynamics|relativity|electromagnetism)\b/i],
  ["maths", /\b(maths?|mathematics|algebra|geometry|calculus|equations?|statistics|trigonometry)\b/i],
  ["coding", /\b(coding|programming|typescript|javascript|python|rust|algorithms?|debugging|software)\b/i],
  ["music", /\b(music|melod\w*|rhythm|chords?|harmony|instruments?|songs?|piano|guitar)\b/i],
  ["reading", /\b(reading|books?|literature|poetry|novels?|linguistics|history|philosophy)\b/i],
  ["science", /\b(science|scientific|experiments?|hypothes[ie]s)\b/i],
];

type MascotMessage = {
  role: string;
  content: string | readonly { type: string; text?: string }[];
  status?: { type: string };
};

export function chatMascotState({ messages, running, recording }: {
  messages: readonly MascotMessage[];
  running: boolean;
  recording: boolean;
}): KeatingBotState {
  if (recording) return "listening";
  if (running) {
    const last = messages.at(-1);
    const part = Array.isArray(last?.content) ? last.content.at(-1) : undefined;
    return last?.role === "assistant" && last.status?.type === "running" && part?.type === "text" && part.text?.trim()
      ? "speaking" : "thinking";
  }
  // Use only the latest learner turn: old topics must not stick after a switch.
  let latest: MascotMessage | undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") { latest = messages[index]; break; }
  }
  const text = typeof latest?.content === "string" ? latest.content : latest?.content
    .filter(part => part.type === "text").map(part => part.text ?? "").join(" ") ?? "";
  return TOPICS.find(([, pattern]) => pattern.test(text))?.[0] ?? "idle";
}
