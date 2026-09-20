# Finite profile updates and information-seeking questions

`scripts/training/profile_information.py` implements the finite Bayesian update
in research-plan **section 5.1** and the next-question calculation in **section
13.3**. It consumes admitted profiles from `user_model_evaluation.py`, computes
conditional weights, and compares a finite set of questions against a declared
decision. It never asks a question, samples a model, reads credentials, or
collects person evidence.

**The demo is wholly authored.** Its people, answers, likelihoods, utilities, and
costs are software examples. It contains zero real respondents and establishes
no empirical user-model performance. The module uses the Python standard library;
it imports the shared admission helpers without invoking NumPy or scikit-learn.

## Local commands

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 UV_CACHE_DIR=.keating/cache/uv uv run --offline --script scripts/training/profile_information.py demo
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 UV_CACHE_DIR=.keating/cache/uv uv run --offline --script scripts/training/profile_information.py fixture
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 UV_CACHE_DIR=.keating/cache/uv uv run --offline --script scripts/training/profile_information.py update /path/to/update-input.json
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 UV_CACHE_DIR=.keating/cache/uv uv run --offline --script scripts/training/profile_information.py select /path/to/selection-input.json
```

`fixture` prints a notice and two complete input objects, `update` and `selection`.
Save the corresponding object as input to that command. Results go to stdout;
invalid contracts exit nonzero. `demo` computes both using authored values only.
`--offline` prohibits dependency retrieval; a compatible Python interpreter must
already be installed. All interfaces below are deterministic and return new
values without modifying their inputs.

## The admitted profile boundary

`admitted_profile(profile, forbidden_answer_ids=())` checks the upstream content
hash, reconstructs the original admission request, and calls
`user_model_evaluation.prepare_profiles` again. The reconstructed snapshot must
equal the supplied snapshot, including its derived entropy. A caller cannot
change an observed trait and merely recompute a checksum to bypass the evidence
contract. This validates consistency, not whether provenance claims are true.

The existing traits remain distinct: observed facts retain their evidence IDs,
unknown traits remain `null`, and authored assumptions retain their rationale.
The extension does not edit the upstream module or add fields to its schema.

## Section 5.1: conditioning on a supplied answer

`update_profile(profile, model, observation, forbidden_answer_ids=())` applies

```text
Z = sum_h prior[h] * P(answer | h, current evidence)
posterior[h] = prior[h] * P(answer | h, current evidence) / Z
```

The likelihood model has exactly:

```text
schema_version: 1
id, revision, person_id, profile_sha256
question_id, question
outcomes: [categorical outcome IDs]
likelihoods: {hypothesis ID: {outcome ID: probability or null}}
provenance: {kind: authored_assumption | fitted, source: explicit source/revision}
```

It must bind the exact person and current profile hash and cover every admitted
hypothesis and declared outcome. Probabilities are finite numbers in `[0, 1]`;
booleans are rejected. Complete rows must sum to one within `1e-9`. Their positive
entries use `user_model_evaluation.normalized_weights`: divide by the admitted
total, assign remaining division roundoff to the largest entry with an identifier
tie break, and require `math.fsum == 1`. Exact zero entries stay zero. Priors and
returned posterior weights use this same idempotent normalization policy.
Individual invalid probabilities, including the next float above `1` or below
`0`, are rejected before normalization; they are never clipped.

A partial row may contain nulls. Its known mass may not exceed one beyond the
`1e-9` tolerance, and its entries remain as supplied. Missing probabilities are
not zero, and remaining mass is never assigned to unknown cells automatically.
Complete-row normalization and keyed Bayesian arithmetic are invariant to
reordering matched hypothesis and outcome entries. Source arrays retain their
original order in provenance hashes.

The observation has exactly:

```text
id, person_id, question_id
value: categorical outcome ID or null
source_answer_ids: [this answer's ID and any declared answer ancestors]
provenance: {kind: observed | authored_fixture, source: original record reference}
```

Its person/question must match the model. Its origin must match the admitted
person: simulated replies cannot be relabeled as observed person evidence.
The answer ID must appear in its own ancestry. Source ancestry cannot intersect
the supplied protected-answer list or previously conditioned answer ancestry.
The protected list is also checked against existing profile evidence. Missing
observations and missing answer values abstain without adding evidence.

On a successful update, the supplied answer is appended as evidence named
`profile-answer:<answer ID>` and a trait `answer:<question ID>` in each surviving
hypothesis. This records **what was answered**, not a conclusion about a latent
trait. All earlier facts, unknowns, and assumption rationales stay unchanged.
For example, a reply favoring a hint does not turn unknown confidence into an
observed psychological fact. A hypothesis reaching probability one still has
authored traits when those traits were authored before the update.

The posterior is re-admitted through the upstream interface. That schema
requires strictly positive weights, so exact zero-posterior hypotheses are
explicitly removed and listed in `dropped_hypotheses`. They are not revived with
an arbitrary probability floor. The returned snapshot remains usable by
`profile_mixture` and subsequent evaluation, with new bindings as appropriate.

| Situation | Result |
| --- | --- |
| No observation supplied | Abstain: `missing_observation` |
| Observation value is null | Abstain: `missing_answer` |
| Likelihood of the supplied outcome is unknown under any hypothesis | Abstain: `unknown_likelihood` |
| Supplied outcome has zero probability under all hypotheses | Abstain: `zero_probability_evidence` |
| Positive mass cannot be represented numerically | Abstain: `numerical_resolution` |
| Wrong person, changed snapshot, protected/reused answer, malformed model | Reject with `ValueError` |

Abstentions return the unchanged prior snapshot and retain the attempted
observation and model for inspection. Zero evidence probability is a model
mismatch, not permission to fabricate a posterior or silently smooth it. The
low-level `bayes_weights` retains log-space posterior arithmetic to handle very
small positive likelihoods. It computes evidence with a scaled weighted mean:

```text
m = max_h likelihood[h]  # positive after the zero-evidence check
Z = (fsum_h prior[h] * (likelihood[h] / m) / fsum_h prior[h]) * m
```

This keeps returned evidence probability in `[0, 1]` without clipping and avoids
losing a representable tiny mixture when individual unscaled products underflow.
For a successful update, log evidence is `log(Z)`; an all-one likelihood vector
therefore gives evidence exactly `1` and log evidence exactly `0`. Posterior
weights are explicitly normalized before returning, rather than only checked.
When evidence or positive posterior mass is unrepresentable, the result abstains
with `numerical_resolution` and retains the log-space evidence estimate for
inspection. Positive mass is never silently pruned.

The result links the parent profile hash, full likelihood model and hash, supplied
observation/ancestry, prior weights, and posterior. The posterior's weight source
is a content-addressed update reference. Authored provenance remains authored if
the person is a fixture, the prior weights are authored, or the likelihood model
is authored. `fitted` in the existing weight vocabulary is used only when both
inputs have that origin; it does not mean this module fitted a new model.

A second update needs a likelihood model explicitly conditioned on the **new**
profile hash. Replaying the same answer ancestry is rejected. Repeating the same
question ID is also rejected, rather than assuming repeated replies are
independent evidence. A genuinely new occasion needs a new question ID and an
appropriate conditional likelihood model. This is finite hypothesis updating,
not a learned state-transition model or automatic likelihood fitting.

## Section 13.3: expected information and decision value

`expected_information_gain(profile, model)` enumerates the finite outcome space:

```text
P(a) = sum_h prior[h] * P(a | h)
EIG = H(prior) - sum_a P(a) * H(posterior given a)
```

Entropy uses natural logarithms, so information is measured in **nats**. Positive
probability branches include their posterior weights and entropy. Impossible
branches have probability zero and no posterior; they contribute zero to the
expectation. Incomplete likelihood tables abstain. A particular answer can
increase entropy even when expected information gain is nonnegative.

These branches are explicitly counterfactual. They are never converted into
observed answer records or admitted posterior profiles. Selection therefore does
not create person evidence. Missing actual answers must remain unknown; an
explicit modeled `no_response` category may be used only when its event
definition and likelihoods are supplied, not as an automatic replacement for null.

`select_question(profile, questions, decision, policy)` adds the decision and
cost boundary. Each question is `{model, cost: {amount, unit}}`. The decision is:

```text
id, person_id, profile_sha256, utility_unit
actions: {action ID: {hypothesis ID: finite utility}}
provenance: {kind: authored_assumption | fitted, source: ...}
```

Utilities may be signed. They must cover every hypothesis; an unknown utility
invalidates the decision model rather than becoming zero. The decision binds the
current profile, and ties between actions use lexicographic action IDs.

The policy declares `utility_unit`, `cost_unit`, `utility_per_nat`,
`utility_per_cost_unit`, `minimum_expected_utility_gain`, and provenance. Costs
and coefficients must be finite and nonnegative. All questions must use the same
declared cost unit. Mixed seconds and USD are rejected until the caller supplies
an explicit common conversion. Coefficients have units of utility/nat and
utility/cost-unit; information, time, and utility are never added directly.

```text
baseline = max_action sum_h prior[h] * utility[action, h]
after_question = sum_a P(a) * max_action sum_h posterior[h | a] * utility[action, h]
decision_gain = after_question - baseline
score = decision_gain + utility_per_nat * EIG - utility_per_cost_unit * cost
```

A candidate must have decision gain above the declared minimum and a positive
score. A numeric floor of `1e-9` prevents roundoff from justifying a question;
scale tiny utility units appropriately. A high-information question that cannot
improve the declared decision is ineligible, even if it is free. Asking nothing
has score zero. The selector returns `abstained` when no candidate qualifies.
Question ties use lexicographic question IDs, independently of input order.

The authored demo starts with weights `0.6, 0.4` and outcome likelihoods
`0.8, 0.2`. A supplied authored `clarification` gives probability `0.56` and
posterior weights `6/7, 1/7`. Before an answer is known, the question improves
the authored optimal expected utility from `0.6` to `0.8`. A two-second cost at
`0.01` authored utility points/second subtracts `0.02`. These are arithmetic
examples, not evidence that a question improves learning or a Voxq experience.

## Lineage eligibility and revocation remain external

This W8 extension records ancestry and rejects supplied protected/reused answer
IDs. It **does not grant eligibility, implement revocation, or propagate deletion**.
No extra module is added: an authoritative purpose/consent registry, monotonic
revocation semantics, and a dependent-artifact inventory are not defined by this
finite measurement interface. The existing benchmark-family registry has a
different domain and is not used as respondent consent authority.

A later lifecycle component must check current eligibility before constructing
these inputs, retain the update chain and source records, invalidate descendants
when a source is withdrawn, and replay from an eligible ancestor under appropriate
conditional likelihood models. A posterior alone is insufficient to undo an
update, especially after zero-mass hypotheses were removed. Hashes preserve
consistency and links, not access rights or proof of deidentification.

Neither truthful provenance nor complete exposure can be established from JSON
alone. The caller remains responsible for resolving identity aliases, supplying
all answer ancestry and protected targets, and preventing semantic leakage from
unrecorded training exposure or copied answers. No real respondent evidence,
fitted likelihood model, observed utility outcomes, or permission review is
supplied with this implementation.

## Deterministic verification

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 -m unittest discover -s scripts/training -p test_profile_information.py
```

The suite checks analytical posteriors and EIG, upstream re-admission, retained
unknowns and authored assumptions, zero/missing/numerically unrepresentable
evidence, protected and duplicate ancestry, stale profile bindings, incomplete
models, decision relevance, cost units, deterministic ties, and local JSON CLI
round trips. Regression cases exercise unit-evidence roundoff, subnormal constant
likelihoods, tolerated prior/row sum errors, normalized posterior weights, strict
probability endpoints, and matched likelihood-row permutations. Test inputs are
authored; no network or provider is involved.
