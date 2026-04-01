import { TopicDefinition } from "./types.js";
import { slugify, titleCase } from "./util.js";

const TOPICS: Record<string, TopicDefinition> = {
  derivative: {
    slug: "derivative",
    title: "Derivative",
    domain: "math",
    summary: "The derivative measures how a quantity changes at an instant.",
    intuition: [
      "Start with average change over an interval, then shrink the interval toward a point.",
      "Connect slope-of-a-graph intuition to motion: velocity is the derivative of position."
    ],
    formalCore: [
      "Define the derivative as the limit of the difference quotient.",
      "Explain differentiability as a stronger condition than continuity."
    ],
    prerequisites: ["functions", "limits", "slope"],
    misconceptions: [
      "A derivative is not just plugging into a formula; it is an instantaneous rate of change.",
      "Continuity does not guarantee differentiability."
    ],
    examples: [
      "Differentiate x^2 and interpret the result geometrically.",
      "Use position and velocity for a moving particle."
    ],
    exercises: [
      "Estimate a derivative from a table of values.",
      "Compare a secant line and a tangent line."
    ],
    reflections: [
      "Why does shrinking the interval change average rate into instantaneous rate?",
      "What physical quantity becomes easier to reason about once you have derivatives?"
    ],
    diagramNodes: ["Prerequisites", "Intuition", "Limit", "Derivative", "Applications", "Exercises"],
    formalism: 0.85,
    visualizable: true,
    interdisciplinaryHooks: ["motion", "optimization", "scientific models"]
  },
  entropy: {
    slug: "entropy",
    title: "Entropy",
    domain: "science",
    summary: "Entropy tracks how many micro-configurations are compatible with what we observe macroscopically.",
    intuition: [
      "Contrast neat-looking states with the many more ways disorder can be arranged.",
      "Use information-theoretic intuition: surprising events carry more information."
    ],
    formalCore: [
      "Relate thermodynamic entropy to multiplicity and log-counting.",
      "Show the bridge to Shannon entropy for distributions."
    ],
    prerequisites: ["probability", "energy", "microstate vs macrostate"],
    misconceptions: [
      "Entropy is not simply 'chaos'; it is a count of compatible arrangements.",
      "Higher entropy does not mean less structure everywhere."
    ],
    examples: [
      "Mixing two gases in a box.",
      "Comparing a fair coin to a biased coin."
    ],
    exercises: [
      "Rank systems by relative entropy change.",
      "Explain why logarithms appear in entropy formulas."
    ],
    reflections: [
      "When does entropy feel like information instead of physics?",
      "How does coarse-graining shape the meaning of entropy?"
    ],
    diagramNodes: ["Multiplicity", "Macrostate", "Entropy", "Information", "Arrow of Time"],
    formalism: 0.78,
    visualizable: true,
    interdisciplinaryHooks: ["information theory", "statistical mechanics", "machine learning"]
  },
  bayes: {
    slug: "bayes-rule",
    title: "Bayes' Rule",
    domain: "math",
    summary: "Bayes' rule updates beliefs when new evidence arrives.",
    intuition: [
      "Start with prior belief and then scale it by how compatible the evidence is with each hypothesis.",
      "Use base-rate reasoning to avoid overreacting to a positive test."
    ],
    formalCore: [
      "Derive Bayes' rule from conditional probability.",
      "Separate prior, likelihood, evidence, and posterior."
    ],
    prerequisites: ["conditional probability", "fractions", "base rates"],
    misconceptions: [
      "A highly accurate test can still produce many false positives.",
      "Posterior probability is not the same as likelihood."
    ],
    examples: [
      "Medical testing with rare disease prevalence.",
      "Spam filtering using prior and evidence."
    ],
    exercises: [
      "Compute a posterior from a confusion matrix.",
      "Explain the difference between P(A|B) and P(B|A)."
    ],
    reflections: [
      "How do priors encode context rather than bias in the pejorative sense?",
      "When should you distrust your own posterior?"
    ],
    diagramNodes: ["Prior", "Evidence", "Likelihood", "Posterior", "Decision"],
    formalism: 0.8,
    visualizable: true,
    interdisciplinaryHooks: ["diagnostics", "scientific inference", "epistemology"]
  },
  falsifiability: {
    slug: "falsifiability",
    title: "Falsifiability",
    domain: "philosophy",
    summary: "A claim is scientifically risky when observation could in principle show it false.",
    intuition: [
      "Compare a risky prediction to a claim that explains every possible outcome.",
      "Use Popper's distinction between bold hypotheses and immunized stories."
    ],
    formalCore: [
      "Define falsifiability as a demarcation criterion, not a full theory of science.",
      "Connect the concept to test design and prediction."
    ],
    prerequisites: ["hypothesis", "prediction", "scientific method"],
    misconceptions: [
      "Unfalsifiable does not always mean meaningless; it means not testable as science.",
      "Single failed tests do not automatically settle complex theories."
    ],
    examples: [
      "General relativity versus vague pseudo-scientific claims.",
      "Forecasts that specify measurable outcomes."
    ],
    exercises: [
      "Rewrite a vague claim so it becomes testable.",
      "Separate scientific, metaphysical, and rhetorical statements."
    ],
    reflections: [
      "Why might a philosopher care about risky predictions?",
      "Where does falsifiability help, and where does it oversimplify?"
    ],
    diagramNodes: ["Claim", "Prediction", "Test", "Failure Condition", "Revision"],
    formalism: 0.58,
    visualizable: true,
    interdisciplinaryHooks: ["scientific practice", "epistemology", "model validation"]
  },
  stoicism: {
    slug: "stoicism",
    title: "Stoicism",
    domain: "philosophy",
    summary: "Stoicism trains attention toward what is under one's control and away from what is not.",
    intuition: [
      "Start with the dichotomy of control: actions and judgments are yours; outcomes are not.",
      "Frame emotion regulation as disciplined interpretation rather than suppression."
    ],
    formalCore: [
      "Explain virtue as the highest good in Stoic ethics.",
      "Connect Stoic practice to attention, judgment, and habit."
    ],
    prerequisites: ["virtue ethics", "self-control", "judgment"],
    misconceptions: [
      "Stoicism is not emotional numbness.",
      "Accepting outcomes does not mean passivity."
    ],
    examples: [
      "Handling criticism at work.",
      "Separating preparation from uncontrollable outcomes."
    ],
    exercises: [
      "Sort concerns into controllable and uncontrollable buckets.",
      "Rewrite an anxious thought in Stoic language."
    ],
    reflections: [
      "What changes if you judge effort, not outcome, as the main target?",
      "Where might Stoicism become too austere?"
    ],
    diagramNodes: ["Perception", "Judgment", "Control", "Action", "Reflection"],
    formalism: 0.42,
    visualizable: true,
    interdisciplinaryHooks: ["psychology", "habit formation", "ethics"]
  }
};

