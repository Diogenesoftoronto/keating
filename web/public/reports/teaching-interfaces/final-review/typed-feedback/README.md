# Feedback after a learner types a prediction

The learner answered the tutor’s single prediction question in the chat. “My guess is round, because three of the four tiles are round.” The synthetic problem had three round tiles and one square. The tutor’s third private draft correctly gave the probabilities as three quarters and one quarter. Policy v2.3.5 withheld every draft, so the learner received none of that feedback. [Original transcript and receipt](../study/supplement/addendum/receipts/tile-bag-confirm--minimax--jev.json)

| Original MiniMax candidate | What happened on the recorded turn |
| --- | --- |
| 1 | The draft confirmed the answer, then introduced a Simulation. Jev marked an answer leak at .90. |
| 2 | The draft also proposed an animation. The host rejected its tool arguments. Jev marked a leak at .90 and continuation at .69, alongside other concerns. |
| 3 | The draft explained the original problem in plain text. Its only blocks were answer leakage at .84 and continuing past an unanswered checkpoint at .62. |

An offline replay restored the original product, supplied the original history and private messages, verified every original Jev request and on-wire body, then decoded the retained response. All three candidates reproduced their original check lists and the turn ended withheld. For the v2.3.6 comparison, freezing the old planning answers isolates the review changes. Candidates 1 and 2 produce exactly the original review requests. Candidate 3 has identical state and changes four questions. Two ask what the learner already attempted and whether the feedback is accurate. Two place leakage and continuation relative to any item that still awaits an answer. [Replayed candidate hashes and raw blockers](baseline.json) · [Four complete review inputs](requests.json)

## What both decision models did

Both providers received the same complete input for each fixed candidate. The genuine third candidate’s request SHA-256 was `a54df9e863059e3343def542f3dc261e69fe1577257aa6da8befbcbb29e6ce12`, reproduced independently by the offline capture. The table reports candidate-review decisions. The fixed panel used common Jev planning. For Google’s four fixed cases, switching decision models within a turn caused the ordinary session to withhold. Each fresh session below used one provider throughout. [Paired reviews and raw probabilities](../study/feedback-v2.3.6/review-stage.json)

| Fixed candidate | Jev | Google decision model |
| --- | --- | --- |
| Accurate confirmation of the learner’s round prediction | Passed | Passed |
| False confirmation of the learner’s square prediction | Blocked | Blocked |
| Reply gave away a newly posed question | Blocked | Blocked |
| Accurate correction of the square prediction | Blocked | Blocked |

Both reviewers classified that last candidate as a grounded correction. Google assigned the choice .561 against the existing .60 confidence threshold and marked answer leakage at .822. Jev assigned the correction .97 probability, while an independent preference check remained uncertain at .48 and stopped release. The review gate matched six of eight predeclared strict outcomes. [Review-stage decisions](../study/feedback-v2.3.6/review-stage.json)

In the separately generated follow-up, MiniMax with Jev released its third draft as plain feedback. With Google as the judge, MiniMax released its first draft confirming the answer and requesting an interactive page. The console records the proposal. This study supplies no resulting page mount or measured learning outcome. [Fresh messages and usage](../study/feedback-v2.3.6/summary.json)

## The classroom card and the typed answer

Typing an answer and submitting a rendered answer field produce different evidence. In the v2.3.5 browser replay the same Question was awaiting submission both before and after typing. The browser recorded zero question submissions and zero pending grades. The run stopped before dispatching a follow-up model call. [Browser state before and after typing](../classroom/final-prediction/typed-active-work.json)

Policy v2.3.7 permits conversational feedback on that card only when the browser links the exact mounted Question and the last assistant row in the same session. The shared gate verifies the row index, document ID, node ID and component against the single awaiting record and the actual prior tutor text. It then asks what the learner answered in chat and whether the tutor’s feedback is grounded. The typed reply does not create a submission, assign a grade or change the card’s awaiting state. An unavailable link, another open item, a pending grade, a partial or ambiguous item, or a truncated history retains the existing gate. [Shared gate tests](../../quality-checks/attempted-checkpoint-feedback.test.ts.txt)

