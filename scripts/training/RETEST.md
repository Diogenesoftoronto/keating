# Retesting the teaching benchmark

Use the provisioned Python environment with `uv` and the Typer CLI:

```bash
rtk proxy env UV_CACHE_DIR=/tmp/keating-uv-cache UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" uv run --project scripts/training --locked --no-sync python scripts/training/benchmark_retest.py --config .keating/outputs/training/benchmark-v2-config-20260907.json --output-dir .keating/outputs/training/benchmark-v2-new-run --execute
```

The config contains model controls and references to operator-owned mode-0600 credential files retrieved from Skate. Never commit that config or credential files. The runner excludes Anthropic/Claude and Gemini; Gemma remains eligible. The user removed the separate USD20 evaluation limit. This runner does not touch the original USD100 training ledger or update model weights.

The benchmark release is frozen before dispatch. Keep version 1 unchanged. Use a new version if cases, anchors, context, tool execution, or objective checks change. One attempt is recorded for each selected model and case, with at most three assistant turns. Actual isolated tool results are appended before the next assistant turn. Provider failures, truncations, missing usage and unfinished tool loops remain visible. No generated learner turns are inserted.

Each model writes private per-case receipts as it finishes. An exclusive output directory prevents accidental replay into an existing run. The runner does not automatically retry failed requests. If interrupted, preserve the incomplete run as evidence; do not combine repeated attempts into a purported single attempt without labeling them.

After candidate execution, calibrate the separate AI reviewer and run `benchmark_review_batch.py`. The eight authored contrasts are a narrow sanity check, not human validation. A failed calibration leaves candidate traces and objective results available without AI quality scores. Reviews include evidence, abstentions, provenance and a same-model bias flag. Judge costs are separate from candidate costs.

Chart definitions:

- Cost per task sums all candidate calls at recorded per-token rates. These are conservative uncached estimates, not invoices; cached counts remain visible when reported. Tinker rates already include the 50% discount once.
- Output tokens per task sum all candidate calls, including reported reasoning tokens where the provider includes them in output usage.
- Episode latency measures elapsed time across calls and isolated tool execution, excluding time waiting for the model worker. It is not decode speed or time to first token.
- Pareto plots compare common cases with known quality and cost/time. Missing quality or usage is unknown, never zero. A frontier is descriptive for this fixed single-attempt sample.
- AI rubric scores describe observed teaching behavior. They do not measure human learning gains, delayed recall, transfer gains, or a harness evolving itself over long trajectories.
