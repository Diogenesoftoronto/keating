import { Domain, TopicDefinition } from "./types.js";

export type { TopicDefinition } from "./types.js";
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
  },
  recursion: {
    slug: "recursion",
    title: "Recursion",
    domain: "code",
    summary: "Recursion solves a problem by having a function call itself on a smaller subproblem until it reaches a base case.",
    intuition: [
      "Think of Russian nesting dolls: open one to find a smaller version of the same thing inside.",
      "Every recursive process needs a stopping point (base case) and a way to get closer to it."
    ],
    formalCore: [
      "A recursive function calls itself with arguments that converge toward a base case.",
      "The call stack stores each invocation's local state until the base case returns."
    ],
    prerequisites: ["functions", "call stack", "conditional branching"],
    misconceptions: [
      "Stack overflow is not the same as infinite recursion; it is the consequence of unbounded recursion hitting memory limits.",
      "Recursion is not inherently slower than iteration; tail-call optimization can make them equivalent."
    ],
    examples: [
      "Factorial: n! = n * (n-1)! with base case 0! = 1.",
      "Fibonacci sequence computed recursively, then improved with memoization."
    ],
    exercises: [
      "Trace the call stack for factorial(4) by hand.",
      "Convert a recursive function to an iterative one using an explicit stack."
    ],
    reflections: [
      "When is recursion clearer than iteration, and when is it a trap?",
      "How does memoization change the computational cost of naive recursion?"
    ],
    diagramNodes: ["Base Case", "Recursive Case", "Call Stack", "Return Path", "Subproblem"],
    formalism: 0.75,
    visualizable: true,
    interdisciplinaryHooks: ["mathematical induction", "fractal geometry", "divide and conquer algorithms"]
  },
  precedent: {
    slug: "precedent",
    title: "Legal Precedent",
    domain: "law",
    summary: "Precedent is the principle that courts should follow earlier decisions on similar facts to ensure consistency and predictability.",
    intuition: [
      "Courts treat past rulings like promises: if a similar case was decided a certain way, future cases should follow unless there is a strong reason to depart.",
      "Stare decisis ('stand by things decided') is the Latin name for this commitment to consistency."
    ],
    formalCore: [
      "The ratio decidendi (reason for deciding) of a case is the binding part; obiter dicta (things said in passing) are persuasive but not binding.",
      "Precedent can be distinguished (shown to differ on material facts), overruled (explicitly rejected by a higher court), or departed from in exceptional circumstances."
    ],
    prerequisites: ["court hierarchy", "case law", "statutory interpretation"],
    misconceptions: [
      "Precedent is not absolute; courts can and do depart from or overrule past decisions.",
      "Only the ratio decidendi binds, not every statement a judge makes in an opinion."
    ],
    examples: [
      "Donoghue v Stevenson (1932) establishing the modern duty of care in negligence.",
      "Brown v Board of Education (1954) overruling Plessy v Ferguson on racial segregation."
    ],
    exercises: [
      "Read a case summary and identify the ratio decidendi versus obiter dicta.",
      "Argue why a precedent should or should not apply to a new set of facts."
    ],
    reflections: [
      "When does consistency serve justice, and when does it entrench past mistakes?",
      "How does the tension between stability and adaptability shape a legal system?"
    ],
    diagramNodes: ["Facts", "Ratio Decidendi", "Obiter Dicta", "Binding Authority", "Distinguishing"],
    formalism: 0.55,
    visualizable: false,
    interdisciplinaryHooks: ["political philosophy", "institutional design", "ethics of consistency"]
  },
  "separation-of-powers": {
    slug: "separation-of-powers",
    title: "Separation of Powers",
    domain: "politics",
    summary: "Separation of powers divides government authority among distinct branches so that no single entity can accumulate unchecked control.",
    intuition: [
      "Imagine three people sharing a kitchen: one decides the recipe (legislature), one cooks (executive), one tastes and judges quality (judiciary).",
      "Each branch has tools to resist encroachment by the others — checks and balances."
    ],
    formalCore: [
      "The legislature makes law, the executive enforces it, and the judiciary interprets it.",
      "Checks and balances (veto, judicial review, confirmation power) prevent any branch from dominating."
    ],
    prerequisites: ["branches of government", "constitutionalism", "rule of law"],
    misconceptions: [
      "The branches are not equal in power at all times; the balance shifts with political context.",
      "Separation of powers does not mean the branches never interact — overlap and negotiation are by design."
    ],
    examples: [
      "The US President's veto power and Congress's ability to override it.",
      "Judicial review as established in Marbury v Madison (1803)."
    ],
    exercises: [
      "Map a recent political conflict to the branch interactions involved.",
      "Compare separation of powers in a presidential system versus a parliamentary system."
    ],
    reflections: [
      "What happens when one branch consistently defers to another?",
      "Is the theory of separated powers a description or an aspiration?"
    ],
    diagramNodes: ["Legislature", "Executive", "Judiciary", "Checks", "Balances"],
    formalism: 0.45,
    visualizable: true,
    interdisciplinaryHooks: ["constitutional law", "game theory", "institutional economics"]
  },
  "cognitive-bias": {
    slug: "cognitive-bias",
    title: "Cognitive Bias",
    domain: "psychology",
    summary: "Cognitive biases are systematic patterns where human judgment departs from normative rationality in predictable directions.",
    intuition: [
      "Your brain uses shortcuts (heuristics) that usually work but sometimes misfire in predictable ways.",
      "Anchoring: the first number you hear warps your subsequent estimates even when it is irrelevant."
    ],
    formalCore: [
      "A bias is systematic (not random) and directional (pushes judgment in a specific direction).",
      "Key biases: anchoring, confirmation bias, availability heuristic, representativeness, loss aversion."
    ],
    prerequisites: ["heuristics", "probability", "decision-making"],
    misconceptions: [
      "Knowing about a bias does not automatically debias you; structured procedures are usually needed.",
      "Not every error in judgment is a 'cognitive bias'; the term has specific empirical criteria."
    ],
    examples: [
      "Anchoring in salary negotiation: the first number proposed shifts the outcome.",
      "Confirmation bias in research: seeking evidence that supports your hypothesis while ignoring disconfirming data."
    ],
    exercises: [
      "Design a simple experiment to demonstrate anchoring in a group.",
      "Identify which bias is operating in a given decision scenario."
    ],
    reflections: [
      "When are heuristics adaptive rather than biased?",
      "How should we interpret bias research given the replication crisis in psychology?"
    ],
    diagramNodes: ["Heuristic", "Bias", "Normative Standard", "Debiasing", "Ecological Rationality"],
    formalism: 0.50,
    visualizable: true,
    interdisciplinaryHooks: ["behavioral economics", "epistemology", "AI alignment"]
  },
  "evidence-based-medicine": {
    slug: "evidence-based-medicine",
    title: "Evidence-Based Medicine",
    domain: "medicine",
    summary: "Evidence-based medicine integrates the best available research evidence with clinical expertise and patient values to guide healthcare decisions.",
    intuition: [
      "Not all evidence is equal: a well-run randomized trial tells you more than a handful of anecdotes.",
      "The number needed to treat (NNT) makes benefit concrete — how many patients must be treated for one to benefit?"
    ],
    formalCore: [
      "The evidence hierarchy ranks study designs: systematic reviews and RCTs at the top, case reports and expert opinion at the bottom.",
      "Clinical significance (effect size, NNT) and statistical significance (p-value) are distinct concepts."
    ],
    prerequisites: ["study design", "statistical significance", "clinical outcomes"],
    misconceptions: [
      "Statistical significance does not imply clinical importance; a tiny effect can be statistically significant.",
      "Observational studies are not worthless — they are essential when RCTs are infeasible or unethical."
    ],
    examples: [
      "The Cochrane review process for synthesizing trial evidence.",
      "NNT for statins in primary cardiovascular prevention."
    ],
    exercises: [
      "Calculate NNT from absolute risk reduction in a trial summary.",
      "Rank three studies by their position in the evidence hierarchy and explain why."
    ],
    reflections: [
      "When should clinical judgment override the published evidence?",
      "How do patient values interact with population-level evidence?"
    ],
    diagramNodes: ["Evidence Hierarchy", "RCT", "Systematic Review", "Clinical Expertise", "Patient Values"],
    formalism: 0.70,
    visualizable: true,
    interdisciplinaryHooks: ["biostatistics", "philosophy of science", "health policy"]
  },
  counterpoint: {
    slug: "counterpoint",
    title: "Counterpoint",
    domain: "arts",
    summary: "Counterpoint is the art of combining independent melodic voices so they sound coherent together.",
    intuition: [
      "Imagine two people singing different melodies at the same time — counterpoint is the set of principles that makes them harmonize rather than clash.",
      "Each voice has its own melodic life, but they must agree at key moments (consonances) and resolve tension (dissonances) gracefully."
    ],
    formalCore: [
      "Species counterpoint progresses through five species, each adding rhythmic complexity to a cantus firmus.",
      "Rules govern intervals (consonant vs dissonant), voice motion (parallel, contrary, oblique), and the treatment of dissonance (passing tones, suspensions)."
    ],
    prerequisites: ["intervals", "consonance and dissonance", "melodic motion"],
    misconceptions: [
      "Counterpoint is not just 'harmony with two melodies'; it prioritizes horizontal (melodic) independence over vertical (chordal) logic.",
      "Following the rules mechanically does not produce good counterpoint; the rules describe constraints within which musical taste operates."
    ],
    examples: [
      "Bach's Two-Part Inventions as studies in imitative counterpoint.",
      "First-species counterpoint: note-against-note with only consonant intervals."
    ],
    exercises: [
      "Write a first-species counterpoint above a given cantus firmus.",
      "Identify parallel fifths and octaves in a short two-voice passage."
    ],
    reflections: [
      "Why did composers develop strict rules only to break them?",
      "How does counterpoint relate to the broader tension between freedom and constraint in art?"
    ],
    diagramNodes: ["Cantus Firmus", "Species", "Voice Motion", "Consonance", "Resolution"],
    formalism: 0.60,
    visualizable: true,
    interdisciplinaryHooks: ["acoustics", "mathematical structure in music", "aesthetic philosophy"]
  },
  "industrial-revolution": {
    slug: "industrial-revolution",
    title: "Industrial Revolution",
    domain: "history",
    summary: "The Industrial Revolution was a period of rapid technological, economic, and social transformation that began in Britain in the late 18th century.",
    intuition: [
      "For most of history, economic output grew barely faster than population; then something changed and output per person began doubling every few decades.",
      "The revolution was not just machines — it was a shift in how energy, labor, and knowledge combined."
    ],
    formalCore: [
      "Key factors: cheap energy (coal), institutional environment (property rights, patent law), labor supply, and capital accumulation.",
      "Periodization matters: the first Industrial Revolution (~1760-1840) centered on textiles and steam; the second (~1870-1914) on steel, chemicals, and electricity."
    ],
    prerequisites: ["pre-industrial economy", "mercantilism", "agricultural revolution"],
    misconceptions: [
      "The Industrial Revolution was not purely technological; institutional, demographic, and geographic factors were equally important.",
      "Living standards did not immediately improve for everyone — the first generations of factory workers often faced harsh conditions."
    ],
    examples: [
      "The cotton gin and spinning jenny transforming textile production.",
      "The railway boom of the 1840s connecting markets and reshaping geography."
    ],
    exercises: [
      "Place five key inventions on a timeline and explain their causal connections.",
      "Compare the British and continental European paths to industrialization."
    ],
    reflections: [
      "Why did the Industrial Revolution start in Britain rather than elsewhere?",
      "What parallels exist between the Industrial Revolution and today's digital transformation?"
    ],
    diagramNodes: ["Energy", "Technology", "Institutions", "Labor", "Periodization", "Consequences"],
    formalism: 0.35,
    visualizable: true,
    interdisciplinaryHooks: ["economic history", "sociology of technology", "environmental history"]
  },
  relativity: {
    slug: "relativity",
    title: "Special Relativity",
    domain: "science",
    summary: "Special relativity reveals that space and time are linked, and that the laws of physics are the same for all observers moving at constant velocity.",
    intuition: [
      "Imagine you are on a perfectly smooth train: without looking out the window, you can't tell if you are moving or sitting still.",
      "Light always travels at the same speed, no matter how fast you chase it. To keep the speed of light constant, time itself must stretch and space must shrink."
    ],
    formalCore: [
      "The two postulates: the laws of physics are invariant in all inertial frames, and the speed of light in vacuum is constant for all observers.",
      "Lorentz transformations describe how coordinates change between frames, leading to time dilation and length contraction."
    ],
    prerequisites: ["velocity", "inertial frames", "Pythagorean theorem"],
    misconceptions: [
      "Relativity does not mean 'everything is subjective'; it means specific measurements are relative, but the laws (and the spacetime interval) are absolute.",
      "Time dilation is not an optical illusion; it is a physical change in the passage of time."
    ],
    examples: [
      "Muons reaching the Earth's surface due to time dilation.",
      "GPS satellites requiring relativistic corrections to stay synchronized."
    ],
    exercises: [
      "Calculate the time dilation factor for a ship traveling at 0.8c.",
      "Explain the 'twin paradox' and identify where the symmetry breaks."
    ],
    reflections: [
      "How does the constant speed of light force us to abandon the idea of absolute simultaneity?",
      "What does it mean for 'now' to be a local, rather than universal, concept?"
    ],
    diagramNodes: ["Postulates", "Light Speed", "Time Dilation", "Length Contraction", "Spacetime"],
    formalism: 0.88,
    visualizable: true,
    interdisciplinaryHooks: ["philosophy of time", "astrophysics", "GPS technology"]
  },
  "social-contract": {
    slug: "social-contract",
    title: "Social Contract Theory",
    domain: "philosophy",
    summary: "Social contract theory argues that political authority and moral obligations are derived from an implicit agreement among individuals to form a society.",
    intuition: [
      "Imagine a 'state of nature' with no laws or government. To escape the chaos, everyone agrees to give up some freedoms in exchange for collective security.",
      "The legitimacy of a ruler depends on whether they uphold their end of the bargain."
    ],
    formalCore: [
      "Hobbes: the contract is an absolute surrender to a sovereign to avoid a life that is 'nasty, brutish, and short'.",
      "Locke: the contract is conditional, intended to protect natural rights (life, liberty, property), with a right to revolution if the sovereign fails."
    ],
    prerequisites: ["sovereignty", "natural rights", "state of nature"],
    misconceptions: [
      "The 'contract' is a philosophical tool, not a historical document that people actually signed.",
      "Social contract theory is not the same as pure democracy; it is about the *source* of legitimacy, not just the *form* of government."
    ],
    examples: [
      "The US Declaration of Independence as a Lockean document.",
      "Modern taxation as a trade-off for public infrastructure and safety."
    ],
    exercises: [
      "Compare and contrast Hobbes's and Rousseau's views on the 'general will'.",
      "Apply social contract theory to a modern issue, like digital privacy or vaccine mandates."
    ],
    reflections: [
      "What happens to the contract if someone cannot 'opt out' of the state?",
      "How does the theory handle obligations to future generations who didn't 'sign'?"
    ],
    diagramNodes: ["State of Nature", "Agreement", "Sovereign", "Rights", "Legitimacy"],
    formalism: 0.52,
    visualizable: true,
    interdisciplinaryHooks: ["political science", "legal theory", "ethics"]
  }
};

