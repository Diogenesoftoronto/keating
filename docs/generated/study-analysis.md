# Study Analysis

## Protocol

- Executed Keating package version: 3.12.0
- Frozen policy origin version: 3.3.0
- Working-tree source digest: `sha256:0066a2356b991c05b931cfd76d727053b20664a7b9a5b0ee9013d325489b2b7b`
- Evaluated policy: me-candidate-33 (docs/study/evaluated-policy.json)
- Benchmark mode: deterministic-synthetic-fallback
- Synthetic learners per topic: 3
- Trace corpus SHA-256: `66e93fa46d5d0d8990e92453800d4ac9ecd844db13959a5113ae3557376ef445`
- Curated snapshot SHA-256: `87b91f1724a991abbb3f35630a2a67218156ad55848d998f4299eceadac86638`
- Evaluated policy SHA-256: `0234046551bd7699e0f4fb3bda1af59c44bfa3e8500a53cb06cb7052fbcd75e1`

## Data Integrity

- Raw trace files: 22
- Latest trace records retained: 16
- Older duplicate traces excluded: 6
- Snapshot matches latest-trace protocol: true
- Score corrections applied: 1

## External Evaluation

- Records: 16
- Overall normalized score mean (95% bootstrap CI): 0.61 (0.515, 0.705)
- Highest-scoring topic: relativity
- Lowest-scoring topic: stoicism

## Legacy Synthetic Benchmark (not the skill activation gate)

- Policy under analysis: me-candidate-33
- Full-suite delta versus default across 200 seeds: 3.982 (3.039, 4.985)
- Positive delta seeds: 200/200
- Evolution comparison: selected policy and default policy reevaluated on the same seed with DEFAULT_WEIGHTS
- Isolated derivative evolution: 11 wins, 4 ties, 15 regressions across 30 runs
- Evolution mean delta (observed range): -0.014 (-8.805, 7.142)

## Current Teaching Evolution: Implementation Inventory

- Suite: teaching-behavior-v1 (sha256:98d08fa941d18a069ffd9d94a9e2b7e3ccfb6bb3c0a5e42ecae28b3068ae31d4)
- Cases / independent family labels: 18 / 18
- train: 6 cases, 6 families, 3 mathematics and 3 programming; 24 criteria, 8 critical
- validation: 6 cases, 6 families, 3 mathematics and 3 programming; 24 criteria, 6 critical
- holdout: 6 cases, 6 families, 3 mathematics and 3 programming; 24 criteria, 7 critical
- Planned tutor episodes for a complete one-repeat experiment: 30
- Independent assessment bank: fractions-loop-bounds-v1
- Inventory and code checks do not measure tutor performance.
- No live-provider results for the new loop or human learning results were collected for this paper.
