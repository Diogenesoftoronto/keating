#let a = json("case-study/aggregates.json")
#set document(title: "Learning While Building Keating: A Longitudinal Creator-as-Learner Case Study", author: "Dio the Debugger", date: datetime(year: 2026, month: 9, day: 6))
#set page(paper: "us-letter", margin: (x: 0.8in, y: 0.7in), numbering: "1", header: align(right)[#text(size: 8pt, fill: rgb("666666"))[KEATING / CREATOR-AS-LEARNER CASE STUDY / LOCAL DRAFT]])
#set text(font: "New Computer Modern", size: 10.5pt)
#set par(leading: 0.6em, justify: true)
#set heading(numbering: "1.")
#let ink = rgb("254e63")
#let muted = rgb("8498a1")
#let algorithm(title, body) = block(width: 100%, breakable: false, inset: 12pt, fill: rgb("f2f5f6"), stroke: (left: 2pt + ink))[
  #text(weight: "bold", title)
  #v(6pt)
  #set par(justify: false, leading: 3pt)
  #show raw: set text(font: "DejaVu Sans Mono", size: 8.5pt)
  #body
]

#align(center)[
  #v(12pt)
  #text(size: 23pt, weight: "bold")[Learning While Building Keating]
  #v(6pt)
  #text(size: 14pt)[A longitudinal creator-as-learner case study]
  #v(10pt)
  Dio the Debugger · 6 September 2026
  #v(5pt)
  #text(size: 9pt)[Local research draft · lessons and system development, May-September 2026]
]
#v(15pt)
*Abstract.* This retrospective case study examines Keating's creator learning with the application while developing it and switching underlying models. Two exports preserve 81 session objects and 1,271 distinct message events from May to September 2026. Analysis of 11 selected sessions and the repository history identifies six findings. Concrete reconstruction improves the creator's explanations of embeddings and Scheme errors. The creator contributes analogies, corrections, and counterarguments that advance the lessons. Keating also mistakes recognition for knowledge, declares understanding prematurely, supplies faulty reference code, and requires repeated interface repair. A SwiReasoning revisit reveals difficulty reconstructing the earlier lesson. These encounters took place as Keating's quizzes, feedback, animation, and teaching interfaces changed and the creator used a range of models, predominantly MiniMax. The training-data audit finds missing judge scores and validation completions included in a training compatibility file. Together, the findings show how conceptual progress, technical correction, and application development interact in sustained use of an AI tutor.

= Study question and case boundary
The study asks: *How did Keating help or hinder its creator's understanding as the lessons, application, and underlying models evolved?* The case follows the relationship among the creator, their learning tasks, and the system they were building.

The two snapshots were generated at #a.portableGeneratedAt and #a.trainingGeneratedAt. Personal learning and development activity are intertwined: the creator asks substantive questions while testing and correcting the tool. Their insider knowledge makes intended behavior explicit and supplies detailed accounts of failures and repairs.

The creator supplied the data and clarified the case context. The assistant performed the quantitative audit, episode analysis, repository alignment, and technical checks. The findings draw on the creator's explanations, the tutor's responses, and changes documented in the application history.

#pagebreak()
#include "case-study/related-work.typ"
#pagebreak()
#include "case-study/subjects.typ"
#pagebreak()
#include "case-study/findings.typ"
#pagebreak()
#include "case-study/lesson-quotes.typ"
#pagebreak()
#include "case-study/model-context.typ"
#pagebreak()
= Methods: reconstructing the lesson record
Eleven session objects were selected for learner explanations, attempted application, a same-topic revisit, or instructional repair. Source positions are recorded in `case-study/episode-ledger.json`. Reading adjacent turns distinguished creator-generated deductions from prompted answers and traced how explanations changed during each lesson. The analysis used the visible dialogue; embedded model thinking text was excluded. A second assistant checked the principal episode findings against their source spans.

