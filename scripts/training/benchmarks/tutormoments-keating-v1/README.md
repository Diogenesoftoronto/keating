# TutorMoments situations inside Keating

Twelve agent-authored synthetic development episodes, derived from six pinned
TutorMoments situations: three scaffolding and three rigor. Each has an ordinary
conversation variant and a reopen variant. This is a small curated pilot, not an
automatic translation of all 520 moments or a human-validated evaluation set.

The episodes unfold through `benchmark_harness_v3.ts`: learner messages go to the
actual Pi runtime; the tutor can use its allowed tools; reopen restores the real
session. Learner messages are fixed scripts, not adaptive student simulation.
Reopen variants request persistence, but tool use and persistence must be judged
from actual receipts. No precomputed tutor replies or fabricated tool results are
injected. The cases do not yet submit generated quiz widgets automatically.

Each case retains `source.moment_id`, source revision, source dimension, changes
made, and a conversation-level family. Group by family for any future split;
variants and nearby moments from the same conversation are not independent
holdouts. This entire pilot is development data. Source labels motivate the
adaptation; its new multi-turn rubric is authored, not inherited ground truth.

Validate locally:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --no-project --with typer python scripts/training/benchmark_v3.py validate --suite scripts/training/benchmarks/tutormoments-keating-v1
```

Use this suite with the existing `benchmark_v3.py run --suite` / `review` workflow.
Provider runs remain explicit CLI actions; opening notebooks never runs inference.
`request_for` forwards steps but withholds `source`, `rubric`, and `reference`.

## Original and adapted comparison

`devenv tasks run keating:tutormoments` caches and verifies the original 520 moments
at `.keating/datasets/tutormoments/moments.jsonl`. Nothing rewrites that file.
`analysis/tutormoments_comparison.py` joins the originals to these cases and shows
the new event sequence beside the frozen prefix.

For the **official vanilla protocol**, use the [upstream runner](https://github.com/allenai/tutormoments)
with `--dataset-revision 66058b4c7ef5e7631b3c4d39a1dfa8172e36d8bc`. Keep its
oracle student, frozen personas, prompts, scoring and model configuration recorded.
The upstream runner supports `--modes plain scaffolding_rigor` and records the
configuration alongside results. No official provider run has been performed here.

The optional local `tutormoments.py plan --system-prompt FILE --output NEW_DIR`
exports a **next-turn diagnostic**, not an official replay: `requests.json` holds
only pre-cut tutor inputs; `evaluation-only.json` holds labels and oracle material.
Never send the evaluator file to the tutor.

Compare matched moments before aggregates. Report protocol, model, prompt policy,
completion coverage, costs and latency separately. There are no measured scores
yet; differences between these protocols are not estimates of human learning.

## Attribution

Adapted from Albert Zhang et al., *When Help is Unhelpful: Evaluating AI Tutors for
Productive Struggle*, Ai2 TutorMoments-Preview (2026),
[dataset](https://huggingface.co/datasets/allenai/tutormoments-preview),
[project](https://tutormoments.allen.ai/), licensed CC BY 4.0.
The synthetic rewrites, explicit learner cues, new attempts, and reopen events are
Keating modifications. Raw transcripts remain in the ignored cache; these fixtures
use rewritten situations, not redistributed learner identities or full transcripts.
