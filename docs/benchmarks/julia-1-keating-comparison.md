# Julia-1 on Keating’s frozen multilingual decisions

The shipped **approximately 144M-parameter Julia-1 decision model is experimental**. It completed all 300 CPU requests and 9,132 outputs, but reached **346/972 correct labels (35.6%)** under the strict policy and **457/972 (47.0%)** under literal argmax. Jev reached 914/972 and Kev 9B 820/972 on the retained tapes. These results do not support replacing either with Julia as the default judge. Julia is separate from the multi-billion-parameter generative offline tutors.

## What was measured

This adds one actual local CPU run to the twelve retained model tapes from [the multilingual comparison](keating-multilingual-judgements.md). It does not rerun hosted or GPU providers. Each model has the same 300 planned requests, 9,132 question outputs and 972 authored assertions across English, Spanish, French, Arabic, Hindi and Simplified Chinese. The other 8,160 outputs have no accuracy claim. The six translations share 25 source families; they are correlated variants, not 150 independent tasks.

The frozen comparison-plan hash is `53857b3ea5f8dc97d3a32c7542419a806923db3a689b28a23f4fb2947b479c37`. All state evidence, question text, criteria, candidate order, labels and request hashes remain unchanged. The inference input is retained separately without expected labels or rationales. The existing translation review was model-assisted, not native-speaker validation, and the question contracts and evidence option IDs remain English.

