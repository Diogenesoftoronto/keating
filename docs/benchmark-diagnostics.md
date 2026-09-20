# Offline v4 response diagnostics

`scripts/training/benchmark_diagnostics.py` exports actual new assistant text from
a native v4 harness result, overlays supplied probe spans, and queues candidate
benchmark gaps for independent investigation. It performs no inference, loads no
actor or observer weights, and never changes a checkpoint, frozen case, rubric,
training split, or benchmark score.

## Run after a result has finished writing

The CLI resolves the result's case ID against the hash-validated frozen v4 suite.
Use a **new output directory**, outside that suite:

```sh
rtk proxy python -B scripts/training/benchmark_diagnostics.py \
  '.keating/native-learning/v4-checkpoint-pilot-v1/F-only/help-hint-then-flip/result.json' \
  --output /tmp/v4-f-only-hint-diagnostics
```

The same command accepts the parent's other `F-only` / `F+S` and
`help-hint-then-flip` / `help-worked-then-flip` results once available. This exporter
does not launch, poll, retry, or alter the pilot. Missing/incomplete JSON fails;
an already finalized failed result is inspectable and retains its failure status.

Outputs:

- `index.html`: standalone, escaped raw-text inspection with highlighted spans,
  hover labels, exact annotation details, separate rubric scores, and proposals.
- `diagnostics.json`: exact extracted responses, source bindings, annotations,
  independent review, and candidate queue.
- `queue.json`: candidate investigations only; an empty array means no candidates
  were produced from the available evidence, **not** that the benchmark passed.

Existing output directories are rejected. Input files are read only. The HTML
uses no scripts, external resources, Markdown renderer, or executable OpenUI.

## What counts as a response

Each new assistant message becomes one response. Extraction uses each message
step's `message_start_index`; absence or invalid bounds fail closed. Reopen and
new-session receipts are skipped because their snapshots can repeat old history.
Only assistant string content and `type: "text"` blocks are included. Thinking,
analysis channels, tool calls/results, explicitly private blocks/messages, source
observations, requests, files, events, state, and learner messages are excluded.

The projection is explicitly labeled
`raw-assistant-text-with-openui-source/v1`. OpenUI source inside an actual assistant
text block remains escaped source text. It is **not** a reconstruction of the
rendered learner artifact. No semantic artifact inspector is implemented here.

Nonempty text blocks are joined with one newline, using v4's existing visible-text
helper. Offsets refer to that exported `text`: Unicode code points, zero-based,
end-exclusive. They are not UTF-8 byte offsets or JavaScript UTF-16 offsets.
Whitespace inside included blocks is preserved. Empty/whitespace-only blocks are
omitted by the existing helper.

`text_sha256` hashes the UTF-8 encoded exported text. `response_hash` hashes the
canonical object containing `case_sha256`, `result_sha256`, step/message indexes,
projection, and `text_sha256`. Thus the same text under a different result or
checkpoint receipt cannot reuse an annotation. Formatting-only JSON changes do
not change these hashes. The original input result is never copied into exports;
its canonical hash binds the private evidence without displaying it.

## Supply existing real probe annotations

First export without annotations to obtain the exact response hashes and text.
Then supply `--annotations /path/annotations.json`. There is no keyword fallback,
synthetic activation generator, probe fitting, or implicit model call. If no
annotation is supplied, `probe_status` is `unknown`; a below-threshold score is an
observed signal, not a pass.

The annotation file has this shape. The identifiers below refer to **existing
measured artifacts**; do not fill them with invented model measurements:

```python
from observer_core import digest

annotations = {
    "schema_version": 1,
    "observer_manifest": actual_observer_manifest,
    "probe_cards": [actual_feature_card],
    "annotations": [{
        "response_hash": exported_response["response_hash"],
        "observer_manifest_sha256": digest(actual_observer_manifest),
        "probe_card_sha256": digest(actual_feature_card),
        "prediction_sha256": actual_prediction_artifact_sha256,
        "dimension": actual_feature_card["target"],
        "score": actual_measured_probability,
        "threshold": actual_recorded_threshold,
        "spans": [{"start": start, "end": end,
                   "text": exported_response["text"][start:end]}],
        # Optional explicit mapping; omit both keys if no mapping is justified.
        "rubric_dimension": existing_v4_rubric_dimension,
        "positive_means": "rubric_issue",
    }],
}
```

