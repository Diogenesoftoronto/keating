#import "preamble.typ": paper-title

#paper-title([Keating: A Metaharness for \ Agency-Preserving AI Instruction])

#align(center)[
  #v(0.4em)
  Dio the Debugger \
  #datetime(year: 2026, month: 8, day: 8).display("[month repr:long] [day], [year]")
]

#v(0.9em)

#block(fill: luma(242), inset: 1em, radius: 4pt)[
  AI tutors can scale explanation, but scaling explanation is not the same as scaling learning. A fluent answer may still weaken the learner's own reconstruction of a concept. Keating is designed around that distinction: a *teaching metaharness* that coordinates live interaction, persistent learner evidence, inspectable artifacts, and evaluation-gated policy improvement. We analyze two deliberately separated evidence layers. An archival set of 22 model-generated sessions, deterministically curated to 16 topic x learner pairs, yields a normalized overall score of 0.61 (95% bootstrap interval 0.515-0.705) and reveals substantial topic heterogeneity and student-role contamination. A deterministic 14-topic benchmark shows that the frozen Keating 3.3.0 policy improves the default policy by 3.982 points on average (2.5th-97.5th percentiles: 3.039-4.985) across 200/200 seeds. In 30 isolated derivative-focused MAP-Elites reruns, selected policies reevaluated against the default on the same seed and fixed objective weights improve in 11, tie in four, and regress in 15 (mean delta -0.014). This exposes a mismatch between co-evolved search objectives and comparable scalar evaluation. These results support a systems-and-methods contribution, not a causal claim about human learning. The policy, traces, curated data, protocol, analysis outputs, and paper build are versioned for audit; a preregistered human trial remains the necessary next step.
]
