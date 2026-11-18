# Checking interface use and draft decisions

The original November audit held up when the stored replies were recompiled. Of 16 opportunities, 14 had a substantive interface in a private draft, 10 reached the public reply and nine matched both the requested family and language. Gemini Flash retained seven of its eight opportunities. MiniMax retained three of eight, including a simulation and two questions. Four released direct-answer controls had no fenced interface. [Independent recount](recount.json)

Change the requested language, hint preference or Python starter to see the recorded outcomes side by side. [Open the interactive evidence](index.html)

## The same JavaScript exercise

Gemini Flash supplied a JavaScript `CodingChallenge` to a learner who had asked to fix Python. We ran the same archived reply against four synthetic learner requests to check which ones the diagnostic counts as met. [Original response](../../evidence/gemini-3.1-flash-lite--code.json)

| Requested action | v2.3.3 recorded match | v2.3.4 recorded match |
| --- | --- | --- |
| A JavaScript coding challenge | No | Yes |
| A JavaScript loop I can fix | No | Yes |
| A TypeScript loop I can fix | No | No |
| A Python loop I can fix | No | No |

The web observer now reads the language of the compiled, selected challenge node. A specific family's name can still be observed in an older trace whose language is unknown. The raw Markdown editor metric, prose word count and browser-mount evidence remain separate. A withholding notice with a known empty selection records a missed coding action. Unobserved selection or a native page of unknown content can leave the outcome unknown. [Before](frozen.json) · [After](current.json)

## Declining a hint

A synthetic Python exercise included a native page description that stated the exact bug. With the same permissive test decision and two normal draft slots, the pre-fix gate withheld the draft for an independent practice request but released it when the learner added “No hints, please.” The v2.3.4 gate withholds it in both cases. Adding “No solutions, but give me a hint” still permits help. The test measures the scope of one deterministic disclosure check. It neither executes the page nor evaluates the quality of a supplied hint. [Gate inputs and test decisions](probe.mjs) · [Before](frozen.json) · [After](current.json)

## An independent check on the reporting

- The initial offer experiment produced a substantive interface in four of eight completed first-draft pairs in each condition. The exact family appeared in three of eight drafts with the named offer and four of eight with those offer words removed. Both arms retained the rest of the teaching prompt.
- In the subsequent six-cell comparison, each decision provider had a matching fenced interface on two of four scheduled implicit opportunities, or two of three with a completed tutor draft. Across all six scheduled cells, four were assessable per provider. The saved rubric passed three with Jev and two with Gemini Decision. Browser renders were unobserved in this set.
- In the earlier multi-turn terminal history, a selected matching control appeared on the first reply for six of forty implicit requests and on reply two for one. The remaining 33 reached the end of the observed episode without a match.
- The accounted study bound before the new final matrix was **$1.917118280**. The completion journal includes all seven entries from the initial v2.3 segment. They were counted once. An invoice total remains unavailable. [Per-cohort totals and journal inventory](recount.json)

On the four synthetic primary prompts of the final matrix, automatic category and acceptable target agreed with the frozen enrollment label on two of four before the change and four of four after it. The Python edit and copper symbol cases were added during this review, making the four-of-four result in-sample. The paper guess and flow control already matched. The subsequent paper-answer feedback prompt still has no automatic modality label. All 139 previously archived learner-message classifications were preserved across 126 distinct wordings. [Calibration](cues.json) · [Earlier cue verifier](../../verify-archived-cues.mjs)

The November prompt “My Python loop skips the last item nearly every time. Give me a tiny broken loop I can fix and try against a couple of example inputs” still yields a coding-practice cue without a language. The requested example does not repeat the earlier language. Its predeclared case and independent language check identify the JavaScript substitution in the nine-of-sixteen result. This is one concrete limit of the English-language heuristic. [November case definitions](../../scenarios.json)

## Four fresh coding turns

MiniMax produced a first candidate in the requested language under both decision providers for both exercises. Both JavaScript challenges were selected. The Google-guided Python turn released its first candidate. The Jev-guided Python turn withheld all three. This is **three selected learner actions in four fresh turns**. These four cells had no classroom mount measurement. [Original supplement receipt register](../study/supplement/coding/summary.json)

The Python learner requested every odd number in `[5, 4, 9]` and a bug visible on that input. Local CPython executed only the four exact, hash-pinned programs. Both first rejected candidates genuinely fail the test without stating how to repair the code. [Runnable verification](check-python.py) · [Actual and expected results](python-outputs.json)

| Decision provider and candidate | Printed | Task-specific review | Original disposition of candidate | Isolated v2.3.5 replay |
| --- | --- | --- | --- | --- |
| Gemini Decision 1 | `[5]` | Observable, independent | Approved | Released |
| Jev 1 | `[9]` | Observable, independent | Blocked | Released |
| Jev 2 | `[4]` | Observable, independent | Blocked | Released |
| Jev 3 | `[5, 9]` | Masked | Blocked | Withheld |

The first two Jev reviews assigned generic checkpoint-leak probabilities of 0.89 and 0.67 to the two useful starters. Their missing-code-trace scores of 0.73 and 0.80 were advisory at release. Version 2.3.5 preserves both sets of values. The gate now recognizes a stated expected output when a bounded independent arithmetic proof and the task-specific review both establish a visible bug and independent practice. A real or uncertain spoiler, unresolved earlier work, a separate tool, unsupported structure or another release blocker keeps the ordinary policy. [Exact single-candidate replay](expected-output-replay.json)

Each replay reused the same saved tutor text and the decision provider's recorded answer envelope, checking complete application request hashes and the original outbound wire bytes. The sealed ledger retains the filtered answer envelope and a digest of the original HTTP response. The three Jev candidates belong to one original turn. The replay demonstrates which candidates could be released individually, without creating new turns or new provider observations.

## Reproduce locally

Run these from the checkout root with its installed Bun dependencies. The frozen check verifies the 1,805-file archive, restores an isolated tree and runs the original four review-request assertions and eight final gate assertions. All four original requests and the three-of-eight release result reproduce. The current check uses the working product. Both checks disable network calls in the exercised model paths.

```sh
rtk proxy python docs/benchmarks/openui-audit-2026-11-18/final-review/audit/verify.py frozen
rtk proxy python docs/benchmarks/openui-audit-2026-11-18/final-review/audit/verify.py current
rtk proxy python docs/benchmarks/openui-audit-2026-11-18/final-review/audit/verify.py policy-v2.3.4
rtk proxy python docs/benchmarks/openui-audit-2026-11-18/final-review/audit/verify.py cues
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/audit/recount.mjs --verify
rtk proxy python -I docs/benchmarks/openui-audit-2026-11-18/final-review/audit/check-python.py
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/audit/replay-expected-output.mjs --verify
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/audit/check-page.mjs
```
