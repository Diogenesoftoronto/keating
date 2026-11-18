# Two pairs of tutor replies in the classroom

On November 18, 2026, two synthetic learners used Keating’s ordinary web draft gate with MiniMax M2.7 Highspeed and Jev 1.14.0. The first typed an answer to the same open tile-bag Question that had stalled in the previous release. The second asked for copper’s chemical symbol. Both went through the composer, review, publication, renderer and Settings export in a fresh Chromium classroom. [Results](summary.json) · [Importable Settings recording](settings-export.json)

| Learner turn | Completed private replies | Overlap across all four tutor requests | Overlap of Jev’s two pair reviews | What the learner saw |
| --- | ---: | ---: | ---: | --- |
| “My guess is round, because three of the four tiles are round.” | 4 | 5,807 ms | 58 ms | A withheld-reply notice after 11.913 seconds |
| “What is the chemical symbol for copper? Just the symbol, please.” | 4 | 1,084 ms | 86 ms | **Cu** after 6.185 seconds |

Each row used four physical tutor calls. For the tile answer, MiniMax produced four different candidates. Three confirmed the correct probability and added another simulation. The fourth proposed two tools and contained no visible feedback. Jev preferred candidates 1 and 4 within their respective pairs. Individual checks left both pairs without an eligible finalist. The same learner also saw a withheld notice in the earlier three-draft run. [New gate receipt and visible reply](typed-tile-answer.json) · [Earlier check](../openui-audit-2026-11-18/final-review/study/classroom-v2.3.8/README.md)

On copper, all four independent calls produced the same two characters. All four passed their individual reviews. Jev preferred candidates 1 and 3 in their pairs and selected candidate 1 in the final comparison. The transcript contained one answer and no tool calls. [Copper gate receipt and visible reply](copper-symbol.json)

The recorder timed each HTTP request from dispatch through receipt of the complete response body. It captured eight tutor generations, eight individual reviews, four pair comparisons, two planning requests and one final comparison. All 23 returned usage. Counting cached MiniMax input at the full input rate gives an upper estimate of **US$0.084002124**, bringing the cumulative study estimate to **US$2.857201804** under the US$10 authorization. Actual invoice charges are unknown. [Transport ledger](ledger.json) · [MiniMax prices](https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise) · [Jev prices](https://docs.typesafe.ai/models)

## Reproduce the checks

From the repository root, verify the hashes of the captured requests, the answers offered to Jev, the pair choices, the publication and the content-free Settings export. This command sends zero provider requests.

~~~sh
rtk bun scripts/openui-diagnostics/probe-jev-pairs.mjs --verify docs/benchmarks/jev-parallel-pairs-2026-11-18
~~~

The browser preflight mounts the prior Question and uses saved review fixtures and a local pair-choice double. It checks the current default, concurrent dispatch and the exported pair rows without paying for inference.

~~~sh
rtk bun scripts/openui-diagnostics/probe-jev-pairs.mjs --preflight
~~~

An authorized fresh run uses `--run <new-directory>` with the configured MiniMax credential and `TYPESAFE_API_KEY`. The probe fixes the synthetic prompts, temperature at zero and the output limit at 3,072 tokens. It reserves funds before each physical call, disables HTTP retries and retains the reservation whenever usage is unavailable. The per-run ceiling is US$1.25. The ledger contains the exact source digests, provider request bodies by hash, sanitized tutor messages and typed Jev answers. These two observations establish how the workflow ran on these prompts. Real-learner success rates remain unmeasured.
