# Testing Strategy

The testing strategy follows an Antithesis-style mindset: prefer a small number of semantic system laws over brittle snapshot trivia.

## System Laws

1. Lesson plans preserve pedagogical order.
   - orientation comes before formal core
   - practice appears before final reflection
   - no phase is empty

2. Policy mutation stays inside valid bounds.
   - every scalar remains within `[0, 1]`
   - `exerciseCount` remains an integer within `[1, 5]`

3. Benchmark scores stay bounded and interpretable.
   - each per-topic score stays within `[0, 100]`
   - confusion stays within `[0, 1]`

4. Evolution is monotone with respect to its acceptance rule.
   - an accepted candidate must beat the current best overall score
   - accepted candidates must not catastrophically degrade the weakest topic
   - every candidate must carry an explicit gate decision report

5. The end-to-end artifact pipeline is durable.
   - scaffold -> plan -> map -> benchmark -> evolve creates readable artifacts and a persisted policy

## Test Forms

### Property Tests

- randomized policies and topic inputs should always produce coherent lesson plans
- repeated benchmark runs on fixed seeds should remain deterministic

### Fuzz Tests

- random topic strings, random policies, and repeated map generation should not crash
- outputs should remain non-empty and bounded

### Acceptance Tests

- run the full local artifact pipeline in a temporary directory
- verify that plans, maps, benchmark reports, evolution reports, trace files, and policy state are all created

## Future Antithesis Workload

The next step is a stateful workload that mutates topics and policies over long sequences:

- create scaffold
- benchmark
- evolve
- benchmark again
- generate maps for multiple topics
- switch focus topic
- restore prior policy
- assert no artifact corruption and no out-of-range policy fields

That workload should pair `always` invariants with explicit reachability evidence so a green run cannot simply mean "the interesting path never happened."
