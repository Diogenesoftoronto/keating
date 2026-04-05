= Methods

== System overview

Keating is implemented as a policy-controlled teaching scaffold around a Pi runtime. The live system can generate lesson plans, maps, verification artifacts, animations, benchmark reports, and prompt-evolution artifacts, but the present paper focuses on the teaching-policy layer and the synthetic harness. A teaching policy contains nine scalar controls:

- analogy density
- Socratic ratio
- formalism
- retrieval practice
- exercise count
- diagram bias
- reflection bias
- interdisciplinary bias
- challenge rate

These controls do not directly encode a single answer. They encode a region of instructional behavior. The metaharness evaluates those controls against topic structure and learner profiles, then uses the resulting signals to revise the policy.

== Mathematical formulation of the harness

For readers from educational measurement, this section defines the latent teaching signals. For readers from ML systems, it specifies the benchmark objective. For readers from applied mathematics, it gives the explicit map from policy and learner parameters to session score.

Let a topic be represented by $T$, a policy by $P$, and a learner profile by $L$. The policy vector is

$ P = (a, s, f, r, e, d, b, i, c) $

where $a$ is analogy density, $s$ Socratic ratio, $f$ formalism, $r$ retrieval practice, $e$ exercise count, $d$ diagram bias, $b$ reflection bias, $i$ interdisciplinary bias, and $c$ challenge rate.

The learner vector is

$ L = (k, u, n, q, v, p, t, x) $

where $k$ is prior knowledge, $u$ abstraction comfort, $n$ analogy need, $q$ dialogue preference, $v$ diagram affinity, $p$ persistence, $t$ transfer desire, and $x$ anxiety.

For a topic with formalism level $phi_T$ and visualizability indicator $nu_T$, Keating computes the following fit terms. All intermediate quantities are clipped to the interval $[0, 1]$ after evaluation.

$ F_i = 1 - |a - n| $

$ F_r = 1 - |f - (phi_T + u)/2| $

$ F_d = 1 - |s - q| $

$ F_g = 1 - |d - (nu_T v + (1 - nu_T) omega_nu)| $

$ F_p = 1 - |e / e_max - (1 - k + omega_x x)| $

$ F_b = 1 - |b - t| $

Here `omega_nu` is the diagram fallback used for weakly visual topics, `omega_x` is the anxiety-to-practice coupling, and `e_max` is the exercise-count normalization constant induced by the policy domain. The model also computes an overload term parameterized by the bundle `Theta_O`:

$ O = lambda_0 + lambda_f f + lambda_e e / e_max + lambda_c c - lambda_p p + lambda_x x - lambda_k k $

These intermediate quantities are then transformed into the five synthetic learning outcomes by the parameter bundles `Theta_M`, `Theta_R`, `Theta_E`, `Theta_T`, and `Theta_C`:

$ M = mu_M + alpha_i F_i + alpha_r F_r + alpha_d F_d + alpha_g F_g + alpha_p F_p + alpha_o (1 - O) $

$ R = M (rho_0 + rho_r r) $

$ E = mu_E + beta_i F_i + beta_d F_d + beta_g F_g + beta_b F_b + beta_o (1 - O) $

$ T_r = R (tau_0 + tau_i i + tau_t t) $

$ C = mu_C + gamma_o O + gamma_f |f - u| + gamma_c |c - p| $

where $M$ is mastery gain, $R$ retention, $E$ engagement, $T_r$ transfer, and $C$ confusion.

Finally, the session score is a weighted composition with bundle `Theta_S`:

$ S = sigma_M M + sigma_R R + sigma_E E + sigma_T T_r - sigma_C C $

Topic-level benchmark scores are the mean of $S$ over the learner population for that topic, multiplied by a reporting scale parameter. Suite-level benchmark score is the mean over topics.

The harness is therefore defined by its structure plus its calibration:

$ Theta = {omega_nu, omega_x, e_max, Theta_O, Theta_M, Theta_R, Theta_E, Theta_T, Theta_C, Theta_S} $

where each `Theta_*` denotes a small family of scalar parameters. The present repository instantiates `Theta` with one concrete numeric setting in `src/core/benchmark.ts`, but the paper intentionally presents the more general parameterized metaharness. This formulation is deliberately interpretable. It is not intended as a psychologically complete model of learning. Its purpose is to make the metaharness legible enough that policy evolution is inspectable rather than opaque.

