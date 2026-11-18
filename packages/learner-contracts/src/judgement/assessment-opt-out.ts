import type { TeachingPolicyPlan, TeachingPolicyTurn } from "./teaching-policy-types.js";

/** Work that is already being assessed or awaiting a grade retains its existing feedback path. */
export function protectAssessmentOptOut(turn: TeachingPolicyTurn, plan: TeachingPolicyPlan): boolean {
  return plan.decisions.assessment_declined === true && turn.assessment !== "assessed"
    && !turn.pendingSubmissions?.length && !turn.activeWork?.focus?.evidence.pendingGrade
    && plan.interaction.action !== "grade-first";
}

// Recover only an unambiguous assessment instruction in a Simulation's optional brief.
// The ordinary semantic review reads the resulting whole reply, including instructions in other languages.
const assessmentLead = /^(?:(?:first|now)\s*[,：:]?\s+|before\b[^.!?;\n,]{1,100},\s*)?(?:please\s+|you (?:must|need to|have to)\s+)?(?:predict\b|guess\b|(?:write down|record|submit|enter|make|give) (?:your |a )(?:prediction|guess|answer)\b|answer (?:this|the following|the) question\b)/iu;
const voluntary = /\b(?:optional(?:ly)?|if (?:you (?:like|want|wish|choose)|you['’]d like)|if interested|at your option)\b/iu;
const preserve = /[;\n]|\b(?:caution|warning|danger|unsafe|safely|safety|protective|injur\w*|emergency|disconnect\w*|never|must not|do not|don['’]t|only if|make sure|remember to|ensure that|assum(?:e|es|ing|ption)|provided that|otherwise|because)\b|\b(?:and|but)\s+(?:also\s+)?(?:press|wear|move|apply|save|set|measure|note|keep|use|turn|switch|check|avoid|explain|review|read|remove|stop)\b/iu;

export function inspectSimulationBrief(brief: string): { imposed: boolean; replacement: string | null } {
  // A sentence border requires whitespace/end so decimal numbers and abbreviations within a number survive.
  const sentences = [...brief.matchAll(/\S[\s\S]*?(?:[.!?](?=\s|$)|$)/gu)];
  const checks = sentences.filter(([sentence]) => assessmentLead.test(sentence) && !voluntary.test(sentence));
  if (!checks.length) return { imposed: false, replacement: null };
  const checkpoint = checks[0]!;
  // Leave ambiguous/mixed instructions intact for revision. Never drop the rest of the brief,
  // or delete instructions in the middle of a longer worked explanation.
  if (checks.length !== 1 || checkpoint !== sentences[0] || preserve.test(checkpoint[0])) return { imposed: true, replacement: null };
  return { imposed: true, replacement: brief.slice(checkpoint.index! + checkpoint[0].length).trimStart() };
}
