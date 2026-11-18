# A matched test of teaching interfaces

The primary study assigned each of four new learner prompts to MiniMax M2.7 Highspeed and Gemini 3.1 Flash-Lite in three conditions. Jev 1.14.0 and Gemini Decision 1 used the frozen application’s planning and review rules. In the unguided condition the tutor saw the same application system prompt and tool set and its first complete response became public directly. The 24 cells were interleaved in six blocks. The prompts, labels and order were written before the first request. [Frozen cases and rubrics](./cohort.json) · [Exact schedule and SHA-256 manifest](./manifest.json)

Compare **first drafts** to study how the additional guidance changed what the tutor wrote. The product also chooses reasoning effort in the guided condition. Compare **public replies** separately to include validation, optional repairs, withholding and best-effort selection. An unguided reply carries the disposition `ungated`. A guided reply can carry both `released` and an `unverified` review notice. The receipts retain these distinctions and every draft’s component types, tool proposals, accompanying text and review checks. Each model and prompt has one sample in each condition. [Sealed individual turn receipts](./receipts/)

Six later-turn slots use a fixed follow-up to the original paper-fold prediction. The continuation reproduces that arm’s actual public parent message. A withheld parent or a pending tool call leaves that continuation ineligible. The standalone stage-light case was reserved separately for a live, instrumented classroom. Only that case supplies evidence about mounting and operating an interface. A native tool call in the matrix is a proposal. [Continued prompt and classroom rubric](./cohort.json)

## What was frozen

The archive contains the v2.3.3 teaching policy, web product sources and Flue assets with hashes for 1,805 files. The runner restores those sources into an isolated temporary tree. Installed third-party packages come from the workspace identified by its archived package locks. The normal application exporter verified the exact system prompt and the 18 tool schemas. The complete system prompt was identical to the preceding study. The native interactive-page authoring description was the single tool-schema difference. [Source and dependency manifest](./product-v2.3.3.json) · [Portable source archive](./product-v2.3.3.tar.gz)

Every billable dispatch had an exclusive study lock and a durable pre-dispatch reservation under the same total authorization. The record stores a hash of the actual HTTP body and a compressed copy without authorization headers or URL query credentials. Decision receipts preserve the provider’s structured answers and probabilities. Tutor receipts preserve public text, native proposals, response hashes, usage and any model identifier supplied by the server. Private reasoning is excluded. Exact repeated decision bodies can share a result within one model. An unobserved charge retains the full reservation. Amounts use published or configured pricing and observed tokens. [Dispatch ledger](./ledger.json) · [Budget and receipt digests](./summary.json)

## Reproduce the evidence offline

The historical checks require the repository’s installed Bun dependencies. Both verification commands run without model credentials. The first restores the source snapshot and replays each matrix case through the actual web gate or the single-draft comparison. The second verifies the actual request bytes, provider and ledger identities, costs, receipt hashes and reservations. The classroom’s browser actions have separate evidence.

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/study/run.mjs --verify
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/study/verify-integrity.mjs
```
