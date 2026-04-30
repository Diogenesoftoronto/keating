import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export function keatingRoot(cwd: string): string {
  return join(cwd, ".keating");
}

export function stateDir(cwd: string): string {
  return join(keatingRoot(cwd), "state");
}

export function outputsDir(cwd: string): string {
  return join(keatingRoot(cwd), "outputs");
}

export function plansDir(cwd: string): string {
  return join(outputsDir(cwd), "plans");
}

export function mapsDir(cwd: string): string {
  return join(outputsDir(cwd), "maps");
}

export function animationsDir(cwd: string): string {
  return join(outputsDir(cwd), "animations");
}

export function benchmarksDir(cwd: string): string {
  return join(outputsDir(cwd), "benchmarks");
}

export function evolutionDir(cwd: string): string {
  return join(outputsDir(cwd), "evolution");
}

export function promptEvolutionDir(cwd: string): string {
  return join(outputsDir(cwd), "prompt-evolution");
}

export function tracesDir(cwd: string): string {
  return join(outputsDir(cwd), "traces");
}

export function sessionsDir(cwd: string): string {
  return join(keatingRoot(cwd), "sessions");
}

export function configDir(cwd: string): string {
  return join(keatingRoot(cwd), "pi-config");
}

export function currentPolicyPath(cwd: string): string {
  return join(stateDir(cwd), "current-policy.json");
}

export function policyArchivePath(cwd: string): string {
  return join(stateDir(cwd), "policy-archive.json");
}

export function promptEvolutionArchivePath(cwd: string): string {
  return join(stateDir(cwd), "prompt-evolution-archive.json");
}

export function learnerStatePath(cwd: string): string {
  return join(stateDir(cwd), "learner.json");
}

export function verificationsDir(cwd: string): string {
  return join(outputsDir(cwd), "verifications");
}

export function verificationCachePath(cwd: string): string {
  return join(stateDir(cwd), "verification-cache.json");
}

export function engagementPolicyPath(cwd: string): string {
  return join(stateDir(cwd), "engagement-policy.json");
}

export function timelineDir(cwd: string): string {
  return join(outputsDir(cwd), "timelines");
}

export function quizDir(cwd: string): string {
  return join(outputsDir(cwd), "quizzes");
}

export function flashcardsDir(cwd: string): string {
  return join(outputsDir(cwd), "flashcards");
}

export function projectsDir(cwd: string): string {
  return join(outputsDir(cwd), "projects");
}

export function masteryDir(cwd: string): string {
  return join(outputsDir(cwd), "mastery");
}

export function workbooksDir(cwd: string): string {
  return join(outputsDir(cwd), "workbooks");
}

export async function ensureKeatingDirs(cwd: string): Promise<void> {
  await Promise.all([
    mkdir(stateDir(cwd), { recursive: true }),
    mkdir(join(stateDir(cwd), "snapshots"), { recursive: true }),
    mkdir(plansDir(cwd), { recursive: true }),
    mkdir(mapsDir(cwd), { recursive: true }),
    mkdir(animationsDir(cwd), { recursive: true }),
    mkdir(benchmarksDir(cwd), { recursive: true }),
    mkdir(evolutionDir(cwd), { recursive: true }),
    mkdir(promptEvolutionDir(cwd), { recursive: true }),
    mkdir(tracesDir(cwd), { recursive: true }),
    mkdir(verificationsDir(cwd), { recursive: true }),
    mkdir(join(outputsDir(cwd), "improvements"), { recursive: true }),
    mkdir(sessionsDir(cwd), { recursive: true }),
    mkdir(timelineDir(cwd), { recursive: true }),
    mkdir(quizDir(cwd), { recursive: true }),
    mkdir(flashcardsDir(cwd), { recursive: true }),
    mkdir(projectsDir(cwd), { recursive: true }),
    mkdir(masteryDir(cwd), { recursive: true }),
    mkdir(workbooksDir(cwd), { recursive: true }),
    mkdir(configDir(cwd), { recursive: true })
  ]);
}
