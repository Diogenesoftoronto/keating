import { teachingTools } from "./teaching.js";
import { selfEvaluationTools } from "./self-evaluation.js";
import { selfEvolutionTools } from "./self-evolution.js";
import { feedbackTools } from "./feedback.js";
import { goalTools } from "./goals.js";
import { learnerMemoryTools } from "./learner-memory.js";

const keatingToolRegistrations = new WeakSet<object>();

export function registerKeatingTools(pi: any): void {
  if (typeof pi.registerTool !== "function") return;
  if (typeof pi === "object" && pi !== null && keatingToolRegistrations.has(pi)) return;

  const tools = [
    ...teachingTools,
    ...selfEvaluationTools,
    ...selfEvolutionTools,
    ...feedbackTools,
    ...goalTools,
    ...learnerMemoryTools,
  ];

  for (const tool of tools) {
    pi.registerTool(tool as any);
  }

  if (typeof pi === "object" && pi !== null) {
    keatingToolRegistrations.add(pi);
  }
}

export { setActiveCtx } from "./shared.js";
