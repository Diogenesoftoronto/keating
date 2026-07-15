import type { AgentTool } from "@earendil-works/pi-agent-core";
import { DEFAULT_BROWSER_POLICY, type KeatingStorage, type Policy } from "../storage";
import {
	runBenchmarkSuite,
	benchmarkToMarkdown,
	hasEnoughRealData,
	MIN_REAL_OUTCOMES,
	mapElitesEvolve,
	mapElitesToMarkdown,
	mapElitesToEvolutionRun,
	DEFAULT_POLICY,
	DEFAULT_WEIGHTS,
	clampPolicy,
	diagnoseBenchmark,
	evaluatePrompt,
	evolvePromptTemplate,
	promptEvolutionToMarkdown,
	generateImprovementProposal,
	proposalToMarkdown,
	improvementArchiveToMarkdown,
	type TeacherPolicy,
	type ImprovementArchive,
} from "../core";
import { isNodePodActive, nodePodCreateSnapshot } from "../nodepod-runtime";
import { getActiveKeatingPrompt } from "./prompt";
import { createTool, type KeatingToolsOptions, type OutcomeCollector, type ToolRegistry } from "./shared";

const POLICY_FIELDS: Array<keyof Omit<TeacherPolicy, "name">> = [
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

export function parsePolicyFromStorage(policy: Policy | null): TeacherPolicy {
	if (!policy) return DEFAULT_POLICY;

	const parsed = parsePolicyContent(policy.content);
	return clampPolicy({
		...DEFAULT_POLICY,
		...parsed,
		name: policy.id,
	});
}

function parsePolicyContent(content: string): Partial<TeacherPolicy> {
	const jsonBlock = content.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? content;
	try {
		const parsed = JSON.parse(jsonBlock) as Partial<TeacherPolicy>;
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		const parsed: Partial<Record<keyof Omit<TeacherPolicy, "name">, number>> = {};
		for (const field of POLICY_FIELDS) {
			const match = content.match(new RegExp(`${field}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
			if (match) {
				parsed[field] = Number(match[1]);
			}
		}
		return parsed;
	}
}

function policyToMarkdown(policy: TeacherPolicy, score: number): string {
	return [
		"# Evolved Teaching Policy",
		"",
		`Generated: ${new Date().toISOString()}`,
		`Score: ${score.toFixed(2)}/100`,
		"",
		"## Parameters",
		...POLICY_FIELDS.map((field) => `- ${field}: ${policy[field].toFixed(field === "exerciseCount" ? 0 : 3)}`),
		"",
		"```json",
		JSON.stringify(policy, null, 2),
		"```",
	].join("\n");
}

export function createImprovementTools(
	storage: KeatingStorage,
	options: KeatingToolsOptions,
	collectRealOutcomes: OutcomeCollector,
): AgentTool[] {
	return [
		createTool(
			"evolve",
			"Evolve the teaching policy using MAP-Elites algorithm. Use to search for better policy parameters when benchmarks show room for improvement.",
			{
				topic: { type: "string", description: "Optional topic to focus the evolution on" }
			},
			async (params) => {
				const topic = params.topic as string | undefined;
				const basePolicy = parsePolicyFromStorage(await storage.getActivePolicy());
				const realOutcomesRef = await collectRealOutcomes();
				if (!hasEnoughRealData(realOutcomesRef)) {
					return `Not ready to evolve: need at least ${MIN_REAL_OUTCOMES} learner feedback signals; found ${realOutcomesRef.length}. Keep teaching and collecting explicit or inferred feedback.`;
				}

				const meRun = mapElitesEvolve(basePolicy, topic, 24, 20260401, undefined, undefined, realOutcomesRef);
				const run = mapElitesToEvolutionRun(meRun);
				const report = mapElitesToMarkdown(meRun);

				await storage.savePolicy(policyToMarkdown(run.bestPolicy, run.best.overallScore), true);

				const saved = await storage.saveEvolution(
					run.best.overallScore,
					JSON.stringify(run.bestPolicy),
					report,
					topic,
					JSON.stringify(run.exploredCandidates, null, 2)
				);

				return `[artifact://evolution/${saved.id}]\n\n**Policy evolved (MAP-Elites)**\n\nBest: ${run.best.overallScore.toFixed(2)}/100 | Baseline: ${run.baseline.overallScore.toFixed(2)}/100 | Filled cells: ${meRun.filledCellCount}/${meRun.totalCells} | Accepted: ${run.acceptedCandidates.length}/${run.exploredCandidates.length}\n\n${report}`;
			}
		),

			// quiz - Generate retrieval practice questions
		createTool(
			"policy",
			"Show the current active teaching policy parameters.",
			{},
			async () => {
				const policy = await storage.getActivePolicy();
				const content = policy?.content || DEFAULT_BROWSER_POLICY;

				return `\`\`\`markdown\n${content}\n\`\`\``;
			}
		),

		// outputs - Browse artifacts
		createTool(
			"auto_improve",
			"Run the full autonomous self-improvement loop: benchmark current policy → evolve policy via MAP-Elites → evolve prompt template → record improvement. Use this instead of calling bench/evolve/improve separately. Triggers automatically on first session and periodically thereafter.",
			{
				topic: { type: "string", description: "Optional topic to focus the improvement on" },
				force: { type: "boolean", description: "Set true only when the learner explicitly asks to run auto_improve again in this session" }
			},
			async (params) => {
				const topic = params.topic as string | undefined;
				const force = params.force === true;
				const previousPolicy = await storage.getActivePolicy();
				const alreadyRanThisSession = (await storage.getImprovementAttempts()).some(
					(attempt) => attempt.sessionId === storage.currentSessionId
				);
				if (alreadyRanThisSession && !force) {
					return "auto_improve already ran in this session. Pass force=true only if the learner explicitly asks to run it again.";
				}

				// Snapshot NodePod VFS before any changes (if active)
				let nodePodSnapId: string | null = null;
				if (isNodePodActive()) {
					try {
						const snap = await nodePodCreateSnapshot(`auto-improve-${Date.now()}`);
						nodePodSnapId = snap.id;
					} catch {
						// ignore snapshot failures
					}
				}

				const basePolicy = parsePolicyFromStorage(await storage.getActivePolicy());
				const realOutcomes = await collectRealOutcomes();
				if (!hasEnoughRealData(realOutcomes)) {
					return `Not ready to auto-improve: need at least ${MIN_REAL_OUTCOMES} learner feedback signals; found ${realOutcomes.length}.`;
				}

				// Step 1: Baseline benchmark
				const baseline = runBenchmarkSuite(basePolicy, topic, 20260401, 3, DEFAULT_WEIGHTS, realOutcomes);
				const baselineReport = benchmarkToMarkdown(baseline);
				await storage.saveBenchmark(baseline.overallScore, baselineReport, topic);

				// Step 2: Evolve policy via MAP-Elites
				const meRun = mapElitesEvolve(basePolicy, topic, 24, 20260401, undefined, undefined, realOutcomes);
				const run = mapElitesToEvolutionRun(meRun);
				const evolveReport = mapElitesToMarkdown(meRun);

				await storage.savePolicy(policyToMarkdown(run.bestPolicy, run.best.overallScore), true);
				const saved = await storage.saveEvolution(
					run.best.overallScore,
					JSON.stringify(run.bestPolicy),
					evolveReport,
					topic,
					JSON.stringify(run.exploredCandidates, null, 2)
				);

				// Step 3: Evolve prompt template
				const promptBase = await getActiveKeatingPrompt(storage, "learn");
				const promptRun = evolvePromptTemplate(promptBase, "learn", 4);
				const promptReport = promptEvolutionToMarkdown(promptRun);
				const promptSaved = await storage.savePromptEvolution("learn", {
					bestScore: promptRun.best.score,
					bestPrompt: promptRun.best.prompt,
					report: promptReport,
				});
				options.setSystemPrompt?.(promptRun.best.prompt);

				// Step 4: Post-evolution benchmark
				const evolvedPolicy = run.bestPolicy;
				const after = runBenchmarkSuite(evolvedPolicy, topic, 20260401, 3, DEFAULT_WEIGHTS, realOutcomes);
				const afterReport = benchmarkToMarkdown(after);
				const benchmarkSaved = await storage.saveBenchmark(after.overallScore, afterReport, topic);

				// Step 5: Record improvement
				const delta = after.overallScore - baseline.overallScore;
				if (delta < -0.5) {
					await storage.savePolicy(previousPolicy?.content ?? policyToMarkdown(basePolicy, baseline.overallScore), true);
				}
				const proposalId = `auto-${Date.now().toString(36)}`;
				const improvementSaved = await storage.saveImprovementAttempt({
					proposalId,
					baselineScore: baseline.overallScore,
					afterScore: after.overallScore,
					scoreDelta: delta,
					accepted: delta > -0.5,
					targets: diagnoseBenchmark(baseline).map((s) => s.area).join(","),
					hypothesis: `Auto-improve: evolved policy (${run.acceptedCandidates.length} accepted) + evolved prompt (${promptRun.acceptedCandidates.length} accepted)`,
				});

				const verdict = delta > 0
					? `IMPROVED by +${delta.toFixed(2)}`
					: delta < -0.5
						? `REGRESSED by ${delta.toFixed(2)} (evolved policy reverted)`
						: `NO SIGNIFICANT CHANGE (Δ${delta.toFixed(2)})`;

				const nodePodNote = nodePodSnapId
					? `\n**NodePod snapshot:** ${nodePodSnapId} (created before improvement, can restore if needed via \`source_restore\`)`
					: "";

				return `[artifact://evolution/${saved.id}] [artifact://prompt-evolution/${promptSaved.id}] [artifact://benchmark/${benchmarkSaved.id}] [artifact://improvement/${improvementSaved.id}]\n\nSelf-improvement complete.

**Benchmark:** ${baseline.overallScore.toFixed(2)} → ${after.overallScore.toFixed(2)} (${verdict})

**Policy Evolution (MAP-Elites):**
- Accepted: ${run.acceptedCandidates.length}/${run.exploredCandidates.length} candidates
- Filled cells: ${meRun.filledCellCount}/${meRun.totalCells}
- Best policy: analogyDensity=${evolvedPolicy.analogyDensity.toFixed(3)} socraticRatio=${evolvedPolicy.socraticRatio.toFixed(3)} formalism=${evolvedPolicy.formalism.toFixed(3)}

**Prompt Evolution (PROSPER):**
- Baseline: ${promptRun.baselineScore.toFixed(2)} → Best: ${promptRun.best.score.toFixed(2)}
- Accepted: ${promptRun.acceptedCandidates.length}/${promptRun.exploredCandidates.length} candidates${nodePodNote}

**Weaknesses diagnosed:** ${diagnoseBenchmark(baseline).map((s) => s.area).join(", ") || "none"}`;
			}
		),

		// improve - Targeted improvement proposal
		createTool(
			"improve",
			"Generate a targeted improvement proposal by diagnosing benchmark weaknesses. Returns specific areas to improve and suggestions. Pass action='history' to view past improvement attempts.",
			{
				action: { type: "string", description: "Pass 'history' to view past improvement attempts" }
			},
			async (params) => {
				const sub = (params.action as string) || "";

				if (sub === "history") {
					const archive = await storage.getImprovementArchive();
					return improvementArchiveToMarkdown(archive as ImprovementArchive);
				}

				const teacherPolicy = parsePolicyFromStorage(await storage.getActivePolicy());

				// Diagnose against the same real-data benchmark used everywhere else,
				// not the synthetic fallback.
				const benchmark = runBenchmarkSuite(teacherPolicy, undefined, 20260401, 3, DEFAULT_WEIGHTS, await collectRealOutcomes());
				const proposal = generateImprovementProposal(benchmark);
				const report = proposalToMarkdown(proposal);

				return report;
			}
		),

		// trace - Browse benchmark/evolution traces
		createTool(
			"trace",
			"Browse benchmark and evolution history. Pass type='benchmark' or type='evolution' to filter.",
			{
				type: { type: "string", enum: ["benchmark", "evolution", "all"], description: "Filter by trace type" }
			},
			async (params) => {
				const type = (params.type as string) || "all";

				const benchmarks = await storage.getBenchmarks();
				const evolutions = await storage.getEvolutions();

				if (benchmarks.length === 0 && evolutions.length === 0) {
					return "No traces yet. Run auto_improve or bench first.";
				}

				const lines: string[] = ["Keating Traces\n"];

				if (type === "all" || type === "benchmark") {
					lines.push("## Benchmarks");
					for (const b of benchmarks.slice(0, 10)) {
						lines.push(`- ${b.topic || "general"}: ${b.score.toFixed(2)} (${new Date(b.createdAt).toLocaleDateString()})`);
					}
					lines.push("");
				}

				if (type === "all" || type === "evolution") {
					lines.push("## Evolutions");
					for (const e of evolutions.slice(0, 10)) {
						lines.push(`- ${e.topic || "general"}: ${e.bestScore.toFixed(2)} (${new Date(e.createdAt).toLocaleDateString()})`);
					}
				}

				return lines.join("\n");
			}
		),

		// prompt_evolve - Iteratively evolve a teaching prompt template
		createTool(
			"prompt_evolve",
			"Iteratively evolve a teaching prompt template using PROSPER-style pairwise selection. Runs 4 iterations of candidate generation and evaluation.",
			{
				name: { type: "string", description: "Name of the prompt template to evolve (defaults to 'learn')" }
			},
			async (params) => {
				const promptName = (params.name as string) || "learn";
				const basePrompt = await getActiveKeatingPrompt(storage, promptName);

				const run = evolvePromptTemplate(basePrompt, promptName, 4);
				const report = promptEvolutionToMarkdown(run);

				await storage.savePromptEvolution(promptName, {
					bestScore: run.best.score,
					bestPrompt: run.best.prompt,
					report,
				});
				options.setSystemPrompt?.(run.best.prompt);

				const improved = run.best.score > run.baselineScore;

				return `Prompt "${promptName}" evolved.\n\nBaseline: ${run.baselineScore.toFixed(2)} → Best: ${run.best.score.toFixed(2)} | Improved: ${improved}\n\n${report}`;
			}
		),

		// prompt_eval - Single-pass prompt evaluation
		createTool(
			"prompt_eval",
			"Evaluate a prompt template for teaching effectiveness in a single pass. Returns score, per-objective breakdown, and improvement feedback.",
			{
				prompt: { type: "string", description: "The prompt template content to evaluate" }
			},
			async (params) => {
				const promptContent = (params.prompt as string) || "";
				if (!promptContent) {
					return "Prompt content required.";
				}

				const result = evaluatePrompt(promptContent);

				const objectiveList = Object.entries(result.objectives)
					.map(([k, v]) => `- ${k}: ${v.toFixed(2)}`)
					.join("\n");

				const feedbackSection =
					result.feedback.length > 0
						? `\n## Feedback\n${result.feedback.map((f) => `- ${f}`).join("\n")}`
						: "\n## Feedback\n- No major issues detected.";

				return `**Score:** ${result.score.toFixed(2)}/100\n\n## Objectives\n${objectiveList}${feedbackSection}`;
			}
		),

		// timeline - Show engagement timeline
	];
}

export function createImprovementCapabilityTools(registry: ToolRegistry): AgentTool[] {
	return [
		createTool(
			"evaluate_teaching",
			"Evaluate current teaching evidence or a prompt without changing policy. Use this to test a concrete hypothesis before requesting improvement.",
			{
				kind: { type: "string", enum: ["evidence", "prompt"], description: "Evaluate learner evidence with the benchmark, or evaluate supplied prompt content." },
				topic: { type: "string", description: "Optional topic scope for evidence evaluation." },
				prompt: { type: "string", description: "Prompt content, required when kind is prompt." },
				hypothesis: { type: "string", description: "The teaching hypothesis this evaluation is intended to test." },
			},
			async (params) => {
				const kind = params.kind === "prompt" ? "prompt" : "evidence";
				const hypothesis = String(params.hypothesis ?? "").trim();
				const result = kind === "prompt"
					? await registry.invoke( "prompt_eval", { prompt: params.prompt })
					: await registry.invoke( "bench", { topic: params.topic });
				return [hypothesis ? `# Evaluation hypothesis\n\n${hypothesis}` : "", result].filter(Boolean).join("\n\n");
			},
			["kind"],
		),
		createTool(
			"request_teaching_improvement",
			"Direct a safeguarded teaching-improvement run after the active teaching moment. State the evidence-backed hypothesis and whether policy, prompt, or both should change.",
			{
				scope: { type: "string", enum: ["policy", "prompt", "both"], description: "Which teaching surface may change." },
				hypothesis: { type: "string", description: "Required, falsifiable explanation of what should improve and why." },
				topic: { type: "string", description: "Optional topic scope." },
				target_objectives: { type: "array", items: { type: "string" }, description: "Optional evaluation objectives to emphasize in the report." },
			},
			async (params) => {
				const scope = ["policy", "prompt", "both"].includes(String(params.scope)) ? String(params.scope) : "both";
				const hypothesis = String(params.hypothesis ?? "").trim();
				if (!hypothesis) return "A concrete improvement hypothesis is required.";
				const targetObjectives = Array.isArray(params.target_objectives)
					? params.target_objectives.filter((value): value is string => typeof value === "string")
					: [];
				const result = scope === "policy"
					? await registry.invoke( "evolve", { topic: params.topic })
					: scope === "prompt"
						? await registry.invoke( "prompt_evolve", { name: "learn" })
						: await registry.invoke( "auto_improve", { topic: params.topic });
				return [
					"# Directed teaching improvement",
					`- scope: ${scope}`,
					`- hypothesis: ${hypothesis}`,
					targetObjectives.length ? `- target objectives: ${targetObjectives.join(", ")}` : "",
					"",
					result,
				].filter((line) => line !== "").join("\n");
			},
			["scope", "hypothesis"],
		),
	];
}