== Harness pseudocode

#block(fill: luma(245), inset: 1em, radius: 4pt)[
#set text(font: "DejaVu Sans Mono", size: 9pt)
```python
BUILD-LEARNER-POPULATION(seed, count)
1  initialize PRNG with seed
2  learners <- empty list
3  for i <- 0 to count - 1
4      learner.id <- "learner-" + seed + "-" + i
5      learner.priorKnowledge <- RANDOM()
6      learner.abstractionComfort <- RANDOM()
7      learner.analogyNeed <- RANDOM()
8      learner.dialoguePreference <- RANDOM()
9      learner.diagramAffinity <- RANDOM()
10     learner.persistence <- RANDOM()
11     learner.transferDesire <- RANDOM()
12     learner.anxiety <- RANDOM()
13     append learner to learners
14 return learners
```
]

This procedure samples the synthetic learner population for one topic. In CLRS terms, it is the input-construction phase for the benchmark: before Keating can evaluate a teaching policy, it needs a distribution of learners with varying prior knowledge, abstraction comfort, persistence, and anxiety. The important point for the present paper is that the population size is an argument rather than a fixed constant of the algorithm. The repository currently supplies one concrete learner count, but the metaharness does not depend on that exact choice.

#block(fill: luma(245), inset: 1em, radius: 4pt)[
#set text(font: "DejaVu Sans Mono", size: 9pt)
```python
SIMULATE-TEACHING(policy, topic, learner, theta)
1  intuitionFit <- 1 - |policy.analogyDensity - learner.analogyNeed|
2  rigorTarget <- CLIP((topic.formalism + learner.abstractionComfort) / 2)
3  rigorFit <- 1 - |policy.formalism - rigorTarget|
4  dialogueFit <- 1 - |policy.socraticRatio - learner.dialoguePreference|
5  if topic.visualizable
6      diagramTarget <- learner.diagramAffinity
7  else diagramTarget <- theta.visualFallback
8  diagramFit <- 1 - |policy.diagramBias - diagramTarget|
9  practiceNeed <- CLIP(1 - learner.priorKnowledge
10                     + theta.practiceAnxietyWeight * learner.anxiety)
11 practiceFit <- 1 - |policy.exerciseCount / theta.exerciseNormalization
12                     - practiceNeed|
13 reflectionFit <- 1 - |policy.reflectionBias - learner.transferDesire|
14 overload <- CLIP(theta.overloadBias
15                  + theta.overloadFormalism * policy.formalism
16                  + theta.overloadExercises
17                    * policy.exerciseCount / theta.exerciseNormalization
18                  + theta.overloadChallenge * policy.challengeRate
19                  - theta.overloadPersistence * learner.persistence
20                  + theta.overloadAnxiety * learner.anxiety
21                  - theta.overloadKnowledge * learner.priorKnowledge)
22 masteryGain <- CLIP(theta.masteryBias
23                     + theta.masteryIntuition * intuitionFit
24                     + theta.masteryRigor * rigorFit
25                     + theta.masteryDialogue * dialogueFit
26                     + theta.masteryDiagram * diagramFit
27                     + theta.masteryPractice * practiceFit
28                     + theta.masteryHeadroom * (1 - overload))
29 retention <- CLIP(masteryGain
30                    * (theta.retentionBase
31                       + theta.retentionRetrieval
32                         * policy.retrievalPractice))
33 engagement <- CLIP(theta.engagementBias
34                    + theta.engagementIntuition * intuitionFit
35                    + theta.engagementDialogue * dialogueFit
36                    + theta.engagementDiagram * diagramFit
37                    + theta.engagementReflection * reflectionFit
38                    + theta.engagementHeadroom * (1 - overload))
39 transfer <- CLIP(retention
40                  * (theta.transferBase
41                     + theta.transferInterdisciplinary
42                       * policy.interdisciplinaryBias
43                     + theta.transferDesire
44                       * learner.transferDesire))
45 confusion <- CLIP(theta.confusionBias
46                   + theta.confusionOverload * overload
47                   + theta.confusionFormalismGap
48                     * |policy.formalism - learner.abstractionComfort|
49                   + theta.confusionChallengeGap
50                     * |policy.challengeRate - learner.persistence|)
51 score <- CLIP(theta.scoreMastery * masteryGain
52             + theta.scoreRetention * retention
53             + theta.scoreEngagement * engagement
54             + theta.scoreTransfer * transfer
55             - theta.scoreConfusion * confusion)
56 return (masteryGain, retention, engagement, transfer, confusion, score)
```
]