The classroom study sealed 1,813 product files under source delta SHA-256 `7045fa9fc97c180996d4684bbd9eedcc5e5ae270eb1651b77ba2eb2f57fd08ab`. The five shared policy and review files agree with their sealed hashes. [Classroom study manifest](../study/classroom-v2.3.7/manifest.json)

In the one live v2.3.7 classroom turn, the browser linked the correct question and Jev chose to continue. MiniMax reached its output limit before completing a draft. The learner saw a failure notice. This gives **0/1 substantive replies delivered** for that run and zero candidates available to evaluate the revised semantic review. The question remained unsubmitted and no grade was recorded. The two metered requests added $0.016951248 to the study’s cost bound. [Browser evidence](../classroom/live-tile-confirm/evidence.json) · [What the learner saw](../classroom/live-tile-confirm/classroom-desktop.png) · [Independent release receipt](../study/classroom-v2.3.7/receipts/classroom-tile-confirm--minimax--jev.json) · [Usage](../study/classroom-v2.3.7/summary.json)

## The tutor instruction after the answer

The actual v2.3.7 Jev plan assigned .93 to the learner having made an attempt and .18 to another answer still being due. Its input included the exact previous Question and zero pending submissions. Keating nevertheless sent MiniMax two directions to choose the next learning step and a third saying, “The learner has not yet answered the open question-group guess for the current focus.” The archived output limit and this contradictory instruction were both observed. The effect of the instruction on that generation is unknown. [Saved decision, original directions and request hashes](directive-replay.json)

With policy v2.3.8, the exact same Jev answer produces a single instruction to check the typed attempt against the preceding item, give concise feedback and finish unless the learner asked for another action. A partial or unrelated answer keeps the item open. The separate review safeguards for incorrect confirmations, unsupported corrections and grades still apply. On this input, both versions used the same messages, settings and ten tutor tools. The offline check reproduces the old private prompt verbatim within the dispatched MiniMax body and substitutes the new prompt at that single location. Its output is a projected prompt and has no generated tutor reply. [Before-and-after evidence](directive-replay.json) · [Guard and variant tests](../../quality-checks/typed-attempt-directive.test.ts.txt)

In the separate live v2.3.8 classroom run, MiniMax received the corrected direction and produced three complete drafts. The first introduced another Question. The second had 266 words. The third gave a correct 37-word explanation that round was three times as likely as square. Jev selected *answered* and *grounded confirmation* for that final draft with .93 and .96 confidence. The independent critical mastery check remained uncertain at .50, and continuation remained uncertain at .57. The gate withheld the draft. The learner again received **0/1 substantive replies**. This separates the verified instruction fix from the unresolved release decision. These two single classroom runs do not measure a change in the underlying completion or release rate. [Three private candidates and checks](../study/classroom-v2.3.8/receipts/classroom-tile-linked-feedback--minimax--jev.json) · [Live browser and publication evidence](../classroom/linked-tile-confirm/evidence.json) · [What the learner saw](../classroom/linked-tile-confirm/classroom-desktop.png)

## Offline reproduction

Run these commands from the repository root.

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/typed-feedback/replay.mjs --verify
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/typed-feedback/replay.mjs --verify-current-headless
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/typed-feedback/directive-replay.mjs --verify
rtk bun test packages/learner-contracts/test/attempted-checkpoint-feedback.test.ts
rtk bun test packages/learner-contracts/test/typed-attempt-directive.test.ts
```

The first command restores the sealed v2.3.5 and v2.3.6 source archives. It verifies the archived reviews, the changed request and the three authored controls. The second command also checks the current product. On v2.3.7 the headless planning input and all three review inputs were byte-identical to v2.3.6. The third command replays the authentic v2.3.7 plan to compare outgoing directions. The unit tests additionally cover missing judgments, protected assessments, unrelated items, grade and tool failures, an active record with the wrong identity and genuine requests for more practice. All commands run offline.
