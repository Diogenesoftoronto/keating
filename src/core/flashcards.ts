/**
 * Flash Cards Engine — spaced-repetition flash cards with front/back and mnemonics.
 */

import { TopicDefinition, resolveTopic } from "./topics.js";

export interface FlashCard {
  id: string;
  front: string;
  back: string;
  mnemonic?: string;
  tags: string[];
  difficulty: "easy" | "medium" | "hard";
  source: "definition" | "intuition" | "misconception" | "example" | "transfer";
}

export interface FlashCardDeck {
  topic: string;
  slug: string;
  generatedAt: string;
  cards: FlashCard[];
}

export function generateFlashCards(topicName: string): FlashCardDeck {
  const topic = resolveTopic(topicName);
  const cards: FlashCard[] = [];

  // Definition card
  cards.push({
    id: `${topic.slug}-fc-def`,
    front: `What is ${topic.title}?`,
    back: topic.summary,
    tags: ["definition", topic.domain],
    difficulty: "easy",
    source: "definition"
  });

  // Formal core cards
  topic.formalCore.forEach((fc, i) => {
    cards.push({
      id: `${topic.slug}-fc-formal-${i}`,
      front: `Formal property of ${topic.title} (#${i + 1})`,
      back: fc,
      tags: ["formal", topic.domain],
      difficulty: "hard",
      source: "definition"
    });
  });

  // Intuition cards
  topic.intuition.forEach((inText, i) => {
    cards.push({
      id: `${topic.slug}-fc-intuition-${i}`,
      front: `Intuition check: What does "${inText}" mean for ${topic.title}?`,
      back: `This is a concrete way to think about ${topic.title} before formal notation.`,
      mnemonic: inText,
      tags: ["intuition", topic.domain],
      difficulty: "medium",
      source: "intuition"
    });
  });

  // Misconception cards (crucial for learning)
  topic.misconceptions.forEach((mis, i) => {
    cards.push({
      id: `${topic.slug}-fc-misconception-${i}`,
      front: `True or False: "${mis}"`,
      back: `FALSE. ${mis} is a common misconception.`,
      tags: ["misconception", topic.domain],
      difficulty: "hard",
      source: "misconception"
    });
  });

  // Example cards
  topic.examples.forEach((ex, i) => {
    cards.push({
      id: `${topic.slug}-fc-example-${i}`,
      front: `Worked example: ${ex}`,
      back: `This example illustrates ${topic.title} in practice.`,
      tags: ["example", topic.domain],
      difficulty: "medium",
      source: "example"
    });
  });

  // Reflection cards
  topic.reflections.forEach((ref, i) => {
    cards.push({
      id: `${topic.slug}-fc-reflection-${i}`,
      front: ref,
      back: `Consider ${topic.title} from a broader perspective. What changed in your understanding?`,
      tags: ["reflection", topic.domain],
      difficulty: "hard",
      source: "transfer"
    });
  });

  // Transfer card
  if (topic.interdisciplinaryHooks.length > 0) {
    cards.push({
      id: `${topic.slug}-fc-transfer`,
      front: `How does ${topic.title} connect to ${topic.interdisciplinaryHooks[0]}?`,
      back: `Build an analogy that preserves structural relationships, not surface features.`,
      tags: ["transfer", topic.domain],
      difficulty: "hard",
      source: "transfer"
    });
  }

  return {
    topic: topic.title,
    slug: topic.slug,
    generatedAt: new Date().toISOString(),
    cards
  };
}

export function flashcardsToMarkdown(deck: FlashCardDeck): string {
  const lines = [
    `# Flash Cards: ${deck.topic}`,
    `> ${deck.cards.length} cards | Generated: ${deck.generatedAt}`,
    ""
  ];

  for (const card of deck.cards) {
    lines.push(`---`);
    lines.push(`## ${card.id} [${card.difficulty}]`);
    lines.push(`**Front:** ${card.front}`);
    lines.push("");
    lines.push(`**Back:** ${card.back}`);
    if (card.mnemonic) {
      lines.push(`**Mnemonic:** ${card.mnemonic}`);
    }
    lines.push(`*Tags:* ${card.tags.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

/**
 * Anki-compatible TSV export (front \t back).
 */
export function flashcardsToAnki(deck: FlashCardDeck): string {
  const rows = deck.cards.map(c => {
    const front = c.front.replace(/\t/g, " ");
    const back = c.back.replace(/\t/g, " ");
    return `${front}\t${back}`;
  });
  return rows.join("\n");
}

/**
 * Mnemonics for selected topics.
 */
export function getMnemonic(topicName: string): string {
  const mnemonics: Record<string, string> = {
    derivative: "DERIV-ative: Differential Equation Reveals Instant Velocity",
    entropy: "ENTROPY: Energy Not Totally Recovered, Order Partially Yielded",
    bayes: "BAYES: Beliefs Are Updated, Evidence Subtracts",
    recursion: "RECURSION: Repeating Every Call Until Reaching Simple Initial-Case Output Now"
  };
  return mnemonics[topicName.toLowerCase()] ?? "";
}
