/**
 * Browser-compatible Keating core logic
 * Ports src/core/*.ts for browser use without Node.js dependencies
 */

// ============================================================================
// Types (from src/core/types.ts)
// ============================================================================

export type Domain =
	| "math"
	| "science"
	| "philosophy"
	| "code"
	| "law"
	| "politics"
	| "psychology"
	| "medicine"
	| "arts"
	| "history"
	| "general";

export interface TopicDefinition {
	slug: string;
	title: string;
	domain: Domain;
	summary: string;
	intuition: string[];
	formalCore: string[];
	prerequisites: string[];
	misconceptions: string[];
	examples: string[];
	exercises: string[];
	reflections: string[];
	diagramNodes: string[];
	formalism: number;
	visualizable: boolean;
	interdisciplinaryHooks: string[];
}

export interface TeacherPolicy {
	name: string;
	analogyDensity: number;
	socraticRatio: number;
	formalism: number;
	retrievalPractice: number;
	exerciseCount: number;
	diagramBias: number;
	reflectionBias: number;
	interdisciplinaryBias: number;
	challengeRate: number;
}

export interface SimulationWeights {
	masteryGain: number;
	retention: number;
	engagement: number;
	transfer: number;
	confusion: number;
}

export interface LessonPhase {
	id: string;
	title: string;
	purpose: string;
	bullets: string[];
}

export interface LessonPlan {
	topic: TopicDefinition;
	policy: TeacherPolicy;
	phases: LessonPhase[];
}

export interface LearnerProfile {
	id: string;
	priorKnowledge: number;
	abstractionComfort: number;
	analogyNeed: number;
	dialoguePreference: number;
	diagramAffinity: number;
	persistence: number;
	transferDesire: number;
	anxiety: number;
}

export interface TeachingSimulation {
	learner: LearnerProfile;
	topic: TopicDefinition;
	masteryGain: number;
	retention: number;
	engagement: number;
	transfer: number;
	confusion: number;
	score: number;
	breakdown: {
		intuitionFit: number;
		rigorFit: number;
		dialogueFit: number;
		diagramFit: number;
		practiceFit: number;
		reflectionFit: number;
		overload: number;
	};
	explanation: string[];
}

export interface ScoreableLearnerOutcome {
	topic: string;
	feedbackSignal: "thumbs-up" | "thumbs-down" | "confused";
	masteryEstimate: number;
	outcomeScore: number;
}

export interface TopicBenchmark {
	topic: TopicDefinition;
	learnerCount: number;
	meanScore: number;
	meanMasteryGain: number;
	meanRetention: number;
	meanEngagement: number;
	meanTransfer: number;
	meanConfusion: number;
	topLearners: TeachingSimulation[];
	strugglingLearners: TeachingSimulation[];
	dominantStrength: string;
	dominantWeakness: string;
}

export interface BenchmarkResult {
	policy: TeacherPolicy;
	suiteName: string;
	topicBenchmarks: TopicBenchmark[];
	overallScore: number;
	weakestTopic: string;
	trace: BenchmarkTrace;
}

export interface BenchmarkTrace {
	seed: number;
	learnerCountPerTopic: number;
	topicTraces: BenchmarkTopicTrace[];
	realOutcomeCount: number;
	syntheticFallback: boolean;
	dataSource?: "learner-feedback" | "learner-feedback-sparse" | "synthetic" | "no-learner-feedback";
}

export interface BenchmarkTopicTrace {
	topic: string;
	topLearners: Array<{
		learnerId: string;
		score: number;
		explanation: string[];
	}>;
	strugglingLearners: Array<{
		learnerId: string;
		score: number;
		explanation: string[];
	}>;
	metricMeans: {
		masteryGain: number;
		retention: number;
		engagement: number;
		transfer: number;
		confusion: number;
	};
	dominantStrength: string;
	dominantWeakness: string;
}

export interface EvolutionCandidate {
	policy: TeacherPolicy;
	benchmark: BenchmarkResult;
	counterfactualBenchmark?: BenchmarkResult;
	parentName: string | null;
	iteration: number;
	novelty: number;
	accepted: boolean;
	decision: {
		improves: boolean;
		safe: boolean;
		novelEnough: boolean;
		scoreDelta: number;
		weakestTopicDelta: number;
		reasons: string[];
	};
	parameterDelta: Array<{
		field: keyof TeacherPolicy;
		before: number | string;
		after: number | string;
		delta: number;
	}>;
	preferenceScore?: number;
}

export interface PromptObjectiveVector {
	voice_divergence: number;
	diagnosis: number;
	verification: number;
	retrieval: number;
	transfer: number;
	structure: number;
}

// ============================================================================
// Utilities
// ============================================================================

