= Methods

== System overview

This revision targets Keating 3.3.0. The system has two related but distinct execution graphs. CLI, Pi, OpenTUI, and MCP surfaces converge on the Node project coordinator. The web app runs a browser-compatible Pi agent and a separately maintained browser port of the core, then routes workspace operations to browser-local, host, remote, or cloud adapters according to declared capabilities. The present paper evaluates neither interface graph directly; it focuses on the shared teaching-policy model, archived traces, and deterministic internal harness.

Within the Node path, lesson plans, maps, learner-state transforms, and fallback benchmark scores are local and inspectable. Some core operations remain model-assisted: animation authoring, factual verification, optional LLM judging, prompt optimization, and Ax/GEPA paths can call a provider and must surface a fallback or pending state. The paper's synthetic results set `KEATING_LLM_BENCHMARK` off and use the algebraic fallback only.

A teaching policy contains nine scalar controls:

- analogy density
- Socratic ratio
- formalism
- retrieval practice
- exercise count
- diagram bias
- reflection bias
- interdisciplinary bias
- challenge rate

These controls do not encode a single answer. They define a region of instructional behavior. The metaharness evaluates that region against topic structure and learner evidence, then uses the result to compare or revise a policy.

`LearnerState` records sessions, topics, feedback, quiz results, goals, and review evidence. The engagement module converts last-seen time, session count, and mastery estimates into a revisit timeline using an exponential decay heuristic with configurable half-life, due threshold, minimum interval, and urgency tiers. This is motivated by evidence for distributed practice @cepeda2006, but its calibration is not estimated from the present archive. More importantly, the production benchmark treats learner evidence and synthetic simulation differently: when learner state is supplied it scores recorded outcomes only, and policy evolution refuses to run until at least five feedback, quiz, or inferred learner-turn signals exist. The synthetic branch used below is an explicit internal fallback, not a substitute silently blended into a learner's record.

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

$ T_r = M (tau_0 + tau_i i + tau_t t) $

$ C = mu_C + gamma_o O + gamma_f |f - u| + gamma_c |c - p| $

where $M$ is mastery gain, $R$ retention, $E$ engagement, $T_r$ transfer, and $C$ confusion.

Finally, the session score is a weighted composition with bundle `Theta_S`:

$ S = sigma_M M + sigma_R R + sigma_E E + sigma_T T_r - sigma_C C $

Topic-level benchmark scores are the mean of $S$ over the learner population for that topic, multiplied by a reporting scale parameter. Suite-level benchmark score is the mean over topics.

The harness is therefore defined by its structure plus its calibration:

$ Theta = {omega_nu, omega_x, e_max, Theta_O, Theta_M, Theta_R, Theta_E, Theta_T, Theta_C, Theta_S} $

where each `Theta_*` denotes a small family of scalar parameters. The concrete coefficients are implemented in `src/core/benchmark-real.ts`; `src/core/benchmark.ts` selects between real-outcome scoring, deterministic simulation, and an explicitly enabled LLM judge. The equations present the fallback as a parameterized metaharness even though the 3.3.0 implementation fixes several values, including three synthetic learners per topic, a topic-seed stride of 97, and a reporting scale of 100. The formulation is interpretable rather than psychologically complete: its purpose is to make the path from policy coordinates to a score inspectable.

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