Julia uses the shipped, unquantized FP32 [Julia-1 ONNX artifact](https://huggingface.co/SupersonicLabs/Julia-1-ONNX), revision `82a2fadf8fccfccdc5fd4e1009ba8f1a265eb7a8`, with ONNX Runtime 1.29.0 CPU, four threads and microbatches of eight decisions. The benchmark declares 8,192 total tokens and a 512-token head. These differ from the packaged desktop/browser 2,048/512 and phone 1,024/256 defaults; this experiment does not establish phone latency or accuracy under those smaller budgets.

The protocol identity is:

```text
SupersonicLabs/Julia-1-ONNX@82a2fadf8fccfccdc5fd4e1009ba8f1a265eb7a8/keating-scorer-v1/ort-1.29.0-cpu/tokenizers-0.1.3-metaspace-split-strict-v1/context8192-head512/threads4
```

The run began before identities included encoder and context limits. Its append-only receipts retain the earlier identity, and `identity-amendment.json` and its explicitly chained `identity-amendment-v2.json` map that identity to the complete descriptor above, including four inference threads. No inputs, tensor hashes, measurements or decoded values were changed, and no inference was repeated for this amendment.

The Keating adapter uses the strict Rust-compatible encoder and compact, sorted evidence JSON. The original published Python implementation uses a different JSON serialization. The retained official-adapter controls in this report cover 22 exact Rust-encoder fixtures. The expanded 121-fixture tokenizer suite is a separate validation set and is not included in these benchmark artifacts. Neither establishes original-Python prediction parity across all benchmark requests. Nullable Choice descriptions fall back to their existing candidate key. This affects the 60 evidence questions whose descriptions are null: the same original sentence IDs become option text, without inventing new descriptions or changing the frozen requests. The comparison measures this shipped Keating adapter, not a reproduction of the vendor’s separate benchmark.

## Decisions and denominators

The primary result retains Keating’s strict Noul policy: false at probability ≤0.2, true at ≥0.8, otherwise abstain. The diagnostic column forces Noul classification at a fixed 0.5 cutoff: false at ≤0.5 and true above it. Choice and Score use the modal option in both columns. Score’s raw expected mean is also retained but does not determine the benchmark answer. An audit of all 5,037 successful Score outputs in the twelve saved baselines found zero nonmodal decoded values, so Julia uses the same policy.

Every model retains 972 planned authored labels, including missing, failed and abstaining responses. The 852 boolean assertions, 60 ordinal grading levels and 60 exact evidence selections are reported separately. An abstention does not become a correct answer by removing it from the denominator. Probabilities from the new Julia run are retained at full JavaScript numeric precision; the historical tapes keep their originally saved precision, which cannot be recovered where rounded.

| Model | Strict / 972 | Abstentions | Argmax / 972 | Boolean balanced accuracy | Grade / 60 | Evidence / 60 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Jev 1.13.0 | 865 | 69 | 914 | 95.6% | 49 | 60 |
| CLM multilingual | 81 | 727 | 472 | 55.5% | 15 | 1 |
| Kev 0.5B | 235 | 548 | 560 | 46.0% | 17 | 48 |
| Kev 0.6B | 301 | 471 | 594 | 62.5% | 21 | 42 |
| Kev 0.8B | 88 | 797 | 601 | 64.7% | 24 | 38 |
| Kev 4B / Qwen3 | 530 | 330 | 738 | 75.2% | 37 | 43 |
| Kev 4B / Qwen3.5 | 273 | 651 | 762 | 80.2% | 41 | 39 |
| Kev 8B | 601 | 259 | 741 | 74.6% | 40 | 41 |
| Kev 9B | 618 | 298 | 820 | 85.6% | 40 | 54 |
| Laya English | 64 | 791 | 370 | 48.5% | 13 | 18 |
| Laya typed-decisions | 45 | 852 | 443 | 47.7% | 23 | 22 |
| Laya multilingual | 200 | 342 | 353 | 46.7% | 24 | 6 |
| Julia-1 FP32 CPU (~144M) | 346 | 238 | 457 | 43.0% | 14 | 32 |

Julia’s literal argmax is **411/852 boolean, 14/60 ordinal grading and 32/60 evidence**, totalling **457/972 (47.016%)**. All 9,132 outputs were examined, with zero exact maximum ties, including zero on labelled outputs. The rule takes the first option in the frozen order on exact ties. These measured counts equal the fixed 0.5 diagnostic here; that equivalence was checked, not assumed. The aggregate argmax counts also match the fixed-policy counts for every retained baseline. Their saved rounded probabilities can create ties, so this does not recover unrounded baseline outputs.

The evidence controls are 30/60 for always choosing the first candidate and an expected 20/60 for uniform random choice. Julia’s 32/60 evidence selections are only two above the first-candidate control. One historical Jev response-validation failure remains in its planned denominator; Julia has none.

### Correct labels per language, out of 162

| Model / policy | English | Spanish | French | Arabic | Hindi | Chinese |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Julia strict | 45 | 60 | 73 | 56 | 62 | 50 |
| Julia argmax | 68 | 75 | 85 | 76 | 77 | 76 |
| Jev argmax | 154 | 150 | 154 | 151 | 153 | 152 |
| Kev 9B argmax | 139 | 134 | 140 | 138 | 132 | 137 |

### Concrete failure boundaries

In the English JavaScript planning example, the learner says `const` freezes every array element, while the supplied reference explains that `push` can mutate the array. The authored `misconception_visible` label is true. Julia assigns it only **0.001295** probability and returns false. This is a confident failure, not an abstention caused by the strict cutoff.

In the osmosis grading example, the learner correctly explains water moving from dilute A toward the more concentrated B. Julia selects the correct supporting sentence with **0.998814** probability, but gives grading level **0** with **0.745156** probability instead of the authored level **4**. Successful evidence selection does not imply successful grading.

## Observed CPU cost

The 300-request sweep returned **4.846 question outputs/s** and **0.1592 request batches/s** over **1884.347 seconds** of summed scoring attempts. Recorded wall elapsed was **1885.308 seconds** (31.42 minutes).

| Sweep batch metric | Milliseconds |
| --- | ---: |
| Median | 6038.55 |
| p90 | 10998.37 |
| p95 | 13510.86 |
| p99 | 22608.10 |
| Minimum | 235.62 |
| Maximum | 42204.64 |
| First batch, including lazy loading | 6475.54 |

Percentiles use nearest rank; the median averages the middle two observations. Requests contain 60 batches of 2 questions, 108 of 35, 60 of 39, 60 of 40 and 12 of 41. Mean batch size is 30.44 questions; median is 35. The eight-row inference microbatches required 1,272 model calls. These batch latencies are **not single-question latencies**. A separate cold-load duration and peak RSS were not recorded for this sweep.

The development machine also ran root/web builds, graph indexing, and briefly Android compilation and browser work during the sweep. The measured timings include that contention and are not an isolated hardware benchmark.

### Separate warm single-question probe

After the Python control exited, with root builds deliberately idle, a fresh Node process used the packaged **2,048/head512, four-thread** runtime. It selected the shortest and longest frozen encoded questions using label-free inputs: 138 tokens in the Chinese garden-goal planning example, and 664 tokens in the Hindi map-scale planning example. Each row received one scoring warmup followed by 20 measured batch-one repetitions.

| Warm scoring metric | Short, 138 tokens | Long, 664 tokens |
| --- | ---: | ---: |
| Mean ms | 69.32 | 398.16 |
| Median ms | 65.85 | 395.70 |
| p90 ms | 80.01 | 431.06 |
| p95 ms | 80.58 | 431.83 |
| p99 ms | 83.66 | 438.90 |
| Minimum ms | 63.25 | 360.00 |
| Maximum ms | 83.66 | 438.90 |

Measured sequential scoring throughput was **14.425 judgements/s** for the short row and **2.512 judgements/s** for the long row, computed as 20 divided by summed scoring seconds, rather than the inverse median.

Encoding-only medians were 0.667 and 0.679 ms. Cold encode plus graph/tokenizer loading took **1680.86 ms**; cached-artifact verification before it took 550.78 ms. The public runtime API does not expose a load-only or inference-only timer: scoring includes its mandatory re-encoding.

Actual complete-process peak RSS was **735,456 KiB = 718.22 MiB**, measured with Node’s `process.resourceUsage().maxRSS` in this fresh Linux process. The downloadable files occupy **614,135,099 bytes (614.14 MB / 585.68 MiB)** on disk; disk size is not RAM use. The peak includes the tokenizer, ONNX session and harness. No phone RAM, battery or timing inference follows from this desktop measurement. OS isolation was not established.

Independent reconstruction checked **all 9,132 encoding hashes**. Every encoded request was identical under the benchmark 8,192/512, packaged desktop/browser 2,048/512 and phone 1,024/256 budgets, with zero rejected contexts and a maximum of 664 tokens. This establishes encoding/budget compatibility for these fixtures, not actual mobile or browser-runtime numerical parity.

Julia ran on an Intel Core i7-1260P with four inference threads. Timings include strict full-context preflight, tokenization and inference. They exclude downloading weights, and the first request additionally includes lazy tokenizer/session loading. Question outputs per second divide completed outputs by summed attempt durations; this is not concurrent saturation throughput. The historical native baselines ran on an A40, and Jev includes hosted HTTP serving. Different hardware, transport and startup boundaries make these observed timings unsuitable for a matched-efficiency ranking.

## Interpretation and limits

### Original Python and official adapter controls

Read-only audit confirms the official qtype mapping (Choice 0, Score 1, Noul 2), marker positions, option order, eight-token padding, int64/bool feeds and ragged logit extraction. Against the official ONNX wrapper on the same CPU graph, 13 vendor Choice fixtures plus nine mixed-type fixtures produced exact encoder matches and **zero softmax difference**. No extra activation or temperature was missing.

A separate original-checkpoint control loaded **`SupersonicLabs/Julia-1@a85b127321d580d65176c89ced8273f305745d85`** through the unmodified published `TransformerEngine`, CPU FP32, four threads, 8,192/head512 and eight-row microbatches. `model.safetensors` is 577,189,056 bytes, SHA-256 `df853bf7fe424420011f3d0c47a05d7341aa9eefa7fb9f203ea4aada4ad95b72`. All 170 stored tensors are F32, containing 144,292,870 scalar values. The control used Python 3.13.15, PyTorch 2.9.0+cu128 on **CPU**, Transformers 5.0.0, tokenizers 0.22.2 and safetensors 0.8.0. Source files and dependencies are pinned or recorded in the compact evidence; the project environment was not changed.

The five predeclared batches were the first English planning, adherence and grading trials, plus French planning and Hindi adherence. They contain 154 question outputs and 16 authored labels from three shared families. Each ran twice: with original Python JSON serialization and with the shipped compact sorted serialization.

| Small original FP32 control | Identical shipped encodings / 154 | Argmax labels / 16 |
| --- | ---: | ---: |
| Published Python JSON | 0 | 8 |
| Shipped compact sorted JSON | 154 | 7 |

With identical compact encodings, original FP32 probabilities differed from ONNX by at most **0.000027681**, and all **154 argmax decisions matched**. The exact billing preview also returned Billing at **85.447%**, matching the browser result. This control does not identify a feed, qtype or missing-temperature bug in the shipped adapter.

Serialization still matters: original Python formatting changed 54/154 argmax outputs, including 5/16 labelled outputs, and the maximum probability difference was 0.997074. Both serializations performed poorly on this small selected subset. This is **not a full original-Python sweep**, and it does not establish model-quality parity across the full comparison. No favorable rerun replaced the main results.

Julia’s small footprint and measured warm single-question execution make it an available local experiment. Its **43.0% boolean balanced accuracy**, weak ordinal grading and confident misconception failures make it unsuitable for a claim of equivalent judging quality. The existing strict thresholds abstain on 238 labels, but removing the thresholds does not resolve the accuracy gap. Treat its local decisions as experimental suggestions, with review where correctness matters. The full original runtime has not been independently rebenchmarked.

These are authored synthetic teaching episodes, not evidence of human learning, retention or transfer. Evidence accuracy means selecting the authored sentence ID; it does not demonstrate citation grounding in arbitrary documents. The family bootstrap in the machine report resamples the 25 shared families across all six languages, preserving that correlation. Its intervals are descriptive and unadjusted for twelve comparisons. Vendor benchmark figures are external claims and are not substituted for this run’s measurements.

The next useful check is a separate evaluation of the packaged phone budgets on unseen, native-speaker-reviewed learner examples, with actual phone timing and a predeclared decision policy. Success would mean useful calibrated decisions, reliable evidence selection, and acceptable on-device latency. This benchmark alone does not establish those outcomes.

## Evidence and reproduction

The local artifacts are under `.keating/benchmarks/context-window/multilingual-v1/execution/julia-1-onnx-cpu/` and remain outside Git:

- `plan.json` and `gold-free-input.json`: complete frozen schedule and inference inputs.
- `run.json`, `runner.mjs` and both identity amendments: actual runtime, bundle hash and precise protocol identity.
- `receipts.jsonl`: all raw probabilities, decoded values, timings and per-question strict context proofs.
- `completion.json`, `audit.json`, `context-audit.json`, `baseline-score-policy-audit.json`, `diagnostics.json` and `comparison-report.json`: schedule completion, integrity checks, policy audit and full results.

Executed sweep bundle SHA-256: `146d07d4398398dd9f7d19d4f927183059606411a4ff0bfe0124accc583a83dd`. Full raw Julia tape SHA-256: `cd8cb9b3799784a5faf68b1af34096b9f068a0255d7db2dc28f17022d2a65e9f`. The compact JSON records byte counts and hashes for all twelve retained tapes, the control and warm-probe artifacts, model files, source revisions and identity amendments.

The tracked [compact JSON evidence](julia-1-keating-comparison.json) retains all model/language results, source revisions and hashes for the exact local raw artifacts.

The source harnesses are [julia-benchmark.ts](../../scripts/context-window/julia-benchmark.ts), [julia-audit.ts](../../scripts/context-window/julia-audit.ts) and [julia-report.ts](../../scripts/context-window/julia-report.ts). For a fresh output directory, bundle the CPU runner with Bun and run it with Node, keeping the existing verified weights directory as the third argument. Audit and report generation call no models. The context audit also reconstructs saved encodings independently and checks the packaged budgets:

```sh
rtk proxy bun build scripts/context-window/julia-benchmark.ts --target node --packages external --outfile <new-output>/runner.mjs
rtk proxy node <new-output>/runner.mjs .keating/benchmarks/context-window/multilingual-v1/comparison-plan.json <new-output> <verified-weights-directory>
rtk proxy bun scripts/context-window/julia-audit.ts .keating/benchmarks/context-window/multilingual-v1/comparison-plan.json <new-output> <new-output>/audit.json
rtk proxy bun scripts/context-window/julia-context-audit.ts .keating/benchmarks/context-window/multilingual-v1/comparison-plan.json <new-output> <verified-weights-directory> <new-output>/context-audit.json
rtk proxy bun scripts/context-window/julia-report.ts .keating/benchmarks/context-window/multilingual-v1/comparison-plan.json <new-output> <new-output>/comparison-report.json
```

Additional diagnostic sources are [julia-diagnostics.py](../../scripts/context-window/julia-diagnostics.py), [julia-python-control.py](../../scripts/context-window/julia-python-control.py) and [julia-warm-probe.ts](../../scripts/context-window/julia-warm-probe.ts). The original-checkpoint control requires the published Python dependencies; the warm probe must be bundled for Node like the main runner. Both write to separate artifact directories. `python-control/` retains full original logits, probabilities and source hashes; `warm-probe/` retains the executed bundle and all timing repetitions. The official adapter audit artifacts are also retained beside the main tape.

For an existing completed tape, run only the audit and report commands. The harness preserves recorded failures instead of retrying until a favorable answer appears. No full original-Python sweep, paid rerun, Android/iOS inference timing or real-device benchmark is claimed.
