#import "preamble.typ": paper-title

#paper-title([Keating: A Metaharness for \ Agency-Preserving AI Instruction])

#align(center)[
  #v(0.4em)
  Dio the Debugger \
  #datetime(year: 2026, month: 9, day: 6).display("[month repr:long] [day], [year]") \
  #text(size: 9pt)[Revised architecture: evidence-gated teaching skill evolution]
]

#v(0.9em)

#block(fill: luma(242), inset: 1em, radius: 4pt)[
  AI tutors can generate persuasive explanations without establishing that learners can reconstruct, retain, or transfer an idea. Keating addresses this measurement problem through a teaching metaharness: a control layer around live instruction, learner records, artifacts, and revisable teaching procedures. This revision replaces automatic promotion from policy-dependent proxy scores with fresh tutor executions, fixed rubric judgments, persistent hypotheses, and content-addressed skill revisions. An 18-case mathematics and programming suite separates training, validation, and a single-use holdout. A candidate must improve under both independent comparisons, preserve every case family's score, and pass all critical criteria before subsequent sessions may use it. Recorded quiz performance, feedback proxies, synthetic teaching behavior, and independent learner assessments remain distinct. Historical analysis explains the redesign: a frozen policy gains 3.982 points inside an algebraic score model, yet 30 standardized MAP-Elites reruns yield 11 improvements, four ties, and 15 regressions. The archived model-to-model traces also expose student-role contamination. These historical results are not evaluations of the new skill loop. The present contribution is an implemented method with reproducible integrity checks and explicit limits: no live-provider performance results for the new loop or human learning effects are reported. Judge calibration and randomized trials with delayed and transfer assessments remain necessary.
]