This procedure samples the synthetic learner population for one topic. Before Keating can evaluate a teaching policy internally, it needs a distribution of pseudo-learners with varying prior knowledge, abstraction comfort, persistence, and anxiety. The study uses the implementation's fixed count of three per topic. That is an engineering choice, not a claim that three simulated profiles approximate a human population.

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
39 transfer <- CLIP(masteryGain
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

This procedure aggregates a set of learner-level simulations into a topic-level result. The benchmark preserves both population averages and diagnostic tails. The mean score describes average behavior under the score model; the strongest and weakest pseudo-learners expose which fit terms dominate. The pseudocode leaves the reporting scale explicit, while the current implementation fixes it at 100.

#block(fill: luma(245), inset: 1em, radius: 4pt)[
#set text(font: "DejaVu Sans Mono", size: 9pt)
```python
RUN-BENCHMARK-SUITE(policy, topics, seed, weights, learnerState?, config)
1  outcomes <- learnerState ? EXTRACT-REAL-OUTCOMES(learnerState) : empty
2  if learnerState exists and outcomes is not empty and topics is not focused
3      topics <- unique topics represented in outcomes
4  topicBenchmarks <- empty list
5  for j <- 0 to length(topics) - 1
6      topic <- topics[j]
7      if learnerState exists
8          topicOutcomes <- outcomes matching topic
9          simulations <- topicOutcomes is empty
10                        ? empty
11                        : [SCORE-REAL-OUTCOMES(topicOutcomes, policy, topic, weights)]
12     else
13         learners <- BUILD-LEARNER-POPULATION(seed + 97 * j, 3)
14         simulations <- map learners through SIMULATE-TEACHING(policy, topic, learner, weights)
15     summary <- SUMMARIZE-TOPIC(topic, simulations, config.traceLimit, 100)
16     append summary to topicBenchmarks
17 weakestTopic <- topic with minimum meanScore in topicBenchmarks
18 overallScore <- MEAN(meanScore for each topic summary in topicBenchmarks)
19 dataSource <- learnerState exists ? real-evidence status : synthetic
20 return (overallScore, weakestTopic, topicBenchmarks, dataSource)
```
]

This is the current benchmark boundary. A caller that supplies learner state does not receive a synthetic blend: for an unfocused benchmark, only topics represented in real outcomes are scored; an explicitly focused topic without outcomes produces an empty summary. A caller that omits learner state enters the deterministic fallback used by tests and the present study. The returned trace labels the data source so a user-facing report can distinguish sufficient evidence, sparse evidence, no evidence, and synthetic execution.

The user-facing product coordinator applies an additional gate before calling the search routine: if learner state is supplied, at least five real outcomes must be available. `mapElitesEvolve` itself is a lower-level primitive and does not enforce that threshold, so direct research and Ax callers remain responsible for their own evidence boundary.

#block(fill: luma(245), inset: 1em, radius: 4pt)[
#set text(font: "DejaVu Sans Mono", size: 9pt)
```python
MAP-ELITES-EVOLVE(basePolicy, focusTopic, iterations, seed, grid, learnerState?)
1  baseline <- RUN-BENCHMARK-SUITE(basePolicy, focusTopic, seed,
2                                  DEFAULT_WEIGHTS, learnerState)
3  place baseline in grid(formalism, socraticRatio)
4  candidates <- [baseline]
5  initialize PRNG with seed
6  for iteration <- 1 to iterations
7      if iteration is in the initial random quarter
8          policy, weights <- RANDOM-POLICY-AND-WEIGHTS(PRNG)
9      else
10         parent <- uniformly sampled filled grid cell
11         policy, weights <- MUTATE(parent.policy, parent.weights, PRNG)
12     benchmark <- RUN-BENCHMARK-SUITE(policy,
13                                      focusTopic,
14                                      seed + 11 * iteration,
15                                      weights,
16                                      learnerState)
17     if learnerState exists
18         counterfactual <- BENCHMARK-PERTURBED-OUTCOMES(policy, weights, learnerState)
19     replace the matching grid cell if empty or benchmark score is higher
20     append (policy, benchmark, counterfactual) to candidates
21 winner <- PROSPER-PAIRWISE-WINNER(candidates,
22           objectives = [score, counterfactual robustness, mastery,
23                         transfer, low confusion, evidence readiness])
24 persist grid and decision ledger
25 return (baseline, winner, grid, candidates)
```
]

This is the current default improvement loop. It does not train model weights. It explores policy and objective-weight coordinates, retains the best score within each behavioral grid cell, and then applies a PROSPER-style pairwise preference across all candidates. Diversity and final selection are therefore separate: MAP-Elites maintains a repertoire, while PROSPER chooses one policy. Unlike the older hill-climbing implementation, the final preference does not impose a monotone scalar-score or weakest-topic gate. The standardized regressions reported in the results are evidence of that distinction, not noise to be hidden.

