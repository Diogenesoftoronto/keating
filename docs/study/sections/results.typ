#import "../preamble.typ": modest-table

= Results

== The evidence stack

The paper uses two evidence layers.

1. *Archival external evaluation.* We analyze teaching traces stored in the repository under `test/traces/`.
2. *Internal synthetic benchmark.* We evaluate policies with the harness implemented in `src/core/benchmark.ts`.

The two layers answer different questions. The archival layer asks what kinds of concrete successes and failures appear in recorded sessions. The synthetic layer asks whether the policy-search machinery is robust inside the benchmark it is designed to optimize.

The repository contains 22 raw trace files, including repeated runs for some topic x learner pairs. We imposed a deterministic curation rule: retain the latest trace by timestamp for each topic x learner pair. This yielded 16 retained sessions, matching the checked-in snapshot `test/final_dataset.json`. The timestamp rule matters methodologically, not just administratively: it fixes the evaluation set by temporal provenance and avoids quietly selecting whichever repeated run looked best in hindsight. One retained derivative trace for `Qwen-2.5-1.5B` contained `mastery=8`, `engagement=7`, and `clarity=8` while the rest of the archive used the 0-1 scale; we normalized that record to 0.8, 0.7, and 0.8 and recorded the correction in the generated analysis bundle.

#figure(
  modest-table(
    columns: 3,
    table.header([Component], [Value], [Interpretation]),
    [Raw archived traces], [22], [All preserved teaching transcripts before curation],
    [Retained topic x learner pairs], [16], [Archival evaluation set used in this paper],
    [Excluded duplicate earlier runs], [6], [Older runs for the same topic x learner pair],
    [Score corrections], [1 record], [Single 10x encoding error normalized before aggregation],
    [Synthetic topics], [14], [Internal benchmark tasks implemented in code],
    [Synthetic learners per topic], [18], [Pseudo-learners sampled per topic and seed]
  ),
  caption: [Evidence layers and curation rules.]
)

== Archival performance is heterogeneous across topics and learners

After normalization, the mean archival overall score, defined as the unweighted mean of mastery, engagement, and clarity, was 0.61 with a 95% bootstrap interval of 0.515-0.705. Performance varied sharply by topic. *Special Relativity* was strongest at 0.75 (0.596-0.883), followed by *Derivative* at 0.654 (0.454-0.767), *Social Contract Theory* at 0.613 (0.500-0.762), and *Stoicism* at 0.425 (0.283-0.558).

This pattern is substantively useful. The physics and calculus topics are structurally friendly to prediction, worked examples, and misconception repair, whereas Stoicism demands introspective application. Keating remains clear on Stoicism, but clarity does not translate into learner uptake as reliably as it does in the more formal domains.

#figure(
  modest-table(
    columns: 5,
    table.header([Topic], [n], [Overall], [Mastery], [Interpretation]),
    [Special Relativity], [4], [0.750 (0.596-0.883)], [0.695 (0.570-0.815)], [Strong transfer from intuitive thought experiment to formal structure],
    [Derivative], [4], [0.654 (0.454-0.767)], [0.600 (0.387-0.775)], [Conceptual calculus teaching is strong but not uniformly clean],
    [Social Contract Theory], [4], [0.613 (0.500-0.762)], [0.537 (0.463-0.650)], [Mixed engagement and mixed transfer],
    [Stoicism], [4], [0.425 (0.283-0.558)], [0.287 (0.175-0.463)], [Explanation often exceeds genuine learner uptake]
  ),
  caption: [Archival evaluation by topic. Values are means with 95% bootstrap intervals.]
)

Learner-model heterogeneity was also substantial. `Qwen-2.5-1.5B` scored highest overall at 0.779 (0.675-0.867), whereas `Llama-3.2-1B` scored lowest at 0.458 (0.367-0.550). We do not interpret these as broad claims about model families. The dataset is too small for that. The relevant result is narrower: the metaharness is not uniformly robust across simulated learner profiles, even in a small archive.

== Student-role contamination is a central failure mode

