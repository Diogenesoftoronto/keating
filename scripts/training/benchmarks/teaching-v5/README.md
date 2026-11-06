# Teaching v5: reactive learners, verified judging, held-out variants, group chat

**keating-teaching-v5 5.1.0-dev** is an unfrozen development suite. It keeps every v4.1 case (unchanged, as
the `dev` split, so v4.1 transcripts can be regraded under v5 rules) and fixes what running stock Flint
through v4.1 on 2026-10-24 exposed. Each change below names the failure it answers.

| v4.1 problem observed | v5 change |
| --- | --- |
| The automatic per-turn grader scored 0 of 219 turns for a tool-using model (`unsupported_nontext_context`). | Whole-episode rubric judging reads the full transcript, tool calls and results included. Tool use is evidence, not a reason to abstain. |
| A model judge credited empty replies, quoted the learner as the tutor, and once called a correct answer wrong. | **Quote verification.** A score of 1 or 2 must cite an exact tutor quote at one of the dimension's evidence steps; the check is mechanical (normalised for markdown and LaTeX delimiters). Unverifiable claims get one repair round, then become `null`, never a pass. |
| 27 of 219 replies reached the learner as nothing: hidden reasoning used the whole 8,192-token output cap. Scripted learners carried on as if helped. | **Delivery is measured** (`delivery_rate`, `cut_off_turns`) apart from quality. **Reactive learners:** after a silent turn the learner says so, which tests recovery the way a person would. A conversation dimension whose evidence turns all went undelivered scores 0. |
| "Yes — I'm marking paper-beads-17 as done" with no tool doing so passed some judges. | **Deterministic action-claim checks** flag sentences that claim an action (marked done, DM sent, erased everything) unless a matching tool succeeded or the sentence is a refusal. |
| Persisted-state dimensions relied on the judge reading the right file. | **Literal state checks** on the files the app actually wrote (for example, the table preference present after step 3 and absent after the forget request). |
| 12 public cases with fixed numbers: memorisable, no held-out measure. | **Parameterized families.** Templates render new numbers, names and wording for the same demand; the `heldout` parameter sets are scored separately and never used for tuning. A `--private` families file kept outside the repo adds a `private` split. |
| A single judge, no agreement figure. | **Multiple judges** (`judges/judges.json`), combined conservatively (lowest verified score), with exact agreement and quadratic-weighted κ per judge pair, and 2-point disagreements listed for human adjudication (`report --adjudications`). |
| Mean of case scores only. | **Family-macro score with a bootstrap 95% CI**, pass rate per episode and across all repeats, by split and by track. |
| One learner at a time. Keating has no multi-learner runtime. | **Group track** (below). |

## Group track: one tutor, several learners

Real tutoring often happens in groups: learners correct each other, one answers for another, two want
different things. Keating's runtime is single-learner, so this track runs tutors directly through
`benchmark_v5_group.py`, using the group-chat contract humans& documents for Ampersand: every learner message
carries sender metadata, and after each message the tutor calls `send_message` or `pass`. Any
OpenAI-compatible tool-calling endpoint (for example Flint on vLLM) runs through the same adapter.

Each group step carries `expect`: `speak`, `pass` or `either`. Turn-taking accuracy counts how often the tutor
spoke when it should have and kept quiet when it should have. Each family also includes off-task chatter, so
every case has at least one unambiguous `pass`. Silence is a teaching move: judges see `[TUTOR PASSED]`, and
can cite it as evidence when holding back was right.

| Family | Demand |
| --- | --- |
| `group-peer-correction-wait` | Let a correct peer correction land; step in when both learners accept the same wrong method; refuse to confirm it when asked. |
| `group-quiet-learner-room` | A confident learner keeps answering for a quieter one; give the work back, build on a third learner's strategy. |
| `group-conflicting-help-requests` | One learner wants the answer now, the other wants to try; there is no private channel, so a DM claim is false. |

## Implicit cues (5.1)

In 5.0, learners still said what they needed ("can you just confirm…", "Don't give it away! I want to try",
"can you DM me"), and the group prompt told the tutor when to speak. Scores clustered near the ceiling because
the test announced its own answer. In the 14 **implicit-cue** instances (`cue: implicit`), no learner states a
need after the opening message; a unit test enforces that. The need shows only in behaviour:

| Family | What the tutor must notice |
| --- | --- |
| `implicit-lucky-method` | A right answer (16/64 = 1/4) from crossing out digits. The learner never asks for a check; the method fails on the next item. |
| `implicit-false-understanding` | "ok", "yeah makes sense", then a wrong attempt that shows the explanation didn't land. |
| `implicit-frustration` | Messages shrink to "ugh", "whatever just tell me", "im so bad at this lol". |
| `group-quiet-right-loud-wrong` | A quiet learner answers correctly; a confident peer overrides it with half the perimeter; "oh ok". Nobody asks the tutor. |
| `group-peer-fix-is-wrong` | A correct answer gets "corrected" into an error by a peer, and the first learner accepts it. |
| `group-wants-to-try-unspoken` | "hold on im doing it" is the only sign one learner wants to work it out; the other asks to be messaged the answer. |
| `group-checked-out-learner` | A third learner drifts ("whatever", "idc") while two others race ahead. |

The group track's system prompt is now neutral: it states the `send_message`/`pass` contract and nothing about
when to speak, so turn-taking measures the tutor rather than the prompt. (Keating's study-room adapter keeps
Keating's own production prompt, because that prompt is the thing being tested.) Reports break results down by
`cue` so explicit and implicit performance can be compared directly.

Other 5.1 fixes, from the independent Astra review (`artifacts/teaching-v5-dev/astra-review/REVIEW.md`):
adjudications are keyed by run, so one file cannot leak between tutors; a cut-off reply that still delivered
text is graded on what arrived (a separate `partial_steps` count) instead of being forced to 0; quote
verification ignores list markers and the spaces LaTeX stripping leaves before punctuation, but now requires
every ellipsis fragment to match; mislabelled `expect` values and "off-task" lines that were really
participation signals were corrected.

## Commands

```sh
python3 -B benchmark_v5.py validate
python3 -B benchmark_v5.py run OUT --transport T.json --repeats 3          # single-learner, through the app harness
python3 -B benchmark_v5_group.py run OUT --transport T.json --repeats 3    # group track
python3 -B benchmark_v5.py import-v4 OUT RUN_DIR...                         # regrade v4.1 transcripts
python3 -B benchmark_v5.py check OUT
uv run --with httpx python -B benchmark_v5.py judge OUT --judges benchmarks/teaching-v5/judges/judges.json
python3 -B benchmark_v5.py report OUT [--adjudications A.json]
```

`benchmark_v5_driver.ts` runs single-learner episodes in harness controller mode and writes a compact
`episode.json` (a few hundred KB) instead of the v4 receipt (up to about 1 GB of streamed events); pass
`--raw` to keep the full receipt. The default output cap is 16,000 tokens per call; v4.1's 8,192 cut off
reasoning models.

## Limits

Scripted learners are not people, and reactive branches are fixed rules, not a learner model. Judges are
uncalibrated models. Quote verification proves the evidence exists, not that the judgement is right. Held-out
variants share their families' demands with the public dev cases, so they measure surface generalisation,
not new skills. The group track runs outside the Keating app, so it tests the model, not Keating's tools.
