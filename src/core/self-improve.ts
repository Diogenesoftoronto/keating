import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { BenchmarkResult } from "./types.js";
import { runBenchmarkSuite } from "./benchmark.js";
import { loadPolicy } from "./policy.js";
import { currentPolicyPath, stateDir, outputsDir } from "./paths.js";
import { mean } from "./util.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImprovementTarget {
  file: string;
  region: string;
  weakness: string;
  metric: string;
  currentValue: number;
  rationale: string;
}

export interface ImprovementProposal {
  id: string;
  timestamp: string;
  targets: ImprovementTarget[];
  hypothesis: string;
  instructions: string;
  baselineScore: number;
  status: "pending" | "applied" | "accepted" | "rejected" | "rolled-back";
}

export interface CodeSnapshot {
  file: string;
  relativePath: string;
  content: string;
  snapshotAt: string;
}

export interface ImprovementAttempt {
  proposal: ImprovementProposal;
  snapshots: CodeSnapshot[];
  baselineScore: number;
  afterScore: number | null;
  scoreDelta: number | null;
  accepted: boolean;
  rollbackPerformed: boolean;
  completedAt: string | null;
}

export interface ImprovementArchive {
  attempts: ImprovementAttempt[];
  totalAccepted: number;
  totalRejected: number;
  cumulativeImprovement: number;
}

// ---------------------------------------------------------------------------
// Mutable source files the meta-evolution loop is allowed to touch
// ---------------------------------------------------------------------------

const MUTABLE_SOURCES: Record<string, string> = {
  "lesson-plan": "src/core/lesson-plan.ts",
  "benchmark-weights": "src/core/benchmark.ts",
  "animation": "src/core/animation.ts",
  "topics": "src/core/topics.ts",
  "map": "src/core/map.ts",
  "policy-defaults": "src/core/policy.ts"
};

/** Files that must never be modified by self-improvement. Checked at proposal time. */
export const IMMUTABLE_SOURCES = new Set([
  "src/core/self-improve.ts",
  "src/core/types.ts",
  "src/core/config.ts",
  "src/core/paths.ts",
  "src/core/random.ts"
]);

// ---------------------------------------------------------------------------
// Archive persistence
// ---------------------------------------------------------------------------

export function improvementArchivePath(cwd: string): string {
  return join(stateDir(cwd), "improvement-archive.json");
}

export function improvementsDir(cwd: string): string {
  return join(outputsDir(cwd), "improvements");
}

export function snapshotsDir(cwd: string): string {
  return join(stateDir(cwd), "snapshots");
}

export async function loadImprovementArchive(cwd: string): Promise<ImprovementArchive> {
  try {
    const raw = await readFile(improvementArchivePath(cwd), "utf8");
    return JSON.parse(raw) as ImprovementArchive;
  } catch {
    return { attempts: [], totalAccepted: 0, totalRejected: 0, cumulativeImprovement: 0 };
  }
}

