# Controlled SAE generation · 14 September 2026

The repaired worker produced six complete paired tasks and 30 actual generations.
A selected layer-12 SAE direction changed some token sequences, but no reviewed
criterion changed relative to baseline.

| Condition | Changed sequences | Hint request matches | Correctness | All three criteria |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 0/6 | 0/4 | 3/6 | 1/6 |
| Selected positive | 2/6 | 0/4 | 3/6 | 1/6 |
| Selected negative | 1/6 | 0/4 | 3/6 | 1/6 |
| Random direction | 0/6 | 0/4 | 3/6 | 1/6 |
| Comparison feature | 0/6 | 0/4 | 3/6 | 1/6 |

All 90 expanded criterion judgments agree between two blinded model-assisted
reviewers. Exact duplicate request/criteria/output triples were reviewed once
per reviewer (eight unique triples), then expanded to all 30 response IDs using
a hashed mapping. Both reviews and reasons remain in the public data.

## What changed

Feature 31497 is the strongest positive weight in the 19-weight premature-answer
readout. The positive intervention first changes the atom-conservation output
at generated token 10, and both signs change the median-task continuation at
token 68 (positions count from one). Comparison coordinate 4962 and the fixed
random direction change no generated token in the six completed tasks.

The chemistry baseline begins with a useful hint but continues an imagined
learner/tutor exchange that reveals a prohibited coefficient. Its positive
intervention changes wording, then repeats the same pedagogical failure. Several
other outputs repeat requests or simulate learner turns instead of producing one
tutor answer. The archived text preserves those errors and all cutoffs.

## Method and execution

Pinned Qwen3.5-9B-Base and its matching Qwen-Scope SAE, layer 12, signed Top-K 50,
hidden width 4096, dictionary width 65536. The selected decoder column and controls
are normalized; epsilon is 0.02 times the calibration lower-median residual norm
30.192398071289062. Only the frontier token is patched. The worker recomputes
history without a cache, uses the checkpoint's actual indexed output head, and
generates greedily with a 96-token cap. All 30 responses reached that cap.

Eight tasks were planned. The four hint and two worked-answer tasks completed all
five conditions; the two capability tasks are missing. Partial admission was
specified before output inspection. The validated archive contains only durable
complete paired groups. In-flight attempts are unknown, with lower bounds of six
families and 30 responses. No missing condition receives a fabricated grade.

V2 started 21:55:52 UTC and terminated 22:37:52 UTC, using cleanup time within the
45-minute allocation. Import reports `partial_valid=true`, `experiment_valid=false`,
exit 124. The parent retains `failed_unknown` for the incomplete full job. A fresh
authenticated provider inventory confirmed zero pods; the research ledger has
zero active grants and USD 61.30 reserved / 38.70 unallocated under its USD 100 cap.
The two USD 1.50 generation reservations include V1's head-loading failure.

## Evidence and interpretation

- [Public outputs, original IDs and reviews](research-story/generation-examples.json).
- [Narrative, controls and inspector](research-story/manuscript.md#generation-inspector).
- [Review and worker workflow](observer-generation-job.md).
- [Interactive notebook](../analysis/controlled_generation.py).
- Private execution: `.keating/native-learning/premature-answer-generation-v2/`.
- Job SHA256: `45e061585cc101edf3bdf51e05cc7709dfadf3d37aa7fd2f662f62f3928959a0`.
- Archive: `d8e258529753fcb482f3000ec4a525f8fcafa6b64e18f0377f8fdabe2a99eb72`.
- Partial result: `7d5c48db660328ecd8baf2052567dcf39f96bc38d1e106af0a979fe7371c7b8a`.
- Review audit: `8f670a128dabb3f21ed6c71b329ee6e6c149f5186769dc08c3e0c07627cb17ea`.

The experiment demonstrates a local generation effect for the selected direction,
with no measured behavioral improvement or degradation on completed tasks. It
does not establish a semantic or causal teaching feature, full-probe reward
benefit, broad equivalence, artifact transfer or human learning. It uses one
magnitude, one layer, one coordinate, greedy Base continuation and reused authored
evaluation families. The comparison coordinate's semantic independence is
unverified. A stronger common instruction policy, independent tasks, a bounded
magnitude/layer sweep and graded artifact transfer are the next tests.

Nineteen generation-job checks passed before dispatch, including pinned cache
symlink handling and escape rejection. Eighteen review checks passed, including
partial admission, exact prompt/ID binding, corruption rejection and unknowns.
The saved-data notebook executed end to end after the reviewed export was present.
These checks are separate from the real GPU execution and model-assisted review.