The observer manifest must declare `evidence: "model_extraction"`, as existing
observer exports do. `probe_cards` accepts the existing
`observer_probes.fit_probes` baseline `feature_card` objects, retaining `target`
and `observer_manifest_sha256`. Card and manifest hashes use
`observer_core.digest`, SHA-256 of sorted compact JSON with Unicode preserved and
nonfinite values rejected. Every annotation must match those supplied artifacts
and a response in this exact result. A native reward card is a different format;
it is not silently converted into a classifier feature card.

Each prediction must supply a valid SHA-256 evidence identifier, finite numeric
score and threshold in `[0, 1]`, and nonempty spans whose quoted text matches
exactly. Boolean scores, duplicate response/card/dimension annotations, missing
pins, stale hashes, and invalid spans are rejected. Overlapping spans are allowed
and displayed without unsafe nested markup.

Annotations are **supplied evidence bindings**, not authenticated extraction
records. Hashes alone do not prove real extraction, model execution, or artifact
authenticity. `prediction_sha256` is checked only for SHA-256 syntax; there is no
supplied prediction-artifact input to recompute it against. The prediction
artifact is not fetched or authenticated.
The caller must supply real measurement provenance and ensure the threshold is
the recorded classifier threshold. Existing pooled classifier predictions do
not establish causal token attribution or validated localization. A highlighted
span records the producer's declared region; the exporter never invents one.

## Independent rubric review and proposals

`--review /path/review.json` accepts the existing v4 review format. The unchanged
`benchmark_v4.validate_review` verifies result/case hashes, reviewer provenance,
complete rubric coverage, scoped evidence, and abstentions. Probe signals and
rubric scores remain separate. Review validation uses the existing v3 dependency
on Typer; use the development environment or the following cached offline command:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH \
  uv run --offline --no-project --with typer==0.27.2 python -B \
  scripts/training/benchmark_diagnostics.py /path/result.json \
  --annotations /path/annotations.json --review /path/review.json \
  --output /tmp/v4-reviewed-diagnostics
```

A candidate is queued when a supplied probe score is at/above its supplied
threshold, or when an explicitly mapped probe disagrees with independent rubric
evidence. `positive_means` must be `rubric_issue` or `rubric_success`, and
`rubric_dimension` must name a case rubric. Comparisons apply only at that rubric's
scoped steps. Scores `0` and `2` support an explicit binary comparison: a positive
issue maps to `0`, and a positive success maps to `2`. Partial score `1`, null,
missing review, missing mapping, or evidence outside the scoped steps leaves
disagreement unknown. The exporter never rescales rubric scores into probe
probabilities. Low probe scores can still queue a disagreement with a rubric.

High scores and disagreements are **triage triggers**, not confirmed faults or
benchmark deficiencies. Every queue entry preserves the response hash, exact
probe spans/scores/pins, independent rating when available, reasons, and a
`needs_independent_review` proposal for a separately versioned contrast or
reproduction case. It neither invents a new test case nor adds one automatically.
All proposals retain `training_policy: "exclude-entire-family"`, including public
development challenges. No v4 family is made eligible for training or moved into
a new split by this tool.

## API and verification

With `scripts/training` on the Python module path:

```python
from benchmark_diagnostics import diagnose, render_html

report = diagnose(frozen_case, native_result, annotations=None, review=None)
html = render_html(report)
```

The API validates the supplied v4 case shape; callers are responsible for loading
it from the frozen suite. The CLI additionally performs the suite hash checks.
Both paths leave inputs unchanged. Reports containing independent review data
include that reviewer-supplied evidence separately from extracted response text.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH \
  uv run --offline --no-project --with typer==0.27.2 python -B \
  -m unittest discover -s scripts/training -p test_benchmark_diagnostics.py
```

The tests use explicitly authored fixtures and validate hash forgery, role and
privacy filters, boundaries, Unicode offsets, unknown annotations, independent
review binding/polarity, HTML escaping, partial results, output isolation, and
unchanged inputs. They establish offline export behavior only. No paid GPU, live
probe localization, real benchmark improvement, or live pilot result is claimed.