Subject coverage uses the full retained collection. Parent-linked forks and exact-history copies are grouped into conversation families, with self-parent links treated as roots. Review of titles and visible exchanges assigns one primary subject and a discussion-or-opening status per family. The hashed membership ledger, copy-joining rules, and coding decisions are documented in `case-study/subject-data.json` and `case-study/subject-coding.md`.

A focused narrative literature review followed the initial episode analysis. It revisited the earlier Keating report's bibliography and examined primary studies of self-explanation, feedback, retrieval, AI tutoring, autobiographical design, and model evaluation. The review contextualized the observations and refined their interpretation, including the value of feedback after a correct guess. Source locations and claim connections are recorded in `case-study/literature-review.md`.

The companion script reads the JSON and ZIP members and produces aggregates and input SHA-256 hashes. Algorithm 1 expands its event-counting loop. The script's `digest` routine hashes role, timestamp, and content as JSON with stable key ordering. A usable timestamp is numeric, is not Boolean, and converts from milliseconds to a UTC date in 2000-2100. Both algorithms follow Dalbey's structured-English pseudocode conventions @dalbey2003pseudocode.

#algorithm("Algorithm 1. Reconstruct distinct lesson events", [
```
READ portable snapshot
COMPUTE snapshot hash from unchanged file bytes using SHA-256
SET retained fingerprints to an empty set
SET all event counters to zero
FOR each session in the snapshot
    FOR each message in the session
        CALL digest with message role, timestamp and content
            RETURNING fingerprint
        IF fingerprint is already retained THEN
            INCREMENT repeated-copy count
        ELSE
            ADD fingerprint to retained fingerprints
            INCREMENT count for message role
            IF timestamp is usable THEN
                COMPUTE UTC date from timestamp in milliseconds
                INCREMENT count for UTC date
                INCREMENT count for UTC month and message role
            ELSE
                INCREMENT untimed-event count
            ENDIF
        ENDIF
    ENDFOR
ENDFOR
STORE snapshot hash, size of retained set and event counters
```
])

The analysis found #a.invalidMessageTimestamps events without usable timestamps. The calendar includes the remaining 1,248 events. A date is active when at least one dated event occurs. The observation window runs from the first to the last dated event, with September ending at the export date.

Assessment, feedback, and artifact records are counted separately by provenance. The training audit reconciles rows with the manifest, checks session-ID and exact-completion overlap across canonical splits, and tests whether validation completions occur in the Alpaca compatibility file.

#pagebreak()
= The retained activity calendar
#figure(image("case-study/figures/activity-calendar.svg", width: 100%), caption: [Calendar of retained activity from 9 May through 6 September 2026. Color encodes the number of dated user, assistant, and tool-result events.])

Activity concentrates in June and July. The archive contains events on 42 dates within a 121-day window. The calendar shows the dense clusters of interaction and the quieter intervals between them. Outlined dates fall outside the observation window.

#pagebreak()
#include "case-study/charts.typ"

#pagebreak()
= Recorded practice and feedback
The #a.sessions session IDs include 19 with parent-session links, 11 marked as generated alternatives, and seven marked as hidden alternatives; these flags overlap. Deduplication removes 548 repeated copies and yields 314 user, 604 assistant, and 353 tool-result events.

The portable store contains 27 lesson plans, 21 maps, 10 animations, and 28 verifications. It also holds 12 benchmark and five evolution records, including synthetic benchmark and policy-search traces.

#figure(image("case-study/figures/evidence-map.svg", width: 100%), caption: [The four recorded channels of teaching material, feedback, question checks, and card reviews. Arrows identify what each channel records.])

Of the 51 feedback entries, eight are explicit, 42 are inferred from turn analysis, and one has an unspecified source. Five of the 13 question checks are model-graded and eight remain pending. The store also contains one quiz-result summary and 37 card reviews. Card-rating categories 0/1/2/3 occur 4/11/12/10 times.

The analysis counts each feedback entry once across mirrored stores and keeps generated quiz artifacts separate from completed quiz results. These distinctions preserve the relationship between the material Keating produced and the responses the creator supplied.

