# Follow-up on coding exercises and predictions

Five new MiniMax opportunities were registered after the main matrix surfaced specific failures. The four coding turns use policy v2.3.4. The final prediction uses a separately frozen policy after a change to candidate selection. Each opportunity starts with an empty conversation. Its prompt, expected learner action and scoring rule were written before any of the five requests. The original v2.3.3 study keeps its own denominator. [Prompts, rubrics and order](./cohort.json) · [Primary study](../README.md)

## Coding exercises

| Learner request | Decision model | First private draft | Released reply |
| --- | --- | --- | --- |
| Implement the largest-number loop in JavaScript | Jev 1.14.0 | Compiled JavaScript CodingChallenge | The first draft. The starter returns `null` and leaves the loop to the learner. |
| Same JavaScript exercise | Gemini Decision 1 | Compiled JavaScript CodingChallenge | The first draft. The starter returns the first element and leaves out the loop that would yield 9. |
| Fix the odd-number filter in Python without hints | Jev 1.14.0 | Editable Python. The first input value is skipped, producing `[9]` in place of `[5, 9]`. | Withheld after three drafts. The second selected even values, yielding `[4]`. The third worked already. |
| Same Python exercise | Gemini Decision 1 | Editable Python. The loop stops before the last element. | The first draft. It yields `[5]` and gives the intended output without disclosing the fix. |

Both planners chose CodingChallenge for JavaScript and an editable Python fence for Python. All six tutor-draft request contexts contained the selected plan’s directives. The compiler found a CodingChallenge in both public JavaScript replies. Markdown Python uses the application’s separate editable-code surface. The outcomes above were checked by reading the exact starter and supplied inputs. Browser interaction with these specific four replies was unobserved. [Turn receipts](./coding/receipts/) · [Exact decision and generation requests](./coding/wire/)

The two usable private Jev-guided Python drafts were judged to have observable bugs on the provided input. Generic review checks still marked checkpoint answer leakage at 0.89 and 0.67 and a missing code trace at 0.73 and 0.80. The first two candidates gave the expected output, which the learner had requested as a visible test. The third candidate was correctly judged to lack a visible bug. This is one concrete example of worthwhile independent work being withheld. [Three candidate reviews](./coding/receipts/odd-filter--minimax--jev.json)

The four coding turns used 16 metered provider requests and added US$0.074873548. The all-study cost bound reached US$2.613388422. Both decision services and the MiniMax stream supplied usage, and all six tutor streams identified MiniMax M2.7 Highspeed. [Coding ledger](./coding/ledger.json) · [Coding totals](./coding/summary.json)

## Prediction and plain-text follow-up

On policy v2.3.5, the learner wanted to guess which shape they would draw from a bag. Jev offered Question and Simulation. MiniMax created a four-choice QuestionGroup on its first draft, put 15 words around it and left the answer open. The gate approved that single candidate and reported its ordinary selection rule, `none`. The earlier paper-fold turns exercise the repaired selection branches in offline replay. This fresh turn succeeded before a comparison between drafts was needed. [Prediction receipt](./prediction/receipts/tile-bag--minimax--jev.json) · [Earlier selection replay](../../prediction-replay/README.md)

A separate two-slot addendum was registered before the fresh responses. Its second turn continues the exact public prediction above. The participant typed that round was more likely because three of the four tiles were round. MiniMax privately confirmed the reasoning, first alongside a Simulation, then with an unsolicited animation proposal, then in 43 words of ordinary text. The third answer correctly gave 75% round and 25% square. Its review flagged checkpoint answer leakage at 0.84 and continuation at 0.62. The gate withheld all three drafts. Neither grading tool appeared in any of the actual tutor requests. The first two requests exposed 16 available tools and the final prose draft exposed zero. No grading tool was proposed or executed. [Addendum rubrics](./addendum/cohort.json) · [Original transcript and all three replies](./addendum/receipts/tile-bag-confirm--minimax--jev.json)

The other addendum learner supplied the expected result for a new Python debugging exercise and requested no hints. The first public draft was editable Python. It uses the index in a modulo-three test and therefore collects `[6]` instead of `[6, 9]`. The text states the intended outcome and leaves the repair to the learner. The planner offered CodingChallenge, recorded no target language and omitted the conditional debugging review. The tutor chose the correct language independently. This fresh case demonstrates the delivered exercise. The correction to the earlier expected-output review has separate evidence from replaying archived candidates. [Python receipt](./addendum/receipts/multiples-loop--minimax--jev.json) · [Archived candidate review](../../audit/README.md)

The v2.3.5 snapshot contains 1,810 hashed files. The fresh prediction and addendum used 13 metered requests and added US$0.057726438. All seven follow-up opportunities together used 29 metered requests. Five produced public replies and two were withheld. Their combined increment was US$0.132599986. The cumulative bound through v2.3.5 was US$2.671114860, including US$0.24 held for four earlier unmetered provider errors. Later slots used distinct prompts, and these counts are descriptive. [Prediction accounting](./prediction/summary.json) · [Cumulative bound through this phase](./addendum/summary.json)

## Reproduce the records

Each manifest identifies an immutable source overlay on top of the original product archive. The runner restores the relevant application source and replays the exact archived decisions and tutor replies through its ordinary gate. The integrity check independently verifies provider endpoints, exact request bytes, settlement and receipt links. Both run without provider credentials.

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/study/supplement/run.mjs coding --verify
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/study/supplement/prediction-driver.mjs prediction --verify
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/study/supplement/verify-integrity.mjs
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/study/supplement/addendum/run.mjs --verify
```
