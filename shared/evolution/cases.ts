import type { TeachingCase, TeachingCriterion } from "./contracts.js";

/** Bump when cases, partitions, or scoring criteria change. */
export const TEACHING_SUITE_VERSION = "teaching-behavior-v1";

type CriterionSpec = readonly [id: string, description: string, critical?: boolean];

function rubric(caseId: string, criteria: readonly CriterionSpec[]): TeachingCriterion[] {
  return criteria.map(([id, description, critical = false]) => ({
    id: `${caseId}:${id}`,
    description,
    critical,
  }));
}

/**
 * Curated synthetic decisions, not observed learner outcomes. Each prefix stops
 * before the response being evaluated; there are no prescribed learner reactions.
 * Families never cross partitions, including disguised numerical variants.
 * Holdout cases are for an independent gate and must not enter proposer context.
 */
export const TEACHING_CASES: readonly TeachingCase[] = [
  {
    id: "train-fraction-parts",
    family: "unit-fraction-part-size",
    domain: "mathematics",
    split: "train",
    messages: [
      { role: "user", content: "I am comparing fractions of the same cake." },
      { role: "assistant", content: "How would you compare one eighth and one quarter?" },
      { role: "user", content: "I think 1/8 is larger than 1/4 because 8 is larger than 4. Give me one hint, but do not tell me which fraction is larger yet." },
    ],
    rubric: rubric("train-fraction-parts", [
      ["correctness", "Treats the fractions as equal-sized parts of the same whole; does not claim that increasing the denominator makes each part larger.", true],
      ["answer-boundary", "Does not state which of 1/8 and 1/4 is larger or give their completed comparison.", true],
      ["diagnosis", "Directs attention to the size of one part when the same cake is divided into different numbers of equal parts."],
      ["next-step", "Gives one focused hint and leaves the learner a concrete comparison or drawing to attempt, without completing it."],
    ]),
  },
  {
    id: "train-fraction-equivalence",
    family: "multiplicative-fraction-equivalence",
    domain: "mathematics",
    split: "train",
    messages: [
      { role: "user", content: "I changed 2/3 into 3/4 by adding 1 to the top and bottom. I thought doing the same thing to both keeps a fraction equal. Show why my rule fails with one example, then let me try an equivalent fraction myself." },
    ],
    rubric: rubric("train-fraction-equivalence", [
      ["correctness", "States that 2/3 and 3/4 differ and explains that multiplying numerator and denominator by the same nonzero factor preserves the fraction.", true],
      ["diagnosis", "Explicitly distinguishes adding the same amount from multiplying by the same factor; does not present the error as an arithmetic slip."],
      ["example", "Uses a valid common-denominator, numerical, or equal-whole visual comparison to demonstrate the failed additive rule."],
      ["next-step", "Invites the learner to construct a new equivalent fraction and does not supply that practice answer."],
    ]),
  },
  {
    id: "train-negative-order",
    family: "signed-number-order",
    domain: "mathematics",
    split: "train",
    messages: [
      { role: "user", content: "Why is -8 smaller than -3 when 8 is bigger than 3? Questions alone are not helping. Please explain it directly first, with a number line or temperature example, and then give me one check." },
    ],
    rubric: rubric("train-negative-order", [
      ["correctness", "Correctly orders -8 below -3 and makes any number-line or temperature example consistent with that ordering.", true],
      ["explain-first", "Provides the requested direct explanation before asking the learner to solve another comparison."],
      ["diagnosis", "Distinguishes distance from zero (magnitude) from signed numerical value."],
      ["next-step", "Asks one new signed-number comparison or explanation check without immediately answering it."],
    ]),
  },
  {
    id: "train-loop-bound",
    family: "array-exclusive-upper-bound",
    domain: "programming",
    split: "train",
    messages: [
      { role: "user", content: "This JavaScript prints A, B, C and then crashes:\nconst items = ['a', 'b', 'c'];\nfor (let i = 0; i <= items.length; i++) {\n  console.log(items[i].toUpperCase());\n}\nI used <= to include the last item. Give me one debugging hint, without writing the corrected loop or telling me the replacement condition." },
    ],
    rubric: rubric("train-loop-bound", [
      ["correctness", "Explains or investigates the array index boundary accurately; does not blame valid strings, asynchronous execution, or an absent array element being a string.", true],
      ["answer-boundary", "Does not provide a corrected loop or state the replacement condition i < items.length.", true],
      ["diagnosis", "Focuses the learner on the difference between the number of items and the last valid index."],
      ["next-step", "Asks the learner to inspect or trace the index and accessed value on the failing iteration, rather than proposing a catch block to hide the error."],
    ]),
  },
  {
    id: "train-assignment-condition",
    family: "assignment-versus-equality",
    domain: "programming",
    split: "train",
    messages: [
      { role: "user", content: "In JavaScript I wrote:\nlet attempts = 0;\nif (attempts = 3) console.log('locked');\nWhy does it print locked even though attempts started at 0? Please explain the line directly and show the smallest correction." },
    ],
    rubric: rubric("train-assignment-condition", [
      ["correctness", "States that = assigns 3 to attempts, that the assignment expression evaluates to 3, and that 3 is truthy.", true],
      ["explain-first", "Directly explains why the branch runs before introducing a new exercise."],
      ["correction", "Shows a comparison condition such as attempts === 3 and distinguishes comparison from assignment."],
      ["state-check", "Makes clear that the original code also changes attempts, so the learner can reason about both the branch and the resulting variable value."],
    ]),
  },
  {
    id: "train-array-alias",
    family: "shared-reference-mutation",
    domain: "programming",
    split: "train",
    messages: [
      { role: "user", content: "JavaScript surprised me:\nconst original = [1, 2];\nconst copy = original;\ncopy.push(3);\nNow original also has 3. I thought copy made a copy and const stopped changes. Show a small reference diagram, then let me predict a fresh example." },
    ],
    rubric: rubric("train-array-alias", [
      ["correctness", "Explains that both variables reference the same array and that const prevents rebinding rather than mutation of the array.", true],
      ["representation", "Shows an explicit diagram or textual reference sketch with both variable names pointing to one array."],
      ["diagnosis", "Separately addresses the mistaken copy assumption and the mistaken const assumption."],
      ["next-step", "Provides a new short aliasing or copying example for prediction without revealing its output."],
    ]),
  },
  {
    id: "validation-percent-base",
    family: "successive-percentage-bases",
    domain: "mathematics",
    split: "validation",
    messages: [
      { role: "user", content: "A price starts at 100, goes up 20%, then down 20%. I get 100 again because +20 and -20 cancel. Please walk through the amounts and explain where that reasoning goes wrong, then give me a new situation to try." },
    ],
    rubric: rubric("validation-percent-base", [
      ["correctness", "Calculates the intermediate price as 120, the decrease as 24, and the final price as 96.", true],
      ["diagnosis", "Explains that the percentages use different base amounts, rather than claiming percentage changes always cancel."],
      ["explain-first", "Walks through the requested concrete amounts and identifies the base used at each step."],
      ["next-step", "Offers a new successive-percentage situation with a clear starting amount and leaves its result for the learner."],
    ]),
  },
  {
    id: "validation-negative-distribution",
    family: "distributing-a-negative-factor",
    domain: "mathematics",
    split: "validation",
    messages: [
      { role: "user", content: "I rewrote -(x - 4) as -x - 4. I put the minus on x, so why is it marked wrong? Explain just this rewrite using multiplication, then give me one similar expression to try. There is no larger equation to solve." },
    ],
    rubric: rubric("validation-negative-distribution", [
      ["correctness", "Correctly rewrites -(x - 4) as -x + 4 and treats the outer minus as multiplication by -1.", true],
      ["diagnosis", "Shows that the factor -1 acts on both terms, including the already negative term -4."],
      ["scope", "Explains the local rewrite without inventing an equation, assigning a value to x, or solving for x."],
      ["next-step", "Gives one new expression involving an outer negative factor without also simplifying it for the learner."],
    ]),
  },
  {
    id: "validation-independent-coin",
    family: "independent-events-and-balance",
    domain: "mathematics",
    split: "validation",
    messages: [
      { role: "user", content: "A fair coin with independent flips came up heads three times. I think tails is now more likely because the results have to balance out. Please explain directly why that is or is not true, using a concrete next-flip argument." },
    ],
    rubric: rubric("validation-independent-coin", [
      ["correctness", "States that the next flip still has probability 1/2 of tails under the given fair, independent model.", true],
      ["diagnosis", "Distinguishes a long-run proportion from a rule forcing short-run streaks to be corrected."],
      ["explain-first", "Gives a direct explanation of the next-flip probability rather than only asking the learner another question."],
      ["concrete-model", "Uses an accurate next-branch, repeated-experiment, or physical independence argument to explain why the recorded history does not change the next flip."],
    ]),
  },
  {
    id: "validation-short-circuit",
    family: "short-circuit-side-effects",
    domain: "programming",
    split: "validation",
    messages: [
      { role: "user", content: "In Python, I expect calls to become 1 because check() is written in the if:\nready = False\ncalls = 0\ndef check():\n    global calls\n    calls += 1\n    return True\nif ready and check():\n    print('go')\nprint(calls)\nExplain the evaluation order, then let me predict what changes when ready is True." },
    ],
    rubric: rubric("validation-short-circuit", [
      ["correctness", "States that check() is not called when ready is False, calls remains 0, and go is not printed.", true],
      ["diagnosis", "Explains that and evaluates left to right and skips the right operand after a false left operand."],
      ["execution", "Connects the skipped call to the absent side effect on calls, rather than suggesting the function definition itself increments calls."],
      ["next-step", "Asks the learner to predict the fresh run with ready = True without revealing that run's outputs."],
    ]),
  },
  {
    id: "validation-return-value",
    family: "printed-output-versus-return-value",
    domain: "programming",
    split: "validation",
    messages: [
      { role: "user", content: "Python shows 8, so why can I not add 1 to result?\ndef double(x):\n    print(x * 2)\nresult = double(4)\nprint(result + 1)\nPlease explain the difference between what I see and what result contains, and show the smallest fix." },
    ],
    rubric: rubric("validation-return-value", [
      ["correctness", "States that the function prints 8, returns None implicitly, and assigning None to result makes result + 1 invalid.", true],
      ["diagnosis", "Clearly separates terminal output from the value delivered to the caller."],
      ["correction", "Shows return x * 2 as the minimal way for double to provide the numeric result, without an unnecessary output-capture workaround."],
      ["explain-first", "Answers the requested value-flow question directly instead of withholding the explanation behind repeated questions."],
    ]),
  },
  {
    id: "validation-promise-order",
    family: "promise-callback-scheduling",
    domain: "programming",
    split: "validation",
    messages: [
      { role: "user", content: "I thought Promise.resolve means the value is ready immediately in this JavaScript:\nlet value = 'pending';\nPromise.resolve('ready').then(result => { value = result; });\nconsole.log(value);\nWhy does it print pending? Walk through the execution order; do not just tell me to add await." },
    ],
    rubric: rubric("validation-promise-order", [
      ["correctness", "Explains that the current synchronous code logs pending before the then callback updates value, even though the promise is already fulfilled.", true],
      ["diagnosis", "Distinguishes a fulfilled promise from synchronous execution of its then callback."],
      ["execution", "Provides an ordered trace placing the log before the callback; does not depend on network delay or random timing."],
      ["next-step", "Connects reading the updated value to running after the callback or asks the learner where that read should go, instead of supplying only an unexplained await rewrite."],
    ]),
  },
  {
    id: "holdout-square-root-sum",
    family: "square-root-nonadditivity",
    domain: "mathematics",
    split: "holdout",
    messages: [
      { role: "user", content: "I got sqrt(9 + 16) = sqrt(9) + sqrt(16) = 7. Both numbers are positive, so I thought splitting the square root was allowed. Explain why the two expressions differ, then let me test the rule on a new example." },
    ],
    rubric: rubric("holdout-square-root-sum", [
      ["correctness", "Evaluates sqrt(9 + 16) as 5 and sqrt(9) + sqrt(16) as 7, and does not assert additivity of square roots.", true],
      ["diagnosis", "Explains that positivity permits these real square roots but does not permit distributing a square root over addition."],
      ["explanation", "Uses squaring back, a geometric model, or the differing numerical quantities to justify the distinction, rather than merely calling a rule forbidden."],
      ["next-step", "Offers another nonnegative sum for the learner to compare with the sum of its square roots, leaving the computation unanswered."],
    ]),
  },
  {
    id: "holdout-cancellation-domain",
    family: "cancellation-domain-restrictions",
    domain: "mathematics",
    split: "holdout",
    messages: [
      { role: "user", content: "I cancelled x in x/x and got 1, so I wrote that x/x = 1 for every real x, including zero. Why does cancellation need a restriction? Explain it directly, then give me a different cancellation where I can find the excluded input." },
    ],
    rubric: rubric("holdout-cancellation-domain", [
      ["correctness", "States that x/x = 1 holds for x != 0 and that 0/0 is undefined in the real-number arithmetic of this problem.", true],
      ["diagnosis", "Explains that cancellation divides by the cancelled factor and cannot introduce inputs excluded by the original denominator."],
      ["explain-first", "Directly explains the restriction rather than only repeating that division by zero is forbidden."],
      ["next-step", "Gives a new cancellable rational expression with a clear excluded input and asks the learner to identify that input without revealing it."],
    ]),
  },
  {
    id: "holdout-perimeter-reasoning",
    family: "perimeter-versus-area-reasoning",
    domain: "mathematics",
    split: "holdout",
    messages: [
      { role: "user", content: "I found the perimeter of a rectangle with sides 3 cm and 4 cm." },
      { role: "assistant", content: "What answer did you get, and how did you calculate it?" },
      { role: "user", content: "14 cm, because I multiplied 3 by 4 and added 2. The answer matches, so is length times width plus 2 the perimeter rule? Please check my reasoning, not just the answer." },
    ],
    rubric: rubric("holdout-perimeter-reasoning", [
      ["correctness", "Confirms that 14 cm is correct for this rectangle but rejects length times width plus 2 as a general perimeter formula.", true],
      ["reasoning", "Explains perimeter by adding the four boundary lengths or using 2(length + width), and distinguishes it from multiplying lengths to find area."],
      ["diagnosis", "Explicitly identifies the matching answer as insufficient evidence for the learner's proposed rule; does not praise the reasoning as correct."],
      ["next-step", "Offers a different rectangle for testing the proposed rule against adding its sides, leaving at least the learner's comparison or computation unresolved."],
    ]),
  },
  {
    id: "holdout-closure-binding",
    family: "closures-capture-bindings",
    domain: "programming",
    split: "holdout",
    messages: [
      { role: "user", content: "I expected [0, 1, 2] from this JavaScript, but get [3, 3, 3]:\nconst callbacks = [];\nfor (var i = 0; i < 3; i++) {\n  callbacks.push(() => i);\n}\nconsole.log(callbacks.map(fn => fn()));\nExplain what each function remembers and show one minimal fix. I need the reasoning, not just replace var with let." },
    ],
    rubric: rubric("holdout-closure-binding", [
      ["correctness", "Explains that all callbacks read the same var binding after the loop, when its value is 3; does not say each callback copied i's numeric value when created.", true],
      ["execution", "Separates callback creation during the loop from callback invocation after the loop."],
      ["correction", "Shows a valid minimal fix such as let and explains the per-iteration binding or explicit value capture that makes it work."],
      ["diagnosis", "Answers what the functions retain by describing a binding or environment, rather than merely attributing the result to var being old or bad."],
    ]),
  },
  {
    id: "holdout-sort-order",
    family: "default-sort-string-order",
    domain: "programming",
    split: "holdout",
    messages: [
      { role: "user", content: "JavaScript gives [1, 10, 2] for [2, 10, 1].sort(). I think the browser has a sorting bug because 10 is bigger than 2. Give me one hint about the ordering rule. Do not write a replacement sort call or comparator yet." },
    ],
    rubric: rubric("holdout-sort-order", [
      ["correctness", "Correctly points to default string-based lexicographic ordering for these numbers; does not call the result a browser bug or random order.", true],
      ["answer-boundary", "Does not provide a replacement sort call, a numeric comparator function, or its subtraction expression.", true],
      ["diagnosis", "Makes the distinction between numeric magnitude and comparing the corresponding strings observable."],
      ["next-step", "Gives one focused hint asking the learner to inspect the characters or compare the strings, leaving the correction for a later attempt."],
    ]),
  },
  {
    id: "holdout-recursion-progress",
    family: "recursive-argument-progress",
    domain: "programming",
    split: "holdout",
    messages: [
      { role: "user", content: "Why does countdown(3) in JavaScript keep printing 3 until the stack overflows?\nfunction countdown(n) {\n  if (n === 0) return;\n  console.log(n);\n  countdown(n++);\n}\nI thought n++ changes n for the next call. Explain the value passed and show a small correction that counts positive integers down to zero." },
    ],
    rubric: rubric("holdout-recursion-progress", [
      ["correctness", "Explains that postfix n++ supplies the old value 3 to each recursive call, so the child call again starts at 3 and never reaches the base case.", true],
      ["diagnosis", "Distinguishes updating the caller's local variable from the argument value received by a new invocation."],
      ["correction", "Provides a correction such as countdown(n - 1) that moves positive integer arguments toward the existing zero base case."],
      ["termination", "Connects termination to both having a base case and making progress toward it, rather than suggesting increasing stack capacity."],
    ]),
  },
];
