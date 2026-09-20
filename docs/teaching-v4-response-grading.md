# Automatic response grading in v4

The benchmark now classifies teaching responses automatically and includes a response-quality component in its review output. It judges when to explain and when to leave room for reasoning. Learners do not have to ask for the pedagogically appropriate move.

This adapts the separation of localization, classification and reward in [Features as Rewards, v3](https://arxiv.org/html/2602.10067v3). That paper also uses automatic judges for legibility, action labels and substantiveness. Our tutoring classes and grading rule below are new project definitions, not the paper's hallucination labels or reward formula.

## The classification sequence

| Pass | Input | Output |
| --- | --- | --- |
| Need | Actual conversation ending before the response | Explanation needed, room to reason, clarification needed, mixed, or unknown; exact supporting context spans |
| Reaction | That frozen need assessment, the same prefix, and the delivered response | Exact response spans labeled explanation, worked step, hint, diagnostic question, confirmation, correction, practice, withholding, or other |
| Fit and substance | Each move in its context | Appropriate, overhelp, underhelp, misdirected, or unknown; whether the move substantively addresses its target |
| Grade | Validated classifications | Per-turn score, whole-case response quality, coverage and full evidence receipt |

The need pass cannot see the tutor's upcoming response, future learner turns, private rubric or answer keys. The reaction pass can use correctness references available at that turn. Need evidence refers to the actual session prefix, not an inferred transcript stitched across fresh sessions.

For example, “divide both sides by six” may be warranted after repeated subtraction of the coefficient. The same step can interrupt a learner who has just identified division and is working through it. The classifier must justify this distinction from the attempts and the tutor's actual response. There is no fixed failure-count threshold, keyword score, or preference for short responses. It can also recognize a useful explanation that helps the learner tackle a follow-on problem.

Legibility, benchmark-facing meta commentary and correctness are separate checks. A specific explanation can be wrong; an appropriate-looking hint can be empty. A response can contain several differently classified spans. Giving an answer is not an automatic failure, and asking a question is not an automatic success.

## How classification enters grading

The protocol is `contextual-tutor-response/v1`:

- **0:** incorrect, illegible or benchmark-facing meta response, or a move classified as overhelp, underhelp or misdirected.
- **1:** appropriate help whose substance is incomplete.
- **2:** appropriate, substantive help.
- **Unknown:** insufficient context, incomplete output, low-confidence classification or an unresolved necessary check.

A turn takes the minimum of its response scores, so a later polished message does not hide an earlier failure. The whole-case response score is the mean turn score divided by two. Every required turn must be observable and graded; otherwise whole-case quality remains unknown. Span counts and response length do not multiply reward.

`benchmark_v4.py review` includes `response_quality`, `response_coverage` and the automatic grading status alongside the existing independent rubric `quality`. These are named grading components, with no hidden weighting that could obscure failures. Historical v4.0 scores are not rewritten.

## Running it

After native execution, run:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --no-project --with typer \
  python -B scripts/training/benchmark_v4.py grade RUN_DIRECTORY --grader-config GRADER_CONFIG.json
```

Or add `--grader-config GRADER_CONFIG.json` to `benchmark_v4.py run` to classify and grade automatically after execution. To grade archived v4.0 inputs, also pass `--suite scripts/training/benchmarks/teaching-v4/versions/4.0.0`.

The config contains:

```json
{
  "command": ["path/to/classifier-adapter", "its-arguments"],
  "max_calls": 160,
  "timeout_seconds": 180,
  "classifier": {
    "kind": "model_api",
    "id": "provider/reviewer-model",
    "revision": "pinned-provider-revision",
    "protocol": "contextual-tutor-response/v1",
    "artifact_sha256": "replace-with-actual-classifier-artifact-or-provider-config-sha256",
    "calibration_sha256": null,
    "minimum_confidence": 0.8
  }
}
```

Those strings are placeholders. The command is an argument array executed without a shell. It receives one JSON request on stdin and returns one decision on stdout. `benchmark_response_classifier.py` implements the model-judge adapter for an OpenAI-compatible endpoint; use it with `uv run --script`, `--endpoint`, `--model` and `--api-key-env`. The key itself stays in the environment. Each observed response uses two calls. Call limits and timeouts are explicit; the invoking provider/budget runner owns the dollar cap.

An activation classifier uses the same two-stage interface with `kind: activation_probe`, the matching protocol, and real observer, artifact and calibration hashes. This lets the validated readout replace the model judge without changing grading arithmetic. It must predict these contextual classes; the earlier hint-only `premature_answer` head is not silently relabeled as this classifier.

The runner creates immutable `response-grades/` receipts. Each preserves context and response spans, classifier identity, prompt and request hashes, decisions, scores and coverage. Review consumption reconstructs the score from its evidence and rejects stale case/result bindings. Failed classification stays unscored; it is not repaired into a convenient label. Fixture classifiers and offline tapes cannot supply measured teaching-quality scores.

## Probe development and limitations

The model judge is the executable labeling baseline. The broader context-sensitive activation heads still require fitting and held-out calibration; the saved single-response token contributions do not establish a trained span localizer or validated appropriateness classifier. Use independently authored or eligible development families, including matched responses across repeated-difficulty and productive-attempt contexts. Compare text, raw-activation and SAE classifiers on identical labels and grouped splits. Measure localization, class calibration and contextual contrast accuracy separately. Keep every v4 family and its graded descendants excluded from probe and policy training.

The current automatic context projection supports visible conversation text, including inline OpenUI source; unrepresented tool/image context is left unscored. A supplied calibration hash records an external artifact, not proof of its adequacy. Uncalibrated model judgments are labeled accordingly. No new hosted classification or activation training was run for this integration; tests exercise the complete automatic path with authored classifiers. Appropriateness is a behavioral judgment; learning and retention need separate observed outcomes.
