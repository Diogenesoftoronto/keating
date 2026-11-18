# When does “correct” imply mastery?

**November 18, 2026.** Keating kept its existing mastery check. An additional Jev question could have released the 37-word confirmation that prompted this investigation. It helped only one of four other appropriate replies. The predeclared requirement was the archived confirmation and at least three other appropriate replies. [Fixed questions, cases and acceptance rule](cases.json) · [Results for all 15 replies](summary.json)

## The comparison

Jev 1.14.0 reviewed 15 synthetic candidate replies. The new question asked how far the tutor’s evaluation of the learner extended. Each request contained the ordinary candidate checks, the added question, the learner’s message and the proposed reply. Jev received the cases in fixed order without their names or expected outcomes. Each case was sent once. This was an evaluation of fixed candidate replies. [Exact input reconstruction](run.mjs) · [Provider responses and request digests](ledger.json)

| Condition | Appropriate replies that would pass, existing checks | Appropriate replies that would pass, proposed check | Inappropriate replies that would pass, existing → proposed |
| --- | ---: | ---: | ---: |
| Fresh provider scores | 1/5 | 2/5 | 0/10 → 0/10 |
| Uncertain mastery stress test | 0/5 | 2/5 | 0/10 → 0/10 |

For the stress test, the original classroom reply retained its original scores and used only the newly measured scope classification. The other 14 kept their fresh scores except for a fixed 0.50 on mastery. This isolated the behavior of the proposed rule when mastery was uncertain. A proposal could pass only if Jev gave at least 0.90 probability to feedback confined to this answer and every independent release requirement was met. The six replies that asserted broad competence, implied readiness for new work, predicted durable performance or awarded credit all fell below that item-only cutoff. [Predeclared labels and cutoffs](cases.json) · [Per-case scores and remaining blocks](summary.json)

## Why three good replies still stopped

- For a correct explanation of **Python list indexing**, Jev rated the scope as item-only at 0.97. Its separate check on the accuracy of the correction selected grounded correction at 0.57 with 0.46 confidence. That was below the existing 0.60 requirement.
- For a correct **spinner prediction**, Jev gave item-only scope probability 1.00. Its independent check flagged a repeated checkpoint at 0.65.
- For a correct **past-tense answer**, item-only scope received 0.88. The fresh review also gave 0.66 to a mastery overclaim, which is already a failing score. This proposal only examined an uncertain mastery finding. [Full judgments](ledger.json)

## What happened in the original classroom

The learner correctly predicted a round tile. The tutor’s private explanation gave 3/4 for round and 1/4 for square. All three of its comparative claims follow directly from the bag’s contents. It made no claim about skill on another problem and recorded no grade. The original review scored the learner’s attempt as answered at 0.95, grounded confirmation at 0.97 and an ignored learning gap at 0.03. It put mastery overclaim at 0.50 and continuing an unanswered checkpoint at 0.57. Those were the only release blockers. The repetition score of 0.42 was advisory on this turn. [Original third review and tutor reply](../openui-audit-2026-11-18/final-review/study/classroom-v2.3.8/ledger.json)

The new question gave that exact candidate item-only probability 1.00. Resolving the mastery uncertainty in the offline projection let the existing answered-item rule handle the continuation flag. The same test held an incorrect Python confirmation and a fabricated source even though Jev rated both as item-only with probabilities above 0.90. Scope and factual support measure different properties of a reply. [Archived and fresh projections](summary.json)

The 15 Jev requests reported usage. The estimated additional cost was **US$0.00416136**, bringing the cumulative study bound to **US$2.861363164**. The estimate uses the recorded input tokens. Provider billing was unavailable. [Request and cost ledger](ledger.json)

From the repository root, reproduce both comparisons from the saved responses with `rtk bun docs/benchmarks/jev-feedback-scope-2026-11-18/run.mjs --verify`.
