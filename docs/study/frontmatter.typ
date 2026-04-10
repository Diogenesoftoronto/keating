#import "preamble.typ": paper-title

#paper-title([Keating: A Metaharness for Agency-Preserving AI Instruction])

#align(center)[
  #v(0.4em)
  Theo The Debugger \
  #datetime(year: 2026, month: 4, day: 3).display("[month repr:long] [day], [year]")
]

#v(0.9em)

#block(fill: luma(242), inset: 1em, radius: 4pt)[
  AI tutors can scale explanation, but scaling explanation is not the same as scaling learning. A tutoring system that answers fluently may still weaken the learner's own reconstruction of a concept. Keating is designed around that distinction. It is not a single tutoring chatbot; it is a *metaharness* for teaching, a control layer that organizes planning, prompting, retrieval, transfer, verification, and evaluation around the live teaching exchange. We analyze two evidence layers: an archival trace set of 22 raw sessions curated to 16 topic x learner pairs, and a synthetic benchmark implemented directly in the repository. The archival set yields a normalized overall score of 0.61 (95% bootstrap interval 0.515-0.705), with strong topic heterogeneity: *Special Relativity* is highest at 0.75 and *Stoicism* lowest at 0.425. The synthetic layer shows that the current Keating policy, although evolved on *Derivative* alone, improves the full 14-topic harness by 6.703 points over the default policy across 200/200 seeds, with derivative-only evolution improving in 29/30 reruns. The contribution of this paper is therefore twofold: a formal account of a teaching metaharness and a reproducible benchmark-and-analysis stack for studying agency-preserving instruction. The present evidence supports systems and methodology claims; a human randomized trial remains the necessary next step for causal pedagogical claims.
]
