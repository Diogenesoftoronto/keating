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
