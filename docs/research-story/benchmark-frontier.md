## When the answer is right and the help is wrong {#benchmark-frontier}

A learner asks for a nudge on `6x + 8 = 38`. The teacher gives the complete solution: `x = 5`. One turn later, the learner changes their mind and asks to see every operation and the substitution. Now that same complete solution is appropriate. The arithmetic has stayed still. The teaching requirement has moved.

That was the question behind Teaching v4.0: can a teacher change its help when the evidence changes? That frozen public challenge contains twelve cases, 73 learner messages and 59 judgments across ten families. Learners reverse preferences, correct source information, offer confident mistakes and ask what a successful attempt really establishes.

The v4.0 [checkpoint pilot](teaching-v4-pilot.json) exposed both behavior and execution problems. All twelve cases completed through real Pi with offline response tapes. With the saved feature-only and feature-plus-hindsight checkpoints, one of four scheduled slots completed. Sixteen actual provider samples produced 3,047 output tokens; none reached its maximum-token limit. Feature-only stopped after a malformed completion, then made no new sample in its later blocked slot. Feature-plus-hindsight completed one six-turn conversation and spent eight calls in the other case's tool loop.

![Completed turns and failed slots in the v4 pilot](teaching-v4-pilot.svg)

The complete conversation earned four of eight rubric points. It disclosed the answer too soon, handled the later request for a full solution correctly, and gave mixed feedback on a sign error. It then treated an assisted correction as evidence of a conceptual foundation. These are different failures to investigate; a single correctness score would hide them.

The surrounding application work makes those distinctions inspectable. A live interactive run delivered two questions and recorded two model-selected answers through the production submission handler. Another caught a clock mismatch: a generated document was dated slightly later than the receiver's clock, so submitting an answer made its updated timestamp invalid. Replaying the exact failed document verified a local repair that preserves the later time. The subsequent live run stopped earlier on malformed controls and actions.

![The captured clock mismatch and its local repair](native-document-clock.svg)

Source material can now enter that same path. Reviewers considered twelve source moments, converted eight multiple-choice screens from three families, and deferred four. One [actual curated scenario](frontier-example.json) completed source delivery, a recorded choice and tutor follow-up through real Pi offline. The original opening and document survived intact. The source screen remained context, separate from the teacher's generated words. The workbench below shows the exact source task and the resulting unanswered question. Missing or superseded screens were deferred.

The next use for a probe is to help us find what a benchmark misses. A probe is a small fitted classifier reading saved model measurements. The new [span inspection](probe-spans.html) revisits an older measured response about `63 − 28`. It assigns additive contributions to 49 exact observer-token positions. Their sum, together with the separate bias, reconstructs the saved premature-answer probability of **0.0836922507**, with zero recorded logit residual.

That gives reviewers something concrete to challenge: which visible words accompany a high score, which missed behavior deserves a criterion, and whether a false alarm comes from the request or response. Proposed additions should enter a separate candidate queue carrying the exact span, surrounding context, suspected failure and proposed judgment. Independent review comes before inclusion in a new benchmark version. The original v4.0 freeze remains unchanged. The separately versioned v4.1 dialogue revision follows in the next chapter.

The [historical completion audit](evidence-notes.html#earlier-gates), read alongside the newer results, leaves the research stages here:

| Stage | Current evidence | Next evidence needed |
| --- | --- | --- |
| 0 — Establish the contract | Twenty real-Pi plumbing traces, original token alignment and source labels, reproducible 9B extraction, and a new actual source-to-OpenUI receipt. | Twenty reviewed model-driven golden traces and qualified simulator use for the final study. |
| 1 — Learn one trustworthy readout | A 120-example authored corpus: 72 training, 24 calibration, 24 test. The SAE probe scored 23/24; raw activations 20/24, text 18/24. | The planned 600-example grouped study, a stronger text baseline and wider context-flipped negatives. |
| 2 — Validate intervention and simulator | Thirty generated outputs across six tasks and five conditions. Selected directions changed tokens without changing reviewed verdicts. | Complete independent intervention evaluation and simulator calibration against held-out actual responses. |
| 3 — Establish training baselines | F, S and F+S each completed one update on two actions and 37 target tokens. The earlier 64-response test preserved F/F+S verdicts; S lost one pass. | A qualified instruction-format warm start, more accepted examples and matched learning curves. |
| 4 — Combine, then make continual | The combined update ran. A sequential coordinator now has offline tests for update order, lineage and evaluation. | Live sequential topics, staleness and replay comparisons, retention gates and verified promotion/rollback. |

The [optional 27B observer and dictionary](https://huggingface.co/Qwen/SAE-Res-Qwen3.5-27B-W80K-L0_50) needs its own extraction and fitted probes. The [curriculum coordinator](evidence-notes.html#v4-extension) already orders topic updates and evaluations while keeping measurement fixed; its tested callbacks have not yet become a live multi-topic run. Inspect the actual records in the [benchmark diagnostics](benchmark-diagnostics.html) and [probe-span view](probe-spans.html).

The limits belong together. Offline tapes establish mechanics; scripted learners and automated reviews do not establish human learning, independent knowledge or lasting retention. This small, development-exposed pilot supplies no paired quality estimate. Token contributions explain a fitted score, not causal words or general teaching quality. No v4 probe measurement or 27B extraction is reported. The saved post-pilot reservation snapshot is **$68.30 reserved / $31.70 unallocated**, retaining the pilot's $4 allocation; these are reservations, not invoices. Browser delivery, live curriculum results remain separate work.

The next experiment should make a complete conversation easier to examine: the learner evidence available before teaching, the answer actually delivered, the action actually accepted, and the precise claim a reviewer can defend. Probe disagreements can then sharpen the next benchmark without changing the history of this one.
