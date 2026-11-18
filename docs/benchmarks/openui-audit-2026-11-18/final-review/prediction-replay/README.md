# Paper-fold prediction: offline replay of the release fix

Two recorded turns for the same learner request ("Before you tell me, I'd like to guess how many layers it has") published a prose question although a working `Question` had been drafted and found free of answer leakage. This folder replays the saved replies and saved decisions through the working tree. Nothing here calls a provider, and nothing under `../study/` is written.

## What happened in the record (policy v2.3.3)

| Cell | Drafts | Why prose was published |
| --- | --- | --- |
| `paper-fold--minimax--jev` | 1 `Question` (trailing sentence trimmed), 2 two profile writes, 3 bare prose | Review of draft 1 passed every structural, leak and continuation check and failed only `checkpoint_repeated` at 0.60, which is the fail threshold. A rejected checkpoint, and separately a trimmed one, was never admitted to the best-effort pool, so the pool held draft 3 alone. |
| `paper-fold--flash--google` | 1 prose question, 2 `Question` | Both were approved. Draft 2 exists because review failed draft 1 on `checkpoint_not_interactive` and the session spent its one repair on it. The general chooser was not told that and picked draft 1 at 0.65. |

## What changed

`packages/learner-contracts/src/judgement/teaching-drafts/attempt-first.ts` (new), with call sites in `session.ts` and one ranking helper in `policy.ts`.

A reply counts as the learner's requested answer field only when all of these hold: the plan is guided with action `create`; `learner_response_due` is true; `assessment_declined` and `plain_reply_requested` are both false (uncertain does not count); the plan offered the `Question` component; the reply has no tool call; the reply is exactly one compiled-syntax surface containing only `LearningSurface` and `Question`; no deterministic, host or critical check is short of a pass; and `checkpoint_answer_leaked`, `checkpoint_continued`, `quality_progress` and `quality_scope` are present and pass.

- **Best-effort branch.** Such a reply joins the best-effort pool when its only release blocker is `checkpoint_repeated` from the judge, minor severity, below 0.8. It leads that pool. It is still published with the unverified notice, and the attempt keeps its `fail` status in the receipt.
- **Approved-choice branch.** When such a reply is approved, an approved reply that review failed on `checkpoint_not_interactive` no longer competes with it. Other approved replies still go to the chooser. The same narrowing applies when a turn runs out of time.

Review thresholds, the rule catalog, the policy version and receipt fields are untouched.

## Replay

```
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/prediction-replay/replay.ts [contractsDir] [out.json]
```

Tutor replies are the saved drafts in saved order. Decisions are the saved provider answers for the same phase, limited to the question ids the current code asks. `patched.json` is the working tree. `baseline.json` is a copy of the same tree with the two new predicates forced to `false`.

| Run | Result |
| --- | --- |
| Baseline, 17 guided cells with completed drafts | All 17 reproduce the recorded selected attempt and notice. |
| Patched, same 17 cells | 15 unchanged. `paper-fold--minimax--jev` publishes draft 1 (the `Question`, unverified, two drafts used instead of three). `paper-fold--flash--google` publishes draft 2 (the `Question`, verified, chooser not called). |
| Patched, 21 counterexamples | No `Question` published in any. Listed below. |

Counterexamples, each a single change to a recorded turn:

- Jev cell, review of draft 1: answer leak 0.7; answer leak 0.5; continued past the question 0.7; repetition 0.85; unsupported tool claim 0.9. Draft 1: broken component syntax; the recorded profile writes attached. Plan: assessment declined; plain reply requested; response not requested; response uncertain. All publish draft 3 as recorded.
- Copper ("Just the symbol, please"): recorded turn unchanged; the `Question` forced in as draft 1 is withheld; the copper plan applied to the paper-fold drafts publishes draft 3.
- Irrigation (optional `Simulation`) and stage light (no quiz wanted): recorded turns unchanged; the `Question` forced into the stage-light turn is not published.
- Google cell: `Question` leaks 0.7; assessment declined; response not requested; draft 1 not judged a prose question. All publish draft 1 as recorded.

## Limits

- The replay runs the shared session with no web host schema check and no token budgets, so it shows selection and release only. Rendering and mounting are not exercised.
- Saved decisions answer the recorded text. A counterexample that alters a draft reuses the answers recorded for the original, apart from the stated change.
- One question the current tree asks, `declined_assessment_imposed`, has no saved answer in cells where it applies and stays unknown.
- This is two turns of one prompt. It says nothing about how often the pattern occurs; the unseen holdout is the test of that.