#pagebreak()
= From a retained history to a training dataset
#figure(image("case-study/figures/training-lineage.svg", width: 100%), caption: [Data lineage and partition audit. The message reconstruction and training-record extraction are distinct transformations of the same portable history. Each stage is labeled with its observation unit.])

The 361 canonical rows preserve training and validation assignments. Their compatibility serialization combines those partitions: all 20 validation completions also appear in the Alpaca file named for training. This breaks the separation required to evaluate a model trained on that file.

#pagebreak()
= Results: audit of the resulting training artifact
All 70 session IDs represented in canonical training rows occur in the portable snapshot. The archive contains 275 conversation records and 86 artifact records: 23 plans, four quizzes, 21 maps, 10 animations, and 28 verifications.

The export rule labels 298 records unscored (82.5%), 53 rejected, and 10 accepted. Of 616 rewarded rows, 119 carry scoring evidence: 40 explicit-signal and 79 inferred-signal rows. The remaining 497 are unscored and carry the neutral default. Repeated session history produces multiple rewarded rows from some source events.

*Judge execution.* Judge scoring was enabled, but the archive contains no judge scores. The implementation used a fixed default model and converted request or parsing failures into null scores without a failure report. The revised UI adds judge-model selection and records provider, model ID, eligible rows, successful scores, and missing scores. Its scoring budget now applies across the export.

#block(width: 100%, inset: 10pt, fill: rgb("f2f5f6"), stroke: (left: 2pt + ink))[
  *The exported setting*\
  #raw("\"judgeScoringEnabled\": true")\
  #text(size: 9pt)[Exact field excerpt from `manifest.json` in the analyzed training ZIP. The rewarded-record audit finds zero rows with a judge score.]
]

The selected judge should be calibrated on checked teaching examples. Research on LLM judging shows that prompt design and reference answers affect grading accuracy @zheng2023. Model identity, rubric, and score coverage therefore belong in the evaluation record alongside the resulting number.

*Partition integrity.* The canonical dataset has 341 training and 20 validation rows, with zero shared session IDs or exact completions between them. All 20 validation completions nevertheless occur in `train.alpaca.jsonl`. Training on that file contaminates an evaluation against canonical validation. Partitioned datasets should therefore be constructed from the canonical records.

*File representations.* ChatML contains 161 rows and Alpaca 308 because they use different export units. The seven preference pairs appear in both chat and text serializations. The manifest records 11 pattern redactions.

#pagebreak()
= Implications for the next development cycle
The findings point to three priorities: check demonstrated code before teaching it, update the lesson from the creator's actual response, and revisit unresolved ideas across sessions. Version-linked assessments would connect these improvements to changes in the application and underlying models.

#algorithm("Algorithm 2. Proposed evidence-preserving evaluation cycle", [
```
READ protocol, baseline revision, learner identity and topic
RECORD tutor identity, judge identity and rubric version
COLLECT fixed precheck before instruction
RECORD responses, assistance and scoring provenance
RECORD baseline as the learner's teaching exposure
DELIVER lesson using the recorded tutor and baseline revision
FOR each immediate, delayed-recall and transfer assessment
    SCHEDULE assessment at the protocol-specified time
    IF response is available by the evaluation cutoff THEN
        SCORE response using the fixed rubric and recorded scorer
        STORE response, outcome, assistance and scoring provenance
    ELSE
        SET learner outcome for this assessment to unknown
    ENDIF
ENDFOR
SET active revision to baseline
SET validation result and holdout result to not run
CALL ProposeRevision with baseline and training cases
    RETURNING candidate
IF judge calibration meets the protocol criteria THEN
    CALL PairedValidation with baseline and candidate
        RETURNING validation result
    IF validation result passes its behavior gate THEN
        IF an unused sealed holdout family is available THEN
            MARK holdout family as consumed before execution
            CALL HoldoutEvaluation with baseline, candidate
                and holdout family RETURNING holdout result
            IF holdout result passes its behavior gate THEN
                SET active revision to candidate
            ENDIF
        ENDIF
    ENDIF
ENDIF
STORE learner outcomes separately from model-judged results
STORE candidate, gate results and active revision
```
])