function buildFallbackTopic(rawTopic: string): TopicDefinition {
  const title = titleCase(rawTopic.trim());
  const slug = slugify(rawTopic);
  return {
    slug,
    title,
    domain: "general",
    summary: `${title} taught through intuition first, then structure, then transfer.`,
    intuition: [
      `Explain ${title} in concrete language before formal vocabulary.`,
      `Anchor ${title} in one memorable metaphor and one real-world example.`
    ],
    formalCore: [
      `State the core definition or thesis of ${title}.`,
      `Separate assumptions, mechanism, and scope of ${title}.`
    ],
    prerequisites: ["basic vocabulary", "one motivating example"],
    misconceptions: [
      `${title} is not just a slogan; it has structure, assumptions, and trade-offs.`,
      `Confusing an example of ${title} with the whole concept usually causes shallow understanding.`
    ],
    examples: [
      `Give one scientific or mathematical example connected to ${title}.`,
      `Give one philosophical or practical example connected to ${title}.`
    ],
    exercises: [
      `Ask the learner to explain ${title} in their own words.`,
      `Ask the learner to compare ${title} to a nearby concept.`
    ],
    reflections: [
      `What would mastery of ${title} let you predict, compute, or judge better?`,
      `Where would ${title} likely break down or become controversial?`
    ],
    diagramNodes: ["Motivation", "Definition", "Mechanism", "Examples", "Limits", "Transfer"],
    formalism: 0.55,
    visualizable: true,
    interdisciplinaryHooks: ["comparison", "application", "critique"]
  };
}

export function resolveTopic(query: string): TopicDefinition {
  const normalized = slugify(query);
  return TOPICS[normalized] ?? TOPICS[normalized.replace(/-rule$/, "")] ?? buildFallbackTopic(query);
}

export function benchmarkTopics(focusTopic?: string): TopicDefinition[] {
  if (focusTopic?.trim()) return [resolveTopic(focusTopic)];
  return Object.values(TOPICS);
}