function clamp(value: number, min = 0, max = 1): number {
	return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function titleCase(text: string): string {
	return text
		.split(/\s+/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
}

// ============================================================================
// Benchmark Real Outcomes (ported from src/core/benchmark-real.ts)
// ============================================================================

export const MIN_REAL_OUTCOMES = 5;

export function feedbackToOutcomeScore(signal: "thumbs-up" | "thumbs-down" | "confused"): number {
	switch (signal) {
		case "thumbs-up": return 0.85;
		case "thumbs-down": return 0.15;
		case "confused": return 0.35;
	}
}

export function hasEnoughRealData(outcomes: ScoreableLearnerOutcome[]): boolean {
	return outcomes.length >= MIN_REAL_OUTCOMES;
}

export function blendRealSyntheticScore(realScore: number, syntheticMean: number, realOutcomeCount: number): number {
	const realShare = clamp(0.5 + Math.min(0.4, realOutcomeCount / 20), 0.5, 0.9);
	const syntheticShare = 1 - realShare;
	return clamp(realScore * realShare + syntheticMean * syntheticShare, 0, 1);
}

export function computeRealOutcomeScore(
	outcomes: ScoreableLearnerOutcome[],
	policy: TeacherPolicy,
	topic: TopicDefinition,
	weights: SimulationWeights
): TeachingSimulation {
	const defaultLearner: LearnerProfile = {
		id: "real-learner",
		priorKnowledge: 0.5,
		abstractionComfort: 0.5,
		analogyNeed: 0.5,
		dialoguePreference: 0.5,
		diagramAffinity: 0.5,
		persistence: 0.5,
		transferDesire: 0.5,
		anxiety: 0.3,
	};

	const avgOutcome = mean(outcomes.map((outcome) => outcome.outcomeScore));
	const upRatio =
		outcomes.filter((outcome) => outcome.feedbackSignal === "thumbs-up").length /
		outcomes.length;
	const confusedRatio =
		outcomes.filter((outcome) => outcome.feedbackSignal === "confused").length /
		outcomes.length;
	const downRatio =
		outcomes.filter((outcome) => outcome.feedbackSignal === "thumbs-down").length /
		outcomes.length;
	const avgMastery = mean(outcomes.map((outcome) => outcome.masteryEstimate));

	const masteryGain = clamp(avgOutcome * 0.6 + avgMastery * 0.4);
	const retention = clamp(
		masteryGain * (0.55 + policy.retrievalPractice * 0.45)
	);
	const engagement = clamp(avgOutcome * 0.7 + upRatio * 0.3);
	const transfer = clamp(
		retention * (0.55 + policy.interdisciplinaryBias * 0.25 + avgMastery * 0.2)
	);
	const confusion = clamp(confusedRatio * 0.6 + downRatio * 0.4);
	const score = clamp(
		masteryGain * weights.masteryGain +
			retention * weights.retention +
			engagement * weights.engagement +
			transfer * weights.transfer -
			confusion * weights.confusion,
		0,
		1
	);

	const explanations: string[] = [];
	if (upRatio > 0.6) explanations.push("learner gave mostly positive feedback");
	if (confusedRatio > 0.3) explanations.push("learner was frequently confused");
	if (downRatio > 0.2) explanations.push("learner gave substantial negative feedback");
	if (avgMastery > 0.7) explanations.push("mastery estimates are high");
	if (avgMastery < 0.3) explanations.push("mastery estimates are low");
	if (explanations.length === 0) explanations.push("learner feedback is mixed");

	return {
		learner: defaultLearner,
		topic,
		masteryGain,
		retention,
		engagement,
		transfer,
		confusion,
		score,
		breakdown: {
			intuitionFit: avgOutcome,
			rigorFit: avgOutcome * policy.formalism,
			dialogueFit: avgOutcome * policy.socraticRatio,
			diagramFit: avgOutcome * policy.diagramBias,
			practiceFit: clamp(upRatio * policy.exerciseCount / 5),
			reflectionFit: avgOutcome * policy.reflectionBias,
			overload: confusion,
		},
		explanation: ["Real learner outcome (N=" + outcomes.length + ").", ...explanations],
	};
}

export function simulateDeterministicTeaching(
	policy: TeacherPolicy,
	topic: TopicDefinition,
	learner: LearnerProfile,
	weights: SimulationWeights
): TeachingSimulation {
	const intuitionFit = 1 - Math.abs(policy.analogyDensity - learner.analogyNeed);
	const rigorTarget = clamp((topic.formalism + learner.abstractionComfort) / 2);
	const rigorFit = 1 - Math.abs(policy.formalism - rigorTarget);
	const dialogueFit = 1 - Math.abs(policy.socraticRatio - learner.dialoguePreference);
	const diagramTarget = topic.visualizable ? learner.diagramAffinity : 0.2;
	const diagramFit = 1 - Math.abs(policy.diagramBias - diagramTarget);
	const practiceNeed = clamp(1 - learner.priorKnowledge + learner.anxiety * 0.2);
	const practiceFit = 1 - Math.abs(policy.exerciseCount / 5 - practiceNeed);
	const reflectionFit = 1 - Math.abs(policy.reflectionBias - learner.transferDesire);
	const overload = clamp(
		policy.formalism * 0.35 +
			(policy.exerciseCount / 5) * 0.15 +
			policy.challengeRate * 0.3 -
			learner.persistence * 0.2 +
			learner.anxiety * 0.25 -
			learner.priorKnowledge * 0.15
	);

	const masteryGain = clamp(
		0.14 +
			intuitionFit * 0.18 +
			rigorFit * 0.2 +
			dialogueFit * 0.12 +
			diagramFit * 0.09 +
			practiceFit * 0.12 +
			(1 - overload) * 0.18
	);
	const retention = clamp(masteryGain * (0.55 + policy.retrievalPractice * 0.45));
	const engagement = clamp(
		0.12 +
			intuitionFit * 0.16 +
			dialogueFit * 0.16 +
			diagramFit * 0.1 +
			reflectionFit * 0.14 +
			(1 - overload) * 0.18
	);
	const transfer = clamp(
		masteryGain * (0.55 + policy.interdisciplinaryBias * 0.25 + learner.transferDesire * 0.2)
	);
	const confusion = clamp(
		0.04 +
			overload * 0.55 +
			Math.abs(policy.formalism - learner.abstractionComfort) * 0.18 +
			Math.abs(policy.challengeRate - learner.persistence) * 0.12
	);
	const score = clamp(
		masteryGain * weights.masteryGain +
			retention * weights.retention +
			engagement * weights.engagement +
			transfer * weights.transfer -
			confusion * weights.confusion,
		0,
		1
	);

	return {
		learner,
		topic,
		masteryGain,
		retention,
		engagement,
		transfer,
		confusion,
		score,
		breakdown: {
			intuitionFit,
			rigorFit,
			dialogueFit,
			diagramFit,
			practiceFit,
			reflectionFit,
			overload,
		},
		explanation: ["Deterministic algebraic baseline."],
	};
}

// ============================================================================
// Prng (from src/core/random.ts)
// ============================================================================

export class Prng {
	private state: number;

	constructor(seed: number) {
		this.state = seed;
	}

	next(): number {
		this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
		return this.state / 0x7fffffff;
	}

	int(min: number, max: number): number {
		return Math.floor(min + this.next() * (max - min + 1));
	}

	bool(): boolean {
		return this.next() >= 0.5;
	}
}

// ============================================================================
// Topics (from src/core/topics.ts)
// ============================================================================

const TOPICS: Record<string, TopicDefinition> = {
	derivative: {
		slug: "derivative",
		title: "Derivative",
		domain: "math",
		summary: "The derivative measures how a quantity changes at an instant.",
		intuition: [
			"Start with average change over an interval, then shrink the interval toward a point.",
			"Connect slope-of-a-graph intuition to motion: velocity is the derivative of position.",
		],
		formalCore: [
			"Define the derivative as the limit of the difference quotient.",
			"Explain differentiability as a stronger condition than continuity.",
		],
		prerequisites: ["functions", "limits", "slope"],
		misconceptions: [
			"A derivative is not just plugging into a formula; it is an instantaneous rate of change.",
			"Continuity does not guarantee differentiability.",
		],
		examples: [
			"Differentiate x^2 and interpret the result geometrically.",
			"Use position and velocity for a moving particle.",
		],
		exercises: [
			"Estimate a derivative from a table of values.",
			"Compare a secant line and a tangent line.",
		],
		reflections: [
			"Why does shrinking the interval change average rate into instantaneous rate?",
			"What physical quantity becomes easier to reason about once you have derivatives?",
		],
		diagramNodes: ["Prerequisites", "Intuition", "Limit", "Derivative", "Applications", "Exercises"],
		formalism: 0.85,
		visualizable: true,
		interdisciplinaryHooks: ["motion", "optimization", "scientific models"],
	},
	entropy: {
		slug: "entropy",
		title: "Entropy",
		domain: "science",
		summary: "Entropy tracks how many micro-configurations are compatible with what we observe macroscopically.",
		intuition: [
			"Contrast neat-looking states with the many more ways disorder can be arranged.",
			"Use information-theoretic intuition: surprising events carry more information.",
		],
		formalCore: [
			"Relate thermodynamic entropy to multiplicity and log-counting.",
			"Show the bridge to Shannon entropy for distributions.",
		],
		prerequisites: ["probability", "energy", "microstate vs macrostate"],
		misconceptions: [
			"Entropy is not simply 'chaos'; it is a count of compatible arrangements.",
			"Higher entropy does not mean less structure everywhere.",
		],
		examples: ["Mixing two gases in a box.", "Comparing a fair coin to a biased coin."],
		exercises: [
			"Rank systems by relative entropy change.",
			"Explain why logarithms appear in entropy formulas.",
		],
		reflections: [
			"When does entropy feel like information instead of physics?",
			"How does coarse-graining shape the meaning of entropy?",
		],
		diagramNodes: ["Multiplicity", "Macrostate", "Entropy", "Information", "Arrow of Time"],
		formalism: 0.78,
		visualizable: true,
		interdisciplinaryHooks: ["information theory", "statistical mechanics", "machine learning"],
	},
	bayes: {
		slug: "bayes-rule",
		title: "Bayes' Rule",
		domain: "math",
		summary: "Bayes' rule updates beliefs when new evidence arrives.",
		intuition: [
			"Start with prior belief and then scale it by how compatible the evidence is with each hypothesis.",
			"Use base-rate reasoning to avoid overreacting to a positive test.",
		],
		formalCore: [
			"Derive Bayes' rule from conditional probability.",
			"Separate prior, likelihood, evidence, and posterior.",
		],
		prerequisites: ["conditional probability", "fractions", "base rates"],
		misconceptions: [
			"A highly accurate test can still produce many false positives.",
			"Posterior probability is not the same as likelihood.",
		],
		examples: ["Medical testing with rare disease prevalence.", "Spam filtering using prior and evidence."],
		exercises: [
			"Compute a posterior from a confusion matrix.",
			"Explain the difference between P(A|B) and P(B|A).",
		],
		reflections: [
			"How do priors encode context rather than bias in the pejorative sense?",
			"When should you distrust your own posterior?",
		],
		diagramNodes: ["Prior", "Evidence", "Likelihood", "Posterior", "Decision"],
		formalism: 0.8,
		visualizable: true,
		interdisciplinaryHooks: ["diagnostics", "scientific inference", "epistemology"],
	},
	recursion: {
		slug: "recursion",
		title: "Recursion",
		domain: "code",
		summary: "Recursion solves a problem by having a function call itself on a smaller subproblem until it reaches a base case.",
		intuition: [
			"Think of Russian nesting dolls: open one to find a smaller version of the same thing inside.",
			"Every recursive process needs a stopping point (base case) and a way to get closer to it.",
		],
		formalCore: [
			"A recursive function calls itself with arguments that converge toward a base case.",
			"The call stack stores each invocation's local state until the base case returns.",
		],
		prerequisites: ["functions", "call stack", "conditional branching"],
		misconceptions: [
			"Stack overflow is not the same as infinite recursion; it is the consequence of unbounded recursion hitting memory limits.",
			"Recursion is not inherently slower than iteration; tail-call optimization can make them equivalent.",
		],
		examples: [
			"Factorial: n! = n * (n-1)! with base case 0! = 1.",
			"Fibonacci sequence computed recursively, then improved with memoization.",
		],
		exercises: [
			"Trace the call stack for factorial(4) by hand.",
			"Convert a recursive function to an iterative one using an explicit stack.",
		],
		reflections: [
			"When is recursion clearer than iteration, and when is it a trap?",
			"How does memoization change the computational cost of naive recursion?",
		],
		diagramNodes: ["Base Case", "Recursive Case", "Call Stack", "Return Path", "Subproblem"],
		formalism: 0.75,
		visualizable: true,
		interdisciplinaryHooks: ["mathematical induction", "fractal geometry", "divide and conquer algorithms"],
	},
};

const DOMAIN_KEYWORDS: Record<string, Domain> = {
	function: "code",
	algorithm: "code",
	programming: "code",
	code: "code",
	class: "code",
	database: "code",
	theorem: "math",
	proof: "math",
	calculus: "math",
	algebra: "math",
	evolution: "science",
	quantum: "science",
	relativity: "science",
	ethics: "philosophy",
	logic: "philosophy",
	court: "law",
	statute: "law",
	democracy: "politics",
	memory: "psychology",
	diagnosis: "medicine",
	painting: "arts",
	music: "arts",
	war: "history",
	revolution: "history",
};

function guessDomain(slug: string): Domain {
	const words = slug.split("-");
	for (const word of words) {
		if (DOMAIN_KEYWORDS[word]) return DOMAIN_KEYWORDS[word];
	}
	return "general";
}

function buildFallbackTopic(rawTopic: string): TopicDefinition {
	const title = titleCase(rawTopic.trim());
	const slug = slugify(rawTopic);
	const domain = guessDomain(slug);
	return {
		slug,
		title,
		domain,
		summary: `${title} taught through intuition first, then structure, then transfer.`,
		intuition: [
			`Explain ${title} in concrete language before formal vocabulary.`,
			`Anchor ${title} in one memorable metaphor and one real-world example.`,
		],
		formalCore: [
			`State the core definition or thesis of ${title}.`,
			`Separate assumptions, mechanism, and scope of ${title}.`,
		],
		prerequisites: ["basic vocabulary", "one motivating example"],
		misconceptions: [
			`${title} is not just a slogan; it has structure, assumptions, and trade-offs.`,
			`Confusing an example of ${title} with the whole concept usually causes shallow understanding.`,
		],
		examples: [`Give one scientific or mathematical example connected to ${title}.`],
		exercises: [`Ask the learner to explain ${title} in their own words.`],
		reflections: [
			`What would mastery of ${title} let you predict, compute, or judge better?`,
			`Where would ${title} likely break down or become controversial?`,
		],
		diagramNodes: ["Motivation", "Definition", "Mechanism", "Examples", "Limits", "Transfer"],
		formalism: domain === "math" ? 0.75 : domain === "code" ? 0.7 : 0.55,
		visualizable: true,
		interdisciplinaryHooks: ["comparison", "application", "critique"],
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

// ============================================================================
// Policy
// ============================================================================

export const DEFAULT_POLICY: TeacherPolicy = {
	name: "keating-default",
	analogyDensity: 0.72,
	socraticRatio: 0.66,
	formalism: 0.64,
	retrievalPractice: 0.74,
	exerciseCount: 3,
	diagramBias: 0.7,
	reflectionBias: 0.68,
	interdisciplinaryBias: 0.62,
	challengeRate: 0.58,
};

export const DEFAULT_WEIGHTS: SimulationWeights = {
	masteryGain: 0.34,
	retention: 0.20,
	engagement: 0.16,
	transfer: 0.18,
	confusion: 0.18,
};

export function clampWeights(weights: SimulationWeights): SimulationWeights {
	const clamped: SimulationWeights = {
		masteryGain: clamp(weights.masteryGain, 0.01, 1),
		retention: clamp(weights.retention, 0.01, 1),
		engagement: clamp(weights.engagement, 0.01, 1),
		transfer: clamp(weights.transfer, 0.01, 1),
		confusion: clamp(weights.confusion, 0.01, 1),
	};
	const sum =
		clamped.masteryGain +
		clamped.retention +
		clamped.engagement +
		clamped.transfer +
		clamped.confusion;
	if (sum === 0) return DEFAULT_WEIGHTS;
	return {
		masteryGain: clamped.masteryGain / sum,
		retention: clamped.retention / sum,
		engagement: clamped.engagement / sum,
		transfer: clamped.transfer / sum,
		confusion: clamped.confusion / sum,
	};
}

export function clampPolicy(policy: TeacherPolicy): TeacherPolicy {
	return {
		...policy,
		analogyDensity: clamp(policy.analogyDensity),
		socraticRatio: clamp(policy.socraticRatio),
		formalism: clamp(policy.formalism),
		retrievalPractice: clamp(policy.retrievalPractice),
		exerciseCount: Math.min(5, Math.max(1, Math.round(policy.exerciseCount))),
		diagramBias: clamp(policy.diagramBias),
		reflectionBias: clamp(policy.reflectionBias),
		interdisciplinaryBias: clamp(policy.interdisciplinaryBias),
		challengeRate: clamp(policy.challengeRate),
	};
}

// ============================================================================
// Lesson Plan Generation (from src/core/lesson-plan.ts)
// ============================================================================

function prerequisiteBullets(topic: TopicDefinition): string[] {
	return topic.prerequisites.map((item) => `Recall ${item} and connect it to ${topic.title}.`);
}

function misconceptionBullets(topic: TopicDefinition): string[] {
	return topic.misconceptions.map((item) => `Address misconception: ${item}`);
}

function practiceBullets(topic: TopicDefinition, exerciseCount: number): string[] {
	const bullets = [...topic.exercises];
	while (bullets.length < exerciseCount) {
		bullets.push(`Invent a new example that makes ${topic.title} easier to explain.`);
	}
	return bullets.slice(0, exerciseCount).map((item) => `Practice: ${item}`);
}

export function buildLessonPlan(topicName: string, policy: TeacherPolicy): LessonPlan {
	const topic = resolveTopic(topicName);
	const phases: LessonPhase[] = [
		{
			id: "orient",
			title: "Orientation",
			purpose: "Assess prerequisites and frame the core question.",
			bullets: [`State the big question: ${topic.summary}`, ...prerequisiteBullets(topic)],
		},
		{
			id: "intuition",
			title: "Intuition",
			purpose: "Teach the concept concretely before pushing notation or abstract framing.",
			bullets: topic.intuition.map((item) => `Intuition: ${item}`),
		},
		{
			id: "formal-core",
			title: "Formal Core",
			purpose: "Escalate into rigorous structure once intuition has traction.",
			bullets: topic.formalCore.map((item) => `Formal: ${item}`),
		},
		{
			id: "misconceptions",
			title: "Misconception Repair",
			purpose: "Anticipate predictable mistakes before they calcify.",
			bullets: misconceptionBullets(topic),
		},
		{
			id: "examples",
			title: "Worked Examples",
			purpose: "Move between examples so the learner sees the invariant structure.",
			bullets: topic.examples.map((item) => `Example: ${item}`),
		},
		{
			id: "practice",
			title: "Guided Practice",
			purpose: "Force retrieval and re-expression, not passive agreement.",
			bullets: practiceBullets(topic, policy.exerciseCount),
		},
		{
			id: "transfer",
			title: "Transfer and Reflection",
			purpose: "Bridge the concept across domains and make the learner summarize what changed.",
			bullets: [
				...topic.reflections.map((item) => `Reflect: ${item}`),
				`Bridge ${topic.title} into: ${topic.interdisciplinaryHooks.join(", ")}.`,
			],
		},
	];

	if (policy.diagramBias >= 0.55) {
		phases.splice(4, 0, {
			id: "diagram",
			title: "Diagram",
			purpose: "Compress the concept into a visual structure before free recall.",
			bullets: [
				`Map the concept using nodes: ${topic.diagramNodes.join(" -> ")}.`,
				`Ask the learner to narrate the diagram without reading from it.`,
			],
		});
	}

	if (policy.socraticRatio >= 0.6) {
		phases[0]!.bullets.unshift(`Open with a diagnostic question instead of a lecture on ${topic.title}.`);
		phases[5]!.bullets.unshift(`Pause after each practice step and ask the learner to predict the next move.`);
	}

	if (topic.domain === "code") {
		const exIdx = phases.findIndex((p) => p.id === "examples");
		if (exIdx !== -1) {
			phases.splice(exIdx + 1, 0, {
				id: "live-code",
				title: "Live Code",
				purpose: "Write and trace runnable code so the learner sees the concept execute.",
				bullets: [
					`Write a minimal runnable example demonstrating ${topic.title}.`,
					"Step through execution line by line, narrating state changes.",
					"Ask the learner to predict output before running.",
				],
			});
		}
	}

	return { topic, policy, phases };
}

export function lessonPlanToMarkdown(plan: LessonPlan): string {
	const lines = [
		`# Lesson Plan: ${plan.topic.title}`,
		"",
		`- Domain: ${plan.topic.domain}`,
		`- Policy: ${plan.policy.name}`,
		`- Summary: ${plan.topic.summary}`,
		"",
	];

	for (const phase of plan.phases) {
		lines.push(`## ${phase.title}`);
		lines.push(phase.purpose);
		lines.push("");
		for (const bullet of phase.bullets) {
			lines.push(`- ${bullet}`);
		}
		lines.push("");
	}

	return `${lines.join("\n").trim()}\n`;
}

// ============================================================================
// Concept Map Generation (from src/core/map.ts)
// ============================================================================

export function buildConceptMap(topicName: string): string {
	const topic = resolveTopic(topicName);
	const nodes = topic.diagramNodes;

	return `graph TD
    A[${topic.title}] --> B[Core Concepts]
    A --> C[Applications]
    A --> D[Related Topics]

    B --> B1[${nodes[0] || "Prerequisites"}]
    B --> B2[${nodes[1] || "Intuition"}]
    B --> B3[${nodes[2] || "Formal Structure"}]

    C --> C1[Practical Use]
    C --> C2[Real-world Examples]

    D --> D1[${topic.interdisciplinaryHooks[0] || "Connections"}]
    D --> D2[Advanced Topics]

    style A fill:#d44a3d,color:#fff
    style B fill:#3043a6,color:#fff
    style C fill:#047857,color:#fff
    style D fill:#64748b,color:#fff`;
}

// ============================================================================
// Benchmark Simulation (from src/core/benchmark.ts)
// ============================================================================

function buildLearnerPopulation(seed: number, count: number): LearnerProfile[] {
	const prng = new Prng(seed);
	const learners: LearnerProfile[] = [];
	for (let index = 0; index < count; index += 1) {
		learners.push({
			id: `learner-${seed}-${index}`,
			priorKnowledge: prng.next(),
			abstractionComfort: prng.next(),
			analogyNeed: prng.next(),
			dialoguePreference: prng.next(),
			diagramAffinity: prng.next(),
			persistence: prng.next(),
			transferDesire: prng.next(),
			anxiety: prng.next(),
		});
	}
	return learners;
}

export function simulateTeaching(
	policy: TeacherPolicy,
	topic: TopicDefinition,
	learner: LearnerProfile,
	weights: SimulationWeights = DEFAULT_WEIGHTS
): TeachingSimulation {
	return simulateDeterministicTeaching(policy, topic, learner, weights);
}

function classifyDominantSignal(simulations: TeachingSimulation[], kind: "strength" | "weakness"): string {
	if (simulations.length === 0) return "no learner feedback";
	const metrics = {
		intuitionFit: mean(simulations.map((entry) => entry.breakdown.intuitionFit)),
		rigorFit: mean(simulations.map((entry) => entry.breakdown.rigorFit)),
		dialogueFit: mean(simulations.map((entry) => entry.breakdown.dialogueFit)),
		diagramFit: mean(simulations.map((entry) => entry.breakdown.diagramFit)),
		practiceFit: mean(simulations.map((entry) => entry.breakdown.practiceFit)),
		reflectionFit: mean(simulations.map((entry) => entry.breakdown.reflectionFit)),
		overload: mean(simulations.map((entry) => entry.breakdown.overload)),
	};
	const ordered = Object.entries(metrics).sort((left, right) =>
		kind === "strength" ? right[1] - left[1] : left[1] - right[1]
	);
	const [name] = ordered[0] ?? ["unknown"];
	return name;
}

function summarizeTopic(topic: TopicDefinition, simulations: TeachingSimulation[], traceLimit: number): TopicBenchmark {
	const ranked = [...simulations].sort((left, right) => right.score - left.score);
	return {
		topic,
		learnerCount: simulations.length,
		meanScore: mean(simulations.map((entry) => entry.score)) * 100,
		meanMasteryGain: mean(simulations.map((entry) => entry.masteryGain)),
		meanRetention: mean(simulations.map((entry) => entry.retention)),
		meanEngagement: mean(simulations.map((entry) => entry.engagement)),
		meanTransfer: mean(simulations.map((entry) => entry.transfer)),
		meanConfusion: mean(simulations.map((entry) => entry.confusion)),
		topLearners: ranked.slice(0, traceLimit),
		strugglingLearners: ranked.slice(-traceLimit).reverse(),
		dominantStrength: classifyDominantSignal(simulations, "strength"),
		dominantWeakness: classifyDominantSignal(simulations, "weakness"),
	};
}

export interface BrowserLearnerOutcome extends ScoreableLearnerOutcome {
	topic: string;
	feedbackSignal: "thumbs-up" | "thumbs-down" | "confused";
	masteryEstimate: number;
	outcomeScore: number;
}

export interface BrowserLearnerTurnSignal {
	topic: string;
	signal: "thumbs-up" | "thumbs-down" | "confused";
	masteryEstimate: number;
	evidence: string;
}

export function inferBrowserLearnerTurnSignal(text: string, fallbackTopic = "general"): BrowserLearnerTurnSignal | null {
	const compact = text.replace(/\s+/g, " ").trim();
	if (compact.length < 4) return null;
	const lowered = compact.toLowerCase();
	const signal =
		/\b(wrong|incorrect|not helpful|bad explanation|no,? that's not|still wrong)\b/i.test(lowered) ? "thumbs-down" :
		/\b(confused|lost|stuck|unclear|not sure|don't understand|dont understand|doesn't make sense|doesnt make sense|can you explain|what do you mean|why is|how does)\b/i.test(lowered) ? "confused" :
		/\b(got it|makes sense|i understand|that helps|clear now|yes exactly|correct)\b/i.test(lowered) ? "thumbs-up" :
		null;
	if (!signal) return null;
	const resolved = resolveTopic(fallbackTopic);
	return {
		topic: resolved.slug,
		signal,
		masteryEstimate: signal === "thumbs-up" ? 0.75 : signal === "confused" ? 0.35 : 0.2,
		evidence: compact.slice(0, 240),
	};
}

export function extractBrowserOutcomes(feedbackHistory: Array<{ topic: string; signal: "thumbs-up" | "thumbs-down" | "confused" }>, topicsExplored: string[]): BrowserLearnerOutcome[] {
	return feedbackHistory.map((fb) => ({
		topic: resolveTopic(fb.topic).slug,
		feedbackSignal: fb.signal,
		masteryEstimate: topicsExplored.includes(fb.topic) ? 0.6 : 0.4,
		outcomeScore: feedbackToOutcomeScore(fb.signal),
	}));
}

export function runBenchmarkSuite(
	policy: TeacherPolicy,
	focusTopic?: string,
	seed = 20260401,
	traceLimit = 3,
	weights: SimulationWeights = DEFAULT_WEIGHTS,
	realOutcomes?: BrowserLearnerOutcome[]
): BenchmarkResult {
	const outcomes = realOutcomes ?? [];
	const hasLearnerContext = realOutcomes !== undefined;
	const hasFeedback = outcomes.length > 0;
	const hasEnoughFeedback = hasEnoughRealData(outcomes);
	const NUM_SYNTHETIC = 3;

	const topics = hasLearnerContext && hasFeedback && !focusTopic
		? [...new Set(outcomes.map((outcome) => outcome.topic))].map((topic) => resolveTopic(topic))
		: benchmarkTopics(focusTopic);
	const topicTraces: BenchmarkTopicTrace[] = [];
	const topicBenchmarks = topics.map((topic, index) => {
		const topicReal = outcomes.filter((o) => o.topic === topic.slug);
		let summary: TopicBenchmark;

		if (hasLearnerContext) {
			const simulations = topicReal.length > 0
				? [computeRealOutcomeScore(topicReal, policy, topic, weights)]
				: [];
			summary = summarizeTopic(topic, simulations, traceLimit);
		} else {
			const learners = buildLearnerPopulation(seed + index * 97, NUM_SYNTHETIC);
			const simulations = learners.map((learner) => simulateTeaching(policy, topic, learner, weights));
			summary = summarizeTopic(topic, simulations, traceLimit);
		}

		topicTraces.push({
			topic: topic.title,
			topLearners: summary.topLearners.map((entry) => ({
				learnerId: entry.learner.id,
				score: entry.score,
				explanation: entry.explanation || ["unknown"],
			})),
			strugglingLearners: summary.strugglingLearners.map((entry) => ({
				learnerId: entry.learner.id,
				score: entry.score,
				explanation: entry.explanation || ["unknown"],
			})),
			metricMeans: {
				masteryGain: summary.meanMasteryGain,
				retention: summary.meanRetention,
				engagement: summary.meanEngagement,
				transfer: summary.meanTransfer,
				confusion: summary.meanConfusion,
			},
			dominantStrength: summary.dominantStrength,
			dominantWeakness: summary.dominantWeakness,
		});
		return summary;
	});

	const weakest = [...topicBenchmarks].sort((left, right) => left.meanScore - right.meanScore)[0];
	const dataSource = hasLearnerContext
		? hasFeedback
			? hasEnoughFeedback
				? "learner-feedback"
				: "learner-feedback-sparse"
			: "no-learner-feedback"
		: "synthetic";

	return {
		policy,
		suiteName: focusTopic ? `focused:${focusTopic}` : "core-suite",
		topicBenchmarks,
		overallScore: mean(topicBenchmarks.map((entry) => entry.meanScore)),
		weakestTopic: weakest?.topic.title ?? "n/a",
		trace: {
			seed,
			learnerCountPerTopic: hasLearnerContext ? (hasFeedback ? 1 : 0) : NUM_SYNTHETIC,
			topicTraces,
			realOutcomeCount: outcomes.length,
			syntheticFallback: !hasLearnerContext,
			dataSource,
		},
	};
}

export function benchmarkToMarkdown(result: BenchmarkResult): string {
	const lines = [
		`# Benchmark Report: ${result.policy.name}`,
		"",
		`- Suite: ${result.suiteName}`,
		`- Overall score: ${result.overallScore.toFixed(2)}`,
		`- Weakest topic: ${result.weakestTopic}`,
		"",
		"| Topic | Score | Mastery | Retention | Engagement | Transfer | Confusion |",
		"| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
	];

	for (const benchmark of result.topicBenchmarks) {
		lines.push(
			`| ${benchmark.topic.title} | ${benchmark.meanScore.toFixed(2)} | ${benchmark.meanMasteryGain.toFixed(2)} | ${benchmark.meanRetention.toFixed(2)} | ${benchmark.meanEngagement.toFixed(2)} | ${benchmark.meanTransfer.toFixed(2)} | ${benchmark.meanConfusion.toFixed(2)} |`
		);
	}

	lines.push("");
	lines.push("## Interpretation");
	lines.push("");
	lines.push(
		`- The policy currently underperforms most on ${result.weakestTopic}, which is a useful anchor for mutation and curriculum repair.`
	);
	const realCount = (result as any).trace?.realOutcomeCount ?? 0;
	const dataSource = (result as any).trace?.dataSource;
	if (dataSource === "learner-feedback") {
		lines.push(`- Benchmark uses **learner feedback only** (${realCount} data points). This is ready for policy evolution.`);
	} else if (dataSource === "learner-feedback-sparse") {
		lines.push(`- Benchmark uses **learner feedback only**, but the corpus is sparse (${realCount}/${MIN_REAL_OUTCOMES} minimum signals). Treat this as directional and do not evolve policy yet.`);
	} else if (dataSource === "no-learner-feedback") {
		lines.push(`- Benchmark has no learner feedback yet. Teach first, collect at least ${MIN_REAL_OUTCOMES} feedback signals for this learner, then benchmark/evolve.`);
	} else {
		lines.push("- Benchmark uses the deterministic synthetic fallback because no learner feedback corpus was supplied.");
	}
	lines.push("");
	return `${lines.join("\n")}\n`;
}

// ============================================================================
// Policy Evolution (from src/core/evolution.ts)
// ============================================================================

function mutateScalar(prng: Prng, value: number, amplitude = 0.18): number {
	return clamp(value + (prng.next() * 2 - 1) * amplitude);
}

function mutateWeights(parent: SimulationWeights, prng: Prng, amplitude = 0.12): SimulationWeights {
	return clampWeights({
		masteryGain: mutateScalar(prng, parent.masteryGain, amplitude),
		retention: mutateScalar(prng, parent.retention, amplitude),
		engagement: mutateScalar(prng, parent.engagement, amplitude),
		transfer: mutateScalar(prng, parent.transfer, amplitude),
		confusion: mutateScalar(prng, parent.confusion, amplitude),
	});
}

function mutatePolicy(parent: TeacherPolicy, prng: Prng, iteration: number): TeacherPolicy {
	return clampPolicy({
		...parent,
		name: `keating-candidate-${iteration}`,
		analogyDensity: mutateScalar(prng, parent.analogyDensity),
		socraticRatio: mutateScalar(prng, parent.socraticRatio),
		formalism: mutateScalar(prng, parent.formalism),
		retrievalPractice: mutateScalar(prng, parent.retrievalPractice),
		exerciseCount: parent.exerciseCount + prng.int(-1, 1),
		diagramBias: mutateScalar(prng, parent.diagramBias),
		reflectionBias: mutateScalar(prng, parent.reflectionBias),
		interdisciplinaryBias: mutateScalar(prng, parent.interdisciplinaryBias),
		challengeRate: mutateScalar(prng, parent.challengeRate),
	});
}

function policyVector(policy: TeacherPolicy): number[] {
	return [
		policy.analogyDensity,
		policy.socraticRatio,
		policy.formalism,
		policy.retrievalPractice,
		policy.exerciseCount / 5,
		policy.diagramBias,
		policy.reflectionBias,
		policy.interdisciplinaryBias,
		policy.challengeRate,
	];
}

function euclideanDistance(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		sum += (a[i] - b[i]) ** 2;
	}
	return Math.sqrt(sum / a.length);
}

function noveltyScore(existingPolicies: TeacherPolicy[], candidate: TeacherPolicy): number {
	if (existingPolicies.length === 0) return 1;
	const candidateVec = policyVector(candidate);
	let minDist = Infinity;
	for (const existing of existingPolicies) {
		const dist = euclideanDistance(candidateVec, policyVector(existing));
		minDist = Math.min(minDist, dist);
	}
	return minDist;
}

function diffPolicy(before: TeacherPolicy, after: TeacherPolicy) {
	const keys: Array<keyof TeacherPolicy> = [
		"analogyDensity",
		"socraticRatio",
		"formalism",
		"retrievalPractice",
		"exerciseCount",
		"diagramBias",
		"reflectionBias",
		"interdisciplinaryBias",
		"challengeRate",
	];
	return keys
		.map((field) => {
			const previous = before[field];
			const next = after[field];
			const delta = typeof previous === "number" && typeof next === "number" ? next - previous : 0;
			return { field, before: previous, after: next, delta };
		})
		.filter((entry) => entry.delta !== 0);
}

export interface EvolutionRun {
	baseline: BenchmarkResult;
	best: BenchmarkResult;
	acceptedCandidates: EvolutionCandidate[];
	exploredCandidates: EvolutionCandidate[];
	bestPolicy: TeacherPolicy;
}

export function evolvePolicy(
	basePolicy: TeacherPolicy,
	focusTopic?: string,
	iterations = 12,
	seed = 20260401,
	baseWeights: SimulationWeights = DEFAULT_WEIGHTS
): EvolutionRun {
	const baseline = runBenchmarkSuite(basePolicy, focusTopic, seed, 3, baseWeights);
	let best = baseline;
	let bestWeights = baseWeights;
	const acceptedCandidates: EvolutionCandidate[] = [];
	const exploredCandidates: EvolutionCandidate[] = [];
	const prng = new Prng(seed + 17);
	const seen: TeacherPolicy[] = [basePolicy];

	for (let iteration = 1; iteration <= iterations; iteration += 1) {
		const candidatePolicy = mutatePolicy(best.policy, prng, iteration);
		const candidateWeights = mutateWeights(bestWeights, prng);
		const novelty = noveltyScore(seen, candidatePolicy);
		const candidateBenchmark = runBenchmarkSuite(candidatePolicy, focusTopic, seed + iteration * 11, 3, candidateWeights);
		const parameterDelta = diffPolicy(best.policy, candidatePolicy);

		const bestWeakest = Math.min(...best.topicBenchmarks.map((entry) => entry.meanScore));
		const candidateWeakest = Math.min(...candidateBenchmark.topicBenchmarks.map((entry) => entry.meanScore));
		const improves = candidateBenchmark.overallScore > best.overallScore;
		const safe = candidateWeakest >= bestWeakest - 1.5;
		const novelEnough = novelty >= 0.05;

		const candidate: EvolutionCandidate = {
			policy: candidatePolicy,
			benchmark: candidateBenchmark,
			parentName: best.policy.name,
			iteration,
			novelty,
			accepted: false,
			decision: {
				improves,
				safe,
				novelEnough,
				scoreDelta: candidateBenchmark.overallScore - best.overallScore,
				weakestTopicDelta: candidateWeakest - bestWeakest,
				reasons: [],
			},
			parameterDelta,
		};

		if (improves) {
			candidate.decision.reasons.push(`overall score improved by ${candidate.decision.scoreDelta.toFixed(2)}`);
		} else {
			candidate.decision.reasons.push(`overall score regressed by ${Math.abs(candidate.decision.scoreDelta).toFixed(2)}`);
		}
		if (safe) {
			candidate.decision.reasons.push(`weakest-topic score stayed within tolerance (${candidate.decision.weakestTopicDelta.toFixed(2)})`);
		} else {
			candidate.decision.reasons.push(`weakest-topic score fell too far (${candidate.decision.weakestTopicDelta.toFixed(2)})`);
		}
		if (novelEnough) {
			candidate.decision.reasons.push(`novelty ${novelty.toFixed(3)} cleared the 0.05 threshold`);
		} else {
			candidate.decision.reasons.push(`novelty ${novelty.toFixed(3)} was too close to archived policies`);
		}

		if (improves && safe && novelEnough) {
			candidate.accepted = true;
			best = candidateBenchmark;
			bestWeights = candidateWeights;
			acceptedCandidates.push(candidate);
		}
		exploredCandidates.push(candidate);
		seen.push(candidate.policy);
	}

	return {
		baseline,
		best,
		acceptedCandidates,
		exploredCandidates,
		bestPolicy: best.policy,
	};
}

export interface MapElitesCell {
	policy: TeacherPolicy;
	weights: SimulationWeights;
	score: number;
	benchmark: BenchmarkResult;
	iteration: number;
}

export interface MapElitesGrid {
	descriptors: string[];
	resolution: number;
	cells: Map<string, MapElitesCell | null>;
}

export interface MapElitesRun {
	baseline: BenchmarkResult;
	best: BenchmarkResult;
	grid: MapElitesGrid;
	filledCellCount: number;
	totalCells: number;
	exploredCandidates: EvolutionCandidate[];
}

const DEFAULT_DESCRIPTORS = ["formalism", "socraticRatio"];
const DEFAULT_RESOLUTION = 10;

function meCellKey(descriptors: number[], resolution: number): string {
	return descriptors
		.map((d) => Math.min(Math.floor(d * resolution), resolution - 1))
		.join(",");
}

function meGetDescriptorValues(policy: TeacherPolicy, descriptors: string[]): number[] {
	return descriptors.map((d) => {
		const val = policy[d as keyof TeacherPolicy];
		return typeof val === "number" ? val : 0;
	});
}

function mePlaceInGrid(
	grid: MapElitesGrid,
	policy: TeacherPolicy,
	weights: SimulationWeights,
	score: number,
	benchmark: BenchmarkResult,
	iteration: number
): boolean {
	const descVals = meGetDescriptorValues(policy, grid.descriptors);
	const key = meCellKey(descVals, grid.resolution);
	const existing = grid.cells.get(key);
	if (!existing || score > existing.score) {
		grid.cells.set(key, { policy, weights, score, benchmark, iteration });
		return !existing;
	}
	return false;
}

function meSelectParent(grid: MapElitesGrid, prng: Prng): { policy: TeacherPolicy; weights: SimulationWeights } {
	const filled = Array.from(grid.cells.values()).filter((c): c is MapElitesCell => c !== null);
	if (filled.length === 0) return { policy: DEFAULT_POLICY, weights: DEFAULT_WEIGHTS };
	const idx = Math.floor(prng.next() * filled.length);
	return { policy: filled[idx].policy, weights: filled[idx].weights };
}

function meRandomPolicy(prng: Prng, iteration: number): TeacherPolicy {
	return clampPolicy({
		name: `me-random-${iteration}`,
		analogyDensity: prng.next(),
		socraticRatio: prng.next(),
		formalism: prng.next(),
		retrievalPractice: prng.next(),
		exerciseCount: Math.round(1 + prng.next() * 4),
		diagramBias: prng.next(),
		reflectionBias: prng.next(),
		interdisciplinaryBias: prng.next(),
		challengeRate: prng.next(),
	});
}

function meRandomWeights(prng: Prng): SimulationWeights {
	return clampWeights({
		masteryGain: 0.1 + prng.next() * 0.9,
		retention: 0.1 + prng.next() * 0.9,
		engagement: 0.1 + prng.next() * 0.9,
		transfer: 0.1 + prng.next() * 0.9,
		confusion: 0.1 + prng.next() * 0.9,
	});
}

function browserCounterfactualOutcomes(outcomes: BrowserLearnerOutcome[]): BrowserLearnerOutcome[] {
	return outcomes.flatMap((outcome) => {
		const variants: Array<"thumbs-up" | "thumbs-down" | "confused"> =
			outcome.feedbackSignal === "thumbs-up"
				? ["thumbs-up", "confused"]
				: outcome.feedbackSignal === "confused"
					? ["confused", "thumbs-down"]
					: ["thumbs-down", "confused"];
		return variants.map((signal) => ({
			topic: outcome.topic,
			feedbackSignal: signal,
			masteryEstimate: signal === "thumbs-up" ? 0.75 : signal === "confused" ? 0.35 : 0.2,
			outcomeScore: feedbackToOutcomeScore(signal),
		}));
	});
}

type PolicyJudgementCandidate = {
	label: string;
	policy: TeacherPolicy;
	benchmark: BenchmarkResult;
	counterfactualBenchmark?: BenchmarkResult;
	preferenceScore: number;
};

function policyJudgementVector(candidate: PolicyJudgementCandidate): number[] {
	const mean = (values: number[]) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
	const topics = candidate.benchmark.topicBenchmarks;
	return [
		clamp(candidate.benchmark.overallScore / 100),
		clamp((candidate.counterfactualBenchmark?.overallScore ?? candidate.benchmark.overallScore) / 100),
		clamp(mean(topics.map((topic) => topic.meanMasteryGain))),
		clamp(mean(topics.map((topic) => topic.meanTransfer))),
		clamp(1 - mean(topics.map((topic) => topic.meanConfusion))),
		candidate.benchmark.trace.dataSource === "learner-feedback" ? 1 : candidate.benchmark.trace.dataSource === "learner-feedback-sparse" ? 0.35 : 0,
	];
}

function prosperPolicyWinner<T extends PolicyJudgementCandidate>(candidates: T[]): T {
	let best = candidates[0];
	let bestScore = -Infinity;
	for (const candidate of candidates) {
		const left = policyJudgementVector(candidate);
		const score = candidates.reduce((sum, opponent) => {
			if (candidate === opponent) return sum;
			const right = policyJudgementVector(opponent);
			let wins = 0;
			let losses = 0;
			for (let index = 0; index < left.length; index++) {
				if (left[index] > right[index]) wins += 1;
				if (left[index] < right[index]) losses += 1;
			}
			const aggregateDelta = left.reduce((s, v) => s + v, 0) / left.length - right.reduce((s, v) => s + v, 0) / right.length;
			return sum + wins - losses + aggregateDelta * 2;
		}, 0);
		candidate.preferenceScore = score;
		if (score > bestScore) {
			best = candidate;
			bestScore = score;
		}
	}
	return best;
}

export function mapElitesEvolve(
	basePolicy: TeacherPolicy,
	focusTopic?: string,
	iterations = 24,
	seed = 20260401,
	descriptors = DEFAULT_DESCRIPTORS,
	resolution = DEFAULT_RESOLUTION,
	realOutcomes?: BrowserLearnerOutcome[]
): MapElitesRun {
	const prng = new Prng(seed);
	const grid: MapElitesGrid = { descriptors, resolution, cells: new Map() };
	const totalCells = resolution ** descriptors.length;
	const initRandom = Math.floor(iterations * 0.25);

	const baseline = runBenchmarkSuite(basePolicy, focusTopic, seed, 3, DEFAULT_WEIGHTS, realOutcomes);
	const cfOutcomes = realOutcomes ? browserCounterfactualOutcomes(realOutcomes) : undefined;
	const baselineCounterfactual = cfOutcomes
		? runBenchmarkSuite(basePolicy, focusTopic, seed + 7, 3, DEFAULT_WEIGHTS, cfOutcomes)
		: undefined;
	mePlaceInGrid(grid, basePolicy, DEFAULT_WEIGHTS, baseline.overallScore, baseline, 0);

	const exploredCandidates: EvolutionCandidate[] = [];
	const judgementCandidates: PolicyJudgementCandidate[] = [{
		label: basePolicy.name,
		policy: basePolicy,
		benchmark: baseline,
		counterfactualBenchmark: baselineCounterfactual,
		preferenceScore: 0,
	}];

	for (let i = 1; i <= iterations; i++) {
		let candidatePolicy: TeacherPolicy;
		let candidateWeights: SimulationWeights;

		if (i <= initRandom) {
			candidatePolicy = meRandomPolicy(prng, i);
			candidateWeights = meRandomWeights(prng);
		} else {
			const parent = meSelectParent(grid, prng);
			candidatePolicy = mutatePolicy(parent.policy, prng, i);
			candidateWeights = mutateWeights(parent.weights, prng);
		}

		const candidateBenchmark = runBenchmarkSuite(candidatePolicy, focusTopic, seed + i * 11, 3, candidateWeights, realOutcomes);
		const candidateCounterfactual = cfOutcomes
			? runBenchmarkSuite(candidatePolicy, focusTopic, seed + i * 11 + 7, 3, candidateWeights, cfOutcomes)
			: undefined;
		const isNewCell = mePlaceInGrid(grid, candidatePolicy, candidateWeights, candidateBenchmark.overallScore, candidateBenchmark, i);

		exploredCandidates.push({
			policy: candidatePolicy,
			benchmark: candidateBenchmark,
			counterfactualBenchmark: candidateCounterfactual,
			parentName: null,
			iteration: i,
			novelty: isNewCell ? 1 : 0,
			accepted: isNewCell,
			decision: {
				improves: isNewCell,
				safe: true,
				novelEnough: isNewCell,
				scoreDelta: 0,
				weakestTopicDelta: 0,
				reasons: isNewCell
					? [`placed in new cell or improved existing cell (score ${candidateBenchmark.overallScore.toFixed(2)})`]
					: ["discarded — cell already held a better elite"],
			},
			parameterDelta: [],
		});
		judgementCandidates.push({
			label: candidatePolicy.name,
			policy: candidatePolicy,
			benchmark: candidateBenchmark,
			counterfactualBenchmark: candidateCounterfactual,
			preferenceScore: 0,
		});
	}

	const prosperBest = prosperPolicyWinner(judgementCandidates);
	for (const candidate of exploredCandidates) {
		const judgement = judgementCandidates.find((entry) => entry.label === candidate.policy.name);
		candidate.preferenceScore = judgement?.preferenceScore ?? 0;
		candidate.accepted = candidate.policy.name === prosperBest.policy.name;
	}
	const best = prosperBest.benchmark;

	return {
		baseline,
		best,
		grid,
		filledCellCount: grid.cells.size,
		totalCells,
		exploredCandidates,
	};
}

export function mapElitesToEvolutionRun(run: MapElitesRun): EvolutionRun {
	return {
		baseline: run.baseline,
		best: run.best,
		acceptedCandidates: run.exploredCandidates.filter((c) => c.accepted),
		exploredCandidates: run.exploredCandidates,
		bestPolicy: run.best.policy,
	};
}

export function mapElitesToMarkdown(run: MapElitesRun): string {
	const lines = [
		"# MAP-Elites Evolution Report",
		"",
		`- Descriptors: ${run.grid.descriptors.join(" × ")}`,
		`- Grid: ${run.grid.resolution}^${run.grid.descriptors.length} = ${run.totalCells} cells`,
		`- Filled cells: ${run.filledCellCount} / ${run.totalCells} (${((run.filledCellCount / run.totalCells) * 100).toFixed(1)}%)`,
		`- Baseline score: ${run.baseline.overallScore.toFixed(2)}`,
		`- Best score: ${run.best.overallScore.toFixed(2)}`,
		`- Explored candidates: ${run.exploredCandidates.length}`,
		`- Judgement: PROSPER-style pairwise preference over real feedback, counterfactual robustness, mastery, transfer, low confusion, and evidence readiness.`,
		"",
		"## Elite Archive",
		"",
	];

	const sorted = Array.from(run.grid.cells.entries()).sort(([a], [b]) => a.localeCompare(b));
	const header = run.grid.descriptors.map((d, i) => `${d}[${i}]`).join(" | ");
	lines.push(`| ${header} | Policy | Score | Weights (m/r/e/t/c) |`);
	lines.push(`| ${run.grid.descriptors.map(() => "---").join(" | ")} | --- | ---: | --- |`);

	for (const [key, cell] of sorted) {
		if (!cell) continue;
		const indices = key.split(",").map(Number);
		const labels = indices
			.map((idx, i) => {
				const lo = (idx / run.grid.resolution).toFixed(2);
				const hi = ((idx + 1) / run.grid.resolution).toFixed(2);
				return `${lo}–${hi}`;
			})
			.join(" | ");
		const w = cell.weights;
		lines.push(
			`| ${labels} | ${cell.policy.name} | ${cell.score.toFixed(2)} | ${w.masteryGain.toFixed(2)}/${w.retention.toFixed(2)}/${w.engagement.toFixed(2)}/${w.transfer.toFixed(2)}/${w.confusion.toFixed(2)} |`
		);
	}

	lines.push("");
	lines.push("## PROSPER Candidate Judgement");
	lines.push("");
	lines.push("| Candidate | Real Score | Counterfactual Score | Preference | Accepted |");
	lines.push("| --- | ---: | ---: | ---: | :---: |");
	for (const candidate of run.exploredCandidates.slice().sort((left, right) => (right.preferenceScore ?? 0) - (left.preferenceScore ?? 0)).slice(0, 12)) {
		lines.push(
			`| ${candidate.policy.name} | ${candidate.benchmark.overallScore.toFixed(2)} | ${candidate.counterfactualBenchmark?.overallScore.toFixed(2) ?? "n/a"} | ${(candidate.preferenceScore ?? 0).toFixed(2)} | ${candidate.accepted ? "yes" : "no"} |`
		);
	}
	lines.push("");
	lines.push("## Best Benchmark Snapshot");
	lines.push("");
	lines.push(benchmarkToMarkdown(run.best).trim());
	lines.push("");
	return `${lines.join("\n")}\n`;
}

export function evolutionToMarkdown(run: EvolutionRun): string {
	const lines = [
		`# Evolution Report: ${run.best.policy.name}`,
		"",
		`- Baseline score: ${run.baseline.overallScore.toFixed(2)}`,
		`- Best score: ${run.best.overallScore.toFixed(2)}`,
		`- Accepted candidates: ${run.acceptedCandidates.length}`,
		`- Explored candidates: ${run.exploredCandidates.length}`,
		"",
		"## Accepted Candidates",
		"",
	];

	if (run.acceptedCandidates.length === 0) {
		lines.push("- No candidate cleared both the novelty and safety gates in this run.");
	} else {
		for (const candidate of run.acceptedCandidates) {
			lines.push(
				`- Iteration ${candidate.iteration}: ${candidate.policy.name} scored ${candidate.benchmark.overallScore.toFixed(2)} with novelty ${candidate.novelty.toFixed(3)}.`
			);
		}
	}

	lines.push("");
	lines.push("## Best Policy Parameters");
	lines.push("");
	lines.push(`- analogyDensity: ${run.bestPolicy.analogyDensity.toFixed(3)}`);
	lines.push(`- socraticRatio: ${run.bestPolicy.socraticRatio.toFixed(3)}`);
	lines.push(`- formalism: ${run.bestPolicy.formalism.toFixed(3)}`);
	lines.push(`- exerciseCount: ${run.bestPolicy.exerciseCount}`);
	lines.push(`- diagramBias: ${run.bestPolicy.diagramBias.toFixed(3)}`);
	lines.push("");

	return `${lines.join("\n")}\n`;
}

// ============================================================================
// Prompt Evolution (simplified for browser)
// ============================================================================

export interface PromptEvaluationResult {
	score: number;
	objectives: PromptObjectiveVector;
	feedback: string[];
}

function heuristicPromptEvaluation(promptContent: string): PromptEvaluationResult {
	const body = promptContent.toLowerCase();

	const objectives: PromptObjectiveVector = {
		voice_divergence: clamp(0.35 + (body.includes("own words") ? 0.18 : 0) + (body.includes("personal") ? 0.15 : 0)),
		diagnosis: clamp(0.4 + (body.includes("prerequisite") ? 0.16 : 0) + (body.includes("misconception") ? 0.12 : 0)),
		verification: clamp(0.2 + (body.includes("verify") ? 0.18 : 0) + (body.includes("source") ? 0.15 : 0)),
		retrieval: clamp(0.35 + (body.includes("retrieval") ? 0.18 : 0) + (body.includes("recall") ? 0.12 : 0)),
		transfer: clamp(0.3 + (body.includes("transfer") ? 0.18 : 0) + (body.includes("bridge") ? 0.12 : 0)),
		structure: clamp(0.45 + (body.includes("diagnose") ? 0.09 : 0) + (body.includes("reflect") ? 0.09 : 0)),
	};

	const feedback: string[] = [];
	if (objectives.voice_divergence < 0.7) feedback.push("Add an explicit requirement that the learner restate the idea in their own words.");
	if (objectives.diagnosis < 0.7) feedback.push("Strengthen diagnosis of prerequisite gaps and misconceptions before teaching.");
	if (objectives.verification < 0.7) feedback.push("Include a step that distinguishes verified claims from claims that still need checking.");
	if (objectives.retrieval < 0.7) feedback.push("Add a retrieval checkpoint that requires reconstruction rather than agreement.");
	if (objectives.transfer < 0.7) feedback.push("Bridge the concept into a different domain or practical context before ending.");

	const score =
		objectives.voice_divergence * 14 +
		objectives.diagnosis * 20 +
		objectives.verification * 18 +
		objectives.retrieval * 18 +
		objectives.transfer * 16 +
		objectives.structure * 14;

	return { score, objectives, feedback };
}

export function evaluatePrompt(promptContent: string): PromptEvaluationResult {
	return heuristicPromptEvaluation(promptContent);
}

// ============================================================================
// Prompt Evolution (iterative, PROSPER-style — browser-compatible)
// ============================================================================

export interface PromptEvolutionCandidate {
	iteration: number;
	label: string;
	prompt: string;
	score: number;
	objectives: PromptObjectiveVector;
	feedback: string[];
	parentLabel: string;
	accepted: boolean;
	preferenceScore: number;
}

export interface PromptEvolutionRun {
	promptName: string;
	baselineScore: number;
	baselineObjectives: PromptObjectiveVector;
	best: PromptEvolutionCandidate;
	exploredCandidates: PromptEvolutionCandidate[];
	acceptedCandidates: PromptEvolutionCandidate[];
}

function heuristicEvolvePrompt(basePrompt: string, evaluation: PromptEvaluationResult): string {
	const body = basePrompt.trimEnd();
	const additions = [
		'4a. If the learner echoes your phrasing, stop and ask them to explain the idea again in their own words.',
		'4b. Separate missing prerequisite, misconception, and partial intuition before choosing the next teaching move.',
		'5a. Add one short retrieval checkpoint that the learner must answer without relying on your wording.',
		'6a. Bridge the idea into a new domain, personal example, or practical consequence before ending.',
		'6b. Mark any factual claim that still needs verification instead of presenting it as settled.',
	].filter((line) => !body.includes(line));

	if (additions.length === 0) {
		return `${body}\n7a. Keep the learner cognitively active at every step. Challenge them to predict before you reveal.`;
	}

	const weakAreas: string[] = [];
	if (evaluation.objectives.voice_divergence < 0.7) weakAreas.push("Force the learner to re-explain in their own words after each major concept.");
	if (evaluation.objectives.diagnosis < 0.7) weakAreas.push("Before teaching, explicitly assess what the learner already knows and where gaps lie.");
	if (evaluation.objectives.verification < 0.7) weakAreas.push("Flag unverified claims explicitly. Never present speculation as settled fact.");
	if (evaluation.objectives.retrieval < 0.7) weakAreas.push("After each explanation, ask the learner to reconstruct the idea without looking at your words.");
	if (evaluation.objectives.transfer < 0.7) weakAreas.push("Before concluding, bridge the concept into a different domain or practical setting.");

	const targeted = weakAreas.length > 0 ? weakAreas : additions;
	return `${body}\n${targeted.join("\n")}`;
}

function pairwisePreference(left: PromptEvolutionCandidate, right: PromptEvolutionCandidate): number {
	const leftVector = [
		left.objectives.voice_divergence,
		left.objectives.diagnosis,
		left.objectives.verification,
		left.objectives.retrieval,
		left.objectives.transfer,
		left.objectives.structure,
	];
	const rightVector = [
		right.objectives.voice_divergence,
		right.objectives.diagnosis,
		right.objectives.verification,
		right.objectives.retrieval,
		right.objectives.transfer,
		right.objectives.structure,
	];
	let wins = 0;
	let losses = 0;
	for (let index = 0; index < leftVector.length; index += 1) {
		if (leftVector[index] > rightVector[index]) wins += 1;
		if (leftVector[index] < rightVector[index]) losses += 1;
	}
	const aggregateDelta = left.score - right.score;
	return wins - losses + aggregateDelta / 25;
}

function prosperStyleWinner(candidates: PromptEvolutionCandidate[]): PromptEvolutionCandidate {
	let best = candidates[0];
	let bestScore = -Infinity;

	for (const candidate of candidates) {
		const score = candidates.reduce((sum, opponent) => {
			if (candidate === opponent) return sum;
			return sum + pairwisePreference(candidate, opponent);
		}, 0);
		candidate.preferenceScore = score;
		if (score > bestScore) {
			best = candidate;
			bestScore = score;
		}
	}

	return best;
}

export function evolvePromptTemplate(
	basePrompt: string,
	promptName = "learn",
	iterations = 4
): PromptEvolutionRun {
	const baseline = heuristicPromptEvaluation(basePrompt);
	const candidates: PromptEvolutionCandidate[] = [];

	let currentPrompt = basePrompt;
	for (let iteration = 1; iteration <= iterations; iteration += 1) {
		const currentEval = heuristicPromptEvaluation(currentPrompt);
		const candidatePrompt = heuristicEvolvePrompt(currentPrompt, currentEval);
		const evaluation = heuristicPromptEvaluation(candidatePrompt);
		candidates.push({
			iteration,
			label: `${promptName}-candidate-${iteration}`,
			prompt: candidatePrompt,
			score: evaluation.score,
			objectives: evaluation.objectives,
			feedback: evaluation.feedback,
			parentLabel: promptName,
			accepted: false,
			preferenceScore: 0,
		});
		currentPrompt = candidatePrompt;
	}

	const best = prosperStyleWinner(candidates);
	for (const candidate of candidates) {
		candidate.accepted = candidate.label === best.label && candidate.score >= baseline.score;
	}

	return {
		promptName,
		baselineScore: baseline.score,
		baselineObjectives: baseline.objectives,
		best,
		exploredCandidates: candidates,
		acceptedCandidates: candidates.filter((c) => c.accepted),
	};
}

export function promptEvolutionToMarkdown(run: PromptEvolutionRun): string {
	const objectiveList = (objectives: PromptObjectiveVector): string[] => [
		`voice_divergence=${objectives.voice_divergence.toFixed(2)}`,
		`diagnosis=${objectives.diagnosis.toFixed(2)}`,
		`verification=${objectives.verification.toFixed(2)}`,
		`retrieval=${objectives.retrieval.toFixed(2)}`,
		`transfer=${objectives.transfer.toFixed(2)}`,
		`structure=${objectives.structure.toFixed(2)}`,
	];

	const lines = [
		`# Prompt Evolution Report: ${run.promptName}`,
		"",
		`- Baseline score: ${run.baselineScore.toFixed(2)}`,
		`- Best candidate: ${run.best.label}`,
		`- Best candidate score: ${run.best.score.toFixed(2)}`,
		`- PROSPER-style preference score: ${run.best.preferenceScore.toFixed(2)}`,
		"",
		"## Candidates",
		"",
	];

	for (const candidate of run.exploredCandidates) {
		lines.push(`### ${candidate.label}`);
		lines.push(`- score: ${candidate.score.toFixed(2)}`);
		lines.push(`- preference: ${candidate.preferenceScore.toFixed(2)}`);
		lines.push(`- accepted: ${candidate.accepted ? "yes" : "no"}`);
		lines.push(`- objectives: ${objectiveList(candidate.objectives).join(", ")}`);
		lines.push("");
	}

	lines.push("## Evolved Prompt");
	lines.push("```md");
	lines.push(run.best.prompt.trimEnd());
	lines.push("```");
	lines.push("");
	return `${lines.join("\n")}\n`;
}

// ============================================================================
// Self-Improvement Proposal Lifecycle (browser-compatible)
// ============================================================================

export interface ImprovementTarget {
	area: string;
	metric: string;
	value: number;
	suggestion: string;
}

export interface ImprovementProposal {
	id: string;
	timestamp: string;
	targets: ImprovementTarget[];
	hypothesis: string;
	baselineScore: number;
	status: "pending" | "applied" | "accepted" | "rejected";
}

export interface ImprovementAttempt {
	proposal: ImprovementProposal;
	baselineScore: number;
	afterScore: number | null;
	scoreDelta: number | null;
	accepted: boolean;
	completedAt: string | null;
}

export interface ImprovementArchive {
	attempts: ImprovementAttempt[];
	totalAccepted: number;
	totalRejected: number;
	cumulativeImprovement: number;
}

export function generateImprovementProposal(benchmark: BenchmarkResult): ImprovementProposal {
	const weaknesses = diagnoseBenchmark(benchmark);
	const sorted = weaknesses.sort((a, b) => a.value - b.value);
	const targets: ImprovementTarget[] = sorted.slice(0, 3).map((w) => ({
		area: w.area,
		metric: w.metric,
		value: w.value,
		suggestion: w.suggestion,
	}));

	const hypothesis = targets.length > 0
		? `Improving ${targets.map((t) => t.area).join(", ")} should raise the overall benchmark score from ${benchmark.overallScore.toFixed(2)} by addressing the identified weak areas.`
		: `The benchmark score is ${benchmark.overallScore.toFixed(2)} with no severe weaknesses detected. Consider exploring novel teaching strategies.`;

	const ts = Date.now().toString(36);
	const id = `improve-${ts}-${Math.random().toString(36).substr(2, 5)}`;

	return {
		id,
		timestamp: new Date().toISOString(),
		targets,
		hypothesis,
		baselineScore: benchmark.overallScore,
		status: "pending",
	};
}

export function proposalToMarkdown(proposal: ImprovementProposal): string {
	const lines = [
		`# Improvement Proposal: ${proposal.id}`,
		"",
		`**Timestamp**: ${proposal.timestamp}`,
		`**Baseline score**: ${proposal.baselineScore.toFixed(2)}`,
		`**Status**: ${proposal.status}`,
		"",
		"## Hypothesis",
		"",
		proposal.hypothesis,
		"",
		"## Targets",
		"",
	];

	for (let i = 0; i < proposal.targets.length; i++) {
		const t = proposal.targets[i];
		lines.push(`### ${i + 1}. ${t.area}`);
		lines.push(`- **Metric**: ${t.metric} = ${t.value.toFixed(2)}`);
		lines.push(`- **Suggestion**: ${t.suggestion}`);
		lines.push("");
	}

	lines.push("## Suggested Actions");
	lines.push("");

	if (proposal.targets.some((t) => t.metric === "meanScore" || t.metric === "meanConfusion")) {
		lines.push("1. Run `/evolve` to search for a better policy using MAP-Elites");
		lines.push("2. Run `/prompt-evolve` to evolve teaching prompt templates");
		lines.push("3. Re-run `/bench` after changes to measure improvement");
	} else {
		lines.push("1. Run `/evolve` to optimize teaching policy parameters");
		lines.push("2. Adjust feedback with `/feedback` to update learner profile");
		lines.push("3. Re-run `/bench` after changes to measure improvement");
	}

	lines.push("");
	return lines.join("\n");
}

export function improvementArchiveToMarkdown(archive: ImprovementArchive): string {
	const lines = [
		"# Self-Improvement History",
		"",
		`- Total attempts: ${archive.attempts.length}`,
		`- Accepted: ${archive.totalAccepted}`,
		`- Rejected: ${archive.totalRejected}`,
		`- Cumulative score improvement: ${archive.cumulativeImprovement.toFixed(2)}`,
		"",
	];

	if (archive.attempts.length === 0) {
		lines.push("No improvement attempts yet. Run `/improve` to start.");
		return lines.join("\n") + "\n";
	}

	lines.push("## Attempts");
	lines.push("");

	for (const attempt of archive.attempts) {
		const status = attempt.accepted ? "ACCEPTED" : "REJECTED";
		lines.push(`### ${attempt.proposal.id} — ${status}`);
		lines.push(`- Baseline: ${attempt.baselineScore.toFixed(2)}`);
		if (attempt.afterScore != null) {
			lines.push(`- After: ${attempt.afterScore.toFixed(2)}`);
			lines.push(`- Delta: ${(attempt.scoreDelta ?? 0) >= 0 ? "+" : ""}${(attempt.scoreDelta ?? 0).toFixed(2)}`);
		}
		lines.push(`- Hypothesis: ${attempt.proposal.hypothesis}`);
		lines.push("");
	}

	return lines.join("\n") + "\n";
}

// ============================================================================
// Self-Improvement Diagnosis (simplified for browser)
// ============================================================================

export type ImprovementSuggestion = ImprovementTarget;

export function diagnoseBenchmark(benchmark: BenchmarkResult): ImprovementSuggestion[] {
	const suggestions: ImprovementSuggestion[] = [];

	// Find weakest topic
	const weakest = [...benchmark.topicBenchmarks].sort((a, b) => a.meanScore - b.meanScore)[0];
	if (weakest && weakest.meanScore < 55) {
		suggestions.push({
			area: `Topic: ${weakest.topic.title}`,
			metric: "meanScore",
			value: weakest.meanScore,
			suggestion: `Consider enriching the topic definition for "${weakest.topic.title}" with better intuition hooks or clearer misconceptions.`,
		});
	}

	// Check confusion
	const allConfusion = mean(benchmark.topicBenchmarks.map((t) => t.meanConfusion));
	if (allConfusion > 0.3) {
		suggestions.push({
			area: "Learner Confusion",
			metric: "meanConfusion",
			value: allConfusion,
			suggestion: "Reduce cognitive load by pacing analogies more slowly or breaking formal content into smaller chunks.",
		});
	}

	// Check transfer
	const allTransfer = mean(benchmark.topicBenchmarks.map((t) => t.meanTransfer));
	if (allTransfer < 0.35) {
		suggestions.push({
			area: "Knowledge Transfer",
			metric: "meanTransfer",
			value: allTransfer,
			suggestion: "Strengthen interdisciplinary hooks and add explicit transfer exercises.",
		});
	}

	return suggestions;
}

// ============================================================================
// Engagement Timeline (spaced revisit system)
// ============================================================================

export interface EngagementPolicy {
	name: string;
	retentionHalfLifeDays: number;
	dueThreshold: number;
	minReviewIntervalDays: number;
	urgencyTiers: [number, number, number, number];
}

export const DEFAULT_ENGAGEMENT_POLICY: EngagementPolicy = {
	name: "spaced-revisit-default",
	retentionHalfLifeDays: 7,
	dueThreshold: 0.5,
	minReviewIntervalDays: 1,
	urgencyTiers: [21, 14, 7, 3],
};

export type UrgencyLabel = "critical" | "high" | "moderate" | "low" | "fresh";

export interface TopicEngagement {
	slug: string;
	title: string;
	domain: string;
	lastSeenAt: number;
	daysSinceLastSeen: number;
	masteryEstimate: number;
	estimatedRetention: number;
	isDue: boolean;
	urgency: number;
	urgencyLabel: UrgencyLabel;
	sessionCount: number;
	nextReviewAt: number;
}

export interface EngagementTimeline {
	generatedAt: number;
	policy: EngagementPolicy;
	topics: TopicEngagement[];
	summary: {
		totalTopics: number;
		dueCount: number;
		criticalCount: number;
		averageRetention: number;
		oldestUnreviewedDays: number;
	};
}

const MS_PER_DAY = 86_400_000;

function estimateRetention(mastery: number, daysSince: number, halfLifeDays: number): number {
	const masteryFactor = 0.5 + mastery * 1.5;
	const effectiveHalfLife = halfLifeDays * masteryFactor;
	const decay = Math.exp((-daysSince * Math.LN2) / effectiveHalfLife);
	return Math.max(0, Math.min(1, mastery * decay));
}

function computeUrgencyLabel(
	retention: number,
	dueThreshold: number,
	daysSince: number,
	tiers: [number, number, number, number]
): { urgency: number; label: UrgencyLabel } {
	if (daysSince < 1) return { urgency: 0, label: "fresh" };
	if (retention >= dueThreshold) {
		return { urgency: Math.max(0, 1 - retention / dueThreshold) * 0.3, label: "low" };
	}
	const deficit = dueThreshold - retention;
	const rawUrgency = Math.min(1, deficit / dueThreshold + 0.3);
	let label: UrgencyLabel;
	if (daysSince >= tiers[0]) label = "critical";
	else if (daysSince >= tiers[1]) label = "high";
	else if (daysSince >= tiers[2]) label = "moderate";
	else label = "low";
	return { urgency: rawUrgency, label };
}

function estimateNextReviewMs(lastSeenAt: number, mastery: number, halfLifeDays: number, dueThreshold: number): number {
	if (mastery <= dueThreshold) return Date.now();
	const masteryFactor = 0.5 + mastery * 1.5;
	const effectiveHalfLife = halfLifeDays * masteryFactor;
	const daysUntilDue = (-effectiveHalfLife * Math.log(dueThreshold / mastery)) / Math.LN2;
	return lastSeenAt + daysUntilDue * MS_PER_DAY;
}

export interface CoveredTopic {
	slug: string;
	domain: string;
	lastSeenAt: number;
	masteryEstimate: number;
	sessionCount: number;
}

export function computeTopicEngagement(
	topic: CoveredTopic,
	policy: EngagementPolicy,
	now: number = Date.now()
): TopicEngagement {
	const daysSince = (now - topic.lastSeenAt) / MS_PER_DAY;
	const retention = estimateRetention(topic.masteryEstimate, daysSince, policy.retentionHalfLifeDays);
	const isDue = retention < policy.dueThreshold && daysSince >= policy.minReviewIntervalDays;
	const { urgency, label } = computeUrgencyLabel(retention, policy.dueThreshold, daysSince, policy.urgencyTiers);
	const nextReview = estimateNextReviewMs(topic.lastSeenAt, topic.masteryEstimate, policy.retentionHalfLifeDays, policy.dueThreshold);
	return {
		slug: topic.slug,
		title: titleCase(topic.slug.replace(/-/g, " ")),
		domain: topic.domain,
		lastSeenAt: topic.lastSeenAt,
		daysSinceLastSeen: daysSince,
		masteryEstimate: topic.masteryEstimate,
		estimatedRetention: retention,
		isDue,
		urgency,
		urgencyLabel: label,
		sessionCount: topic.sessionCount,
		nextReviewAt: nextReview,
	};
}

export function buildEngagementTimeline(
	coveredTopics: CoveredTopic[],
	policy: EngagementPolicy = DEFAULT_ENGAGEMENT_POLICY,
	now: number = Date.now()
): EngagementTimeline {
	const topics = coveredTopics.map((t) => computeTopicEngagement(t, policy, now));
	topics.sort((a, b) => b.urgency - a.urgency);
	const dueCount = topics.filter((t) => t.isDue).length;
	const criticalCount = topics.filter((t) => t.urgencyLabel === "critical").length;
	const averageRetention = topics.length > 0 ? mean(topics.map((t) => t.estimatedRetention)) : 1;
	const oldestDays = topics.length > 0 ? Math.max(...topics.map((t) => t.daysSinceLastSeen)) : 0;
	return {
		generatedAt: now,
		policy,
		topics,
		summary: { totalTopics: topics.length, dueCount, criticalCount, averageRetention, oldestUnreviewedDays: oldestDays },
	};
}

export function getDueTopics(
	coveredTopics: CoveredTopic[],
	policy: EngagementPolicy = DEFAULT_ENGAGEMENT_POLICY,
	now: number = Date.now()
): TopicEngagement[] {
	return buildEngagementTimeline(coveredTopics, policy, now).topics.filter((t) => t.isDue);
}

function formatDaysAgo(days: number): string {
	if (days < 1) return "today";
	if (days < 2) return "1 day ago";
	if (days < 7) return `${Math.floor(days)} days ago`;
	if (days < 14) return "1 week ago";
	if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
	if (days < 60) return "1 month ago";
	return `${Math.floor(days / 30)} months ago`;
}

function urgencyEmoji(label: UrgencyLabel): string {
	switch (label) {
		case "critical": return "🔴";
		case "high": return "🟠";
		case "moderate": return "🟡";
		case "low": return "🟢";
		case "fresh": return "✨";
	}
}

function retentionBar(retention: number): string {
	const filled = Math.round(retention * 10);
	return "█".repeat(filled) + "░".repeat(10 - filled);
}

export function engagementTimelineToMarkdown(timeline: EngagementTimeline): string {
	const lines = [
		"# 📅 Engagement Timeline",
		"",
		`Generated: ${new Date(timeline.generatedAt).toLocaleString()}`,
		"",
		"## Summary",
		"",
		`- **Topics tracked:** ${timeline.summary.totalTopics}`,
		`- **Due for review:** ${timeline.summary.dueCount}`,
		`- **Critical:** ${timeline.summary.criticalCount}`,
		`- **Average retention:** ${(timeline.summary.averageRetention * 100).toFixed(1)}%`,
		`- **Oldest unreviewed:** ${formatDaysAgo(timeline.summary.oldestUnreviewedDays)}`,
		"",
	];

	if (timeline.topics.length === 0) {
		lines.push("No topics covered yet. Start a lesson to begin tracking.");
		return lines.join("\n") + "\n";
	}

	lines.push("## Topics");
	lines.push("");
	lines.push("| Status | Topic | Last Seen | Retention | Mastery | Sessions | Next Review |");
	lines.push("| :---: | --- | --- | --- | ---: | ---: | --- |");
	for (const topic of timeline.topics) {
		const nextReview = topic.isDue ? "**NOW**" : new Date(topic.nextReviewAt).toLocaleDateString();
		lines.push(
			`| ${urgencyEmoji(topic.urgencyLabel)} | **${topic.title}** (${topic.domain}) | ${formatDaysAgo(topic.daysSinceLastSeen)} | ${retentionBar(topic.estimatedRetention)} ${(topic.estimatedRetention * 100).toFixed(0)}% | ${(topic.masteryEstimate * 100).toFixed(0)}% | ${topic.sessionCount} | ${nextReview} |`
		);
	}
	lines.push("");
	lines.push("### Legend");
	lines.push("- 🔴 Critical — severely overdue");
	lines.push("- 🟠 High — significantly overdue");
	lines.push("- 🟡 Moderate — approaching review threshold");
	lines.push("- 🟢 Low — retention adequate");
	lines.push("- ✨ Fresh — recently covered");
	lines.push("");
	return lines.join("\n") + "\n";
}

export function dueTopicsToMarkdown(topics: TopicEngagement[]): string {
	if (topics.length === 0) {
		return "# Due Topics\n\n✅ All topics are up to date! No reviews needed right now.\n";
	}
	const lines = [
		"# 📋 Due Topics",
		"",
		`${topics.length} topic${topics.length === 1 ? "" : "s"} due for review:`,
		"",
	];
	for (const topic of topics) {
		lines.push(`### ${urgencyEmoji(topic.urgencyLabel)} ${topic.title}`);
		lines.push(`- Domain: ${topic.domain}`);
		lines.push(`- Last seen: ${formatDaysAgo(topic.daysSinceLastSeen)}`);
		lines.push(`- Retention: ${retentionBar(topic.estimatedRetention)} ${(topic.estimatedRetention * 100).toFixed(0)}%`);
		lines.push(`- Mastery at last review: ${(topic.masteryEstimate * 100).toFixed(0)}%`);
		lines.push(`- Sessions: ${topic.sessionCount}`);
		lines.push("");
	}
	return lines.join("\n") + "\n";
}

// ============================================================================
// Quiz Engine (from src/core/quiz.ts)
// ============================================================================

export type QuestionType = "multiple_choice" | "short_answer" | "true_false" | "fill_in" | "transfer" | "slider" | "dropdown" | "multi_select";

export interface QuizQuestion {
	id: string;
	type: QuestionType;
	level: "recall" | "comprehension" | "application" | "analysis" | "transfer";
	question: string;
	options?: string[];
	/** For fill_in questions with multiple blanks: the template uses ___ placeholders */
	blanks?: { placeholder?: string; hint?: string }[];
	min?: number;
	max?: number;
	step?: number;
	correctAnswer: string;
	correctAnswers?: string[];
	explanation: string;
	rubric?: string;
	timeLimit?: number;
	reframes?: Record<string, string>;
	fallbackFor?: string;
}

export interface QuizReview {
	status: "passed" | "revised";
	issues: string[];
	duplicatesRemoved: number;
	maxQuestionChars: number;
	maxAnswerChars: number;
	maxExplanationChars: number;
	maxRubricChars: number;
	maxOptionChars: number;
	limits: QuizLimits;
}

export interface AdaptiveRule {
	level: "recall" | "comprehension" | "application" | "analysis" | "transfer";
	threshold: number;
}

export interface Quiz {
	topic: string;
	slug: string;
	generatedAt: string;
	questions: QuizQuestion[];
	totalPoints: number;
	adaptiveRules?: AdaptiveRule[];
	review: QuizReview;
}

export interface QuizLimits {
	questionChars: number;
	answerChars: number;
	explanationChars: number;
	rubricChars: number;
	optionChars: number;
}

export type QuizLimitOverrides = Partial<QuizLimits>;

const DEFAULT_QUIZ_LIMITS: QuizLimits = {
	questionChars: 180,
	answerChars: 220,
	explanationChars: 220,
	rubricChars: 120,
	optionChars: 140,
};

function clampQuizLimit(value: number | undefined, min: number, max: number, fallback: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.round(value)));
}

export function resolveQuizLimits(overrides: QuizLimitOverrides = {}): QuizLimits {
	return {
		questionChars: clampQuizLimit(overrides.questionChars, 80, 320, DEFAULT_QUIZ_LIMITS.questionChars),
		answerChars: clampQuizLimit(overrides.answerChars, 80, 500, DEFAULT_QUIZ_LIMITS.answerChars),
		explanationChars: clampQuizLimit(overrides.explanationChars, 80, 500, DEFAULT_QUIZ_LIMITS.explanationChars),
		rubricChars: clampQuizLimit(overrides.rubricChars, 60, 220, DEFAULT_QUIZ_LIMITS.rubricChars),
		optionChars: clampQuizLimit(overrides.optionChars, 40, 220, DEFAULT_QUIZ_LIMITS.optionChars),
	};
}

function limitQuizText(value: string, maxChars: number): string {
	const text = value.replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	const clipped = text.slice(0, Math.max(0, maxChars - 1)).trimEnd();
	const boundary = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf(";"), clipped.lastIndexOf(","));
	const shortened = boundary >= maxChars * 0.6 ? clipped.slice(0, boundary) : clipped;
	return `${shortened.trimEnd()}…`;
}

function pickDistinctQuizItem(items: string[], prng: Prng, idx: number, fallback: string): string {
	const clean = items.map((item) => item.trim()).filter(Boolean);
	if (clean.length === 0) return fallback;
	const start = prng.int(0, clean.length - 1);
	return clean[(start + idx - 1) % clean.length] ?? fallback;
}

function normalizeQuizQuestion(value: string): string {
	return value
		.toLowerCase()
		.replace(/["'`]/g, "")
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((word) => word.length > 2 && !["the", "and", "for", "with", "your", "this", "that", "about"].includes(word))
		.join(" ");
}

function quizQuestionSimilarity(a: string, b: string): number {
	const left = new Set(normalizeQuizQuestion(a).split(/\s+/).filter(Boolean));
	const right = new Set(normalizeQuizQuestion(b).split(/\s+/).filter(Boolean));
	if (left.size === 0 || right.size === 0) return 0;
	let intersection = 0;
	for (const token of left) {
		if (right.has(token)) intersection++;
	}
	return intersection / (left.size + right.size - intersection);
}

function enforceQuizQuestionLimits(q: QuizQuestion, limits: QuizLimits): QuizQuestion {
	return {
		...q,
		question: limitQuizText(q.question, limits.questionChars),
		correctAnswer: limitQuizText(q.correctAnswer, limits.answerChars),
		explanation: limitQuizText(q.explanation, limits.explanationChars),
		rubric: q.rubric ? limitQuizText(q.rubric, limits.rubricChars) : undefined,
		options: q.options?.map((option) => limitQuizText(option, limits.optionChars)),
	};
}

function reviewQuizQuestions(questions: QuizQuestion[], limits: QuizLimits): QuizReview {
	const issues: string[] = [];
	let duplicatesRemoved = 0;
	const seen: QuizQuestion[] = [];

	for (const q of questions) {
		if (q.question.length > limits.questionChars) issues.push(`${q.id}: question exceeded ${limits.questionChars} chars`);
		if (q.correctAnswer.length > limits.answerChars) issues.push(`${q.id}: answer exceeded ${limits.answerChars} chars`);
		if (q.explanation.length > limits.explanationChars) issues.push(`${q.id}: explanation exceeded ${limits.explanationChars} chars`);
		if (q.rubric && q.rubric.length > limits.rubricChars) issues.push(`${q.id}: rubric exceeded ${limits.rubricChars} chars`);
		for (const option of q.options ?? []) {
			if (option.length > limits.optionChars) issues.push(`${q.id}: option exceeded ${limits.optionChars} chars`);
		}
		if (seen.some((prior) => quizQuestionSimilarity(prior.question, q.question) >= 0.82)) {
			duplicatesRemoved++;
			issues.push(`${q.id}: similar to an earlier question`);
		} else {
			seen.push(q);
		}
	}

	return {
		status: issues.length === 0 ? "passed" : "revised",
		issues,
		duplicatesRemoved,
		maxQuestionChars: limits.questionChars,
		maxAnswerChars: limits.answerChars,
		maxExplanationChars: limits.explanationChars,
		maxRubricChars: limits.rubricChars,
		maxOptionChars: limits.optionChars,
		limits,
	};
}

function refineQuizQuestions(questions: QuizQuestion[], limits: QuizLimits): { questions: QuizQuestion[]; review: QuizReview } {
	const refined = questions.map((question) => enforceQuizQuestionLimits(question, limits));
	const review = reviewQuizQuestions(refined, limits);
	return { questions: refined, review };
}

function makeRecallQ(topic: TopicDefinition, prng: Prng, idx: number): QuizQuestion {
	return {
		id: `${topic.slug}-r${idx}`,
		type: "short_answer",
		level: "recall",
		question: idx === 1
			? `Define "${topic.title}" in your own words.`
			: `State the central idea of ${topic.title} without using the exact lesson wording.`,
		correctAnswer: topic.summary,
		explanation: `The core definition: ${topic.summary}`,
		rubric: `1pt vague, 2pts essence, 3pts precise with nuance.`,
	};
}

function makeFillInQ(topic: TopicDefinition, _prng: Prng, idx: number): QuizQuestion {
	return {
		id: `${topic.slug}-f${idx}`,
		type: "fill_in",
		level: "recall",
		question: `Complete the sentence: "${topic.title} is a concept that _____."`,
		correctAnswer: topic.summary.toLowerCase().replace(/^a /, "").split(".")[0],
		explanation: `The completed definition: ${topic.title} is a concept that ${topic.summary.toLowerCase().replace(/^a /, "").split(".")[0]}.`,
		rubric: `1pt: partially correct. 2pts: captures the complete idea.`,
	};
}

function makeTrueFalseQ(topic: TopicDefinition, prng: Prng, idx: number): QuizQuestion {
	const isTrue = prng.bool();
	const mis = topic.misconceptions[prng.int(0, topic.misconceptions.length - 1)] ?? "a common misconception";
	return {
		id: `${topic.slug}-tf${idx}`,
		type: "true_false",
		level: "comprehension",
		question: isTrue
			? `True or False: "${topic.title}" is commonly described as ${topic.summary.toLowerCase()}.`
			: `True or False: "${mis}"`,
		correctAnswer: isTrue ? "True" : "False",
		explanation: isTrue
			? `This is true — ${topic.title} is indeed ${topic.summary.toLowerCase()}.`
			: `"${mis}" is a known misconception about ${topic.title}.`,
		rubric: `1pt: correct answer.`,
	};
}

function makeComprehensionQ(topic: TopicDefinition, prng: Prng, idx: number): QuizQuestion {
	const hook = pickDistinctQuizItem(topic.intuition, prng, idx, "the concept");
	return {
		id: `${topic.slug}-c${idx}`,
		type: "short_answer",
		level: "comprehension",
		question: `Explain the intuition: "${hook}". Why is this a helpful way to think about ${topic.title}?`,
		correctAnswer: `Because it maps ${topic.title} to something concrete before formal notation.`,
		explanation: `Intuition first, formalism second: ${hook}`,
		rubric: `2pts: explains the metaphor. 3pts: identifies when it breaks down.`,
	};
}

function makeApplicationQ(topic: TopicDefinition, prng: Prng, idx: number): QuizQuestion {
	const ex = pickDistinctQuizItem(topic.examples, prng, idx, `an example involving ${topic.title}`);
	return {
		id: `${topic.slug}-a${idx}`,
		type: "short_answer",
		level: "application",
		question: idx === 1
			? `Work through this example: ${ex}. Show the key reasoning steps.`
			: `Use ${topic.title} to solve or analyze this case: ${ex}. Name the rule you used.`,
		correctAnswer: `Follow the mechanics demonstrated in ${topic.title}.`,
		explanation: `Application grounds abstract knowledge: ${ex}`,
		rubric: `2pts attempt, 3pts correct mechanics, 4pts clear reasoning.`,
	};
}

function makeMisconceptionQ(topic: TopicDefinition, prng: Prng, idx: number): QuizQuestion {
	const mis = topic.misconceptions;
	const m = mis[prng.int(0, mis.length - 1)] ?? "a common misconception";
	return {
		id: `${topic.slug}-m${idx}`,
		type: "multiple_choice",
		level: "comprehension",
		question: `Which of the following statements about ${topic.title} is FALSE?`,
		options: [
			`${m}`,
			`${topic.title} can be reasoned about using concrete examples.`,
			`A good answer should mention limits or boundary conditions.`,
			`The formal version should connect back to the intuition.`,
		],
		correctAnswer: `${m}`,
		explanation: `"${m}" is a known misconception. The other statements are generally true.`,
	};
}

function makeTransferQ(topic: TopicDefinition, prng: Prng, idx: number): QuizQuestion {
	const domain = pickDistinctQuizItem(topic.interdisciplinaryHooks, prng, idx, "a new domain");
	return {
		id: `${topic.slug}-t${idx}`,
		type: "short_answer",
		level: "transfer",
		question: idx === 1
			? `Apply ${topic.title} to ${domain}. What structure carries over?`
			: `Where would an analogy between ${topic.title} and ${domain} break down?`,
		correctAnswer: `A valid analogy that preserves structural relationships and acknowledges boundary conditions.`,
		explanation: `Transfer requires mapping invariants, not surface features, to ${domain}.`,
		rubric: `2pts surface analogy, 3pts structure, 4pts limits included.`,
	};
}

/**
 * A question crafted by the teaching agent, grounded in the actual lesson
 * material. Only `question`, `correctAnswer`, and `explanation` are required;
 * the rest is inferred. When authored questions are supplied to generateQuiz
 * they replace the templated questions entirely.
 */
export interface AuthoredQuestion {
	type?: QuestionType;
	level?: QuizQuestion["level"];
	question: string;
	options?: string[];
	correctAnswer: string;
	correctAnswers?: string[];
	explanation: string;
	rubric?: string;
}

export interface GenerateQuizOptions {
	adaptive?: boolean;
	reframes?: string[];
	limits?: QuizLimitOverrides;
	/** Agent-crafted questions grounded in real material. Used instead of templates when 2+ are valid. */
	authored?: AuthoredQuestion[];
}

const OPEN_LEVELS: ReadonlySet<QuizQuestion["level"]> = new Set([
	"recall",
	"comprehension",
	"application",
	"analysis",
	"transfer",
]);

const DEFAULT_LEVEL_CYCLE: QuizQuestion["level"][] = [
	"recall",
	"comprehension",
	"application",
	"analysis",
	"transfer",
];

/**
 * Convert agent-authored question specs into validated QuizQuestions. Drops
 * entries missing a question/answer/explanation, infers type and level, ensures
 * multiple-choice options actually contain the correct answer, and supplies a
 * default rubric for open-ended questions so they are scored generously.
 */
export function buildAuthoredQuestions(
	topic: ReturnType<typeof resolveTopic>,
	authored: AuthoredQuestion[],
): QuizQuestion[] {
	const out: QuizQuestion[] = [];
	authored.forEach((raw, i) => {
		const question = (raw.question ?? "").trim();
		const correctAnswer = (raw.correctAnswer ?? "").trim();
		const explanation = (raw.explanation ?? "").trim();
		if (!question || !correctAnswer || !explanation) return;

		let options = Array.isArray(raw.options)
			? raw.options.map((o) => String(o).trim()).filter(Boolean)
			: undefined;

		const level: QuizQuestion["level"] = raw.level && OPEN_LEVELS.has(raw.level)
			? raw.level
			: DEFAULT_LEVEL_CYCLE[i % DEFAULT_LEVEL_CYCLE.length];

		let type: QuestionType = raw.type ?? (options && options.length >= 2 ? "multiple_choice" : "short_answer");

		// Multiple-choice questions must include the correct answer as an option.
		if ((type === "multiple_choice" || type === "dropdown") && options) {
			if (!options.some((o) => o === correctAnswer)) options = [correctAnswer, ...options];
			if (options.length < 2) type = "short_answer";
		}
		if ((type === "multiple_choice" || type === "dropdown" || type === "multi_select") && (!options || options.length < 2)) {
			type = "short_answer";
		}

		const isOpen = type === "short_answer" || type === "transfer" || type === "fill_in";
		const rubric = raw.rubric?.trim()
			? raw.rubric.trim()
			: isOpen
				? "1pt vague, 2pts captures the essence, 3pts precise with a concrete detail or limit."
				: undefined;

		out.push({
			id: `${topic.slug}-q${out.length + 1}`,
			type,
			level,
			question,
			options: options && options.length ? options : undefined,
			correctAnswer,
			correctAnswers: Array.isArray(raw.correctAnswers) && raw.correctAnswers.length
				? raw.correctAnswers.map((a) => String(a).trim()).filter(Boolean)
				: undefined,
			explanation,
			rubric,
		});
	});
	return out;
}

export function generateQuiz(topicName: string, seed = 42, options: GenerateQuizOptions = {}): Quiz {
	const topic = resolveTopic(topicName);
	const prng = new Prng(seed);
	const limits = resolveQuizLimits(options.limits);
	const questions: QuizQuestion[] = [];

	// Preferred path: the teaching agent crafted questions grounded in the real
	// material. Use them instead of the generic templates (which produce vacuous
	// "Define X in your own words" questions for any topic not hardcoded).
	const authored = options.authored ? buildAuthoredQuestions(topic, options.authored) : [];
	if (authored.length >= 2) {
		const refined = refineQuizQuestions(authored, limits);
		return {
			topic: topic.title,
			slug: topic.slug,
			generatedAt: new Date().toISOString(),
			questions: refined.questions,
			totalPoints: refined.questions.reduce((s, q) => s + (q.rubric ? 3 : 1), 0),
			adaptiveRules: undefined,
			review: refined.review,
		};
	}

	const r1 = makeRecallQ(topic, prng, 1);
	const r2 = makeRecallQ(topic, prng, 2);
	const c1 = makeComprehensionQ(topic, prng, 1);
	const m1 = makeMisconceptionQ(topic, prng, 1);
	const a1 = makeApplicationQ(topic, prng, 1);
	const a2 = makeApplicationQ(topic, prng, 2);
	const t1 = makeTransferQ(topic, prng, 1);
	const t2 = makeTransferQ(topic, prng, 2);

	if (options.adaptive) {
		r2.fallbackFor = "recall";
		a2.fallbackFor = "application";
		t2.fallbackFor = "transfer";
	}

	if (options.reframes && options.reframes.length > 0) {
		const addReframes = (q: QuizQuestion) => {
			q.reframes = {};
			for (const mode of options.reframes!) {
				if (mode === "eli5") {
					q.reframes[mode] = `[ELI5] ${q.question.replace(topic.title, `"${topic.title}"`)} Explain it like I'm 10 years old.`;
				} else if (mode === "debug") {
					q.reframes[mode] = `[Debug scenario] ${q.question.replace(topic.title, `a bug involving ${topic.title}`)} Frame this as finding and fixing a bug.`;
				} else if (mode === "cooking") {
					q.reframes[mode] = `[Cooking analogy] ${q.question.replace(topic.title, `a cooking technique related to "${topic.title}"`)} Use a kitchen/cooking analogy.`;
				} else {
					q.reframes[mode] = `[${mode}] ${q.question}`;
				}
			}
		};
		[r1, r2, c1, m1, a1, a2, t1, t2].forEach(addReframes);
	}

	questions.push(r1, r2, c1, m1, a1, a2, t1, t2);
	const refined = refineQuizQuestions(questions, limits);

	return {
		topic: topic.title,
		slug: topic.slug,
		generatedAt: new Date().toISOString(),
		questions: refined.questions,
		totalPoints: refined.questions.reduce((s, q) => s + (q.rubric ? 3 : 1), 0),
		adaptiveRules: options.adaptive ? [
			{ level: "recall", threshold: 0.5 },
			{ level: "comprehension", threshold: 0.5 },
			{ level: "application", threshold: 0.5 },
			{ level: "transfer", threshold: 0.5 },
		] : undefined,
		review: refined.review,
	};
}

export function quizToMarkdown(quiz: Quiz): string {
	const lines = [
		`# Quiz: ${quiz.topic}`,
		`> Generated: ${quiz.generatedAt}`,
		`> Reviewed: ${quiz.review.status}; limits q/a/expl/rubric/option ${quiz.review.maxQuestionChars}/${quiz.review.maxAnswerChars}/${quiz.review.maxExplanationChars}/${quiz.review.maxRubricChars}/${quiz.review.maxOptionChars} chars`,
		``,
	];
	for (const q of quiz.questions) {
		lines.push(`## ${q.id} — ${q.level} (${q.type})`);
		lines.push(q.question);
		if (q.options) {
			lines.push("");
			for (let i = 0; i < q.options.length; i++) {
				lines.push(`${String.fromCharCode(65 + i)}. ${q.options[i]}`);
			}
		}
		lines.push("");
		if (q.rubric) lines.push(`*Rubric:* ${q.rubric}`);
		lines.push("");
	}
	return lines.join("\n") + "\n";
}

export function quizAnswerKeyToMarkdown(quiz: Quiz): string {
	const lines = [
		`# Answer Key: ${quiz.topic}`,
		"",
	];
	for (const q of quiz.questions) {
		lines.push(`## ${q.id}`);
		lines.push(`**Answer:** ${q.correctAnswer}`);
		lines.push(`**Explanation:** ${q.explanation}`);
		lines.push("");
	}
	return lines.join("\n") + "\n";
}
