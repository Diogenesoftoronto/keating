import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildLessonPlan } from "./lesson-plan.js";
import { mapsDir } from "./paths.js";
import { TeacherPolicy } from "./types.js";
import { slugify } from "./util.js";

function mermaidLabel(text: string): string {
  return text.replaceAll('"', "'").replaceAll("\n", " ");
}

export function lessonPlanToMermaid(topicName: string, policy: TeacherPolicy): string {
  const plan = buildLessonPlan(topicName, policy);
  const topicId = slugify(plan.topic.title);
  const lines = [
    "graph TD",
    "  classDef phase fill:#12263f,stroke:#8db5ff,color:#f8f5ec,stroke-width:1px;",
    "  classDef concept fill:#173122,stroke:#8fd7b6,color:#f8f5ec,stroke-width:1px;",
    "  classDef friction fill:#3a2317,stroke:#ff9b6b,color:#f8f5ec,stroke-width:1px;",
    "  classDef transfer fill:#2f2140,stroke:#d3a6ff,color:#f8f5ec,stroke-width:1px;",
    `  learner(("Learner state"))`,
    `  thesis["${mermaidLabel(plan.topic.title)}: ${mermaidLabel(plan.topic.summary)}"]`
  ];

  lines.push('  subgraph pedagogy["Teaching Loop"]');
  for (const phase of plan.phases) {
    lines.push(`    ${phase.id}["${mermaidLabel(phase.title)}"]`);
  }
  for (let index = 0; index < plan.phases.length - 1; index += 1) {
    lines.push(`    ${plan.phases[index]!.id} --> ${plan.phases[index + 1]!.id}`);
  }
  lines.push("  end");

  lines.push('  subgraph meaning["Meaning Map"]');
  lines.push(`    ${topicId}_core["${mermaidLabel(plan.topic.title)}"]`);
  for (const [index, node] of plan.topic.diagramNodes.entries()) {
    lines.push(`    ${topicId}_concept_${index}["${mermaidLabel(node)}"]`);
    lines.push(`    ${topicId}_core --> ${topicId}_concept_${index}`);
  }
  for (const [index, prerequisite] of plan.topic.prerequisites.slice(0, 3).entries()) {
    lines.push(`    ${topicId}_prereq_${index}["Prereq: ${mermaidLabel(prerequisite)}"]`);
    lines.push(`    ${topicId}_prereq_${index} --> ${topicId}_core`);
  }
  lines.push("  end");

  lines.push('  subgraph friction["Misconceptions And Practice"]');
  for (const [index, misconception] of plan.topic.misconceptions.slice(0, 2).entries()) {
    lines.push(`    ${topicId}_mis_${index}["${mermaidLabel(misconception)}"]`);
    lines.push(`    ${topicId}_core --> ${topicId}_mis_${index}`);
  }
  for (const [index, exercise] of plan.topic.exercises.slice(0, 2).entries()) {
    lines.push(`    ${topicId}_exercise_${index}["Practice: ${mermaidLabel(exercise)}"]`);
    lines.push(`    ${topicId}_mis_${Math.min(index, Math.max(plan.topic.misconceptions.length - 1, 0))} --> ${topicId}_exercise_${index}`);
  }
  lines.push("  end");

  lines.push('  subgraph transfer["Transfer Hooks"]');
  for (const [index, hook] of plan.topic.interdisciplinaryHooks.entries()) {
    lines.push(`    ${topicId}_hook_${index}["${mermaidLabel(hook)}"]`);
    lines.push(`    ${topicId}_core --> ${topicId}_hook_${index}`);
  }
  lines.push("  end");

  lines.push("  learner --> orient");
  lines.push("  thesis --> orient");
  lines.push(`  ${plan.phases.at(-1)!.id} --> ${topicId}_hook_0`);
  lines.push(`  ${plan.phases.find((phase) => phase.id === "diagram")?.id ?? "examples"} --> ${topicId}_core`);
  lines.push(`  class ${plan.phases.map((phase) => phase.id).join(",")} phase;`);
  lines.push(`  class ${topicId}_core,${plan.topic.diagramNodes.map((_, index) => `${topicId}_concept_${index}`).join(",")},${plan.topic.prerequisites.slice(0, 3).map((_, index) => `${topicId}_prereq_${index}`).join(",")} concept;`);
  const frictionNodes = [
    ...plan.topic.misconceptions.slice(0, 2).map((_, index) => `${topicId}_mis_${index}`),
    ...plan.topic.exercises.slice(0, 2).map((_, index) => `${topicId}_exercise_${index}`)
  ];
  if (frictionNodes.length > 0) {
    lines.push(`  class ${frictionNodes.join(",")} friction;`);
  }
  const transferNodes = plan.topic.interdisciplinaryHooks.map((_, index) => `${topicId}_hook_${index}`);
  if (transferNodes.length > 0) {
    lines.push(`  class ${transferNodes.join(",")} transfer;`);
  }
  return `${lines.join("\n")}\n`;
}

export async function writeLessonMap(
  cwd: string,
  topicName: string,
  policy: TeacherPolicy
): Promise<{ mmdPath: string; svgPath: string | null }> {
  const slug = slugify(topicName);
  const mmdPath = join(mapsDir(cwd), `${slug}.mmd`);
  const svgPath = join(mapsDir(cwd), `${slug}.svg`);
  await writeFile(mmdPath, lessonPlanToMermaid(topicName, policy), "utf8");

  const render = spawnSync("oxdraw", ["--input", mmdPath, "--output", svgPath], {
    cwd,
    encoding: "utf8"
  });
  if (render.status === 0) {
    return { mmdPath, svgPath };
  }
  return { mmdPath, svgPath: null };
}