This is the core scoring routine. It converts one policy-topic-learner triple into interpretable intermediate quantities and then into a final score. The important structural fact is that Keating does not score a policy directly. It first scores alignments: analogy pacing, rigor matching, dialogue matching, visual fit, practice load, reflection match, and overload. These are then composed into the five outcome variables used by the benchmark. In that sense, the harness is factorized: it makes the path from policy parameters to session score inspectable. Passing the parameter bundle `theta` explicitly makes the generality of the metaharness visible. A reviewer can change the calibration without changing the algorithmic structure.

#block(fill: luma(245), inset: 1em, radius: 4pt)[
#set text(font: "DejaVu Sans Mono", size: 9pt)
```python
SUMMARIZE-TOPIC(topic, simulations, traceLimit, reportScale)
1  ranked <- simulations sorted in decreasing order by score
2  summary.meanScore <- reportScale
3                      * MEAN(score for each simulation in simulations)
4  summary.meanMasteryGain <- MEAN(masteryGain for each simulation in simulations)
5  summary.meanRetention <- MEAN(retention for each simulation in simulations)
6  summary.meanEngagement <- MEAN(engagement for each simulation in simulations)
7  summary.meanTransfer <- MEAN(transfer for each simulation in simulations)
8  summary.meanConfusion <- MEAN(confusion for each simulation in simulations)
9  summary.topLearners <- first traceLimit entries of ranked
10 summary.strugglingLearners <- last traceLimit entries of ranked, reversed
11 summary.dominantStrength <- strongest average alignment signal
12 summary.dominantWeakness <- weakest average alignment signal
13 return summary
```
]

This procedure aggregates a set of learner-level simulations into a topic-level result. The benchmark therefore preserves both population averages and diagnostic tails. The mean score tells us how a policy performs on average; the strongest and weakest learners tell us *why*. That diagnostic tail is one place where the metaharness differs from chatbot evaluation, which often reports only a single aggregate success rate. The reporting scale is likewise explicit rather than hardwired into the procedure.

#block(fill: luma(245), inset: 1em, radius: 4pt)[
#set text(font: "DejaVu Sans Mono", size: 9pt)
```python
RUN-BENCHMARK-SUITE(policy, topics, seed, config)
1  topicBenchmarks <- empty list
2  topicTraces <- empty list
3  for j <- 0 to length(topics) - 1
4      topic <- topics[j]
5      topicSeed <- seed + config.topicSeedStride * j
6      learners <- BUILD-LEARNER-POPULATION(topicSeed, config.learnerCount)
7      simulations <- empty list
8      for each learner in learners
9          simulation <- SIMULATE-TEACHING(policy, topic, learner, config.theta)
10         append simulation to simulations
11     summary <- SUMMARIZE-TOPIC(topic,
12                                simulations,
13                                config.traceLimit,
14                                config.reportScale)
15     append summary to topicBenchmarks
16     append summary.trace to topicTraces
17 weakestTopic <- topic with minimum meanScore in topicBenchmarks
18 overallScore <- MEAN(meanScore for each topic summary in topicBenchmarks)
19 return (overallScore, weakestTopic, topicBenchmarks, topicTraces)
```
]

This is the full benchmark harness. It loops over topics, builds a learner population for each one, simulates the teaching interaction at the score-model level, and aggregates the results into a suite score. In algorithmic terms, it is a nested evaluation loop: topics on the outside, learners on the inside, summary at the end. The `config` argument makes clear that learner count, trace depth, reporting scale, seed stride, and harness coefficients are benchmark choices rather than theoretical necessities. This is the procedure that produces the benchmark reports cited in the results section.

