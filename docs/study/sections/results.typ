#import "../preamble.typ": modest-table

= Results

== The evidence stack

The paper uses two evidence layers.

1. *Archival model-trace evaluation.* We analyze model-generated teaching traces stored under `test/traces/`. These are not human-participant sessions.
2. *Internal deterministic benchmark.* We compare policies with the synthetic fallback implemented in `src/core/benchmark-real.ts` and orchestrated by `src/core/benchmark.ts`.

The layers answer different questions. The archival layer asks which concrete successes and failures appear in recorded model-to-model teaching sessions. The synthetic layer asks how policies and the current search procedure behave inside an explicit score model. Neither layer estimates a causal effect on human learning.

The repository contains 22 raw trace files, including repeated runs for some topic x learner pairs. We imposed a deterministic curation rule: retain the latest trace by timestamp for each pair. This yielded 16 retained sessions, matching the versioned snapshot `test/final_dataset.json`. The timestamp rule fixes the set by temporal provenance rather than selecting whichever repeated run looked best. One retained derivative trace for `Qwen-2.5-1.5B` contained `mastery=8`, `engagement=7`, and `clarity=8` while the rest of the archive used a 0-1 scale; we normalized that record to 0.8, 0.7, and 0.8 and recorded the correction in the generated bundle.

#figure(
  modest-table(
    columns: 3,
    table.header([Component], [Value], [Interpretation]),
    [Raw archived traces], [22], [All preserved model-generated teaching transcripts before curation],
    [Retained topic x learner pairs], [16], [Archival evaluation set used in this paper],
    [Excluded duplicate earlier runs], [6], [Older runs for the same topic x learner pair],
    [Score corrections], [1 record], [Single 10x encoding error normalized before aggregation],
    [Synthetic topics], [14], [Internal benchmark tasks implemented in code],
    [Synthetic learners per topic], [3], [Deterministic pseudo-learners sampled per topic and seed],
    [Software snapshot], [Keating 3.3.0], [Version targeted by the frozen policy and analysis protocol]
  ),
  caption: [Evidence layers, implementation snapshot, and curation rules.]
)

== Archival performance is heterogeneous across topics and learners

After normalization, the mean archival overall score, defined as the unweighted mean of mastery, engagement, and clarity, was 0.61 with a 95% bootstrap interval of 0.515-0.705. Performance varied sharply by topic. *Special Relativity* was strongest at 0.75 (0.596-0.883), followed by *Derivative* at 0.654 (0.454-0.767), *Social Contract Theory* at 0.613 (0.500-0.763), and *Stoicism* at 0.425 (0.283-0.558).

This pattern is substantively useful but not causal. The physics and calculus traces are structurally friendly to prediction, worked examples, and misconception repair, whereas the Stoicism traces demand introspective application. In this small archive, high instructional clarity does not reliably translate into demonstrated learner uptake on that introspective task.

#figure(
  modest-table(
    columns: 5,
    table.header([Topic], [n], [Overall], [Mastery], [Interpretation]),
    [Special Relativity], [4], [0.750 (0.596-0.883)], [0.695 (0.570-0.815)], [Strong transfer from intuitive thought experiment to formal structure],
    [Derivative], [4], [0.654 (0.454-0.767)], [0.600 (0.263-0.788)], [Conceptual calculus teaching is strong but not uniformly clean],
    [Social Contract Theory], [4], [0.613 (0.500-0.763)], [0.537 (0.462-0.650)], [Mixed engagement and mixed transfer],
    [Stoicism], [4], [0.425 (0.283-0.558)], [0.287 (0.175-0.463)], [Explanation often exceeds demonstrated learner uptake]
  ),
  caption: [Archival model-trace evaluation by topic. Values are means with 95% bootstrap intervals.]
)

Learner-model heterogeneity was also substantial. `Qwen-2.5-1.5B` scored highest overall at 0.779 (0.675-0.867), whereas `Llama-3.2-1B` scored lowest at 0.458 (0.367-0.550). We do not interpret these as broad claims about model families. The set is too small and the roles too artificial. The narrower result is that the teaching protocol was not uniformly robust across the four simulated learner profiles in the archive.

== Student-role contamination is a central failure mode

The traces reveal a failure mode for agency-preserving instruction: student-role contamination. In some sessions, student turns begin to speak like a teacher or assistant rather than reconstructing the concept as a learner. Using a versioned heuristic over student turns, 5 of the 16 curated sessions showed at least one contamination marker.

