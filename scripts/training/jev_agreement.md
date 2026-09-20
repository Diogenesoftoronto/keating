# Judge agreement on captured teaching runs

`jev_agreement.py` compares the incumbent rubric judge and Jev on the same
immutable captured generation. It does not generate new tutor responses. Each
receipt hashes the same case and transcript; the corpus hashes all source state.
Agreement with the incumbent is agreement, **not correctness or human learning**.
The eight authored calibration pairs are not ground truth.

The included source config selects actual local artifacts: eight v1 base-model
turns, 48 v2 Luna results, one v3 frozen pilot, and 12 v4 offline plumbing tapes. It is an
example subset, not a complete v1–v4 evaluation. Source paths are explicit to
avoid sweeping unrelated learner data into requests. Change the config to select
additional runs. A source directory loads its `*.review-packet.json` files.

From the repository root, using Python 3.13 with the existing benchmark dependencies:

```sh
rtk proxy python3.13 scripts/training/jev_agreement.py prepare --source scripts/training/jev_agreement.sources.example.json --out .keating/tmp/jev-agreement-corpus.json
rtk proxy python3.13 scripts/training/jev_agreement.py plan --source .keating/tmp/jev-agreement-corpus.json --out .keating/tmp/jev-agreement-requests.json --jev-model judgement
rtk proxy env PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3.13 -m pytest scripts/training/jev_agreement_test.py scripts/training/jev_agreement_v4_test.py scripts/training/test_benchmark_judge.py scripts/training/test_benchmark_judge_systemone.py scripts/training/test_benchmark_v4.py -q
```

`prepare` and `plan` make zero provider calls. The plan reports over-budget states
without truncating them. Evidence narrowing may require more requests than the
first-round plan. Outputs are private mode-0600 files and existing outputs are
never overwritten.

The 2026-09-19 dry run prepared all 69 rows and built initial requests for 68.
The v4 `memory-evidence-correction-forget` state exceeds the 96,000-character
guardrail and was recorded as a planning error. Provider calls: zero. This is
request-construction evidence only; no agreement or hosted cost/latency was measured.

For authenticated Not Organic calls, create a JSON argv file containing the
account-owned bridge command, for example:

```json
["rtk", "proxy", "bun", "scripts/training/jev_notorganic_dispatch.ts"]
```

The command receives one direct `{state, model, questions}` JSON request on stdin
and must emit one raw `{model, answers, usage}` SystemOne JSON response to stdout.
It must exit nonzero on failure; stderr and malformed stdout are never included
in reports. Authentication remains in the bridge/session store. Do not put
credentials in argv. The `judgement` alias is the gateway model; returned model
identities are separately retained in Jev receipts.

An incumbent Responses API bridge can be supplied with
`--incumbent-dispatch-command /private/incumbent-command.json`, mutually exclusive
with `--incumbent-key-file`. It follows the same JSON argv/stdin/stdout protocol,
receiving the existing Responses API request and returning its raw response.
The runner requires the returned `model` to match `--incumbent-model` exactly;
an alias or a different routed model fails closed. A Not Organic bridge must
obtain the account's inference capability and sign the exact `/v1/responses`
request. Public account capabilities cannot use arbitrary raw model IDs under
the current gateway policy: if an authorized alias is transported internally,
its returned identity must still prove it is the declared incumbent. Never label
a different `balanced` model as agreement with `gpt-5.6-sol`.

The provided account bridge is selected explicitly:

```json
["rtk", "proxy", "bun", "scripts/training/incumbent_notorganic_dispatch.ts", "--route-model", "balanced"]
```

Authorize the project with `keating login --judgement` after the provider's
judgement route and consent changes are deployed. This grants both
`infer:balanced` and `judgement:evaluate` for five minutes. The incumbent bridge
uses the first scope, preserves the requested concrete model for comparison, and
rejects any returned model mismatch. The Jev bridge uses the second scope. Neither
bridge refreshes or expands authority. A route that does not serve the declared
incumbent is an unresolved comparison prerequisite, not a substitute comparator.

The newer local corpus in `.keating/tmp/jev-agreement-corpus-current/` contains
80 genuine captured episodes: 8 v1, 48 v2, 23 v3 and 1 v4. Its `coverage.json`
records missing cases and excludes failed captures. `runnable-corpus.json` has
63 episodes; 17 v3 states exceed the 96,000-character gateway budget and remain
explicit exclusions. Native validation confirms selected source/receipt shape;
it does not establish judge accuracy or full suite coverage.

```sh
rtk proxy python3.13 scripts/training/jev_agreement.py live --source .keating/tmp/jev-agreement-corpus.json --out .keating/tmp/jev-agreement-live.json --execute --incumbent-key-file /private/openai-key --jev-dispatch-command /private/jev-command.json --jev-model judgement
```

The standalone alternative requires `--jev-endpoint` and `--jev-key-file` for an
operator-configured HTTPS service accepting bearer authentication. This does not
imply Not Organic product sessions support bearer-only keys. Direct TypeSafe
requires the additional explicit `--allow-direct-systemone` override. Credentials
must be private files. Nothing calls a hosted service without `live --execute`.

Offline judge-response replay accepts `--incumbent-tape` and `--jev-tape` JSON
maps from SHA-256 of canonical request JSON to raw response. This holds both
generation and judge responses fixed; it proves report plumbing, not live model
quality. Replay latency is never presented as hosted latency.

```sh
rtk proxy python3.13 scripts/training/jev_agreement.py replay --source .keating/tmp/jev-agreement-corpus.json --out .keating/tmp/jev-agreement-replay.json --incumbent-tape /private/incumbent-responses.json --jev-tape /private/jev-responses.json
```

Reports include per-suite/per-dimension exact agreement, nominal Cohen's kappa,
confusion matrices, scored-pair denominators and both judges' abstentions.
Kappa is null when no pairs are scored or both raters are constant and identical.
Disagreements carry the entire source row and both receipts. Full review receipts
also persist separately as each pair completes. Missing token usage or prices
stays unknown. Optional `--rates` takes an explicit USD-per-million table:
`{"incumbent":{"input_tokens":0,"output_tokens":0},"jev":{"input_tokens":0,"output_tokens":0}}`.
Use actual quoted rates, not these placeholder zeros; estimates are not invoices.

`jev_agreement_v4.py` uses a separate versioned protocol for v4. Jev shares scalar
rubric questions across independent evidence Choices for **every** scoped step.
Persisted-state dimensions also select an actual state/profile file independently
at each required step. Code copies exact text spans and file hashes; a missing or
uncertain selection abstains on the dimension. Sentence narrowing stays inside the
selected visible block. Repeated identical messages in different steps remain
separate candidates. The incumbent request schema carries matching `evidence`,
`additional_evidence`, and `state_evidence` fields without changing its v1/v2 path.
Both judge results pass the existing native v4 validator, including completed
steps, fresh message boundaries, clipped-output rejection and actual file hashes.
Each dimension is validated independently while retaining the complete frozen case.

Current boundaries: v3 flat missing-behavior ratings lack step attribution and
abstain. v4 offline plumbing generation is labeled separately from real model
episodes and receives no hosted calls or scores; its planned requests are marked
ineligible for execution. Synthetic protocol tests prove evidence handling, not
judgment accuracy. The report never declares the plan's phase-2 gate passed:
actual hosted comparisons, full suite coverage and acceptance criteria still
require proof. The v4 adapter has not yet been validated with live judge responses.
