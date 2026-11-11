# Keating Teaching Check v1

This is a **versioned public development benchmark**: a stable target for improving Keating and comparing models under the same conditions. It has no model results yet, validated teaching score, or promotion threshold. Keep its evaluation prompts and rubric out of the training corpus. Repeated inspection and tuning still make it a known development target; fresh held-out conversations are separately needed to assess generalization.

Version 1 fixes 32 fictional conversation prefixes and asks a model for one continuation. Eight cases form a smaller core comparison set. Cases contain user/assistant/tool history, an output cap, deterministic interaction requirements, and separate case-specific human review anchors. The runner must send only the messages plus the separately exported real Keating prompt and supplied tool schemas. Expectations, rubric, and privileged hints are evaluator data.

The intended question is practical: does the next response help this learner, and does its interaction work? A compiled quiz is not evidence of good teaching. A question is useful only when it fits the learner's request and understanding; repeating questions after a request for help is a failure. Explanations, examples, and judgments may use any sound wording. There is no prose reference answer to imitate.

## Core and its motivation

| Case | Why it is included | Evidence status |
| --- | --- | --- |
| `direct-const` | Give the requested explanation without making the learner earn it through an interview. | Inspired by the user's report of unhelpful responses; this JavaScript situation is newly authored. |
| `predict-event-loop` | Offer a useful prediction when the learner expressly asks to attempt one. | Inspired by the report that the checkpoint stopped asking useful questions; the task is newly authored. |
| `stuck-closure` | Change to a worked example when the learner says repeated questions are frustrating. | Directly targets the reported experience; the conversation is fictional, not a recovered failed trace. |
| `transfer-index` | Compare alternatives and justify a real-world application at the learner's edge. | A stated Keating design goal, not an observed production failure. |
| `openui-quiz-circuits` | Create a complete inline mixed quiz and wait for a submission. | Prior recorded tests exposed format/creation failures; this quiz topic and request are new. |
| `openui-flashcards-http` | Create usable retrieval cards through OpenUI. | User-requested interaction path and prior markup concerns; the request is new. |
| `grade-question-paraphrase` | Accept a complete explanation in the learner's own words. | Tests the user's concern about exact-answer pressure; it does not establish that SFT caused that problem. |
| `grade-quiz-mixed` | Judge only actual pending answers, including meaningful partial credit. | Prior checks exposed grading/ID failures; this complete mixed submission is new. |

The other 24 cases broaden coverage: direct help, changing representations, prerequisite support, confident misconceptions, assisted success versus retention, identity, generative learning, learner-owned notes, plans, an exam, a simulation, preferences, memory, feedback, goals, failed writes, and bounded recovery from malformed markup. Three conversation prefixes contain 10–13 messages. These are fixed contexts, not a simulation of how each candidate would have generated all earlier turns.

## Data and contract provenance

All cases are newly authored fictional evaluation material. No Downloads conversation text, real learner profile, or training target was copied. This gives exact-case separation, **not** a claim that subject matter or skills are unseen: for example, fractions and averages also occur elsewhere in Keating's data. The selected coverage has not been measured against production traffic.

The fixed question envelopes were serialized with `createQuestionLearnerResponse`. The quiz/deck submissions were produced by the current `compileOpenUISourceToSharedDocument`, `dispatchSharedUiAction`, and `createOpenUIActionLearnerResponse`, using isolated in-memory storage and a fixed timestamp. Their compiled question/card IDs are intentionally preserved. No learner storage, provider, or live durable tool was accessed. Historical malformed markup exists only in the repair scenario.

Authoring was grounded in `DEFAULT_TEACHER_PERSONA`, `operational-protocol.md`, learner-contract definitions, and assessment/teaching tool schemas. The comparison context separately freezes the exact application prompt and tool schemas. Use the same files, hashes, sampling settings, and per-case output caps for every compared model. The exam has a larger output cap than short conversational cases so a complete twenty-item response is feasible; record truncation and never quietly shorten or drop it.

## Version policy

Keep the released cases, rubric, and context immutable. Do not fix a weak case or adjust an output cap silently after seeing a model's results. Publish the change as a new benchmark version with new hashes, retain the prior definition/results, and rerun compared models when claiming a change in relative performance. Runner/checker changes that alter scoring must also be identified with their source hash or revision.

Model comparisons must use one suite (`core` or `full`) consistently; a core result is not a full-suite result. The public cases are useful for iteration, but improvement on them alone does not establish that a learner's next unseen conversation will improve. Do not append these prompts, candidate answers, or rubric-derived targets to training data and then present the same evaluation as independent evidence. If benchmark examples are deliberately repurposed for training in a later experiment, disclose that contamination and use a separate assessment.

## Reading a result

Report automatic contract results separately from human review. The nine review dimensions are responsiveness, correctness, scaffolding, learner agency, adaptation, transfer, clarity, evidence discipline, and tool judgment. Only dimensions listed for a case apply. Scores are 0, 1, or 2 using the case's behavioral anchors; missing reviews remain unscored. Equivalent explanations, alternative correct examples, and flexible teaching approaches count.

Blind reviewers to training labels. Report rated and missing counts, per-dimension results, category contract pass rates, and paired traces. Preserve failures and disagreements. Do not collapse these into a single claim about learning quality. The rubric is uncalibrated, and there is no evidence yet of inter-rater agreement or predictive validity.

This benchmark does not measure learner improvement, delayed recall, real-world transfer by a human, safety across domains, broad knowledge, full conversations generated by the model, serving reliability, or sample/compute efficiency. It can identify concrete next-response regressions and compare development progress if used consistently; fresh held-out conversations and relevant learner evidence are separately needed before claiming generalization or deciding model promotion.
