import type { TeachingPolicyCase, TeachingPolicyTurn } from "../../../src/judgement/teaching-policy-types.js";

/**
 * Authored proxy situations for the interaction-feature questions. Labels are
 * offline evaluation only and never reach the actor or judge. Omitted feature
 * ids are deliberately unlabeled because a reasonable reader could go either way.
 */
const EMPTY_TURN: TeachingPolicyTurn = {
  learnerMessage: "",
  conversation: [],
  learnerEvidence: [],
  availableTools: [],
  toolResults: [],
  sources: [],
  assessment: "none",
  improvementRuns: 0,
  domain: "general",
};

const labels = (positive: readonly string[], negative: readonly string[]): Record<string, boolean> =>
  Object.fromEntries([...positive.map((id) => [id, true]), ...negative.map((id) => [id, false])]);

const taught = (topic: string, lesson: string, reply: string): TeachingPolicyTurn["conversation"] => [
  { role: "user", content: `Can you teach me ${topic}?` },
  { role: "assistant", content: lesson },
  { role: "user", content: reply },
];

function interactionCase(id: string, split: TeachingPolicyCase["split"], turn: Partial<TeachingPolicyTurn>, expected: Record<string, boolean>): TeachingPolicyCase {
  return { id: `interaction-${id}`, family: `interaction-${id}`, split, turn: { ...EMPTY_TURN, ...turn }, ruleIds: [], expectedDecisions: expected };
}

