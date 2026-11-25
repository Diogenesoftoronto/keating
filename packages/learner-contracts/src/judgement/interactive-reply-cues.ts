import type { TeachingPolicyTurn } from "./teaching-policy-types.js";

/**
 * Code-owned cues that open the interactive-reply feature questions. Each is a
 * cheap wording check over the learner's recent material. A turn with no cue
 * sends the same planning request as before these features existed, so recorded
 * evidence for such turns stays replayable. Cues are deliberately broad: they
 * only decide whether the judge is asked, never what it answers.
 */
export const INTERACTIVE_REPLY_FEATURE_IDS = [
  "state_transitions", "geometric_construction", "fraction_magnitude", "symbolic_manipulation",
  "permutation_structure", "data_grouping", "plan_revision", "source_evaluation",
  "spatial_anatomy", "drug_dose_response", "study_appraisal", "field_wave_quantum",
] as const;
export type InteractiveReplyFeatureId = typeof INTERACTIVE_REPLY_FEATURE_IDS[number];

const CUES: Readonly<Record<InteractiveReplyFeatureId, RegExp>> = {
  state_transitions: /\b(?:states?|machines?|automat(?:on|a)|dfa|nfa|regex|regular expressions?|protocols?|handshakes?|tcp|https?|tls|dns|vending|turnstiles?|traffic[- ]lights?|controllers?|life ?cycles?|log ?in|lock(?:s|ed)? (?:me )?out|barriers?|lifts?|elevators?|buttons?|patterns?|match(?:es)?|accepts?)\b/iu,
  geometric_construction: /\b(?:compass(?:es)?|straightedge|ruler|bisect(?:or|ing|s)?|construct(?:ion|ing)?|hexagon|circles?|radius|perpendicular|protractor|cop(?:y|ying)\b[^.?!]{0,30}\b(?:angle|segment|length))\b/iu,
  fraction_magnitude: /\b\d+\s*\/\s*\d+\b|\b(?:fractions?|numerators?|denominators?|halves|thirds?|quarters?|eighths?)\b/iu,
  symbolic_manipulation: /[=²³^]|\d\s*\(|\b\d+[a-z]\b|\b(?:solve|expand|factor(?:i[sz]e)?|simplify|equations?|expressions?|brackets?|terms?|coefficients?)\b/iu,
  permutation_structure: /\b(?:permutations?|swaps?|swapping|rearrang\w*|shuffl\w*|rotat\w*|cycles?|back in (?:the )?(?:original )?order|back to the start|back where|seats?|places)\b/iu,
  data_grouping: /%|\b(?:rates?|averages?|means?|percent\w*|groups?|surveys?|data(?:set)?|numbers by|paradox|confound\w*|delays?|admitted|success|survival|patients?|deaths?|scored|overall)\b/iu,
  plan_revision: /\b(?:plans?|schedul\w*|deadlines?|due|days?|weeks?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|exams?|hand-in|revis(?:e|ing|ion))\b/iu,
  source_evaluation: /\b(?:articles?|headlines?|sources?|paragraphs?|passages?|op-ed|ads?|advert\w*|claims?|drafts?|rubric|evidence|back(?:s)? (?:that |it )?up|support)\b/iu,
  spatial_anatomy: /\b(?:(?<!by )heart|cardiac|atri(?:um|a|al)|ventric\w*|valves?|mitral|tricuspid|aort\w*|pulmonary|vena cava|svc|ivc|coronar\w*|lad|circumflex|sept(?:um|al)|chambers?|thora\w*|mediastin\w*|azygos|o?esophag\w*|trachea|bronch\w*|vertebra\w*|t(?:[1-9]|1[0-2])|ct(?: slices?| scans?)?|axial|cross[- ]sections?|anatom\w*)\b/iu,
  drug_dose_response: /\b(?:drugs?|doses?|dosing|dosage|loading doses?|maintenance doses?|half[- ]li(?:fe|ves)|steady[- ]state|troughs?|peak levels?|clearance|infusions?|bolus|pharmaco\w*|pk|pd|agonists?|antagonis\w*|receptors?|ec50|ed50|td50|potency|efficacy|therapeutic (?:index|window|range)|tdm|gentamicin|vancomycin|digoxin|theophylline|aminoglycosides?|chemo\w*|nadir|g-?csf|neutropen\w*|mg)\b/iu,
  study_appraisal: /\b(?:confound\w*|adjust(?:ed|ing|ment)? for|collider|selection bias|berkson|paradox|mediat\w*|dags?|causal\w*|observational|cohort|case[- ]control|sensitiv\w*|specificity|ppv|npv|predictive value|false (?:positives?|negatives?|alarms?)|base[- ]rates?|prevalence|screening|likelihood ratios?|roc|cut-?offs?|kaplan|survival|censor\w*|hazard ratios?|log-?rank|intention[- ]to[- ]treat|per[- ]protocol|crossover|meta-?analys\w*|forest plots?|pooled|heterogeneity|i2|i²|funnel|publication bias|file[- ]drawer|random[- ]effects|fixed[- ]effects?|clinical trials?|randomi[sz]\w*|rcts?)\b/iu,
  field_wave_quantum: /\b(?:(?:point|electric|positive|negative|like|opposite|unlike) charges?|charged|electric(?:al)? fields?|field lines?|equipotentials?|dipoles?|coulomb|conductors?|faraday|shield\w*|inverse[- ]square|interference|diffract\w*|fringes?|slits?|young'?s|path difference|wavelengths?|coherent|two speakers|ripple|waves?|quantum|quanti[sz]\w*|schr(?:ö|o|oe)dinger|wave ?functions?|particle in a box|(?:potential|square|finite|infinite|quantum) wells?|bound states?|zero[- ]point|harmonic oscillators?|tunnel\w*|potential barriers?|double[- ]well|energy levels?)\b/iu,
};

const RECENT_MESSAGES = 4;

export function interactiveReplyCue(turn: TeachingPolicyTurn, feature: InteractiveReplyFeatureId): boolean {
  const focus = turn.activeWork?.focus;
  const material = [
    turn.learnerMessage,
    ...turn.conversation.slice(-RECENT_MESSAGES).map(({ content }) => content),
    ...(focus ? [focus.title, focus.detail ?? "", ...focus.outcomes] : []),
  ];
  return material.some((text) => CUES[feature].test(text));
}

export function isInteractiveReplyFeature(id: string): id is InteractiveReplyFeatureId {
  return (INTERACTIVE_REPLY_FEATURE_IDS as readonly string[]).includes(id);
}