The traces reveal a particularly important failure mode for agency-preserving instruction: student-role contamination. In some sessions, student turns begin to speak like a teacher or assistant, for example opening with formulaic tutor language instead of reconstructing the concept as a learner. Using a simple heuristic over student turns, 5 of the 16 curated sessions showed at least one contamination marker.

These sessions performed worse. Sessions without contamination had mean mastery 0.575 and mean overall score 0.642, compared with 0.430 and 0.540 for contaminated sessions. Because the sample is small, we treat this contrast as descriptive. Nonetheless, it is exactly the kind of failure a metaharness should detect: not merely whether the content is correct, but whether the learner is sounding fluent without evidencing ownership of the idea.

== Synthetic policy gains are robust and generalize beyond the tuned topic

Keating's current policy (`keating-candidate-22`) was evolved on *Derivative*, not on the entire suite. That makes the full-suite benchmark a useful internal check against narrow overfitting. Across 200 seeds, the current policy improved the default policy by 6.703 points overall (2.5th-97.5th percentiles: 6.341-7.093), winning on 200/200 seeds. The mean delta on *non-derivative* topics was 6.704 (6.276-7.112), essentially identical to the derivative-specific gain of 6.704 (5.172-8.232).

We also reran derivative-only evolution 30 times from the default policy. The best evolved policy beat the baseline in 29 of 30 runs, with mean gain 5.768 points. Within the harness, policy search is therefore stable enough to be useful rather than purely anecdotal.

#figure(
  modest-table(
    columns: 4,
    table.header([Synthetic analysis], [Result], [n], [Interpretation]),
    [Default vs. current full-suite benchmark], [+6.703 points (6.341-7.093)], [200 seeds], [Current policy beats default on every sampled seed],
    [Derivative-only topic delta], [+6.704 points (5.172-8.232)], [200 seeds], [Large tuned-topic gain],
    [Non-derivative mean delta], [+6.704 points (6.276-7.112)], [200 seeds], [Comparable gain on untuned topics],
    [Derivative evolution reruns], [29/30 wins; mean +5.768], [30 runs], [Mutation-and-gate procedure is usually improving]
  ),
  caption: [Synthetic robustness checks for the current policy.]
)

== Synthetic ablations show what the metaharness currently rewards

The current policy differs from the default policy by nine scalar parameters. One-at-a-time ablations show that the largest synthetic gains come from maximal retrieval practice (+3.137 points when swapped into the default policy), lower challenge rate (+2.324), and higher interdisciplinary bias (+0.877). Increasing diagram bias or reflection bias alone reduces mean benchmark score by about 0.4 points each.

This is a useful diagnosis of the metaharness itself. The benchmark is highly sensitive to retrieval and overload control, but less sensitive to reflective richness in isolation. That does not mean reflection is unimportant pedagogically. It means the current harness is better at rewarding some desirable instructional traits than others. The same diagnosis also surfaces a further risk: once a policy optimizer can see that retrieval-heavy, lower-overload settings are disproportionately rewarded, it may learn to push those knobs in ways that increase benchmark score without producing correspondingly better teaching in the real world. We did not run a dedicated reward-hacking audit in the present study, so these gains should be read as *within-harness* gains rather than as proof that the optimizer cannot exploit benchmark idiosyncrasies.

#figure(
  modest-table(
    columns: 3,
    table.header([Parameter swapped into default], [Mean synthetic delta], [Interpretation]),
    [retrievalPractice], [+3.137], [Strongest driver; the harness strongly rewards enforced recall],
    [challengeRate], [+2.324], [Reducing overload is the second largest contributor],
    [interdisciplinaryBias], [+0.877], [Transfer-oriented prompting helps modestly],
    [analogyDensity], [+0.445], [Analogical pacing helps, but less than retrieval or challenge control],
    [diagramBias], [-0.406], [Visual emphasis alone is not sufficient in the current harness],
    [reflectionBias], [-0.408], [Reflection prompts alone are not reliably rewarded]
  ),
  caption: [One-at-a-time ablations reveal what the synthetic benchmark currently values.]
)
