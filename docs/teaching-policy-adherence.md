# Keating prompt decisions and adherence benchmark

The compact path moves teaching decisions out of the long instruction block into typed Jev judgments. It leaves a short identity/interaction contract with the tutor, selects instructions for the current turn in code, and checks each private draft before publication. The web Flue chat stream now uses this gate; the source prompt snapshots and independent teaching-revision activation rules remain intact. The benchmark compares the original prompt, the compact alternative, and the full drafting loop.

The source of truth is [`teaching-policy-catalog.ts`](../packages/learner-contracts/src/judgement/teaching-policy-catalog.ts). Every question records the source prompt section. To print the complete breakdown without credentials or network access:

```sh
rtk bun scripts/prompt-adherence/describe-policy.ts
```

The current web persona and operational protocol supply the interaction rules. `SYSTEM.md` supplies additional subject-specific requirements. The benchmark adds those subject requirements equally to every arm, and freezes the actual web prompt and OpenUI grammar with the existing runtime-checked exporter. It does not substitute an invented shorter control prompt.

```mermaid
flowchart LR
  T[Observed turn and evidence] --> J[One Jev input batch]
  J --> D[Code selects turn instructions]
  D --> M[Compact prompt and tutor model]
  T --> R[Jev rule and quality batch]
  M --> R
  M --> C[UI parser and tool checks]
  C --> V{Mandatory checks pass?}
  R --> V
  V -->|Mandatory failure or uncertainty| F[Code-owned repair feedback]
  F -->|Attempt budget remains| M
  V -->|Pass| S[Jev chooses an approved draft]
  S --> P[Publish exact reviewed content]
```

For example, “teach for mastery” becomes separate questions: did the learner actually attempt the task; is there evidence of unaided success; does the response overclaim mastery; does it overclaim delayed retention; does it overclaim transfer to a new context? None of those answers can substitute for the others. A correct assisted answer does not establish the final three outcomes.

“Wait for the learner” is also decomposed: did the response disclose the answer; did it repeat the question in prose; did it advance the lesson past an unanswered checkpoint? Code separately checks that OpenUI parses, that there is one checkpoint, that the checkpoint is the final component, and that nothing follows its fence.

“Use sources” separates the need for fresh evidence, missing direct links, and claims that contradict supplied evidence. These checks do not establish the truth of arbitrary claims outside the supplied evidence. Domain questions separately check jurisdiction, legal authority, clinical guideline versus individual study, primary-source attribution, temporal sequence, replication status, normative versus descriptive claims, and other narrow obligations.

## Composition and evidence

All independent input questions are asked together. One interaction feature is gated: code asks `concrete_quantity` only when the learner message, recent conversation or plan focus carries an early-number, fraction or time cue, or the turn names a young learner ([`early-learning-cues.ts`](../packages/learner-contracts/src/judgement/early-learning-cues.ts)). A turn without a cue sends the same request as before the question existed, so recorded planning evidence stays replayable; an unasked feature is unknown, not false. Each receives the observed learner message, conversation, sources, tool receipts, and learner evidence. Question IDs, benchmark labels, model names, experiment arms, and expected answers cannot guide inference. Output checks see the response and the same observations; they cannot see the predecision result.

Most primitives are Nouls: the probability that one proposition holds. Input `true` selects a particular instruction. Output `true` means a violation. Code uses explicit provisional cutoffs of 0.4 and 0.6; the middle is unknown, and an unknown on a review rule blocks release like a fail. Tool permissions keep a stricter 0.8 cutoff: a lean is enough to change teaching, not to unlock an action. Choice primitives select reasoning effort, response depth, and an approved draft. There is no separate Noul confidence value. Missing, malformed, unavailable, or oversized judgments remain unknown. Raw probabilities are retained so future calibration does not require rerunning unchanged requests.

The report does not average away a critical violation. A response with any failed check fails; an otherwise passing response with an unresolved check is unknown. A completely passing response is an uncalibrated adherence estimate, not proof of good teaching. The predecision stage ignores uncertainty on unused branches while withholding optional actions that lack positive evidence.

Tool names, argument schemas, counts, parser validity, and the existence of submitted grading evidence belong in code. The benchmark records proposed tool calls and validates their structure. It does not execute workspace operations, persist a learner profile, grade real submissions, or claim a proposed tool call succeeded. Runtime authorization, exact evidence-ID correlation, and independent teaching-revision activation gates remain mandatory at the host boundary.