`ProposeRevision` uses training cases only. `PairedValidation` and `HoldoutEvaluation` run fresh baseline and candidate teaching episodes, score them with the recorded independent judge, and apply fixed behavior thresholds. Execution errors or missing required scores fail the relevant gate. A failed or unrun gate leaves the baseline active.

The proposed cycle records tutor and judge identities separately, groups related forks within the same evaluation partition, and reserves assessment families for holdout use. It combines the dialogue evidence that made this case informative with consistent checks at immediate and delayed follow-ups @roediger2006; @bastani2025. Judge calibration uses checked examples and a human-rated subset before model scores guide promotion @zheng2023.

#pagebreak()
#include "case-study/future-research.typ"

#pagebreak()
= Limitations
This is a retrospective case of Keating's creator using and developing the system. Technical experience, knowledge of the intended behavior, and commitment to the project shaped both the lessons and the repairs. The 11 episodes were purposively selected from a retained archive; they do not estimate the prevalence of these findings among all sessions or other users. The analysis was assistant-assisted and included an additional assistant evidence review, with no independent human coding, blinding, or inter-rater reliability estimate.

The literature review is focused and narrative, not systematic. It was conducted after the initial episode analysis. The cited studies use other populations, topics, designs, and outcome measures; they provide concepts and comparisons rather than effect estimates for Keating. This case does not replicate those experiments or validate the earlier technical report's proposed evolution loop.

Application revisions, model choices, topics, and prior knowledge changed together. The archive does not identify the exact deployed revision or verify historical provider routing for every turn. Saved session models sometimes differ from response-level labels, and some OpenRouter and Mercury use is known only from the creator's account. Historical capability rankings were not independently reconstructed. The case therefore describes the combined teaching experience; it cannot isolate causal effects of the application, compare model quality, or establish that later releases resolved earlier failures.

Most learning evidence consists of assisted responses within lessons. The SwiReasoning revisit documents difficulty reconstructing an earlier topic, but its incomplete first lesson, uncertain baseline, and unknown intervening practice prevent estimating a forgetting rate. The archive contains no controlled pre/post design or consistent independent retention and transfer series. Synthetic benchmarks, generated verification records, inferred feedback, and self-rated reviews are separate measures from demonstrated learning. The technical checks reproduce specific Scheme defects rather than validate every lesson, and the reported quiz and interface bugs were not independently reconstructed.

Retention and export selection are incomplete records of use: deleted conversations, off-platform work, missing timestamps, and generated alternatives affect reconstruction. Fingerprint deduplication can collapse identical untimed messages or preserve copies whose metadata changed. Activity dates and message counts measure retained events, not study duration. Exact-text partition checks leave semantic and fork-family overlap unresolved. The training archive does not identify the cause of its missing judge scores or demonstrate that fine-tuning occurred. Its quality labels reflect export rules, and pattern redaction does not guarantee removal of all private material.

Subject coverage depends on analyst-assigned primary categories and the boundary between an opening and substantive discussion. Secondary topics within a conversation family are not counted separately.

= Materials and availability
The source is `docs/case-study.typ`; episode locations and aggregates are in `docs/case-study/`. The scripts reproduce the counts, figures, and Scheme checks. Raw transcripts and the original training ZIP remain local and unchanged. This draft is prepared for creator review and has not replaced the production paper.

*Input integrity (SHA-256).* Hashes identify the analyzed local snapshots without disclosing their contents.
#set text(size: 8pt)
#for item in a.inputs [
  #block[
    *#item.role*\
    #raw(item.sha256)
  ]
]

#pagebreak()
#set text(size: 9.5pt)
#set par(justify: false)
#bibliography("case-study/references.bib", title: [References], style: "apa")
