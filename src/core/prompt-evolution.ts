import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as dotenv from "dotenv";

import { promptEvolutionArchivePath, promptEvolutionDir } from "./paths.js";
import { piComplete, piCompleteJson } from "./pi-agent.js";

dotenv.config();

const KEATING_QUOTE =
  "Boys, you must strive to find your own voice. Because the longer you wait to begin, the less likely you are to find it at all.";

let piAvailabilityCache: boolean | null = null;

function promptNameFromPath(promptPath: string): string {
  const fileName = promptPath.split(/[\\/]/).pop() ?? promptPath;
  return fileName.replace(/\.md$/, "");
}

export interface PromptObjectiveVector {
  voice_divergence: number;
  diagnosis: number;
  verification: number;
  retrieval: number;
  transfer: number;
  structure: number;
}

export interface PromptEvaluation {
  promptPath: string;
  promptName: string;
  score: number;
  objectives: PromptObjectiveVector;
  feedback: string[];
}

export interface PromptEvolutionCandidate {
  iteration: number;
  label: string;
  prompt: string;
  evaluation: PromptEvaluation;
  parentLabel: string;
  accepted: boolean;
  preferenceScore: number;
}

interface PromptEvolutionArchive {
  winners: Array<{
    promptName: string;
    label: string;
    score: number;
    objectives: PromptObjectiveVector;
    updatedAt: string;
  }>;
}

export interface PromptEvolutionRun {
  promptPath: string;
  promptName: string;
  baseline: PromptEvaluation;
  best: PromptEvolutionCandidate;
  exploredCandidates: PromptEvolutionCandidate[];
  acceptedCandidates: PromptEvolutionCandidate[];
}

function parsePromptBody(raw: string): string {
  if (!raw.startsWith("---")) return raw.trim();
  const parts = raw.split("\n---\n");
  if (parts.length < 2) return raw.trim();
  return parts.slice(1).join("\n---\n").trim();
}

