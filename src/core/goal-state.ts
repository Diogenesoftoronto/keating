import { readFile, writeFile } from "node:fs/promises";
import type { LearnerGoal } from "./goals.js";

export async function loadGoals(filePath: string): Promise<LearnerGoal[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LearnerGoal[]) : [];
  } catch {
    return [];
  }
}

export async function saveGoals(filePath: string, goals: LearnerGoal[]): Promise<void> {
  await writeFile(filePath, JSON.stringify(goals, null, 2), "utf8");
}

export async function upsertGoal(filePath: string, goal: LearnerGoal): Promise<LearnerGoal[]> {
  const goals = await loadGoals(filePath);
  const index = goals.findIndex((g) => g.id === goal.id);
  if (index >= 0) goals[index] = goal;
  else goals.push(goal);
  await saveGoals(filePath, goals);
  return goals;
}
