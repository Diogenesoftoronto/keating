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
	trace?: any;
}

export interface EvolutionCandidate {
	policy: TeacherPolicy;
	benchmark: BenchmarkResult;
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
	analogyDensity: 0.6,
	socraticRatio: 0.55,
	formalism: 0.5,
	retrievalPractice: 0.7,
	exerciseCount: 4,
	diagramBias: 0.45,
	reflectionBias: 0.5,
	interdisciplinaryBias: 0.4,
	challengeRate: 0.35,
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
		exerciseCount: Math.max(1, Math.min(8, policy.exerciseCount)),
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
		0.14 + intuitionFit * 0.18 + rigorFit * 0.2 + dialogueFit * 0.12 + diagramFit * 0.09 + practiceFit * 0.12 + (1 - overload) * 0.18
	);
	const retention = clamp(masteryGain * (0.55 + policy.retrievalPractice * 0.45));
	const engagement = clamp(
		0.12 + intuitionFit * 0.16 + dialogueFit * 0.16 + diagramFit * 0.1 + reflectionFit * 0.14 + (1 - overload) * 0.18
	);
	const transfer = clamp(retention * (0.55 + policy.interdisciplinaryBias * 0.25 + learner.transferDesire * 0.2));
	const confusion = clamp(
		0.04 +
			overload * 0.55 +
			Math.abs(policy.formalism - learner.abstractionComfort) * 0.18 +
			Math.abs(policy.challengeRate - learner.persistence) * 0.12
	);

	const score = clamp(masteryGain * weights.masteryGain + retention * weights.retention + engagement * weights.engagement + transfer * weights.transfer - confusion * weights.confusion, 0, 1);

	const explanation: string[] = [];
	if (intuitionFit >= 0.8) explanation.push("analogy pacing matched the learner well");
	if (rigorFit >= 0.8) explanation.push("formal depth fit the learner's abstraction comfort");
	if (practiceFit >= 0.75) explanation.push("exercise load matched the learner's need for repetition");
	if (reflectionFit >= 0.75) explanation.push("reflection and transfer demands aligned with the learner");
	if (overload >= 0.55) explanation.push("challenge and formal load pushed the learner toward overload");
	if (diagramFit <= 0.45) explanation.push("diagram emphasis mismatched the learner's visual preference");
	if (explanation.length === 0) explanation.push("the lesson was balanced but not strongly optimized for this learner");

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
		explanation,
	};
}

function classifyDominantSignal(simulations: TeachingSimulation[], kind: "strength" | "weakness"): string {
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

export function runBenchmarkSuite(
	policy: TeacherPolicy,
	focusTopic?: string,
	seed = 20260401,
	traceLimit = 3,
	weights: SimulationWeights = DEFAULT_WEIGHTS
): BenchmarkResult {
	const topics = benchmarkTopics(focusTopic);
	const topicBenchmarks = topics.map((topic, index) => {
		const learners = buildLearnerPopulation(seed + index * 97, 18);
		const simulations = learners.map((learner) => simulateTeaching(policy, topic, learner, weights));
		return summarizeTopic(topic, simulations, traceLimit);
	});

	const weakest = [...topicBenchmarks].sort((left, right) => left.meanScore - right.meanScore)[0];

	return {
		policy,
		suiteName: focusTopic ? `focused:${focusTopic}` : "core-suite",
		topicBenchmarks,
		overallScore: mean(topicBenchmarks.map((entry) => entry.meanScore)),
		weakestTopic: weakest?.topic.title ?? "n/a",
		trace: undefined,
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

export function mapElitesEvolve(
	basePolicy: TeacherPolicy,
	focusTopic?: string,
	iterations = 24,
	seed = 20260401,
	descriptors = DEFAULT_DESCRIPTORS,
	resolution = DEFAULT_RESOLUTION
): MapElitesRun {
	const prng = new Prng(seed);
	const grid: MapElitesGrid = { descriptors, resolution, cells: new Map() };
	const totalCells = resolution ** descriptors.length;
	const initRandom = Math.floor(iterations * 0.25);

	const baseline = runBenchmarkSuite(basePolicy, focusTopic, seed, 3, DEFAULT_WEIGHTS);
	mePlaceInGrid(grid, basePolicy, DEFAULT_WEIGHTS, baseline.overallScore, baseline, 0);

	const exploredCandidates: EvolutionCandidate[] = [];

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

		const candidateBenchmark = runBenchmarkSuite(candidatePolicy, focusTopic, seed + i * 11, 3, candidateWeights);
		const isNewCell = mePlaceInGrid(grid, candidatePolicy, candidateWeights, candidateBenchmark.overallScore, candidateBenchmark, i);

		exploredCandidates.push({
			policy: candidatePolicy,
			benchmark: candidateBenchmark,
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
	}

	let best: BenchmarkResult = baseline;
	for (const cell of grid.cells.values()) {
		if (cell && cell.benchmark.overallScore > best.overallScore) {
			best = cell.benchmark;
		}
	}

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

function heuristicPromptEvaluation(promptContent: string): { score: number; objectives: PromptObjectiveVector; feedback: string[] } {
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

export function evaluatePrompt(promptContent: string): { score: number; objectives: PromptObjectiveVector; feedback: string[] } {
	return heuristicPromptEvaluation(promptContent);
}

// ============================================================================
// Self-Improvement Diagnosis (simplified for browser)
// ============================================================================

export interface ImprovementSuggestion {
	area: string;
	metric: string;
	value: number;
	suggestion: string;
}

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