## Experimental comparison

The four arms are:

| Arm | Generation instructions | Jev input decisions | Blinded reply assessment |
| --- | --- | --- | --- |
| `full` | Frozen current web prompt, shared domain supplement, OpenUI grammar | No | Yes |
| `compact` | Compact contract, shared domain supplement, same grammar | No | Yes |
| `governed` | Compact contract plus selected turn instructions, shared supplement, same grammar | Yes | Yes |
| `drafted` | Governed private drafts with adaptive effort, rule feedback, and selection | Yes, plus per-draft checks | Yes, an independent call on released content |

The compact-only arm isolates the effect of shortening the prompt from the effect of Jev's decisions. The drafted arm includes every retry and selector call in latency and usage; withholding a response is an abstention, never a passing answer. Every arm has the same tool schemas and observed case evidence. The model under test is selected explicitly; OpenAI/Anthropic identities, including reseller versions and unresolved routing aliases, are rejected. An OpenAI-compatible or Anthropic-compatible wire protocol does not itself make a Qwen or MiniMax model ineligible.

Actor cases and contrastive judge fixtures keep whole families in either development or holdout. Judge fixtures compare a compliant and violating response to the same observed turn, with one narrow label per pair. Their labels are authored examples, not independently adjudicated human evidence. No thresholds are fitted on holdout results. Published holdout examples can become training contamination over time; renew the families before using them for a release decision.

Record failures and abstentions in the denominator. Inspect per-rule coverage, rule-level uncertainty, judge false positives/negatives, Brier error, and paired case outcomes before considering an aggregate number. Not every rule has independent fixture coverage; the report exposes missing coverage. Checkpoints with syntactically valid UI still need semantic checks for answer leakage and relevant content.

Latency includes actual elapsed time for input judgment, generation, output judgment, and the complete checked turn. Compare matched model/case/repetition pairs. Report generation-only time separately so a shorter prompt cannot hide additional sequential requests. Provider-reported input/output/cache tokens are recorded; absent usage and cost remain unknown. There is no fixed assumption that adding Jev is faster or cheaper. Small samples, provider queuing, caching, output-length differences, and transport failures limit any speed comparison.

## Run and inspect

Use `rtk bun scripts/prompt-adherence/cli.ts --help` for current options. The default/dry-run path performs no inference. Live runs require explicit model selection and credentials for those providers and for Jev. The CLI uses the existing private credential paths; credentials never enter report artifacts.

Reports and raw receipts live under `.keating/benchmarks/prompt-adherence/`. Keep these generated artifacts out of commits. The CLI can also evaluate the judge fixtures independently of the actor matrix.

## Web draft publication

`web/src/keating/judgement/draft-gate.ts` wraps the innermost model stream, after the normal memory, recall, and teaching-adjustment layers have prepared context. It buffers text, reasoning, and proposed tool calls. Rejected tool proposals are never executed. Structurally usable text can be displayed and saved through best-effort recovery even when semantic checks reject it. Provider failures yield a fixed application message, not partial model content or raw errors.

The shared `runTeachingDrafts` controller bounds one drafting round to ten attempts. Web chat supplies a 90-second deadline and the mobile teaching adapter supplies 120 seconds. A tool result starts a new round within the same learner turn.

In ordinary hosted chat the tutor starts two independent drafts together. Each has a stable attempt number. The checker reviews completed candidates as they arrive, and Jev compares the eligible ones. The app executes tool proposals from the selected candidate. Models with provider-native search can still use that capability during drafting. On-device generation uses a single lane. The shared controller also supports ordered generation for benchmark callers.

When a checked alternative already covers a missing request, Keating can release it immediately. When the chosen prose answers part of the request and an explicit part still needs an addition, Keating can show that approved opening while the tutor writes the missing part. The checker reviews the opening and addition together. If the addition fails review or runs out of time, the opening stands. Receipts distinguish the parallel attempts, the source of a repair, and the attempt actually shown. Stopping a web reply after the opening keeps that opening and its review on the message.

If both opening candidates miss mandatory requirements, a later attempt targets the outstanding checks from one candidate. Usable text can still release with a best-effort notice. If neither candidate is usable, recovery can continue within the original budget with tools disabled. Structural checks, host authorization and cancellation apply throughout.