These sessions performed worse descriptively. Sessions without contamination had mean mastery 0.575 and mean overall score 0.642, compared with 0.430 and 0.540 for contaminated sessions. The sample is small and the heuristic is not a validated classifier. Nonetheless, it demonstrates the kind of failure a metaharness can make visible: fluent text can coexist with weak evidence that the learner owns the idea.

== The frozen policy is robust inside the current score model

The evaluated policy vector, `me-candidate-33`, is frozen in `docs/study/evaluated-policy.json`; the analysis does not read mutable `.keating` state. We compared that vector with the repository's 3.3.0 default policy under the same default objective weights. This is a robustness comparison inside the current harness, not a held-out generalization result: the frozen candidate originated in full-suite MAP-Elites work.

Across 200 seeds, the frozen policy improved the default by 3.982 points on average (2.5th-97.5th percentiles: 3.039-4.985), winning on 200/200 aggregate suite comparisons. Its mean score was 59.039, compared with 55.057 for the default. Mean per-topic gains ranged from 3.142 points on *Legal Precedent* to 4.315 on *Cognitive Bias*; each topic improved on 196-200 of the 200 seeds.

The optimizer stability result is substantially more qualified. Thirty independent derivative-focused MAP-Elites runs used 24 candidates each and a fresh grid per run. Search candidates co-evolved policy coordinates and objective weights and were sampled on candidate-specific seeds, so their raw search scores are not directly comparable with the baseline. We therefore reevaluated each PROSPER-selected policy and the default policy on the same run seed with `DEFAULT_WEIGHTS`. Under that standardized comparison, 11 selections improved, four selected the unchanged default, and 15 regressed. The mean delta was -0.014, the median -0.164, and the observed range -8.805 to +7.142. This protocol finds diverse candidates, but it does not show reliable scalar improvement under a fixed objective.

#figure(
  modest-table(
    columns: 4,
    table.header([Synthetic analysis], [Result], [n], [Interpretation]),
    [Frozen policy vs. default], [+3.982 points (3.039-4.985)], [200 seeds], [Aggregate suite delta is positive on every sampled seed],
    [Per-topic robustness], [+3.142 to +4.315 mean], [14 topics], [Each topic is positive on 196-200 seeds],
    [Independent derivative MAP-Elites reruns], [11 wins, 4 ties, 15 regressions; mean -0.014], [30 runs], [Standardized reevaluation shows no reliable scalar gain]
  ),
  caption: [Deterministic synthetic results for the frozen Keating 3.3.0 protocol.]
)

== Ablations show what the score model currently rewards

The frozen policy differs from the default in all nine controls. One-at-a-time swaps show that the largest gains come from lowering challenge rate (+2.227 points), maximizing retrieval practice (+1.820), and increasing interdisciplinary bias (+1.182). Increasing diagram bias to the frozen policy's maximum produces the largest negative isolated effect (-1.583), while reflection bias contributes -0.376 in isolation.

These are properties of the score model and the tested policy coordinates, not estimates of pedagogical effect. The result suggests that the current synthetic surface is especially sensitive to overload control and retrieval. It also shows why joint search can be hard to interpret: a parameter that hurts in isolation may interact with other coordinates or objective weights inside a selected policy. An optimizer that can see this surface may exploit those sensitivities without producing better human teaching.

#figure(
  modest-table(
    columns: 3,
    table.header([Parameter swapped into default], [Mean synthetic delta], [Interpretation]),
    [challengeRate], [+2.227], [Lower challenge reduces modeled overload most strongly],
    [retrievalPractice], [+1.820], [The harness rewards enforced recall],
    [interdisciplinaryBias], [+1.182], [Transfer-oriented prompting helps],
    [analogyDensity], [+0.657], [Lower analogy density is weakly positive with a wide empirical range],
    [exerciseCount], [+0.343], [Two rather than three exercises helps modestly],
    [socraticRatio], [-0.118], [This coordinate is nearly neutral in isolation],
    [formalism], [-0.189], [Additional formalism is slightly negative in isolation],
    [reflectionBias], [-0.376], [Reflection emphasis is not rewarded in isolation],
    [diagramBias], [-1.583], [Maximum visual emphasis is actively penalized in isolation]
  ),
  caption: [One-at-a-time ablations diagnose the synthetic objective rather than human learning.]
)
