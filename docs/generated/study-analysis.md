# Study Analysis

## Protocol

- Keating version: 3.3.0
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

## Synthetic Benchmark

- Policy under analysis: me-candidate-33
- Full-suite delta versus default across 200 seeds: 3.982 (3.039, 4.985)
- Positive delta seeds: 200/200
- Evolution comparison: selected policy and default policy reevaluated on the same seed with DEFAULT_WEIGHTS
- Isolated derivative evolution: 11 wins, 4 ties, 15 regressions across 30 runs
- Evolution mean delta (observed range): -0.014 (-8.805, 7.142)
