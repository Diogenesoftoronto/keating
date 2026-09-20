# Learning from the next turn

## Research brief · Keating · 14 September 2026

**Question:** Can a context-sensitive measurement of a tutor’s action and feedback from the learner’s next turn provide complementary supervision for better teaching?

Keating is an interactive AI tutor. Our earlier *Learning to Teach* project moved evaluation from isolated responses toward actual prompts, tools, learner actions, and memory. This follow-up connects those interactions to inspectable model updates. **The pilot's immediate purpose was to verify the pipeline and check for obvious output degradation.**

### What we accomplished

- Implemented native scenario adapters for TutorMoments, MathDial, Bridge, MRBench/BEA, and bundled MathTutorBench tasks. Pinned original material stays separate from adaptations; source families and private answers stay identifiable. The current cache yields 826 eligible development records and 4,766 reference records, with family overlap and exclusions tracked.
- Ran a pinned Qwen3.5-9B-Base observer with its matching layer-12 Qwen-Scope SAE. A 19-weight readout classified premature answer delivery on a 120-record authored contrast corpus. It scored 23/24 correct on six held-out task families, with Brier 0.0381.
- Executed F-only, hindsight-only (S), and F+S updates on the same two actual native tutor actions with delivered simulated learner feedback. Each arm trained 37 original completion tokens in one acknowledged optimizer step. All context gradients were zero, and numerical replay agreed within 3.43e-9.
- Completed a fresh, blinded, 64-response comparison. Initial, F-only, and F+S each passed 10/16 trials; S-only passed 9/16. Each trained arm repeated Initial’s text on 14/16 matched pairs.

- Completed six of eight planned SAE intervention tasks, with five conditions each and two blinded reviews. The selected positive/negative directions changed 2/6 and 1/6 token sequences; the controls changed none. Every criterion verdict stayed unchanged: 0/4 hint compliance, 3/6 correctness and 1/6 overall per condition.

### A stronger test now exposes the next engineering work

V4.0 combined 12 cases, 73 learner turns and 10 task families into a development challenge. Every case completed an offline replay through the actual Pi runtime. In a bounded live pilot, one of four scheduled case/checkpoint slots completed; an independent model reviewer scored it 4/8. The remaining slots exposed malformed output, tool looping and a halted bridge.

Eight TutorMoments screens now have reviewed, unanswered OpenUI multiple-choice adaptations; four incomplete source situations were deferred. A real Pi canary accepted a choice and continued the tutoring interaction. A span inspector reconstructs an earlier measured probe score from 49 token contributions, while v4 probe scores remain unknown pending extraction. The sequential-learning coordinator and a pinned 27B observer candidate are prepared for the next live experiment.

### The benchmark changed the training question

Reviewing v4 exposed learner prompts that prescribed the teaching style. V4.1 rewrites all 73 turns as natural attempts and confusion while retaining the original frozen v4.0 evidence. The tutor must infer when to explain and when to leave room, including times when an unsolicited explanation is warranted.

The same judgment now enters training. A two-stage classifier assesses learner need, then localizes the delivered response and judges appropriateness, substance and correctness. Its action reward can encourage useful help and penalize both takeover and withheld support. The feature-only and combined update paths pass 59 focused local tests, including gradient direction and prompt masking. A new hosted experiment follows broader readout fitting and calibration.

### Why this warrants the next experiment

The implementation closes a measurement-to-update integration gap. Each score is traceable to a frozen observer, a delivered action, original actor tokens, and a saved checkpoint. **The next step is to expand from two actions and one update to a diverse training study with learning curves.** The pilot gives that study a working foundation and a recorded output baseline.

Published work gives a concrete reason for optimism. [SDPO personalization](https://arxiv.org/html/2603.12273v1#S4.SS2) reported above 85% style-preference win rate after 50 interactions and above 95% after 200; its offline alignment study used about 50,000 interaction tuples. [Features as Rewards](https://arxiv.org/html/2602.10067v1#S4.SS2) ran 360 optimizer steps, with most measured gains present by roughly step 300.

These results give us a concrete reason to pursue larger experiments. The next study combines a capable starting policy, more varied teaching examples, repeated updates, and independent outcome checks. Intermediate checkpoints will show how behavior changes with training exposure. The full report compares the published milestones in their original units.

### What support would enable

1. **Reliable native evidence.** Qualify complete tutor/learner episodes, including delivered activities and accepted submissions, then execute the paired development pilot. Report every attempted episode and its outcome.
2. **A tested measuring instrument.** Strengthen text controls, expand family-held-out contrasts, test prose-to-artifact transfer, and independently grade controlled SAE interventions.
3. **A matched training study at several doses.** Compare prompting, supervised fine-tuning, F, S, and F+S from the same qualified starting point. Expand accepted interactions and independent test families; evaluate intermediate checkpoints to find when gains appear. Freeze splits, doses and outcome criteria before generation.
4. **Human validation.** After a successful native comparison, run a consented study of fresh-problem performance and delayed transfer. Follow with a sequential retention and rollback study.

We seek compute support, educator time for annotation and review, and collaborators in interpretability, learner simulation, and evaluation. A tranche should have a frozen workload, priced compute, review labor, deliverables, and a stop/continue decision.

The saved post-v4 pilot snapshot of the shared $100 research cap records $68.30 reserved and $31.70 unallocated, including failed grants.

### Limitations

The pilot establishes execution and an initial output check, not improved teaching or broad equivalence. S-only lost one pass. Eight evaluation families and six probe test families limit generalization; the text baseline was intercept-only. Published milestones involve different tasks and recipes, so larger scale is a testable hypothesis rather than a guarantee.

No human learning benefit, causal teaching feature, complete 180-episode pilot, deployed continual learner, or Persimmon/Voxq population validation has been demonstrated. The intervention study stopped at six complete paired tasks; both capability tasks are missing and every output reached its 96-token limit. It used one direction, one magnitude and greedy Base continuation. All headline results use authored tasks and/or simulated learners; review is model-assisted. Data admissions count starting states, with overlap across lanes. Budget reservations are not invoices and exclude engineering labor. A complete next-phase grant has not been priced.

**Next success criterion:** demonstrate that adding the frozen feature signal improves preregistered delivered behavior beyond hindsight alone and matched baselines, then test whether that behavior helps people learn.

Read the companion report and its packaged evidence audit for methods, provenance, limitations, and the full journey.

The original v4.0 pilot and revised v4.1 benchmark are separate conditions. No v4.1 model outcomes or new contextual hosted update are claimed. The broader contextual probes still need fitting and calibration; the earlier narrow SAE results remain historical.