export const INTERACTION_FEATURE_CASES: readonly TeachingPolicyCase[] = [
  // Development
  interactionCase("pendulum", "development", { learnerMessage: "Why does a longer pendulum swing more slowly?" },
    labels(["variable_relationship", "prediction_opportunity"], ["category_distinction", "ordered_procedure", "executable_code", "performed_skill", "language_learning", "extended_production", "outside_observation", "discrete_recall", "untested_coverage"])),
  interactionCase("mortgage-rate", "development", { learnerMessage: "How does changing the interest rate change my monthly mortgage payment?" },
    labels(["variable_relationship"], ["performed_skill", "language_learning", "visual_reference", "outside_observation"])),
  interactionCase("mitosis-order", "development", { learnerMessage: "I keep mixing up the order of the phases of mitosis." },
    labels(["ordered_procedure", "discrete_recall"], ["executable_code", "performed_skill", "variable_relationship", "outside_observation", "language_learning"])),
  interactionCase("python-range", "development", { learnerMessage: "Why does `for i in range(5): print(i)` print 0 to 4 instead of 1 to 5?" },
    labels(["executable_code", "prediction_opportunity"], ["performed_skill", "language_learning", "visual_reference", "extended_production", "discrete_recall", "structure_relations"])),
  interactionCase("rust-reverse", "development", { learnerMessage: "How do I reverse a string in Rust?" },
    labels(["executable_code"], ["performed_skill", "language_learning", "outside_observation", "visual_reference"])),
  interactionCase("spanish-past", "development", { learnerMessage: "How do I say 'I went to the market yesterday' in Spanish? I'm learning it for a trip." },
    labels(["language_learning"], ["prediction_opportunity", "ordered_procedure", "executable_code", "variable_relationship", "outside_observation", "structure_relations", "visual_reference"])),
  interactionCase("heart-valves", "development", { learnerMessage: "Where exactly are the heart's valves and which way does blood flow through them?" },
    labels(["visual_reference"], ["ordered_procedure", "category_distinction", "executable_code", "language_learning", "performed_skill", "extended_production"])),
  interactionCase("wwi-essay", "development", { learnerMessage: "Help me plan my 2,000-word history essay on the causes of the First World War." },
    labels(["extended_production", "structure_relations"], ["prediction_opportunity", "executable_code", "performed_skill", "variable_relationship", "visual_reference", "language_learning"])),
  interactionCase("sqrt2-proof", "development", { learnerMessage: "My assignment is to write a full proof that the square root of 2 is irrational. Where do I start?" },
    labels(["extended_production"], ["performed_skill", "language_learning", "outside_observation", "visual_reference"])),
  interactionCase("government-branches", "development", { learnerMessage: "How do the three branches of the US government check each other?" },
    labels(["structure_relations"], ["ordered_procedure", "executable_code", "performed_skill", "language_learning", "outside_observation"])),
  interactionCase("guitar-barre", "development", { learnerMessage: "My F barre chord buzzes on the guitar. How do I fix it?" },
    labels(["performed_skill"], ["prediction_opportunity", "category_distinction", "executable_code", "language_learning", "extended_production", "discrete_recall", "structure_relations"])),
  interactionCase("singing-flat", "development", { learnerMessage: "When I sing high notes I go flat. What am I doing wrong?" },
    labels(["performed_skill"], ["executable_code", "extended_production", "outside_observation"])),
  interactionCase("bird-feeder", "development", { learnerMessage: "Are there more birds at my feeder in the morning or the evening?" },
    labels(["outside_observation"], ["category_distinction", "executable_code", "language_learning", "performed_skill", "discrete_recall"])),
  interactionCase("platypus", "development", { learnerMessage: "Is a platypus a mammal? How do you tell mammals from reptiles?" },
    labels(["category_distinction"], ["ordered_procedure", "executable_code", "variable_relationship", "performed_skill", "outside_observation"])),
  interactionCase("affect-effect", "development", { learnerMessage: "When do I use 'affect' and when do I use 'effect'?" },
    labels(["category_distinction"], ["executable_code", "variable_relationship", "visual_reference", "outside_observation"])),
  interactionCase("cell-organelles-untested", "development", {
    learnerMessage: "OK, what next?",
    conversation: taught("cell organelles", "The nucleus stores DNA, ribosomes build proteins, and mitochondria release energy from food.", "Makes sense."),
  }, labels(["discrete_recall", "untested_coverage"], ["executable_code", "performed_skill", "outside_observation", "extended_production"])),
  interactionCase("organelles-already-tested", "development", {
    learnerMessage: "OK, what next?",
    conversation: [
      ...taught("cell organelles", "The nucleus stores DNA, ribosomes build proteins, and mitochondria release energy from food.", "Makes sense."),
      { role: "assistant", content: "Quick check: which organelle builds proteins, which stores DNA, and which releases energy?" },
      { role: "user", content: "Ribosomes build proteins, the nucleus stores DNA, mitochondria release energy." },
      { role: "assistant", content: "All three correct." },
    ],
  }, labels([], ["untested_coverage", "executable_code", "performed_skill", "outside_observation"])),
  interactionCase("factorial-trap", "development", { learnerMessage: "What is 4 factorial?" },
    labels([], ["prediction_opportunity", "discrete_recall", "variable_relationship", "ordered_procedure", "structure_relations", "category_distinction", "executable_code", "performed_skill", "language_learning", "visual_reference", "extended_production", "outside_observation", "untested_coverage"])),

  interactionCase("ohms-law", "development", { learnerMessage: "If I double the resistance in this circuit, what happens to the current?" },
    labels(["variable_relationship", "prediction_opportunity"], ["language_learning", "performed_skill", "outside_observation", "extended_production"])),
  interactionCase("git-order", "development", { learnerMessage: "What order do I run git add, commit and push, and why does the order matter?" },
    labels(["ordered_procedure", "executable_code"], ["performed_skill", "language_learning", "visual_reference", "outside_observation"])),
  interactionCase("cpr-steps", "development", { learnerMessage: "What are the steps of CPR, in order? I want to be ready if it happens." },
    labels(["ordered_procedure", "performed_skill"], ["executable_code", "language_learning", "extended_production", "category_distinction"])),
  interactionCase("japanese-greetings-untested", "development", {
    learnerMessage: "OK.",
    conversation: taught("Japanese greetings", "Ohayō gozaimasu is good morning, konnichiwa is hello during the day, and konbanwa is good evening.", "Got it."),
  }, labels(["language_learning", "discrete_recall", "untested_coverage"], ["executable_code", "outside_observation", "variable_relationship", "extended_production"])),
  interactionCase("italian-ordering", "development", { learnerMessage: "I'm learning Italian. Can you help me practise ordering food at a restaurant?" },
    labels(["language_learning"], ["executable_code", "variable_relationship", "visual_reference", "outside_observation"])),
  interactionCase("photosynthesis-untested", "development", {
    learnerMessage: "Right.",
    conversation: taught("photosynthesis", "Plants take in carbon dioxide and water, use light energy in the chloroplasts, and release oxygen and glucose.", "That makes sense."),
  }, labels(["untested_coverage", "discrete_recall"], ["executable_code", "performed_skill", "outside_observation", "language_learning"])),
  interactionCase("solar-system", "development", { learnerMessage: "Where are the planets relative to the sun and to each other?" },
    labels(["visual_reference"], ["executable_code", "language_learning", "performed_skill", "extended_production"])),
  interactionCase("flying-buttress", "development", { learnerMessage: "What does a flying buttress on a Gothic cathedral look like, and what does it do?" },
    labels(["visual_reference"], ["executable_code", "language_learning", "performed_skill", "outside_observation"])),
  interactionCase("park-leaves", "development", { learnerMessage: "For my science fair project I want to find out which trees in my park have the biggest leaves. How should I go about it?" },
    labels(["outside_observation", "extended_production"], ["executable_code", "language_learning", "performed_skill"])),
  interactionCase("genes-chromosomes", "development", { learnerMessage: "How are genes, chromosomes and DNA related to each other?" },
    labels(["structure_relations"], ["executable_code", "performed_skill", "outside_observation", "extended_production"])),
  interactionCase("tomato", "development", { learnerMessage: "Is a tomato a fruit or a vegetable? What decides it?" },
    labels(["category_distinction"], ["executable_code", "performed_skill", "outside_observation", "extended_production"])),
  interactionCase("rain-clouds", "development", { learnerMessage: "Do the clouds in the morning tell me whether it will rain later where I live? I want to check for myself." },
    labels(["outside_observation"], ["executable_code", "language_learning", "extended_production"])),

  // Holdout
  interactionCase("coffee-frost", "holdout", { learnerMessage: "What happens to the price of coffee if a frost destroys half the harvest?" },
    labels(["variable_relationship", "prediction_opportunity"], ["category_distinction", "untested_coverage", "executable_code", "language_learning", "performed_skill", "outside_observation", "discrete_recall"])),
  interactionCase("bread-knead", "holdout", { learnerMessage: "Does it matter whether I knead the dough before or after the first rise?" },
    labels(["ordered_procedure"], ["executable_code", "language_learning", "visual_reference", "structure_relations"])),
  interactionCase("long-division-steps", "holdout", { learnerMessage: "What order do the steps of long division go in? I always lose my place." },
    labels(["ordered_procedure"], ["executable_code", "performed_skill", "language_learning", "outside_observation"])),
  interactionCase("js-closure", "holdout", { learnerMessage: "Why does `for (var i = 0; i < 3; i++) setTimeout(() => console.log(i))` print 3 three times?" },
    labels(["executable_code", "prediction_opportunity"], ["performed_skill", "language_learning", "visual_reference", "discrete_recall", "structure_relations"])),
  interactionCase("sql-join", "holdout", { learnerMessage: "How do I write a SQL query that lists each customer with their total orders?" },
    labels(["executable_code"], ["prediction_opportunity", "untested_coverage", "performed_skill", "language_learning", "outside_observation", "visual_reference"])),
  interactionCase("french-r", "holdout", { learnerMessage: "I'm learning French. How do I pronounce the French 'r'?" },
    labels(["language_learning", "performed_skill"], ["executable_code", "extended_production", "variable_relationship", "structure_relations"])),
  interactionCase("german-perfect", "holdout", { learnerMessage: "Can you check my German sentence? 'Ich habe gestern ins Kino gegangen.'" },
    labels(["language_learning"], ["prediction_opportunity", "ordered_procedure", "executable_code", "variable_relationship", "visual_reference", "outside_observation"])),
  interactionCase("hand-bones", "holdout", { learnerMessage: "I need to learn to identify the bones of the hand for my anatomy exam." },
    labels(["visual_reference", "discrete_recall"], ["executable_code", "language_learning", "outside_observation", "variable_relationship"])),
  interactionCase("europe-rivers", "holdout", { learnerMessage: "Where are the major rivers of Europe relative to each other?" },
    labels(["visual_reference"], ["ordered_procedure", "category_distinction", "executable_code", "performed_skill", "language_learning", "extended_production"])),
  interactionCase("pond-food-web", "holdout", { learnerMessage: "How do the organisms in a pond food web depend on each other?" },
    labels(["structure_relations"], ["executable_code", "language_learning", "performed_skill", "extended_production"])),
  interactionCase("titration-report", "holdout", { learnerMessage: "I have to write a lab report on my titration experiment. How should I structure it?" },
    labels(["extended_production"], ["prediction_opportunity", "performed_skill", "language_learning", "variable_relationship", "visual_reference"])),
  interactionCase("dance-turn", "holdout", { learnerMessage: "I lose balance on my pirouette. What should I change?" },
    labels(["performed_skill"], ["category_distinction", "executable_code", "language_learning", "extended_production"])),
  interactionCase("school-traffic", "holdout", { learnerMessage: "How could I find out how many cars pass my school each hour?" },
    labels(["outside_observation"], ["category_distinction", "untested_coverage", "executable_code", "language_learning", "performed_skill", "discrete_recall"])),
  interactionCase("stream-cloudiness", "holdout", { learnerMessage: "Does the water in my local stream get cloudier after it rains?" },
    labels(["outside_observation"], ["executable_code", "language_learning", "performed_skill", "extended_production"])),
  interactionCase("virus-bacterium", "holdout", { learnerMessage: "What's the difference between a virus and a bacterium?" },
    labels(["category_distinction"], ["ordered_procedure", "executable_code", "performed_skill", "outside_observation", "variable_relationship"])),
  interactionCase("simile-metaphor", "holdout", { learnerMessage: "How do I tell a simile from a metaphor?" },
    labels(["category_distinction"], ["ordered_procedure", "executable_code", "variable_relationship", "visual_reference", "outside_observation"])),
  interactionCase("trig-ratios-untested", "holdout", {
    learnerMessage: "Got it, thanks.",
    conversation: taught("sine, cosine and tangent", "Sine is opposite over hypotenuse, cosine is adjacent over hypotenuse, and tangent is opposite over adjacent.", "OK."),
  }, labels(["discrete_recall", "untested_coverage"], ["performed_skill", "language_learning", "outside_observation", "extended_production"])),
  interactionCase("revolution-causes-untested", "holdout", {
    learnerMessage: "Cool.",
    conversation: taught("the causes of the French Revolution", "Three causes stand out: royal debt, bread prices after poor harvests, and Enlightenment ideas about rights.", "Interesting."),
  }, labels(["untested_coverage"], ["executable_code", "performed_skill", "outside_observation"])),
  interactionCase("capital-trap", "holdout", { learnerMessage: "What is the capital of Australia?" },
    labels([], ["prediction_opportunity", "discrete_recall", "variable_relationship", "ordered_procedure", "structure_relations", "category_distinction", "executable_code", "performed_skill", "language_learning", "visual_reference", "extended_production", "outside_observation", "untested_coverage"])),
  interactionCase("fox-rabbit", "holdout", { learnerMessage: "What happens to the fox population if the rabbits all die out?" },
    labels(["variable_relationship", "prediction_opportunity"], ["executable_code", "language_learning", "performed_skill", "extended_production"])),
  interactionCase("compounding", "holdout", { learnerMessage: "How does compounding monthly instead of yearly change how much my savings grow?" },
    labels(["variable_relationship"], ["performed_skill", "language_learning", "outside_observation", "visual_reference"])),
  interactionCase("bike-tyre", "holdout", { learnerMessage: "How do I fix a flat bike tyre, step by step?" },
    labels(["ordered_procedure", "performed_skill"], ["executable_code", "language_learning", "extended_production", "category_distinction"])),
  interactionCase("noble-gases-untested", "holdout", {
    learnerMessage: "Neat.",
    conversation: taught("the noble gases", "The noble gases are helium, neon, argon, krypton, xenon and radon. Their full outer shells make them barely reactive.", "Cool."),
  }, labels(["discrete_recall", "untested_coverage"], ["executable_code", "performed_skill", "outside_observation", "language_learning"])),
  interactionCase("immune-cells", "holdout", { learnerMessage: "How do B cells, T cells and antibodies work together?" },
    labels(["structure_relations"], ["executable_code", "language_learning", "outside_observation", "performed_skill"])),
  interactionCase("central-bank", "holdout", { learnerMessage: "How do the central bank, commercial banks and interest rates influence each other?" },
    labels(["structure_relations", "variable_relationship"], ["performed_skill", "language_learning", "outside_observation"])),
  interactionCase("alligator-crocodile", "holdout", { learnerMessage: "How do I tell an alligator from a crocodile?" },
    labels(["category_distinction", "visual_reference"], ["executable_code", "language_learning", "extended_production", "ordered_procedure"])),
  interactionCase("python-none", "holdout", { learnerMessage: "Why does my Python function return None instead of the list I built? `def f(xs): xs.sort()`" },
    labels(["executable_code", "prediction_opportunity"], ["performed_skill", "language_learning", "visual_reference", "outside_observation"])),
  interactionCase("backhand-grip", "holdout", { learnerMessage: "How should I hold my tennis racket for a backhand?" },
    labels(["performed_skill"], ["executable_code", "language_learning", "extended_production", "untested_coverage"])),
  interactionCase("mandarin-directions", "holdout", { learnerMessage: "I'm learning Mandarin. How do I ask for directions to the train station?" },
    labels(["language_learning"], ["executable_code", "variable_relationship", "visual_reference", "outside_observation"])),
  interactionCase("short-story", "holdout", { learnerMessage: "I'm writing a short story for a competition. How should I structure the plot?" },
    labels(["extended_production"], ["performed_skill", "language_learning", "executable_code", "outside_observation"])),
  interactionCase("portfolio-site", "holdout", { learnerMessage: "I need to build a small portfolio website for my course project. Where do I start?" },
    labels(["extended_production", "executable_code"], ["performed_skill", "language_learning", "outside_observation"])),
  interactionCase("moonrise", "holdout", { learnerMessage: "Does the moon rise at the same time every night where I live? I'd like to see for myself." },
    labels(["outside_observation", "prediction_opportunity"], ["executable_code", "language_learning", "extended_production"])),
];

/** Situations where the recommendation should be `none`: a bounded answer is the whole job. */
export const INTERACTION_OVERUSE_TRAPS: readonly string[] = ["interaction-factorial-trap", "interaction-capital-trap"];