Executable-code planning can narrow an unknown domain to code. Evidence-integrity rules also apply when the domain stays unknown. For search-only steps the checker reviews the proposed calls. It checks the resulting factual claims on the learner-facing answer, with excerpts from observed results and priority for URLs that answer cites. Receipts retain the raw probabilities and distinguish failed, inconclusive and passing checks.

Longer comparison and synthesis require the explicit host option `refinement: "extended"`, also capped at ten attempts. The benchmark opts into extended mode when its requested budget exceeds three. It can compare complementary eligible prose and review a merged response. Selection failures retain the best completed candidate; text-only best effort remains available after exhaustion. Complete candidates are never silently clipped.

The controller snapshots provider output before review. The host reconstructs publication solely from the reviewed text and tool arguments, retaining only necessary native protocol metadata. Private reasoning blocks are discarded. Repair context contains failed/uncertain rule IDs, probabilities, and code-owned corrective criteria; it contains no rejected draft text.

The UI shows preparing, drafting, checking, revising, and selection progress. Users can inspect a plain-language explanation and record helpful/too-strict/missed-problem feedback. Developer details expose rule probabilities, per-attempt timing, reasoning effort, selected standard, and reviewer identity. This bounded in-memory record contains no draft, learner text, source snippets, or tool arguments. Feedback stays in the tab and can be copied with the review; it does not claim delivery to a support service.

The gate honors the existing independent judgement model privacy setting (`off`, `local`, or `hosted`), concrete reviewer identity, account authentication, and server credential boundary. It never silently enables hosted inference. If no permitted reviewer is available, it withholds generation and gives a setup action. Hosted review may send the observed conversation and candidate to the configured service; the optional raw diagnostic observer is suppressed for these private calls.

The web/desktop Flue text-chat stream and the mobile native request-round adapter use the shared controller for typed chat. Direct realtime voice and CLI/Pi use separate paths. For image blocks and opaque audio attachments, the UI asks for text or a transcript that the reviewer can inspect.

Each planning, review, and comparison request starts with the full conversation and current learner message. A request that fits exactly keeps all its history. When multiple reviewers are enabled, each planning attempt uses that reviewer’s own limits. The reviewer that completes planning also checks and compares the drafts.

If only the review questions exceed the request limit, Keating splits them into batches with the same state. If even a single question would exceed the configured token or transport limit with that state, Keating removes the fewest complete old turns needed. It uses the space left for excerpts from the first two displaced learner messages, up to 320 Unicode characters each. The current message, active work, supplied evidence, and drafts stay complete. If the observed search passages alone prevent review, Keating tries shorter passages, prioritizes cited URLs, and checks the full history again. Token sizes are estimates. Receipts record the sizes sent and the history removed for each review.

The portable APIs are exported from `@keating/learner-contracts`:

```ts
const input = teachingPolicyDecisionRequest(turn);
const plan = projectTeachingPolicyDecision(turn, await judge(input));
const prompt = buildCompactTeachingPrompt(plan); // append the actual UI grammar
const reply = await generate({ prompt, turn }); // injected model; host-owned tools
const request = teachingPolicyAdherenceRequest(turn, reply);
const result = assessTeachingPolicyAdherence(turn, reply, request ? await judge(request) : null);
// For publication, runTeachingDrafts adds private generation, repair, and selection.
// Mandatory failure/uncertainty cannot authorize release; advisory statuses remain in receipts.
```

The benchmark proves only what its actual receipts show: response adherence estimates and observed service latency for the specified models and cases. Human learning, real tool execution, deployed behavior, and teaching-revision activation are outside this experiment. The separate [Not Organic handoff](notorganic-judgement-allowance-handoff.md) requests a lifetime **5,000 microUSD ($0.005) per-account** judgement allowance; it is not implemented or funded by Keating's browser.

Design references: [TypeSafe HTTP contract](https://docs.typesafe.ai/api), [narrow Noul questions](https://docs.typesafe.ai/primitives/noul), [parallel question composition](https://docs.typesafe.ai/patterns/fan-out), and [input/output guardrail composition](https://docs.typesafe.ai/cookbooks/llm_guardrails). The implementation reuses Keating's existing TypeSafe transport.