#block(fill: luma(245), inset: 1em, radius: 4pt)[
#set text(font: "DejaVu Sans Mono", size: 9pt)
```python
EVOLVE-POLICY(basePolicy, focusTopic, iterations, seed, config)
1  baseline <- RUN-BENCHMARK-SUITE(basePolicy, [focusTopic], seed, config)
2  best <- baseline
3  acceptedCandidates <- empty list
4  exploredCandidates <- empty list
5  seenPolicies <- {basePolicy}
6  initialize PRNG with seed + config.evolutionSeedOffset
7  for iteration <- 1 to iterations
8      candidatePolicy <- MUTATE(best.policy, PRNG, iteration)
9      novelty <- NOVELTY-SCORE(seenPolicies, candidatePolicy)
10     candidateBenchmark <- RUN-BENCHMARK-SUITE(candidatePolicy,
11                                               [focusTopic],
12                                               seed
13                                               + config.evolutionSeedStride
14                                                 * iteration,
15                                               config)
16     improves <- candidateBenchmark.overallScore > best.overallScore
17     safe <- candidateBenchmark.weakestTopicScore
18             >= best.weakestTopicScore - config.weakestTopicTolerance
19     novelEnough <- novelty >= config.noveltyThreshold
20     record candidate, benchmark, and gate decision
21     if improves and safe and novelEnough
22         best <- candidateBenchmark
23         append candidate to acceptedCandidates
24     append candidate to exploredCandidates
25     insert candidatePolicy into seenPolicies
26 return (baseline, best, acceptedCandidates, exploredCandidates)
```
]

This is the metaharness improvement loop. It does not directly train a model. Instead, it mutates the *instructional controller*, evaluates the mutant in the harness, and accepts it only if three conditions hold: the score improves, the weakest topic does not collapse beyond the configured tolerance, and the candidate is sufficiently novel relative to previously explored policies. That combination of mutation, evaluation, and gating is the algorithmic heart of the paper's metaharness claim. Writing these gates as parameters rather than literals makes the point explicit: Keating's contribution is the control architecture, not one privileged set of thresholds.

== External archival evaluation

We analyzed the 22 JSON trace files stored in `test/traces/`. Because multiple traces existed for some topic x learner pairs, we retained the chronologically latest trace for each pair, yielding 16 sessions spanning four topics (`Derivative`, `Special Relativity`, `Stoicism`, and `Social Contract Theory`) and four learner models (`Llama-3.2-1B`, `LFM-2.5-1.2B`, `Qwen-2.5-1.5B`, and `Cloud-MiniMax-M2.5`). The retained set exactly matched `test/final_dataset.json`.

Each retained trace already contained three scalar labels: mastery, engagement, and clarity. We treated these as archived outcome labels. One record encoded scores on a 0-10 scale rather than the 0-1 scale used elsewhere, so we normalized that record by dividing by 10 and recorded the correction in `docs/generated/study-analysis.json`.

The external overall score was defined as the unweighted mean of mastery, engagement, and clarity. Because the dataset is small, we report bootstrap intervals rather than formal null-hypothesis tests. We also computed exploratory trace features, including empty turns, word counts, teacher redirection cues, and student-role contamination markers.

== Synthetic benchmark and robustness analyses

The internal benchmark uses `src/core/benchmark.ts`. Unless a focus topic is specified, the suite evaluates 14 topics. For each topic and random seed, the benchmark samples 18 synthetic learners and computes topic-level mean scores from mastery gain, retention, engagement, transfer, and confusion. The current study compared the repository default policy with the current evolved policy in `.keating/state/current-policy.json` over 200 seeds.

To probe overfitting, we separately summarized tuned-topic (`Derivative`) and non-tuned-topic mean deltas. To probe mechanism, we performed one-at-a-time ablations by swapping each current-policy parameter individually into the default policy and re-evaluating over the same 200 seeds. To probe optimization stability, we reran derivative-only evolution 30 times from the default policy using `src/core/evolution.ts`.

== Statistics and reporting

All derived numbers in the manuscript come from `bun scripts/study-analysis.mjs`, which writes `docs/generated/study-analysis.json` and `docs/generated/study-analysis.md`. The marimo notebook at `analysis/study_analysis.py` provides an inspectable analysis surface for peer review and exploratory review. External descriptive intervals were estimated with non-parametric bootstrap resampling. Synthetic robustness summaries are reported as empirical means and percentile ranges across seeds or reruns.
