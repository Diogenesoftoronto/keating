# Evidence-conditioned profiles and paired user-model evaluation

`scripts/training/user_model_evaluation.py` implements an offline measurement
boundary for research-plan sections **5, 12, and 13**. It validates supplied
evidence and finite profile alternatives, measures predictions against held-out
answers, and compares two experiences for the same evidence-conditioned panel.
It does not collect answers, generate responses, fit a simulator, or call a
provider. No credentials are read.

**No respondent evidence accompanies this module.** The runnable demonstration
is entirely authored: people, evidence, hypothetical answers, profile weights,
predictions, and continuation outcomes. Its report explicitly counts **zero real
respondents**. Arithmetic on this fixture is a software check, not a Voxq finding
or a simulator calibration result.

## Run locally

From the repository root, using the existing offline uv cache:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 UV_CACHE_DIR=.keating/cache/uv uv run --offline --script scripts/training/user_model_evaluation.py demo
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 UV_CACHE_DIR=.keating/cache/uv uv run --offline --script scripts/training/user_model_evaluation.py fixture
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 UV_CACHE_DIR=.keating/cache/uv uv run --offline --script scripts/training/user_model_evaluation.py evaluate /path/to/local-input.json --samples 2000 --seed 42 --bins 10
```

Each command prints JSON to stdout. `fixture` prints the complete input schema;
`demo` evaluates that same fixture; `evaluate` reads only the supplied local JSON.
Invalid inputs exit nonzero. These commands require the pinned NumPy and
scikit-learn packages already cached; `--offline` never fetches them. The optional
read-only notebook is `analysis/user_model_evaluation.py` and uses marimo,
pandas, matplotlib, NumPy, and the same calibration dependencies.

## Section 5: finite profiles with evidence and unknowns

`prepare_profiles(evidence, profiles, origin=..., forbidden_answer_ids=...)`
returns one immutable-by-content snapshot per canonical `person_id`. The snapshot
includes a content hash, selected evidence, profile weights, and entropy in nats.
Every hypothesis represents the same named traits:

| Trait kind | Required information | Meaning |
| --- | --- | --- |
| `observed` | `value`, `evidence_ids` | Exact matching evidence from this person |
| `unknown` | `value: null` | No asserted value; retained in every alternative |
| `authored_assumption` | `value`, `rationale` | Explicit hypothesis, never relabeled as observed |

Each evidence record has `id`, `person_id`, `field`, `value`,
`source_answer_ids`, and `provenance`. Provenance consists of `kind` and `source`.
The source should name the archived record/revision or receipt. Evidence derived
from answers must list **all** its source answer IDs, including paraphrase or
summary ancestry. Conflicting values for a selected observed field fail
validation; adjudicate conflicts upstream rather than silently replacing facts
with an assumption. An unobserved trait need not be guessed.

Weights must individually be finite in `(0, 1]` and sum to one within `1e-9`.
Totals outside that absolute tolerance are rejected. Within tolerance, admission
divides by the total and assigns any remaining division roundoff to the largest
weight, breaking ties by identifier. The effective weights have `math.fsum == 1`,
retain every positive mass, and remain unchanged on re-admission. Explicitly
omit zero-mass alternatives or panel entries.

Profile snapshots store and hash these effective weights and calculate entropy
from them; the report's input hash retains the original supplied values. Mixtures
use a weighted mean with an explicit denominator, so all-zero and all-one
conditional probabilities return exactly `0` and `1`. Conditional probabilities
are validated **before** arithmetic: `1 + 1e-12` and `-1e-12` remain invalid and
are never clipped. Panel hypothesis mixtures use the same function, and panel
respondent weights follow the same admission policy. Older snapshots containing
approximate weights need fresh admission and matching downstream hash bindings;
the module does not rewrite archived records.

`weight_provenance` names either an `authored_assumption` or a `fitted` source.
This module validates the supplied finite distribution; it does not learn
weights, calculate evidence likelihoods, or claim that authored weights are a
calibrated posterior.

`profile_mixture(profile, conditional_probabilities)` computes
`P(outcome | evidence) = sum_h weight[h] * P(outcome | hypothesis[h])`.
It requires one finite probability in `[0, 1]` for every hypothesis. A profile
snapshot hash binds evidence, assumptions, person identity, and weights.
Changing any of those after admission invalidates downstream predictions and
paired continuations. Hashes establish content consistency, not truth.

For the authored fixture, two hypotheses have weights `0.6` and `0.4`.
Conditional probabilities `0.25` and `0.75` yield `0.45`. Confidence remains
unknown in both hypotheses. Entropy describes uncertainty over these authored
alternatives; it does not measure a person's mental state.

## Section 13: two distinct holdouts

The `holdout` object declares fitting/calibration person IDs, fitting/calibration
answer IDs, target `answers`, and `predictions`. Fitting includes any tuning,
prompt development, threshold selection, or prior inspection used to improve
the user model. Calibration people and fitting people must be disjoint.

| Holdout | Required person membership | What it measures |
| --- | --- | --- |
| `known_respondent` | In the fitting or calibration person registry | Prediction of another unseen answer for an already encountered person |
| `new_person` | In neither registry | Generalization to people absent from model development |

New people may still have an allowed initial subset of evidence for profile
conditioning. This does not make them known training respondents. Person IDs
must resolve repeated interviews and identity aliases before evaluation. One
person cannot appear in both holdout groups.

Every registered target requires exactly one prediction, even when its actual
answer is unavailable. Targets cannot occur among fitting/calibration answer
IDs or in conditioning evidence ancestry. Predictions bind the target's person,
the profile hash, and per-hypothesis probabilities. Direct predictions for a
different person's answer or a changed profile are rejected. The two holdout
reports are never pooled into one score. Exposure checks inspect **all supplied
evidence lineage**, including records omitted from a profile's conditioning
subset. An owner of a declared fitting/calibration answer must appear in the
matching development-person registry. Removing `evidence_ids` therefore cannot
turn an exposed person into a new person. Records retained for this audit do not
automatically become selected evidence or profile traits.

Standalone `evaluate_answers(..., all_evidence=...)` requires the full evidence
inventory. It validates that inventory, rejects protected target ancestry, and
checks that each selected evidence record matches its inventory copy.
`evaluate(bundle)` passes the whole `bundle["evidence"]` inventory. This separates
development exposure from the chosen conditioning subset; it cannot discover
records or exposure a caller never supplies.

In `observed_panel` mode, actual answers and person/evidence provenance must be
`observed`; model predictions and continuations must be `simulated`. In
`authored_fixture` mode they must be labeled `authored_fixture`. Boolean labels
are rejected: use binary integers `0`/`1`, or `null` for missing actual answers.
An unknown answer contributes no negative label and no calibration observation.

The implementation **reuses `observer_probes.calibration_metrics`** for Brier,
log loss, ECE, reliability bins, accuracy, and ROC AUC. Bins are left-inclusive,
right-exclusive except the final bin includes probability `1`; empty bins retain
null means. These shared metrics weight answers equally. The report additionally
provides each person's Brier score, the mean across people, and a respondent
bootstrap for that person-mean score. Repeated answers increase the number of
answers, not the number of people. `actual_respondent_count` in a holdout counts
people with a known observed target answer; `person_count` also includes people
whose targets are all missing.

## Section 12: a paired synthetic panel

The `panel` object contains normalized `respondent_weights`, conditions `A` and
`B`, a fixed `simulation_manifest`, and supplied continuations. The manifest
names the model revision, sampling settings, outcome definition, and evaluator
revision. Each continuation has:

```text
id, person_id, hypothesis_id, replicate_id, arm,
profile_sha256, condition_sha256, simulation_sha256,
value, provenance
```

`value` is a binary outcome or bounded score in `[0, 1]`, defined by the frozen
outcome rubric, or `null` when unavailable. Every `(person, hypothesis,
replicate)` requires both arms. The two arms share the profile, evidence, weights,
and simulation contract, while each binds its own condition hash. A replicate
ID is a pairing index; it does not assert identical provider RNG streams.
These contracts do not replace independent outcome scoring.

Compute each arm's mean within each hypothesis, integrate the hypothesis means
with the profile weights, then calculate each person's `delta = B - A`. Finally,
`effect = sum_i w_i * delta_i / sum_i w_i`. Hypotheses may have different numbers
of repetitions as long as both arms match; repetition counts never replace the
declared hypothesis weights.

The report distinguishes:

- Real respondents, authored people, and total continuation records.
- Complete paired respondents and their total available weight.
- Missing outcomes by arm and each person's available arm means.
- `full_panel_effect` and `available_pair_effect`.
- Weighting ESS `(sum w)^2 / sum(w^2)` for the full and available panels.

An absent arm is a contract error. Record an attempted but unavailable outcome
as a paired row with `value: null`. If any positive-mass hypothesis has a missing
outcome, that person's affected arm remains unknown; no available-replicate
imputation is made. The full-panel effect remains null until every person's
paired effect is known. The available-pair estimate renormalizes the weights of
complete people and reports that denominator. It may be biased by missingness.

The fixture has three authored people with weights `0.5, 0.3, 0.2`, each with two
hypotheses, two repetitions, and two conditions: **24 authored continuations and
zero real respondents**. Their authored deltas `+1, -1, +1` give `0.4`; weighting
ESS is approximately `2.63`. These are illustrative arithmetic results only.

## Bootstrap contract and scope of uncertainty

`respondent_bootstrap` accepts exactly one aggregated value and fixed weight per
person. It uniformly samples whole people with replacement, recomputing the
weighted denominator for every draw. Repeated continuations never become
bootstrap units. Duplicating all continuations therefore leaves the effect, ESS,
respondent count, and interval unchanged. A single available person has no
interval. The default is 2,000 draws with seed 42; permitted counts are 100–20,000.

This follows `native_pilot.paired_bootstrap`'s bounded, seeded percentile-order
statistic convention. It uses separate code because that helper resamples
situation/family means and cannot express fixed respondent weights. The 95%
interval uses sorted draw indices `floor((samples - 1) * q)`, for `q=.025,.975`.

Intervals condition on the supplied profiles, weights, and already-generated
continuations. They do not include within-person Monte Carlo uncertainty,
unrepresented profile hypotheses, simulator bias, correlated household effects,
or population undercoverage. ESS is a weight concentration diagnostic, not a
population sample-size certificate. A synthetic A/B estimate is not a causal
effect measured in real users.

## Evidence still required externally

No real respondent answers, authorized Voxq profiles, independent outcome
assessments, model continuations, consent review, or human experiment are
provided here. Valid JSON and hashes cannot establish those facts. A caller
must attest provenance, preserve source/permission/deletion lineage, fully
register development exposure, resolve identity aliases, and inspect prompts
for semantic leakage that IDs cannot detect. The module only checks declared
identity and ancestry relationships; it cannot detect an undisclosed copied
answer, omitted training exposure, or a fabricated provenance statement.

Section 13's disclosure timing, profile persistence over multi-turn interaction,
error response, action ranking against observed people, and active question
selection remain separate implementation/evidence work. This module delivers
the finite-profile mixture and offline paired measurement boundary, not the full
user-model research programme.

## Verification

The focused suite exercises frozen profile binding, source-answer leakage,
person holdouts, unknown labels, weight validation, Brier/bin compatibility,
paired condition contracts, missing outcomes, and respondent-bootstrap
invariance to repeated continuations. Regressions cover unselected exposure
lineage, the distinction between inventory and conditioning, tolerated sum
roundoff at both weight levels, idempotent profile admission, invalid probability
rejection, and compatibility with `profile_information`'s admitted snapshots.
All test inputs are authored.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 UV_CACHE_DIR=.keating/cache/uv uv run --offline --no-project --python '>=3.12,<3.14' --with numpy==2.2.6 --with scikit-learn==1.7.2 python -m unittest discover -s scripts/training -p test_user_model_evaluation.py
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 UV_CACHE_DIR=.keating/cache/uv MPLBACKEND=Agg uv run --offline --script analysis/user_model_evaluation.py
```
