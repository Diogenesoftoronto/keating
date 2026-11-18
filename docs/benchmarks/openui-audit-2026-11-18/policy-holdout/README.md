# Fresh v2.1 tutor holdout

The current web draft gate sent three new, empty-history teaching prompts to each configured tutor. Four of six turns returned a completed candidate. MiniMax delivered the requested action on all three of its turns. Gemini returned a native page proposal on the bus turn. Google returned HTTP 503 on its other two requests.

| Predeclared case | MiniMax M2.7 Highspeed | Gemini 3.1 Flash-Lite |
| --- | --- | --- |
| Predict the next spinner result | Grouped Question with four choices and a write-in response, 26 words outside the interface. The gate removed the trailing sentence and reviewed the trimmed draft. The choices assume unspecified spinner proportions. | HTTP 503. The gate withheld the reply. |
| Change bus frequency, skip the quiz | Simulation with adjustable frequency and seat capacity, 98 outside words. At 40 seats per bus, changing 8 to 16 buses/hour doubles offered capacity from 320 to 640. The authored demand model puts spare seats at −44 and 212 respectively. | Approved native `interactive_page` proposal, zero text and zero compiled nodes. Its effect after tool execution is unknown. |
| Just the square’s perimeter | “16.”, one outside word. | HTTP 503. The gate withheld the reply. |

The requested interface appeared in two of three opportunities with a completed candidate. One more scheduled opportunity had no returned candidate. All three opportunities with a completed candidate received Jev’s interface offer in the tutor request. The direct-text instruction reached one completed candidate, which answered it correctly. The gate released all four completed candidates, including Gemini’s native proposal. The two failed HTTP requests produced no completed drafts. No browser mount, tool execution, learner interaction or learning outcome was measured.

## Reproduce the checks

From the repository root, run the receipts against the historical application sources with Bun and the existing dependencies.

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/verify-historical.mjs jev jev-resume
```

The command runs both original verification entrypoints with the archived planner, gate, prompt and export contract. It checks the frozen source hashes, schedule, journals and reused Jev responses, recompiles submitted and selected content with the application parser, and compares the two derived artifacts byte for byte. Keating’s arithmetic interpreter evaluates the authored Simulation expressions. [Reproduction method](../replay-source/README.md)

## Evidence and denominators

- [Frozen prompts and rubrics](cohort.json) and [manifest](manifest.json) record the exact schedule, release prompt and tool checksums, and source hashes for policy v2.1 and the provider transports. The gzip bundle contains the verified 4.2.0 system and tool export.
- [Portable diagnostic turns](turns.json) and [scored records](summary.json) give the six scheduled cells, four completed candidates, actual selected components and prose, and withheld outcomes. Model labels identify the configured actor on its official endpoint. The transport did not expose a distinct returned model-version field. Direct TypeSafe returned `jev-1.14.0` for every actual judgment.
- [Semantic ratings](adjudication.json) bind each completed, released reply to the predeclared case criteria and its exact selected text digest. The two HTTP failures have unknown learner fit. The four observed ratings include the native proposal as a failed immediate OpenUI delivery; a later application tool round was outside the study.
- Each tutor made one HTTP request per case. The web gate recorded three failed generation slots after each 503. The no-network-retry rule prevented the latter two slots from submitting another request. There were six tutor POSTs and eight Jev POSTs (four planning and four reviews). The same bus and perimeter plans served both tutors where the entire Jev request, including the state and all question definitions, hashed identically.
- The first [budget ledger](ledger.json) retains the first 503 reservation. The [budget-only amendment](budget-amendment.json) authorizes the four remaining untouched tutor requests and pins the first segment, including the original Gemini bus planning receipt. The [second ledger](segment-two-ledger.json) accounts for those requests and the second 503. Usage at conservative published list prices totals **$0.045513344**. Two missing usage records retain **$0.24**. The holdout upper bound is **$0.285513344**, bringing the all-study bound to **$1.121192398** against the original **$2** allowance. [Google pricing](https://aistudio.google.com/docs/pricing#gemini-3.1-flash-lite), [MiniMax pricing](https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise), [TypeSafe pricing](https://docs.typesafe.ai/models)