const DOMAIN_KEYWORDS: Record<string, Domain> = {};
for (const [kw, d] of [
  ["function", "code"], ["algorithm", "code"], ["programming", "code"], ["code", "code"],
  ["loop", "code"], ["variable", "code"], ["compiler", "code"], ["data-structure", "code"],
  ["class", "code"], ["inheritance", "code"], ["api", "code"], ["database", "code"],
  ["court", "law"], ["statute", "law"], ["legal", "law"], ["tort", "law"],
  ["contract", "law"], ["constitution", "law"], ["rights", "law"], ["jurisdiction", "law"],
  ["democracy", "politics"], ["election", "politics"], ["sovereignty", "politics"],
  ["ideology", "politics"], ["parliament", "politics"], ["governance", "politics"],
  ["memory", "psychology"], ["emotion", "psychology"], ["behavior", "psychology"],
  ["cognition", "psychology"], ["perception", "psychology"], ["personality", "psychology"],
  ["diagnosis", "medicine"], ["treatment", "medicine"], ["pathology", "medicine"],
  ["clinical", "medicine"], ["anatomy", "medicine"], ["pharmacology", "medicine"],
  ["painting", "arts"], ["sculpture", "arts"], ["music", "arts"], ["composition", "arts"],
  ["poetry", "arts"], ["theatre", "arts"], ["aesthetic", "arts"], ["harmony", "arts"],
  ["war", "history"], ["empire", "history"], ["revolution", "history"], ["medieval", "history"],
  ["colonial", "history"], ["ancient", "history"], ["civilization", "history"],
  ["theorem", "math"], ["proof", "math"], ["calculus", "math"], ["algebra", "math"],
  ["geometry", "math"], ["integral", "math"], ["topology", "math"],
  ["evolution", "science"], ["quantum", "science"], ["thermodynamic", "science"],
  ["cell", "science"], ["gravity", "science"], ["relativity", "science"],
  ["ethics", "philosophy"], ["epistemology", "philosophy"], ["metaphysics", "philosophy"],
  ["logic", "philosophy"], ["existentialism", "philosophy"], ["ontology", "philosophy"]
] as const) {
  DOMAIN_KEYWORDS[kw] = d;
}

