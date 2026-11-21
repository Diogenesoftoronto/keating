import type { TeachingPolicyTurn } from "./teaching-policy-types.js";

/**
 * Code-owned cues that decide whether the planner asks about a concrete
 * early-learning model at all. The question is asked only when a cue holds,
 * so a turn without one sends the same planning request as before the
 * question existed. A cue only opens the question; the judge still decides.
 *
 * The cues favour recall over precision: a false positive costs one question,
 * a false negative hides the early-learning family for that turn.
 */
const MATERIAL_CUES: readonly RegExp[] = [
  // Small-number arithmetic written out: 3 + 4, 12 - 5, 6 x 7, 20 ÷ 4, 8 take away 3.
  /\b\d{1,3}\s*(?:[+−×÷]|-(?=\s)|\sx\s|\*|plus\b|minus\b|take away\b|times\b|divided by\b|multiplied by\b|groups of\b)\s*\d{1,3}\b/iu,
  // A simple written fraction such as 3/4 or 1/2 (not dates or ratios of large numbers).
  /(?<![\d/])\b\d{1,2}\s*\/\s*\d{1,2}\b(?![\d/])/u,
  /\b(?:count(?:ing)? (?:on|back|up|down|by|to)|skip[- ]count\w*|number lines?|ten[- ]frames?|number bonds?|make (?:a )?ten|making ten|place value|tens and ones|hundreds,? tens|regroup\w*|carry(?:ing)? the|borrow(?:ing)? from|times tables?|multiplication|equal (?:groups|parts|shares)|share[sd]? equally|fractions?|halves|half of|thirds|fourths|quarters?|numerators?|denominators?|o'clock|half past|quarter (?:past|to)|tell(?:ing)? (?:the )?time|analog(?:ue)? clocks?|hour hand|minute hand|addition (?:facts|sums|problems)|subtraction|adding up|take away|odd (?:and|or) even|even (?:and|or) odd)\b/iu,
];

const YOUNG_LEARNER_CUES: readonly RegExp[] = [
  /\b(?:my|our) (?:son|daughter|kids?|child|children|little one|grandson|granddaughter|nephew|niece|pupils?)\b/iu,
  /\b(?:kindergarten|preschool|pre-k|nursery|reception class|first grade|second grade|third grade|[1-3](?:st|nd|rd) grade|grade [1-3]|year [1-3]|primary school|elementary school|key stage 1)\b/iu,
  /\b(?:[3-9]|ten)[- ]year[- ]olds?\b/iu,
  /\b(?:aged?|ages) [3-9]\b/iu,
];

const RECENT_MESSAGES = 4;
const any = (cues: readonly RegExp[], texts: readonly string[]): boolean => texts.some(text => cues.some(cue => cue.test(text)));

/**
 * True when the learner's message, recent conversation or current focus
 * carries early-number, fraction or time material, or the turn says the
 * learner is a young child. Learner evidence can only supply the age cue.
 */
export function earlyLearningCue(turn: TeachingPolicyTurn): boolean {
  const focus = turn.activeWork?.focus;
  const material = [
    turn.learnerMessage,
    ...(turn.earlierLearnerExcerpts ?? []),
    ...turn.conversation.slice(-RECENT_MESSAGES).map(({ content }) => content),
    ...(focus ? [focus.title, focus.detail ?? "", ...focus.outcomes] : []),
  ];
  return any(MATERIAL_CUES, material) || any(YOUNG_LEARNER_CUES, [...material, ...turn.learnerEvidence.map(({ content }) => content)]);
}
