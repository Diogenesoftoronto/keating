# What changed when Jev guided the same tutor model?

On 14 matched September case/model pairs, the compact prompt produced a compiler-valid OpenUI surface **9/14** times (64%). Adding Jev’s turn instructions produced one **6/14** times (43%). Two of the three differences came on a factual answer and a worked explanation, where prose was a reasonable choice. The third was a real failure on an explicit request to practice. The evidence supports examining the *kind* of turn where a surface disappears. [Receipts and counts](./summary.json)

## The comparison

The September 21 run executed one generation per model, arm and authored case. Each arm used the same scenario and shared UI grammar. The compact arm received the base compact prompt. The governed arm also received instructions projected from a live System One `jev-1.13.0` response. All 18 governed receipts record a successful pre-judgment, a guided plan and a system-prompt hash. The plan identified intent and supplied text instructions. These receipts predate Jev’s component-family selection. [Recorded manifest digest](./summary.json) · [Arm construction](../../../../scripts/prompt-adherence/prompts.ts)

| Tutor | Both arms returned usable text | Any valid surface, compact | Any valid surface, governed | Valid Question or Quiz on explicit practice, compact → governed |
| --- | ---: | ---: | ---: | ---: |
| Gemini 3.5 Flash | 2/6 | 2/2 | 2/2 | 0 usable pairs of 2 |
| Gemini 3.1 Flash-Lite | 6/6 | 6/6 | 4/6 | 2/2 → 2/2 |
| MiniMax M2.7 Highspeed | 6/6 | 1/6 | 0/6 | 1/2 → 0/2 |
| **Total** | **14/18** | **9/14** | **6/14** | **3/4 → 2/4** |

A valid surface contains at least one compiled node. An Explanation that compiles to a markdown node counts as a surface. For learner responses, a Question means a compiled `question` or `question-group`; a Quiz means `quiz`. Across all 14 pairs, Question occurred **6/14 → 5/14** and Quiz **1/14 → 1/14**. Six pairs used a valid surface in both arms, three only in compact, zero only in governed and five in neither. Pairing excludes four Gemini 3.5 Flash cases. One had an interrupted compact answer and a valid governed Question. The other three had provider failures in both arms. [Machine-readable matched results](./summary.json)

## When a learner explicitly asked to respond

The two prompts asked for a fresh algebra checkpoint and a French color quiz. For all six governed case/model pairs, Jev classified practice as requested and the resulting plan said “Provide one requested OpenUI practice activity now, without requiring a lesson first or attaching a study plan.” The probability of requested practice ranged from 0.86 to 0.87 for algebra and was 0.99 for French.

| Governed tutor response | Fresh algebra checkpoint | French color quiz |
| --- | --- | --- |
| Gemini 3.1 Flash-Lite | Valid Question. The final benchmark judge was uncertain about `checkpoint_repeated`. | Valid Quiz. The judge was uncertain about `direct_answer_missing`. |
| MiniMax M2.7 Highspeed | Asked the question in prose. The judge was uncertain whether it should have been interactive. | Tried LanguagePractice. Its generated structure failed contract validation. The compact counterpart had a valid Question that translated French into English and added prose after the checkpoint. |
| Gemini 3.5 Flash | Provider error. | Provider error. |

The governed evaluator marked all six **would-hold**, including both valid Flash-Lite interfaces. These flags simulate release. The experiment never displayed an answer to a learner. Across all six cases, the 45 authored intent-label observations on the governed path included **44 agreements, one abstention and zero contradictions**. They repeat 15 case-specific labels across the three tutor runs. The abstention concerned whether the saved-project prompt was a learning task. These labels measure Jev’s recognition of specified intent. They do not grade the tutor’s response. Algebra receipt (`trial-0043.json` in the original local archive) · French receipt (`trial-0069.json` in the original local archive)

## What private review removed

The drafted arm generated up to three private candidates. On the six explicit practice turns, **5/6** had some successful private candidate with a valid Question or Quiz. The internal gate selected **2/6**, both algebra Questions. A separate blind final benchmark assessment marked **1/6** would-release. These are successive decisions on the same six authored trials.

- Gemini 3.5 Flash’s first algebra candidate compiled. Its checks on revealing and repeating the checkpoint were uncertain. Later candidates did not replace it with an approved answer. Receipt 36 (`trial-0036.json` in the original local archive)
- MiniMax changed two prose algebra attempts into a valid Question on its third attempt. The internal gate approved it. The separate final evaluator was uncertain about repetition. Receipt 44 (`trial-0044.json` in the original local archive)
- MiniMax’s first and third French attempts had valid Question blocks. Both continued after the checkpoint, violating the deterministic stop rule. Receipt 62 (`trial-0062.json` in the original local archive)
- Flash-Lite’s second French candidate compiled to a Quiz. The unresolved `direct_answer_missing` judgment prevented approval. The other two attempts failed UI validation. Receipt 70 (`trial-0070.json` in the original local archive)

## Coverage and reproduction

The run scheduled 72 cells, six cases × three models × four arms, including five development prompts and one holdout. All 72 cell identifiers were unique. Of 54 successful, nonempty final texts across the four arms, none shared identical bytes. Drafted-arm private attempts are nested in their original trial. A selected attempt and its final copy count once. The previous run had 72 unknown results (54 missing-credential generations and 18 withheld drafts). It and all other neighboring runs were excluded.

The final blind rubric statuses were 9 pass / 4 fail / 5 unknown in full, 7 / 1 / 10 in compact, 10 / 1 / 7 in governed, and 8 / 0 / 10 in drafted. A judgment of unknown can coexist with a structurally valid interface. The full arm had two provider errors, compact four, and governed three. The drafted controller withheld nine trials. It selected nine internally, of which eight passed the separate final assessment.

Production traffic, browser rendering and behavior after a learner submits an answer are outside this archive. The observations describe these six September prompts and the recorded generator configurations. One generation per cell cannot establish a stable model ranking or the causal effect of Jev across classrooms.

From the repository root, replay the retained files with the project’s message splitter and shared contract compiler. The script requires the original local receipt bundle, which is excluded from Git. The published summary retains its SHA-256, counts, exclusions and matched-case outcomes. The script performs no network requests. It prints the numerator, denominator, paired transitions, validation failures and judge provenance as JSON. [Replay script](./measure.mjs) · [Summary](./summary.json)

```sh
rtk proxy bun docs/benchmarks/openui-audit-2026-11-18/archive/measure.mjs
```