function guessDomain(slug: string): Domain {
  const words = slug.split("-");
  for (const word of words) {
    if (DOMAIN_KEYWORDS[word]) return DOMAIN_KEYWORDS[word];
  }
  return "general";
}

const DOMAIN_EXAMPLE_HINTS: Record<Domain, { examples: [string, string]; exercises: [string, string] }> = {
  code: {
    examples: ["Write a minimal runnable example demonstrating %s.", "Trace execution step by step for a simple input."],
    exercises: ["Ask the learner to predict the output of a short code snippet involving %s.", "Ask the learner to refactor or simplify a naive implementation."]
  },
  law: {
    examples: ["Cite one leading case or statute illustrating %s.", "Show how the rule applies differently across two jurisdictions."],
    exercises: ["Ask the learner to identify the ratio decidendi in a case summary.", "Ask the learner to argue both sides of a dispute involving %s."]
  },
  politics: {
    examples: ["Give one real-world example of %s in a democratic system.", "Contrast how %s operates in two different political systems."],
    exercises: ["Ask the learner to map a current event to the concept of %s.", "Ask the learner to evaluate a normative claim about %s."]
  },
  psychology: {
    examples: ["Describe one classic experiment related to %s.", "Give an everyday example where %s affects decision-making."],
    exercises: ["Ask the learner to design a simple study testing %s.", "Ask the learner to distinguish the empirical finding from folk-psychology intuition."]
  },
  medicine: {
    examples: ["Reference a systematic review or landmark trial related to %s.", "Compute or interpret a relevant clinical metric (NNT, sensitivity, specificity)."],
    exercises: ["Ask the learner to rank evidence sources by the evidence hierarchy.", "Ask the learner to distinguish mechanism-based reasoning from evidence-based conclusions about %s."]
  },
  arts: {
    examples: ["Analyze a specific work that exemplifies %s.", "Compare two works that take different approaches to %s."],
    exercises: ["Ask the learner to create a short exercise applying the technique of %s.", "Ask the learner to connect formal technique to expressive effect in a given work."]
  },
  history: {
    examples: ["Place %s on a timeline with at least two contextual events.", "Cite a primary source relevant to %s."],
    exercises: ["Ask the learner to distinguish primary sources from secondary interpretation.", "Ask the learner to compare two historians' accounts of %s."]
  },
  math: {
    examples: ["Give one scientific or mathematical example connected to %s.", "Show a worked proof or calculation involving %s."],
    exercises: ["Ask the learner to explain %s in their own words.", "Ask the learner to compare %s to a nearby concept."]
  },
  science: {
    examples: ["Give one experimental or observational example connected to %s.", "Connect %s to a measurable prediction."],
    exercises: ["Ask the learner to explain %s in their own words.", "Ask the learner to design an experiment that tests %s."]
  },
  philosophy: {
    examples: ["Give one philosophical thought experiment connected to %s.", "Show where two major thinkers disagree about %s."],
    exercises: ["Ask the learner to explain %s in their own words.", "Ask the learner to identify the strongest objection to %s."]
  },
  general: {
    examples: ["Give one scientific or mathematical example connected to %s.", "Give one philosophical or practical example connected to %s."],
    exercises: ["Ask the learner to explain %s in their own words.", "Ask the learner to compare %s to a nearby concept."]
  }
};

const VISUALIZABLE_DOMAINS: Set<Domain> = new Set([
  "math", "science", "code", "medicine", "psychology", "history", "arts"
]);

function buildFallbackTopic(rawTopic: string): TopicDefinition {
  const title = titleCase(rawTopic.trim());
  const slug = slugify(rawTopic);
  const domain = guessDomain(slug);
  const hints = DOMAIN_EXAMPLE_HINTS[domain];
  return {
    slug,
    title,
    domain,
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
    examples: hints.examples.map(e => e.replace(/%s/g, title)),
    exercises: hints.exercises.map(e => e.replace(/%s/g, title)),
    reflections: [
      `What would mastery of ${title} let you predict, compute, or judge better?`,
      `Where would ${title} likely break down or become controversial?`
    ],
    diagramNodes: ["Motivation", "Definition", "Mechanism", "Examples", "Limits", "Transfer"],
    formalism: domain === "math" ? 0.75 : domain === "code" ? 0.70 : domain === "medicine" ? 0.65 : 0.55,
    visualizable: VISUALIZABLE_DOMAINS.has(domain),
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
