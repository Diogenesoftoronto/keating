# Restart after the reported teaching regression

**Superseded experiment direction:** the user selected the real Downloads traces and their observed next-user replies. Use [REAL_USER_INTERACTIONS.md](REAL_USER_INTERACTIONS.md) and `run_user_interaction_sdpo.py` for that restart. This document preserves the earlier authored-hint proposal, which was not executed.

The user reports that the SFT checkpoint is less responsive and much worse at teaching than the base model: it does not ask useful questions and makes progress feel difficult. This is qualitative user feedback, not a measured effect size. Treat the previous contract scores as insufficient for promotion.

The completed identity SFT used two epochs at learning rate 3e-4; OpenUI SFT added two epochs at 1e-4 over eight authored long conversations, with loss on every assistant message. That concentrates supervision on a small, repetitive set of teaching styles. Over-specialization is a hypothesis, not an established cause. Empty responses also require checking completion budgets, native rendering, tool continuation and serving settings. SFT normally uses token targets; it does not require an exact-match quality metric. The problem is not evidence that SFT inherently prevents flexible responses.

## New comparison

`run_restart_sdpo.py` creates a new rank-16 Inkling-Small adapter directly from the base model. It never loads an old SFT/SDPO state. The old run record supplies account association and the original shared budget only.

- Exact current application prompt and all 14 available tool schemas, exported by the real builder. Same prompt, effort 0.1 and schemas for base and candidate.
- Four distinct updates by default: teaching start, misconception repair, OpenUI flashcards, native grading of submitted quiz work.
- One fresh response per context, teacher and student at the same checkpoint, PPO ratio bounds 0.8–1.2, 3× EMA advantage clipping, learning rate 1e-5. No authored assistant response is an optimization target.
- Teacher-only hints combine explicit authored behavior guidance with contract observations from the actual new response. The authored guidance is not mislabeled as user feedback on that response. This remains an SDPO-inspired test, not full SDPO++.
- Existing long conversation prefixes provide context; subsequent tool and learner messages are not fabricated for fresh responses. These are conditional response probes, not end-to-end autonomous teaching episodes.
- Five same-context before/after probes include teaching start, repair, cards, grading, and a request for a worked example with no question. Area/mean are reused development families, not a fresh sealed holdout.
- Empty or truncated base responses stop training for investigation. Truncated training responses stop the run. Each completed update saves both training state and sampler weights with 24-hour TTL; no automatic promotion occurs.

Review teaching separately: does the response offer substantive help, ask a relevant diagnostic when useful, respond to actual reasoning, invite alternatives and transfer, and respect a request for direct help? Read answers blind to arm where practical. A question mark, valid JSON, or successful compiler result cannot establish teaching quality. Mathematical explanations and grading verdicts still need review.

## Offline preference material

`prepare_restart.py` reuses only training-family contexts for 36 DPO pairs and 72 balanced KTO records. Chosen answers are authored examples; rejected answers contain a deliberate contract-breaking mutation. Both sides are checked against the current compiler/schema/submission identifiers. Labels describe contract correctness only. They do not establish pedagogical preferences or realistic model error coverage, and they must not be repurposed as such.

Keep future DPO and KTO runs as separate fresh-base arms with a frozen base reference, the same prompt and evaluation cases, and explicit token budgets. DPO needs paired chosen/rejected sequence likelihoods; KTO needs binary desirability labels and its specified KL/reference term. Do not implement KTO as a relabeled DPO objective. Add human-reviewed teaching preferences before claiming either corpus trains teaching quality. No DPO or KTO optimizer run has been executed in this restart.

## Commands

Use a new output directory for every preparation/run. The prepared dataset is `.keating/outputs/training/sdpo-restart-data-v3`; the context is `.keating/outputs/training/sdpo-restart-context/`.

```sh
rtk proxy bun scripts/training/export_system_prompt.ts .keating/outputs/training/sdpo-restart-context/system-prompt.txt
rtk proxy env UV_CACHE_DIR=/tmp/keating-uv-cache UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" uv run --project scripts/training --locked --no-sync python scripts/training/run_restart_sdpo.py --dataset .keating/outputs/training/sdpo-restart-data-v3 --prompt-path .keating/outputs/training/sdpo-restart-context/system-prompt.txt --run-dir .keating/outputs/training/sdpo-only-run --dry-run
```

Remove `--dry-run` only with the existing server-held Tinker credential available through the environment or SDK login. The plan and every dispatched request retain the original $100 ledger and its fivefold undiscounted reservations; no past events are released to make space. Actual discounted/cache-aware estimates are separate from this safety ceiling. A failed request remains reserved.

No new trained checkpoint is available until `result.json` exists with saved sampler weights. An interrupted run may have a saved candidate but incomplete comparison; `evaluated` and `quality_improvement_verified` remain separate. Never repeat a failed command against a new budget or claim a prepared dataset is a completed experiment.

Sources: [Trajectory SDPO](https://www.trajectory.ai/field-notes/scaling-sdpo), [Tinker DPO](https://tinker-docs.thinkingmachines.ai/cookbook/preferences/dpo-guide/), [KTO paper](https://arxiv.org/abs/2402.01306), [Tinker pricing](https://tinker-docs.thinkingmachines.ai/tinker/models/).