== External archival evaluation

We analyzed the 22 JSON trace files stored in `test/traces/`. Because multiple traces existed for some topic x learner pairs, we retained the chronologically latest trace for each pair, yielding 16 sessions spanning four topics (`Derivative`, `Special Relativity`, `Stoicism`, and `Social Contract Theory`) and four learner models (`Llama-3.2-1B`, `LFM-2.5-1.2B`, `Qwen-2.5-1.5B`, and `Cloud-MiniMax-M2.5`). The retained set exactly matched `test/final_dataset.json`. This timestamp-based rule was chosen to make archival evaluation deterministic and auditable: later reruns replace earlier reruns by a visible provenance field rather than by manual judgment.

Each retained trace already contained three scalar labels: mastery, engagement, and clarity. We treated these as archived outcome labels. One record encoded scores on a 0-10 scale rather than the 0-1 scale used elsewhere, so we normalized that record by dividing by 10 and recorded the correction in `docs/generated/study-analysis.json`.

The external overall score was defined as the unweighted mean of mastery, engagement, and clarity. Because the dataset is small, we report bootstrap intervals rather than formal null-hypothesis tests. We also computed exploratory trace features, including empty turns, word counts, teacher redirection cues, and student-role contamination markers.

== Synthetic benchmark and robustness analyses

The internal benchmark uses `src/core/benchmark.ts` with `KEATING_LLM_BENCHMARK` disabled, which routes simulation to the algebraic model in `src/core/benchmark-real.ts`. Unless a focus topic is specified, the suite evaluates 14 topics. For each topic and random seed, it samples three pseudo-learners and computes topic means for mastery gain, retention, engagement, transfer, confusion, and their weighted score.

The evaluated vector is the exact JSON snapshot at `docs/study/evaluated-policy.json`, frozen from the Keating 3.3.0 `me-candidate-33` state. The analysis compares it with `DEFAULT_POLICY` under `DEFAULT_WEIGHTS` over seeds 1-200. Because that candidate originated in full-suite work, per-topic comparisons are robustness checks, not held-out tests. To probe mechanism, we swapped each frozen-policy coordinate individually into the default and reevaluated the same 200 seeds.

To probe search stability, we ran `mapElitesEvolve` 30 times from `DEFAULT_POLICY`, focused on *Derivative*, with 24 candidates and seeds 1-30. Every run received a distinct temporary grid path, preventing persisted elites from leaking between reruns. Candidate search scores use co-evolved objective weights and candidate-specific seeds, so we retain them only as provenance. For the reported delta, the selected policy and `DEFAULT_POLICY` are reevaluated on the same run seed with `DEFAULT_WEIGHTS`. Production normally uses 48 candidates and a persistent 10 x 10 grid; the smaller isolated study protocol is a bounded diagnostic, not a reconstruction of the frozen policy's original search history.

We did *not* run a dedicated reward-hacking study in which the optimizer was challenged against hidden holdout metrics, adversarially perturbed harness coefficients, or external human judgments. That omission is important because any policy-search loop can in principle exploit regularities in the scoring function rather than improve the underlying pedagogical behavior the score was meant to represent.

== Statistics and reporting

All derived numbers in the manuscript come from `bun scripts/study-analysis.mjs`, exposed as the `keating:study-analysis` devenv task. The script writes the versioned `docs/generated/study-analysis.json` and `docs/generated/study-analysis.md`; the JSON includes protocol metadata, every seed result, and every optimizer rerun. The marimo notebook at `analysis/study_analysis.py` provides an inspectable analysis surface. External descriptive intervals use 5,000 non-parametric bootstrap resamples with deterministic pseudo-random seeds. Synthetic robustness summaries are empirical means, percentiles, and observed counts across seeds or isolated reruns; they are not confidence intervals over human learners.
