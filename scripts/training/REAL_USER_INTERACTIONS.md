# SDPO from the real Downloads conversations

This is the active restart direction, replacing the proposed authored-hint restart. It uses the user's existing case-study conversations and the logged-data formulation in [Aligning Language Models from User Interactions](https://arxiv.org/html/2603.12273v1#S4.SS1). No synthetic answer, synthetic learner reply, or judge label is needed for its hindsight context.

The audited inputs are `/home/diogenes/Downloads/keating-portable-data(6).json` and `/home/diogenes/Downloads/keating-training-2026-09-06T20-43-04-888Z.zip`. Their hashes match `docs/case-study/aggregates.json`. Conversation-family membership comes from `docs/case-study/subject-data.json`, including parent links and copied-history joins. Downloads is read only; extracted text remains in mode-0600 files under a mode-0700 private output directory.

## Prepared data

| Item | Count |
|---|---:|
| Source sessions | 81 |
| Adjacent assistant / next-user opportunities | 422 |
| Unique accepted interactions | 193 |
| Training interactions / families | 138 / 27 |
| Development validation interactions / families | 55 / 6 |
| Training interactions fitting native pilot limits | 132 |
| Validation interactions fitting native pilot limits | 55 |
| Copied interactions removed | 155 |
| Synthetic hints | 0 |

Other exclusions: 40 targets not confirmed complete; 19 opportunities in excluded case-study families; four unsupported nontext contexts; seven contexts with no usable visible content; four incomplete tool-result chains. Encoding additionally excludes one completion above 2,048 tokens and five contexts above 32,768 tokens. Nothing is silently cut to make it fit.

184 accepted follow-ups are text and nine contain structured Keating submissions. “User-role message” is provenance, not proof of manual typing: the application can insert context or serialize a real form submission. Quality, helpfulness, and mastery are not inferred from the role or from positive sentiment.

Each row retains:

- The recent history, the original visible assistant response, and the immediate next user message.
- Source file hashes, hashed session/family identity, original message indexes and timestamps, and recorded model/provider metadata.
- Native tool calls and corresponding tool results together in context. Tool output is never relabeled as a user hint.
- The original development split for previously used seed families, plus deterministic family-level assignment for additional families.

The history window starts from the five most recent raw messages and expands backward to a user boundary, preserving tool chains. Full conversations remain in the source snapshot. Hidden reasoning is omitted. This is a declared context-window adaptation, not full-history training or an exact reproduction of the paper's preprocessing.

## Training objective and comparison

`run_user_interaction_sdpo.py` creates a new rank-16 Inkling-Small adapter directly from the base model. The original account record establishes owner/budget only; no SFT or previous optimizer state is restored. Teacher and student receive the same exact current Keating application prompt and 14 tool schemas. The teacher alone receives the observed future user message in a fixed hindsight wrapper. Historical system prompts are unavailable, so using today's prompt is explicitly recorded as an adaptation.

The old responses came from other models; original behavior token probabilities are unavailable. The runner therefore uses a logged-token gradient surrogate: negative mean current token log probability weighted by detached teacher-minus-student log probabilities. Positive weights reinforce and negative weights discourage parts of the historical response. Context and user-message tokens receive no gradient. It does not fabricate behavior probabilities or calculate PPO ratios against an imaginary rollout policy. This is biased relative to fresh on-policy SDPO and is not claimed to compute the exact full-distribution KL.

The pilot defaults to four distinct-family updates, batch size one, learning rate 1e-5, and 3× EMA advantage clipping. These are bounded LoRA adaptations, not the paper's batch size/schedule. Before and after training, sample the same two real held-out histories and three authored regression controls: OpenUI cards, grading a submitted quiz, and giving direct help when the learner asks for no questions. Evaluation never receives the future reply. Contract checks remain separate from human review of teaching quality. No automatic promotion occurs.

The frozen plan at preparation reserves at most **$5.2993278**, including conservative accounting for both custom-loss forward/backward work and ten evaluation responses. The original ledger contains **$89.0368662** in prior reservations, leaving **$5.663806** after the plan. These are fivefold undiscounted safety reservations, not billed dollars. The ledger is checked again before every operation. No reservations were added during preparation.

## Run and review

```sh
rtk proxy env UV_CACHE_DIR=/tmp/keating-uv-cache UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" uv run --project scripts/training --locked --no-sync python scripts/training/prepare_user_interactions.py --output-dir .keating/outputs/training/real-user-interactions-next
rtk proxy env UV_CACHE_DIR=/tmp/keating-uv-cache UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" uv run --project scripts/training --locked --no-sync python scripts/training/run_user_interaction_sdpo.py --dataset .keating/outputs/training/real-user-interactions-v1 --prompt-path .keating/outputs/training/sdpo-restart-context/system-prompt.txt --run-dir .keating/outputs/training/real-interaction-sdpo-run --dry-run
```

The prepared private directory is `.keating/outputs/training/real-user-interactions-v1`, with `train.json`, `validation.json`, `manifest.json`, `preference-audit.json`, and `preflight-plan.json`. Use an unused directory when preparing again. Remove `--dry-run` once the existing Tinker credential is available through its SDK login or server environment. No new checkpoint exists yet. Checkpoints receive a 24-hour TTL when execution occurs; failed requests remain reserved.

## Existing DPO/KTO exports

The ZIP already contains 119 KTO records and seven DPO pairs. Rejoining KTO records to rewarded traces finds 77 with inferred signals, 38 with explicit signals, and four with both. The compatibility files lack source IDs/family splits, so they are audited separately and are not marked training-ready. They are not used as SDPO hints or allowed to override the family split. The previously authored 36-pair/72-example contract dataset remains a separate artifact and is not mixed with real observations.

Eight focused tests cover next-reply identity, temporal ordering, copied histories, hidden-reasoning removal, tool continuity, changed-hint rejection, signed-gradient masking and native teacher/student token alignment. Dry-run encoding verifies all accepted triples without contacting the GPU service. This establishes preparation correctness, not model improvement or human learning gains.
