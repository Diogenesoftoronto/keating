# Inspecting additive SAE probe spans

`scripts/training/probe_spans.py` reads a saved signed-TopK feature artifact and an exported SAE logistic probe. It reconstructs the **calibrated pooled logit** from contributions at the actual selected observer-token positions. It performs no inference, fitting, model download, reward update or paid operation. It does not modify benchmark, sampler or harness files.

For N unique selected tokens, signed coordinate value x[t,j], classifier coefficient β[j], positive preprocessing scale s[j], classifier intercept b, calibration coefficient a and calibration intercept c:

```text
contribution[t] = (Σj x[t,j] × β[j] / s[j]) × a / N
bias            = b × a + c
pooled logit    = bias + Σt contribution[t]
pooled probability = sigmoid(pooled logit)
```

This matches `observer_probes.predict_probe` for its uncentered SAE preprocessing. Negative activations, negative coefficients and negative calibration coefficients retain their signs. The intercept is separate; it is not arbitrarily spread across tokens. Only the pooled logit becomes a probability. Applying a sigmoid separately to token contributions would not produce additive token probabilities.

## Run and inspect

From the repository root:

```sh
rtk proxy python -B scripts/training/probe_spans.py
rtk proxy python -B -m unittest discover -s scripts/training -p test_probe_spans.py
```

The default run uses the existing local artifacts and creates a **new** ignored directory, `.keating/native-learning/probe-span-inspection-v1/`, containing `example.json` and `index.html`. An existing output directory is refused. Use `--output NEW_DIRECTORY` for a subsequent inspection. `--features`, `--report`, `--card`, `--measurement-plan`, `--audit` and `--record-id` select other explicitly supplied saved evidence. No fallback model or invented offsets are supported.

The HTML is standalone, escaped and script-free, with readable source text, signed color, a complete numeric token table, all nonzero probe coefficients, calibration constants and source hashes. Orange increases the calibrated logit; blue decreases it. Color strength is relative within the response. Unselected context remains visible without heat. Overlapping token spans share a visual color without duplicating source text; the authoritative contributions remain separate token rows. Character offsets are Python Unicode code-point indices into the full serialized source view, not actor-token offsets or byte offsets.

## Actual saved example

The example inspects one delivered response from family `pa-02`: “I misunderstood my previous hint…” followed by a compensation hint for63−28. Source features come from `premature-answer-native-measurement-v1/features.local.json`; the fitted head comes from `premature-answer-execution-v1/probe-report.json`. Its target is premature answer delivery under the declared request context, not general teaching quality.

| Quantity | Value |
| --- | ---: |
| Selected observer tokens | 49 |
| Calibrated bias | −3.2590851159517973 |
| Sum of token contributions | +0.8658792259035523 |
| Pooled calibrated logit | −2.393205890048245 |
| Pooled probability | 0.08369225070552079 |
| Observed logit reconstruction residual | 0 |

The probability agrees with the saved reward audit,0.0836922507055208, to floating-point precision. These values describe one measured response only. A positive contribution increases this head's logit relative to its bias and other contributions; it is not a verdict that the particular word contains an answer leak.

## Evidence checks and limits

The tool reuses the existing read-only `observer_report` validators for exact source-view reconstruction, record hashes, boundary/family binding, input-token indices, unique selected indices, sparse-coordinate dimensions, finite signed values, character offsets, full non-whitespace span coverage and reconstruction of **every** pooled coordinate, including coordinates with zero classifier weight. Altering an unused feature therefore cannot evade validation merely by leaving the prediction unchanged.

Observer manifests, the fitted model, feature card and full report must match their hashes and card pins. The measured and fitted observer bases must match. The only accepted revision exception is `layer_selection_implementation_sha256` explicitly pinned by the saved card; model, tokenizer, SAE, precision, layer, pooling and other fields remain exact. The native measurement-plan, audit and approval-card seals use the existing insertion-ordered native hash convention; observer/report objects use canonical sorted JSON hashes. These conventions are deliberately distinct.

The authoritative source is `native-hint-brief-capture-v1/reward-handoff-v1/measurement-plan.json`'s `projection`, whose hash matches the feature input hash. The loose `observer-inputs.json` has additional metadata and a different hash, although its source view is equivalent; it is not silently substituted. The saved card is pinned by the audit. Hashes bind supplied artifacts, not operator identity or cryptographic authenticity. The script does not grant reward approval or re-evaluate cross-family performance.

Offsets and token IDs are checked against saved evidence; the tokenizer is not downloaded or rerun, and residual activations/TopK selection are not re-extracted. Contextual hidden states can encode preceding text, so an additive contribution assigned to an observed token does **not** establish that this token caused the concept, that deleting it would change behavior as predicted, or that a span is semantically correct. Localization accuracy, causal intervention effects, cross-family classification, calibration transfer and human learning require independent evidence. None is established here.

The unit tests use tiny synthetic arrays with only the full Qwen manifest-schema validator replaced, retaining source/token/pooling and hash validation. A separate read-only test uses the actual saved artifacts and full manifest validation when they are available; it explicitly skips when the optional local measurement is absent.
