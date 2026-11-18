# A corrected instruction in the live classroom

The v2.3.7 planning request contained the learner’s typed guess and evidence of the matching open Question. Jev indicated that a learner response was no longer due. The actual MiniMax request still said the learner had not answered. Replaying the exact saved request and Jev answers on v2.3.8 removed that contradiction. The preregistered replication then mounted the previous public Question in a fresh classroom and submitted the same learner answer once. This was a non-blind implementation check. [Original turn](../classroom-v2.3.7/README.md) · [Same-input proof](old-plan.json) · [Preregistration](cohort.json)

| Actual classroom outcome | v2.3.7 | v2.3.8 |
| --- | --- | --- |
| Original, incorrect instruction in tutor requests | 1 of 1 | 0 of 3 |
| Physical tutor generations | 1 | 3 |
| Completed and reviewed drafts | 0 | 3 |
| Teaching replies shown | 0 | 0 |
| Immediate reason | The first generation hit the 3,072-token cap. The study bridge closed further transport. | All three complete candidates were reviewed. None passed. |

On v2.3.8, the fresh Jev plan put the probability that a response was still due at 0.20. All three real tutor requests told MiniMax to address the typed attempt, give concise feedback and stop unless the learner asked for another action. The first draft added an unrequested Question. The second offered a simulation after a long explanation. The third gave a correct 37-word confirmation and stopped. Jev put the probability of an answered attempt at 0.95 and grounded confirmation at 0.97. Its critical mastery-overclaim check was still uncertain at 0.50, and its checkpoint-continuation check was uncertain at 0.57. The learner saw “Couldn't produce a reply.” [Exact candidates and checks](receipts/classroom-tile-linked-feedback--minimax--jev.json) · [Browser evidence](../../classroom/linked-tile-confirm/evidence.json)

The earlier frozen-input replay demonstrates removal of the erroneous instruction. The two live observations show what happened to the same learner prompt in separate classrooms with independent model generations. Both were withheld, for different reasons. Seven metered requests added US$0.029663970 in the final phase and brought the all-study conservative bound to **US$2.773199680**. [Exact request comparison](comparison.json) · [Ledger](ledger.json) · [Final cumulative accounting](summary.json)

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/study/classroom-v2.3.8/old-plan.mjs --verify
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/study/classroom-v2.3.8/run.mjs --verify
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/study/classroom-v2.3.8/compare.mjs --verify
```