function parseFrontMatter(raw: string): string {
  if (!raw.startsWith("---")) return "";
  const parts = raw.split("\n---\n");
  if (parts.length < 2) return "";
  return `${parts[0]}\n---`.trim();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function keywordScore(body: string, keywords: string[], base: number, bonus: number): number {
  const hits = keywords.filter((keyword) => body.includes(keyword)).length;
  return clamp01(base + hits * bonus);
}

function heuristicPromptEvaluation(promptPath: string, prompt: string): PromptEvaluation {
  const body = parsePromptBody(prompt).toLowerCase();

  const objectives: PromptObjectiveVector = {
    voice_divergence: keywordScore(body, ["own words", "own language", "personal context", "say it again"], 0.35, 0.18),
    diagnosis: keywordScore(body, ["diagnostic", "prerequisite", "misconception", "assumption check"], 0.4, 0.16),
    verification: keywordScore(body, ["verify", "verification", "source", "unverified", "check claim"], 0.2, 0.18),
    retrieval: keywordScore(body, ["retrieval", "reconstruct", "without looking", "recall", "practice"], 0.35, 0.18),
    transfer: keywordScore(body, ["transfer", "bridge", "other domain", "practical consequence", "new setting"], 0.3, 0.18),
    structure: keywordScore(
      body,
      ["diagnose", "intuition", "formal", "misconception", "example", "retrieval", "reflection"],
      0.45,
      0.09
    )
  };

  const feedback: string[] = [];
  if (objectives.voice_divergence < 0.7) feedback.push("Add an explicit requirement that the learner restate the idea in their own words.");
  if (objectives.diagnosis < 0.7) feedback.push("Strengthen diagnosis of prerequisite gaps and misconceptions before teaching.");
  if (objectives.verification < 0.7) feedback.push("Include a step that distinguishes verified claims from claims that still need checking.");
  if (objectives.retrieval < 0.7) feedback.push("Add a retrieval checkpoint that requires reconstruction rather than agreement.");
  if (objectives.transfer < 0.7) feedback.push("Bridge the concept into a different domain or practical context before ending.");
  if (objectives.structure < 0.7) feedback.push("Make the lesson loop explicit so the workflow is easy to follow and evaluate.");

  const score =
    objectives.voice_divergence * 14 +
    objectives.diagnosis * 20 +
    objectives.verification * 18 +
    objectives.retrieval * 18 +
    objectives.transfer * 16 +
    objectives.structure * 14;

  return {
    promptPath,
    promptName: promptNameFromPath(promptPath),
    score,
    objectives,
    feedback
  };
}

function heuristicCandidatePrompt(basePrompt: string): string {
  const frontMatter = parseFrontMatter(basePrompt);
  const body = parsePromptBody(basePrompt).trimEnd();
  const additions = [
    '4a. If the learner echoes your phrasing, stop and ask them to explain the idea again in their own words.',
    '4b. Separate missing prerequisite, misconception, and partial intuition before choosing the next teaching move.',
    '5a. Add one short retrieval checkpoint that the learner must answer without relying on your wording.',
    '6a. Bridge the idea into a new domain, personal example, or practical consequence before ending.',
    '6b. Mark any factual claim that still needs verification instead of presenting it as settled.'
  ].filter((line) => !body.includes(line));

  const evolvedBody =
    additions.length === 0 ? `${body}\n7a. Keep the learner cognitively active at every step.` : `${body}\n${additions.join("\n")}`;

  return frontMatter ? `${frontMatter}\n${evolvedBody}\n` : `${evolvedBody}\n`;
}

export async function evaluatePromptContent(cwd: string, promptPath: string, prompt: string): Promise<PromptEvaluation> {
  const body = parsePromptBody(prompt);

  const evalPrompt = `Evaluate the following teaching prompt template based on Keating's hyperteacher philosophy.
Keating philosophy:
- AI must not be a surrogate for thought.
- Measuring success by the learner's independent articulation (finding their "voice").
- Rejecting "surface agreement" (rote echoes or simple "yes/no" answers).
- The "diagnose -> intuition -> formal core -> misconception repair -> example -> retrieval -> reflection" loop.

Evaluate these objectives on a scale of 0 to 1 (floating point):
1. voice_divergence: How well does the prompt force the learner to use their own language? Penalize prompts that allow the learner to echo the AI's explanation.
2. diagnosis: Checking prerequisites and misconceptions before teaching.
3. verification: Refusing to teach unverified claims as settled truth.
4. retrieval: Using reconstruction and practice instead of passive agreement.
5. transfer: Bridging the concept to other domains or practical consequences.
6. structure: Having an explicit, logical teaching workflow.

Provide the evaluation in JSON format:
{
  "objectives": {
    "voice_divergence": number,
    "diagnosis": number,
    "verification": number,
    "retrieval": number,
    "transfer": number,
    "structure": number
  },
  "feedback": string[]
}

Prompt Content:
"""
${body}
"""
`;

  if (piAvailabilityCache === false) {
    return heuristicPromptEvaluation(promptPath, prompt);
  }

  let data: {
    objectives: PromptObjectiveVector;
    feedback: string[];
  };
  try {
    data = await piCompleteJson<{
      objectives: PromptObjectiveVector;
      feedback: string[];
    }>(cwd, evalPrompt, { thinking: "low" });
    piAvailabilityCache = true;
  } catch {
    piAvailabilityCache = false;
    const heuristic = heuristicPromptEvaluation(promptPath, prompt);
    return heuristic;
  }

  // Guard against missing objectives in response
  if (!data?.objectives) {
    return heuristicPromptEvaluation(promptPath, prompt);
  }

  const objectives = data.objectives;
  const score =
    objectives.voice_divergence * 14 +
    objectives.diagnosis * 20 +
    objectives.verification * 18 +
    objectives.retrieval * 18 +
    objectives.transfer * 16 +
    objectives.structure * 14;

  return {
    promptPath,
    promptName: promptNameFromPath(promptPath),
    score,
    objectives,
    feedback: data.feedback
  };
}

async function generateCandidatePrompt(
  cwd: string,
  basePrompt: string,
  evaluation: PromptEvaluation,
  iteration: number
): Promise<string> {
  const frontMatter = parseFrontMatter(basePrompt);
  const body = parsePromptBody(basePrompt);

  const generationPrompt = `You are Keating's prompt-learning agent. Your goal is to evolve a teaching prompt template so that it prevents "surface agreement" and forces the learner to find their own voice.

Original Prompt:
"""
${body}
"""

Feedback:
${evaluation.feedback.map(f => `- ${f}`).join("\n")}

Mandate:
1. PUSH FOR DIVERGENCE: Add instructions that force the learner to re-explain the concept using their own analogies or personal context.
2. REJECT ECHOES: Instruct the teacher to identify if the learner is just repeating words from the previous explanation and, if so, ask them to "say it again, but as if you're explaining it to someone else entirely."
3. ADDRESS FEEDBACK: Address the specific gaps in diagnosis, verification, and structure.

Evolved Prompt Body (no code blocks, no frontmatter):`;

  if (piAvailabilityCache === false) {
    return heuristicCandidatePrompt(basePrompt);
  }

  let evolvedBody: string;
  try {
    evolvedBody = await piComplete(cwd, generationPrompt, { thinking: "medium" });
    piAvailabilityCache = true;
  } catch {
    piAvailabilityCache = false;
    return heuristicCandidatePrompt(basePrompt);
  }
  return frontMatter ? `${frontMatter}\n${evolvedBody}\n` : `${evolvedBody}\n`;
}

function objectiveVector(candidate: PromptEvolutionCandidate): number[] {
  const { objectives } = candidate.evaluation;
  return [
    objectives.voice_divergence,
    objectives.diagnosis,
    objectives.verification,
    objectives.retrieval,
    objectives.transfer,
    objectives.structure
  ];
}

function pairwisePreference(left: PromptEvolutionCandidate, right: PromptEvolutionCandidate): number {
  const leftVector = objectiveVector(left);
  const rightVector = objectiveVector(right);
  let wins = 0;
  let losses = 0;
  for (let index = 0; index < leftVector.length; index += 1) {
    if (leftVector[index] > rightVector[index]) wins += 1;
    if (leftVector[index] < rightVector[index]) losses += 1;
  }
  const aggregateDelta = left.evaluation.score - right.evaluation.score;
  return wins - losses + aggregateDelta / 25;
}

export function prosperStyleWinner(candidates: PromptEvolutionCandidate[]): PromptEvolutionCandidate {
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

async function loadArchive(archivePath: string): Promise<PromptEvolutionArchive> {
  try {
    const raw = await readFile(archivePath, "utf8");
    return JSON.parse(raw) as PromptEvolutionArchive;
  } catch {
    return { winners: [] };
  }
}

async function saveArchive(archivePath: string, archive: PromptEvolutionArchive): Promise<void> {
  await writeFile(archivePath, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
}

export interface PromptEvaluator {
  (cwd: string, promptPath: string, prompt: string): Promise<PromptEvaluation>;
}

export interface PromptGenerator {
  (cwd: string, basePrompt: string, evaluation: PromptEvaluation, iteration: number): Promise<string>;
}

export async function evolvePrompt(
  cwd: string,
  promptName = "learn",
  iterations = 4,
  evaluator: PromptEvaluator = evaluatePromptContent,
  generator: PromptGenerator = generateCandidatePrompt
): Promise<PromptEvolutionRun> {
  const promptPath = join(cwd, "pi", "prompts", `${promptName}.md`);
  const prompt = await readFile(promptPath, "utf8");
  const baseline = await evaluator(cwd, promptPath, prompt);
  const candidates: PromptEvolutionCandidate[] = [];

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const candidatePrompt = await generator(cwd, prompt, baseline, iteration);
    const evaluation = await evaluator(cwd, promptPath, candidatePrompt);
    candidates.push({
      iteration,
      label: `${promptName}-candidate-${iteration}`,
      prompt: candidatePrompt,
      evaluation,
      parentLabel: promptName,
      accepted: false,
      preferenceScore: 0
    });
  }

  const best = prosperStyleWinner(candidates);
  for (const candidate of candidates) {
    candidate.accepted = candidate.label === best.label && candidate.evaluation.score >= baseline.score;
  }

  const archivePath = promptEvolutionArchivePath(cwd);
  const archive = await loadArchive(archivePath);
  archive.winners.push({
    promptName,
    label: best.label,
    score: best.evaluation.score,
    objectives: best.evaluation.objectives,
    updatedAt: new Date().toISOString()
  });
  await saveArchive(archivePath, archive);

  return {
    promptPath,
    promptName,
    baseline,
    best,
    exploredCandidates: candidates,
    acceptedCandidates: candidates.filter((candidate) => candidate.accepted)
  };
}

export async function writePromptEvolutionArtifacts(
  cwd: string,
  promptName = "learn"
): Promise<{ reportPath: string; evolvedPromptPath: string; bestScore: number; promptPath: string }> {
  const run = await evolvePrompt(cwd, promptName);
  const reportPath = join(promptEvolutionDir(cwd), `${promptName}.md`);
  const evolvedPromptPath = join(promptEvolutionDir(cwd), `${promptName}.evolved.md`);
  await writeFile(reportPath, promptEvolutionToMarkdown(run), "utf8");
  await writeFile(evolvedPromptPath, run.best.prompt, "utf8");
  return {
    reportPath,
    evolvedPromptPath,
    bestScore: run.best.evaluation.score,
    promptPath: run.promptPath
  };
}

export function promptEvolutionToMarkdown(run: PromptEvolutionRun): string {
  const objectiveList = (objectives: PromptObjectiveVector): string[] => [
    `voice_divergence=${objectives.voice_divergence.toFixed(2)}`,
    `diagnosis=${objectives.diagnosis.toFixed(2)}`,
    `verification=${objectives.verification.toFixed(2)}`,
    `retrieval=${objectives.retrieval.toFixed(2)}`,
    `transfer=${objectives.transfer.toFixed(2)}`,
    `structure=${objectives.structure.toFixed(2)}`
  ];

  const lines = [
    `# Prompt Evolution Report: ${run.promptName}`,
    "",
    `- Source prompt: ${run.promptPath}`,
    `- Baseline score: ${run.baseline.score.toFixed(2)}`,
    `- Best candidate: ${run.best.label}`,
    `- Best candidate score: ${run.best.evaluation.score.toFixed(2)}`,
    `- PROSPER-style preference score: ${run.best.preferenceScore.toFixed(2)}`,
    "",
    "## Baseline Feedback",
    ""
  ];

  if (run.baseline.feedback.length === 0) {
    lines.push("- No major prompt-learning gaps detected.");
  } else {
    for (const item of run.baseline.feedback) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("");
  lines.push("## Candidate Comparison");
  lines.push("");
  for (const candidate of run.exploredCandidates) {
    lines.push(`### ${candidate.label}`);
    lines.push(`- score: ${candidate.evaluation.score.toFixed(2)}`);
    lines.push(`- preference: ${candidate.preferenceScore.toFixed(2)}`);
    lines.push(`- accepted: ${candidate.accepted ? "yes" : "no"}`);
    lines.push(`- objectives: ${objectiveList(candidate.evaluation.objectives).join(", ")}`);
    lines.push("");
  }

  lines.push("## Recommended Prompt");
  lines.push("");
  lines.push("```md");
  lines.push(run.best.prompt.trimEnd());
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}