async function saveImprovementArchive(cwd: string, archive: ImprovementArchive): Promise<void> {
  await writeFile(improvementArchivePath(cwd), JSON.stringify(archive, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Diagnosis: analyze benchmark traces to find weaknesses
// ---------------------------------------------------------------------------

interface DiagnosedWeakness {
  area: string;
  metric: string;
  value: number;
  file: string;
  region: string;
  explanation: string;
}

function diagnoseFromBenchmark(result: BenchmarkResult): DiagnosedWeakness[] {
  const weaknesses: DiagnosedWeakness[] = [];

  // Find the weakest topic
  const weakest = [...result.topicBenchmarks].sort((a, b) => a.meanScore - b.meanScore)[0];
  if (weakest && weakest.meanScore < 55) {
    weaknesses.push({
      area: `topic:${weakest.topic.slug}`,
      metric: "meanScore",
      value: weakest.meanScore,
      file: MUTABLE_SOURCES["topics"],
      region: `Topic definition for "${weakest.topic.slug}"`,
      explanation: `Topic "${weakest.topic.title}" scores ${weakest.meanScore.toFixed(1)}, well below the suite average of ${result.overallScore.toFixed(1)}. Its topic definition may need richer intuition, better misconceptions, or more targeted exercises.`
    });
  }

  // Find metrics that are consistently weak across topics
  const allConfusion = mean(result.topicBenchmarks.map(t => t.meanConfusion));
  if (allConfusion > 0.3) {
    weaknesses.push({
      area: "simulation:overload",
      metric: "meanConfusion",
      value: allConfusion,
      file: MUTABLE_SOURCES["benchmark-weights"],
      region: "simulateTeaching overload calculation",
      explanation: `Mean confusion across all topics is ${allConfusion.toFixed(2)} (target < 0.3). The overload formula or its interaction with policy parameters may be miscalibrated.`
    });
  }

  const allTransfer = mean(result.topicBenchmarks.map(t => t.meanTransfer));
  if (allTransfer < 0.35) {
    weaknesses.push({
      area: "simulation:transfer",
      metric: "meanTransfer",
      value: allTransfer,
      file: MUTABLE_SOURCES["lesson-plan"],
      region: "Transfer and Reflection phase",
      explanation: `Mean transfer is ${allTransfer.toFixed(2)} (target > 0.35). The lesson plan's transfer phase or interdisciplinary hooks may need strengthening.`
    });
  }

  const allEngagement = mean(result.topicBenchmarks.map(t => t.meanEngagement));
  if (allEngagement < 0.45) {
    weaknesses.push({
      area: "simulation:engagement",
      metric: "meanEngagement",
      value: allEngagement,
      file: MUTABLE_SOURCES["lesson-plan"],
      region: "Socratic and practice phases",
      explanation: `Mean engagement is ${allEngagement.toFixed(2)} (target > 0.45). Lesson phases may need more interactive elements, stronger Socratic scaffolding, or better diagram integration.`
    });
  }

  // Check per-topic dominant weaknesses
  for (const tb of result.topicBenchmarks) {
    if (tb.dominantWeakness === "overload" && tb.meanConfusion > 0.35) {
      weaknesses.push({
        area: `topic-overload:${tb.topic.slug}`,
        metric: "confusion",
        value: tb.meanConfusion,
        file: MUTABLE_SOURCES["lesson-plan"],
        region: `Domain-specific guidance for "${tb.topic.domain}" topics`,
        explanation: `Topic "${tb.topic.title}" (${tb.topic.domain}) causes excessive overload (confusion ${tb.meanConfusion.toFixed(2)}). The domain-specific lesson customization may need adjustment.`
      });
    }
    if (tb.dominantWeakness === "diagramFit") {
      weaknesses.push({
        area: `visual:${tb.topic.slug}`,
        metric: "diagramFit",
        value: tb.meanScore,
        file: MUTABLE_SOURCES["animation"],
        region: `Scene generator for ${tb.topic.domain} domain`,
        explanation: `Topic "${tb.topic.title}" has weak diagram fit. The animation scene for this domain may need richer visual representation.`
      });
    }
  }

  return weaknesses;
}

// ---------------------------------------------------------------------------
// Proposal generation
// ---------------------------------------------------------------------------

let proposalCounter = 0;

function generateProposalId(): string {
  proposalCounter += 1;
  const ts = Date.now().toString(36);
  return `improve-${ts}-${proposalCounter}`;
}

export async function generateImprovementProposal(
  cwd: string
): Promise<ImprovementProposal> {
  const policy = await loadPolicy(currentPolicyPath(cwd));
  const benchmark = await runBenchmarkSuite(cwd, policy);
  const weaknesses = diagnoseFromBenchmark(benchmark);

  // Prioritize: pick the top 3 weaknesses by severity
  const sorted = weaknesses.sort((a, b) => a.value - b.value);
  const targets: ImprovementTarget[] = sorted.slice(0, 3).map(w => ({
    file: w.file,
    region: w.region,
    weakness: w.area,
    metric: w.metric,
    currentValue: w.value,
    rationale: w.explanation
  }));

  const hypothesis = targets.length > 0
    ? `Improving ${targets.map(t => t.weakness).join(", ")} should raise the overall benchmark score from ${benchmark.overallScore.toFixed(2)} by addressing the identified weak areas.`
    : `The benchmark score is ${benchmark.overallScore.toFixed(2)} with no severe weaknesses detected. Consider exploring novel teaching strategies.`;

  const instructions = buildImprovementInstructions(cwd, targets, benchmark);

  return {
    id: generateProposalId(),
    timestamp: new Date().toISOString(),
    targets,
    hypothesis,
    instructions,
    baselineScore: benchmark.overallScore,
    status: "pending"
  };
}

function buildImprovementInstructions(
  _cwd: string,
  targets: ImprovementTarget[],
  benchmark: BenchmarkResult
): string {
  const lines: string[] = [
    "# Self-Improvement Instructions",
    "",
    "You are Keating's meta-evolution agent. Your task is to modify Keating's own source code",
    "to improve teaching effectiveness as measured by the benchmark suite.",
    "",
    "## Current Baseline",
    "",
    `- Overall score: ${benchmark.overallScore.toFixed(2)}`,
    `- Weakest topic: ${benchmark.weakestTopic}`,
    "",
    "## Safety Rules",
    "",
    "1. ONLY modify files listed in the targets below. Do not touch types, config, paths, or this self-improvement module.",
    "2. After making changes, run `bun test ./test/*.test.ts` to verify no tests break.",
    "3. Run `bun src/cli/main.ts bench` to measure the impact.",
    "4. If the benchmark score decreases or tests fail, ROLLBACK all changes using the snapshots.",
    "5. Keep changes small and focused. One logical change per target.",
    "6. Do not change function signatures that are imported by other modules.",
    "7. Add a comment `// [self-improve] <proposal-id>` near each changed region.",
    "",
    "## Targets",
    ""
  ];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    lines.push(`### Target ${i + 1}: ${t.weakness}`);
    lines.push("");
    lines.push(`- **File**: ${t.file}`);
    lines.push(`- **Region**: ${t.region}`);
    lines.push(`- **Metric**: ${t.metric} = ${t.currentValue.toFixed(2)}`);
    lines.push(`- **Rationale**: ${t.rationale}`);
    lines.push("");
    lines.push("**Suggested approach**: Read the file, understand the region, and make a targeted change");
    lines.push("that addresses the diagnosed weakness. Think about what the benchmark simulation actually");
    lines.push("measures and how your code change will flow through to improve the metric.");
    lines.push("");
  }

  lines.push("## Evaluation Protocol");
  lines.push("");
  lines.push("After applying changes:");
  lines.push("1. Run `bun x tsc -p tsconfig.json` — must compile clean");
  lines.push("2. Run `bun test ./test/*.test.ts` — all tests must pass");
  lines.push("3. Run `bun src/cli/main.ts bench` — record the new overall score");
  lines.push(`4. If new score > ${benchmark.overallScore.toFixed(2)}, the change is accepted`);
  lines.push(`5. If new score <= ${benchmark.overallScore.toFixed(2)}, rollback using the snapshots`);
  lines.push("6. Record the result using `/improve accept` or `/improve reject`");
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Snapshot: save current state of mutable files before changes
// ---------------------------------------------------------------------------

export async function snapshotMutableSources(cwd: string, proposalId: string): Promise<CodeSnapshot[]> {
  const snapDir = join(snapshotsDir(cwd), proposalId);
  await mkdir(snapDir, { recursive: true });

  const snapshots: CodeSnapshot[] = [];
  for (const [_label, relativePath] of Object.entries(MUTABLE_SOURCES)) {
    const fullPath = join(cwd, relativePath);
    try {
      const content = await readFile(fullPath, "utf8");
      const snapshot: CodeSnapshot = {
        file: fullPath,
        relativePath,
        content,
        snapshotAt: new Date().toISOString()
      };
      snapshots.push(snapshot);
      await writeFile(join(snapDir, relativePath.replace(/\//g, "__")), content, "utf8");
    } catch {
      // file doesn't exist, skip
    }
  }
  return snapshots;
}

// ---------------------------------------------------------------------------
// Rollback: restore files from snapshot
// ---------------------------------------------------------------------------

export async function rollbackFromSnapshots(snapshots: CodeSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    await writeFile(snapshot.file, snapshot.content, "utf8");
  }
}

// ---------------------------------------------------------------------------
// Evaluate: compare before/after benchmark scores
// ---------------------------------------------------------------------------

export async function evaluateImprovement(
  cwd: string,
  baselineScore: number
): Promise<{ afterScore: number; improved: boolean; delta: number }> {
  const policy = await loadPolicy(currentPolicyPath(cwd));
  const result = await runBenchmarkSuite(cwd, policy);
  const delta = result.overallScore - baselineScore;
  return {
    afterScore: result.overallScore,
    improved: delta > 0,
    delta
  };
}

// ---------------------------------------------------------------------------
// Record: persist an improvement attempt to the archive
// ---------------------------------------------------------------------------

export async function recordAttempt(
  cwd: string,
  attempt: ImprovementAttempt
): Promise<void> {
  const archive = await loadImprovementArchive(cwd);
  archive.attempts.push(attempt);
  if (attempt.accepted) {
    archive.totalAccepted += 1;
    archive.cumulativeImprovement += attempt.scoreDelta ?? 0;
  } else {
    archive.totalRejected += 1;
  }
  await saveImprovementArchive(cwd, archive);
}

// ---------------------------------------------------------------------------
// Full pipeline: diagnose -> propose -> snapshot -> write proposal
// ---------------------------------------------------------------------------

export interface ImprovementArtifact {
  proposalPath: string;
  proposal: ImprovementProposal;
  snapshots: CodeSnapshot[];
}

export async function generateImprovementArtifact(cwd: string): Promise<ImprovementArtifact> {
  const dir = improvementsDir(cwd);
  await mkdir(dir, { recursive: true });

  const proposal = await generateImprovementProposal(cwd);
  const snapshots = await snapshotMutableSources(cwd, proposal.id);

  // Write the proposal as a markdown artifact the agent can read and execute
  const proposalPath = join(dir, `${proposal.id}.md`);
  const content = [
    `# Improvement Proposal: ${proposal.id}`,
    "",
    `**Timestamp**: ${proposal.timestamp}`,
    `**Baseline score**: ${proposal.baselineScore.toFixed(2)}`,
    `**Status**: ${proposal.status}`,
    "",
    `## Hypothesis`,
    "",
    proposal.hypothesis,
    "",
    `## Snapshotted Files`,
    "",
    ...snapshots.map(s => `- ${s.relativePath} (${s.content.length} bytes)`),
    "",
    proposal.instructions,
    "",
    "## Archive Context",
    ""
  ].join("\n");

  // Append prior attempt summaries for the agent's learning
  const archive = await loadImprovementArchive(cwd);
  const history = archive.attempts.slice(-5).map(a => {
    const status = a.accepted ? "ACCEPTED" : "REJECTED";
    const delta = a.scoreDelta != null ? ` (delta: ${a.scoreDelta.toFixed(2)})` : "";
    const targets = a.proposal.targets.map(t => t.weakness).join(", ");
    return `- ${a.proposal.id}: ${status}${delta} — targeted ${targets}`;
  });

  const fullContent = history.length > 0
    ? content + "Recent attempts (learn from these):\n\n" + history.join("\n") + "\n"
    : content + "No prior improvement attempts. This is the first run.\n";

  await writeFile(proposalPath, fullContent, "utf8");

  return { proposalPath, proposal, snapshots };
}

// ---------------------------------------------------------------------------
// Accept / Reject helpers
// ---------------------------------------------------------------------------

export async function acceptImprovement(
  cwd: string,
  proposalId: string,
  afterScore: number
): Promise<void> {
  const archive = await loadImprovementArchive(cwd);
  const existing = archive.attempts.find(a => a.proposal.id === proposalId);
  if (existing) {
    existing.accepted = true;
    existing.afterScore = afterScore;
    existing.scoreDelta = afterScore - existing.baselineScore;
    existing.proposal.status = "accepted";
    existing.completedAt = new Date().toISOString();
    archive.totalAccepted += 1;
    archive.cumulativeImprovement += existing.scoreDelta;
    await saveImprovementArchive(cwd, archive);
    return;
  }

  // If not found in archive, create a new entry
  const proposal: ImprovementProposal = {
    id: proposalId,
    timestamp: new Date().toISOString(),
    targets: [],
    hypothesis: "Accepted externally",
    instructions: "",
    baselineScore: afterScore,
    status: "accepted"
  };

  await recordAttempt(cwd, {
    proposal,
    snapshots: [],
    baselineScore: 0,
    afterScore,
    scoreDelta: null,
    accepted: true,
    rollbackPerformed: false,
    completedAt: new Date().toISOString()
  });
}

export async function rejectImprovement(
  cwd: string,
  proposalId: string,
  snapshots: CodeSnapshot[]
): Promise<void> {
  await rollbackFromSnapshots(snapshots);

  const archive = await loadImprovementArchive(cwd);
  const existing = archive.attempts.find(a => a.proposal.id === proposalId);
  if (existing) {
    existing.accepted = false;
    existing.proposal.status = "rejected";
    existing.rollbackPerformed = true;
    existing.completedAt = new Date().toISOString();
    archive.totalRejected += 1;
    await saveImprovementArchive(cwd, archive);
    return;
  }

  await recordAttempt(cwd, {
    proposal: {
      id: proposalId,
      timestamp: new Date().toISOString(),
      targets: [],
      hypothesis: "Rejected and rolled back",
      instructions: "",
      baselineScore: 0,
      status: "rolled-back"
    },
    snapshots,
    baselineScore: 0,
    afterScore: null,
    scoreDelta: null,
    accepted: false,
    rollbackPerformed: true,
    completedAt: new Date().toISOString()
  });
}

// ---------------------------------------------------------------------------
// Markdown report of improvement history
// ---------------------------------------------------------------------------

export function improvementHistoryToMarkdown(archive: ImprovementArchive): string {
  const lines = [
    "# Self-Improvement History",
    "",
    `- Total attempts: ${archive.attempts.length}`,
    `- Accepted: ${archive.totalAccepted}`,
    `- Rejected: ${archive.totalRejected}`,
    `- Cumulative score improvement: ${archive.cumulativeImprovement.toFixed(2)}`,
    ""
  ];

  if (archive.attempts.length === 0) {
    lines.push("No improvement attempts yet. Run `/improve` to start the self-improvement loop.");
    return lines.join("\n");
  }

  lines.push("## Attempts");
  lines.push("");

  for (const attempt of archive.attempts) {
    const status = attempt.accepted ? "ACCEPTED" : attempt.rollbackPerformed ? "ROLLED BACK" : "REJECTED";
    lines.push(`### ${attempt.proposal.id} — ${status}`);
    lines.push("");
    lines.push(`- Baseline: ${attempt.baselineScore.toFixed(2)}`);
    if (attempt.afterScore != null) {
      lines.push(`- After: ${attempt.afterScore.toFixed(2)}`);
      lines.push(`- Delta: ${(attempt.scoreDelta ?? 0) >= 0 ? "+" : ""}${(attempt.scoreDelta ?? 0).toFixed(2)}`);
    }
    lines.push(`- Hypothesis: ${attempt.proposal.hypothesis}`);
    if (attempt.proposal.targets.length > 0) {
      lines.push(`- Targets: ${attempt.proposal.targets.map(t => `${t.file}:${t.region}`).join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
