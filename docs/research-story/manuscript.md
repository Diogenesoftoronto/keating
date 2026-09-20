# Learning from the next turn

## A tutor has to decide how much help to give {#beginning}

A learner asks for a starting hint on **63 − 28**, without the answer. Keating replies: “Start by breaking 28 into friendly chunks relative to 63.” The simulated learner asks whether to split 28 into 3 and 25, or 20 and 8. Keating suggests subtracting 20, then 8. The learner computes 43, then 35.

This small exchange became the center of our latest experiment. It contains a teaching decision, an observable response to that decision, and a precise question: **what should the tutor learn from what happened?**

We followed that exchange from Keating’s runtime, through a frozen model that measures premature answer delivery, into three real model updates, and out to a fresh comparison of the resulting answers. **The pilot demonstrated the measurement-and-update pipeline and checked its effect on output quality.** With just two tutor actions, 37 target tokens, and one optimizer step per branch, feature-only and combined training preserved every measured pass/fail outcome; hindsight-only lost one pass.

That is the starting point for this report: a working research pipeline, an initial output check, and a concrete case for the larger studies needed to test whether the approach improves teaching.

This is the companion to [Learning to Teach](https://learning-to-teach-report-production.up.railway.app/), our earlier account of adapting a small model and progressively testing it in a more realistic teaching environment. The present work asks how those interactions could become evidence for the next policy update. The results below were recorded by 14 September 2026. [E1, E2](#evidence)

## From a better benchmark to a learning experiment {#journey}

The first report followed a recurring discovery. A model could learn Keating’s identity without reliably asking the learner to think. A response could look useful in isolation without following through over several turns. A tutor could talk about progress without a corresponding saved record. Each finding moved the benchmark closer to the application: real prompts, tools, learner actions, and memory built from interactions.

The next request was practical: make the Python work understandable and easy to change. We built reactive marimo notebooks around the repository’s calculations, benchmark definitions, training plans, and recorded results. NumPy, pandas, and Matplotlib became part of self-contained notebook environments. This gave us a way to inspect token alignment, advantage clipping, cost assumptions, and results without launching another training job.

As the research expanded, those notebooks became a useful discipline. A quantity needed a name, a source, and a visible meaning. Changing a slider showed how a loss changed. Recorded runs showed what happened to the model. Preparation, execution, and evidence became separately inspectable.

The research question sharpened to this: **can a measurement of the tutor’s action and feedback from the learner’s next turn provide complementary supervision?** The feature signal evaluates the teaching move. The next turn supplies evidence about its consequence. The experiment asks whether learning from both improves the tutor more than learning from either alone.

Here, *supervision* means the evidence used to guide a model update. *Complementary* means the two kinds of evidence help together more than either does alone. Testing that hypothesis became the project's focus. Unfamiliar terms are explained in the [glossary](#glossary); study boundaries are collected in [limitations](#limitations).

<div class="journey-map" aria-label="Research progression"><p><strong>Real interactions</strong><span>What did the tutor actually deliver?</span></p><span aria-hidden="true">→</span><p><strong>Measured behavior</strong><span>Can we recognize one teaching failure?</span></p><span aria-hidden="true">→</span><p><strong>Feedback and updates</strong><span>Can evidence reach the right tokens?</span></p><span aria-hidden="true">→</span><p><strong>Independent comparison</strong><span>Did the answers improve?</span></p></div>

## A dataset became a starting situation {#situations}

TutorMoments gave the project a promising connection to teacher judgment. Its Situation–Action–Result structure distinguishes why help was called for, what the tutor did, and what followed. That distinction fits an interactive tutor: deciding that a learner needs support is different from checking whether the delivered support was appropriate. [TutorMoments](https://huggingface.co/datasets/allenai/tutormoments-preview)

We wanted to see how Keating behaves when a learner uses its tools. We preserved the original material for reference and built a native adaptation path. An adaptation supplies the task and evidence available at a decision point. Keating must generate the next action; the learner controller must respond to what was delivered; the runtime must supply its own receipts.

We extended that approach to five source collections. The common adapter separates actor-visible context, learner evidence, and private evaluation material. It preserves original source identities, groups related records across repackaged datasets, and protects evaluation families before selecting development examples.

The first adaptation was deliberately small: twelve scripted development episodes from six TutorMoments moments, pairing ordinary conversations with session reopening. Later, twenty plumbing executions crossed twenty admitted families and produced twenty actual notes-action receipts. Authored tutor and learner policies checked the route through the runtime before model-driven episodes carried the experiment.

| Source adapter | Eligible development records | Eligible reference records |
| --- | ---: | ---: |
| MathDial | 772 | 2,849 |
| Bridge | 42 | 150 |
| MRBench / BEA | 0 | 355 |
| MathTutorBench bundled tasks | 0 | 1,262 |
| TutorMoments | 12 | 150 |
| **Total record admissions** | **826** | **4,766** |

The adapters produced starting states from 6,049 pinned source records. The two zeroes reflect protected-family exclusions. Shared conversations retain a common family identity across datasets. [E3](#evidence)

The inspector below puts selected original excerpts beside their native adaptations. Follow the retained problem, the new learner opening, and the assessment material kept outside the tutor's view.

The source annotations exposed the next research problem. Under our admitted explicit-cut policy, the TutorMoments action targets had too few labeled groups and insufficient class coverage for the intended fit. We needed labels available at the actual teaching decision. MathDial provided a workable first source-action experiment: 200 task-family views for recognizing a tagged probing move. It established a classification path, but a probing move can still be poorly timed or incorrect. **Recognizing a move did not tell us whether to reward it.** [E4](#evidence)

That led to a smaller, more testable target.

### Inspect the source and its adaptation {#dataset-inspector}

Choose a record to follow it from the original dataset into Keating. Each pair identifies the changes and the evidence available to the tutor. Open the review details to inspect provenance and assessment boundaries.

<!-- DATASET_INSPECTOR -->

## The same answer can deserve different treatment {#measurement}

We chose **premature answer delivery under an explicit hint-only request**. The experiment uses matched contrasts: the same answer can be appropriate when a learner asks for a worked solution and inappropriate when the learner asks to do the final step themselves.

Thirty independently authored tasks each supplied four records: a hint and a worked answer, each paired with a hint-only request and a worked-solution request. Only the answer under the hint-only request was labeled premature. This gives the readout a precise target: detect an answer delivered before the learner requested it.

All four variants stayed in the same task family. We fixed 18 training, six calibration, and six test families, giving 72/24/24 records. A separate agent reviewed these authored contrasts for arithmetic and labels.

The observer is a frozen **Qwen3.5-9B-Base**, paired with the matching **Qwen-Scope sparse autoencoder**, or SAE, at layer 12. An SAE expresses a dense hidden vector using a larger dictionary with only a small subset retained at each token. We used the published 4,096-wide hidden representation, 65,536-coordinate dictionary, and signed Top-K 50 convention. Model revision, dictionary revision, layer file, and token spans were pinned. [Qwen-Scope model card](https://huggingface.co/Qwen/SAE-Res-Qwen3.5-9B-Base-W64K-L0_50)

A small fitted readout combined **19 nonzero feature weights** into a score, using the frozen observer's representation of the interaction.

One way to understand this is to think of an interaction passing through a measuring instrument. The model produces a large internal numerical description, its [activations](#term-activation). The SAE rewrites that description using a sparse dictionary. A [probe](#term-probe) learns which combinations of those coordinates predict our label. The 19 weights belong to that small classifier. Keeping the observer frozen lets us use the same instrument before and after changing the tutor.

<figure class="wide"><img src="probe-comparison.svg" alt="On 24 authored test records, SAE Brier error is 0.0381, raw activation error is 0.0762, and the intercept-only text baseline is 0.1875."><figcaption>Held-out concept classification: 24 authored records across six task families. The text fit used only its intercept under the fixed recipe.</figcaption></figure>

The SAE readout achieved **23/24 classification accuracy**, Brier error **0.0381**, and ranking AUC **1.0** on the 24 test records. Lower Brier error means predicted probabilities are closer to the labels.

These numbers answer different questions. Accuracy counts decisions that were correct at a chosen threshold. [Brier error](#term-brier) penalizes confident mistakes more heavily than cautious ones. [AUC](#term-auc) asks whether premature answers generally receive higher scores than the other examples. An AUC of 1.0 here means perfect ranking on these 24 records. The text classifier's reported accuracy was 18/24 simply by predicting the majority class, which is why accuracy alone would have been misleading.

For every held-out task, changing the request from a worked solution to a hint increased the score on the identical worked answer. A fraction-reduction answer moved from 0.154 to 0.996. The readout responded to what the learner requested. That result earned a reward experiment. [E5](#evidence)

### Two probes, two questions

| Probe | Question it learns to answer | Training signal |
| --- | --- | --- |
| MathDial action probe | Did the tutor use a tagged probing move? | Source action annotations across 200 task-family views |
| Premature-answer probe | Did the tutor supply the answer after an explicit hint-only request? | Context-matched authored labels across 30 task families |

The first recognizes a teaching move. The second evaluates that move against the learner's request. We connected the second to the feature penalty used in the training experiment.

### Diagnose individual probe decisions {#probe-inspector}

Read the request and response, then compare the authored label with the measured score. The matched examples hold the answer fixed while changing the request. The error example shows where the chosen decision threshold misses a premature answer.

<!-- PROBE_INSPECTOR -->

## Does moving a feature change the answer? {#generation-inspector}

The probe could recognize an answer given too soon. We then asked a different question: **would changing one of its feature directions change what the model generated?**

We selected coordinate **31497**, the strongest positive weight in the fitted readout, and ran the pinned Base model under five conditions: unchanged, selected direction added, selected direction subtracted, a random direction, and comparison coordinate **4962**. The same learner request and decoding settings were used across each task's five conditions.

At layer 12, each intervention changed the representation used to choose the next token. Its magnitude was 2% of a fixed calibration scale. Generation was greedy—taking the highest-scoring next token—with a 96-token limit. This produces a controlled comparison that can be inspected token by token.

**Six of eight planned tasks completed all five conditions, producing 30 saved generations.** Both blinded reviewers agreed on every criterion. Each condition scored **0/4 on respecting hint requests**, **3/6 on correctness**, and **1/6 on all three criteria together**.

<figure class="wide"><img src="generation-outcomes.svg" alt="Across six completed paired tasks, every condition has zero of four hint-compliance passes and three of six correctness passes. The selected positive direction changes two token sequences, negative changes one, and both controls change none."><figcaption>Six completed task groups, five generation conditions and two blinded reviews. See <a href="#limitations">limitations</a> for the interrupted run and output-length boundary.</figcaption></figure>

Adding the selected direction changed **2/6** generated token sequences; subtracting it changed **1/6**. The random direction and comparison feature changed **0/6**. None of those changes altered a criterion verdict: there was **no measured improvement or degradation relative to this baseline**.

The chemistry example makes the result tangible. Baseline begins, “Hint: Count the oxygen atoms on each side of the equation.” Adding the feature changes that to, “Hint: Count the oxygen atoms on each side first.” Both then generate an imagined learner/tutor exchange and reveal a coefficient the learner had asked to work out. Other tasks repeat the prompt, invent learner turns, or supply a faulty search rule. The test exposed the behavior we need to fix.

This experiment completed another part of the research loop: a selected SAE direction reached live generation, and the resulting answers reached independent review. It also sharpened the next step. We need a stronger instruction-following starting policy and broader direction tests to turn a readable feature into useful behavioral control. The inspector keeps the complete output—including the awkward continuations—available for diagnosis.


<!-- GENERATION_INSPECTOR -->

## Two views of the same teaching action {#interaction}

The proposed architecture separates responsibilities. The actor teaches through Keating. A learner simulator chooses a response. The runtime records what was accepted and delivered. A frozen observer measures the interaction. A hindsight teacher scores the original tutor response with the benefit of later feedback. The training service changes the actor.

This separation draws on two research directions: reusable feature-based supervision in [Features as Rewards](https://arxiv.org/abs/2602.10067), and hindsight-conditioned self-distillation in [Aligning Language Models from User Interactions](https://arxiv.org/abs/2603.12273). Our experiment connects their two signals to the same original tutor action.

For the subtraction trace, a separate Qwen3.5-9B instruction model generated the learner's responses.

<!-- TRACE_EXPLORER -->

The runtime repaired one malformed learner response, delivered the corrected message, and preserved both events in its ledger. Two tutor actions acquired the subsequent learner feedback needed for hindsight training. The final tutor response remained in the episode record after the decision horizon closed.

The two usable actions received premature-answer scores of **0.102627** and **0.030449**. The feature objective, F, applied their negatives as small action-level penalties. This objective penalizes the estimated risk of giving the answer too soon, once per action.

The hindsight objective, S, supplied the actual next simulated learner event to a frozen teacher before replaying the original tutor completion. The student saw its original context. Both scored the same target token IDs. This asks how later evidence changes the teacher’s evaluation of what the tutor already said.

Models generate text as [tokens](#term-token), which may be whole words, word pieces, or punctuation. For each original tutor token, the teacher and student assign a probability. Their difference in [log probabilities](#term-logprob) provides the hindsight signal: later evidence can make a token more or less favored. The teacher is a fixed copy of the actor with extra context. This feedback is privileged during training; it was unavailable when the original response was generated.

The observations were now tied to delivered events and original actor tokens. That made the two-action chat segment usable for a controlled update. [E1, E4](#evidence)

## The evidence reached the optimizer {#updates}

We ran three sibling updates from the same saved starting weights: **F-only**, **S-only**, and **F+S**. Each trained on the same two actions, totaling **37 original tutor completion tokens**. Each arm completed one acknowledged optimizer step. The three branches isolate each signal’s contribution.

The common starting checkpoint already included an earlier feature update.

<figure class="wide"><img src="native-combined-update.svg" alt="Recorded feature, hindsight, and combined update signals on the two native actions and their original completion tokens."><figcaption>Actual update measurements. These derivatives are with respect to target log probabilities, not model parameters.</figcaption></figure>

All **2,738 context targets per arm** had exactly zero recorded gradient. Learner and tool-result tokens were context, not tutor-policy targets. Independent arithmetic replay reproduced the transported derivatives within **3.43 × 10⁻⁹**. All three arms saved checkpoints; their sampler adapter archives were downloaded and hash-checked.

A [gradient](#term-gradient) tells the training system which numerical direction would reduce the specified loss. A [mask](#term-mask) marks which tokens may receive that signal. Here, the mask prevents the system from training the tutor to produce the learner's words. The [optimizer](#term-optimizer) applies the update to model weights. We then evaluated fresh outputs from the resulting checkpoints.

The feature and hindsight derivatives had cosine **0.313** in target-log-probability coordinates: the two signals partly aligned on this batch.

This is a real integration result: a frozen feature measurement and subsequent learner feedback reached the intended actor tokens in a hosted optimizer. The next question required new outputs, evaluated independently of the reward. [E1](#evidence)

## Did the pipeline preserve usable outputs? {#behavior}

We froze eight new authored tasks covering hint requests, legitimate worked answers, and two unrelated capabilities. Two seeds and four actual checkpoint arms produced **64 responses**. Every scheduled response completed normally. We used the same actor-visible questions across arms, with no output-dependent retries, replacements, or best-of selection.

Two fresh automated reviewers graded shuffled responses without checkpoint labels or the SAE reward. They agreed on all eight overlapping overall verdicts and 23 of 24 overlapping criterion scores.

<figure class="wide"><img src="checkpoint-behavior.svg" alt="Initial, F-only and F+S each pass 10 of 16 trials. S-only passes 9. Every trained arm repeats Initial verbatim on 14 of 16 matched pairs."><figcaption>Fresh outputs after one update per arm: eight task families, with two seeds per checkpoint.</figcaption></figure>

<!-- BEHAVIOR_EXPLORER -->

| Checkpoint | Hint requests | Worked answers | Other capabilities | Total |
| --- | ---: | ---: | ---: | ---: |
| Common Initial | 4/8 | 3/4 | 3/4 | **10/16** |
| F-only | 4/8 | 3/4 | 3/4 | **10/16** |
| S-only | 4/8 | 2/4 | 3/4 | **9/16** |
| F+S | 4/8 | 3/4 | 3/4 | **10/16** |

Each trained arm repeated Initial’s text exactly on **14/16 matched task/seed pairs**. F-only and F+S changed two texts each without changing a pass/fail verdict. S-only changed two texts and lost one worked-answer pass. Failures included revealing the surviving side in a binary search, missing a forbidden combination, calling elemental hydrogen a compound, and failing an exact output-format requirement.

For **F-only and F+S**, every overall pass/fail verdict matched Initial. The two arms preserved the measured behavior after a real update, meeting the pilot's immediate aim of checking for obvious damage. S-only's lost pass identifies a concrete regression to investigate.

## How small was this experiment? {#scale}

**Thirty-seven target tokens is the text in the two short hints above.** That was the entire training dose for each branch. The 120 probe records trained the measuring instrument; the 64 evaluation responses tested the resulting checkpoints.

The closest published precedents make the difference in scale concrete. They also show why “how long until gains?” needs a unit: an interaction is one response and its follow-up; an optimizer step changes weights; an epoch is one pass through a training set. The comparison keeps those units explicit.

<figure class="wide"><img src="training-exposure.svg" alt="Three exposure comparisons on logarithmic axes: Keating's two interactions versus SDPO's 50 and 200 interaction milestones; two tuples versus a 50,000-tuple offline corpus; and one optimizer step versus 300 and 360 feature-reward steps."><figcaption>Each horizontal tick represents ten times the exposure. RLFR is the method in Features as Rewards. The three panels use different units; the table gives the corresponding tasks and reported outcomes.</figcaption></figure>

| Run | Training exposure | When improvement was reported | What the result measures |
| --- | --- | --- | --- |
| **Keating, this matched pilot** | 2 actions; 37 target tokens; 1 step per branch | One endpoint after that step: F and F+S unchanged; S lost one pass | Model-reviewed behavior on 8 authored task families |
| **SDPO, online style personalization** | Sequential simulated user interactions | Above 85% win rate after **50 interactions**; above 95% after **200** | Judge preference for a requested writing style |
| **SDPO, offline alignment** | About **50,000 interaction tuples** from 14,000 conversations; 2 epochs, batch 32 | Gains reported at the trained endpoint; earliest beneficial checkpoint not specified here | Alignment, instruction-following and capability benchmarks |
| **Features as Rewards** | **360 optimizer steps**, batch size 32,768 | Most reported gains present by about **step 300**; correction performance still rising at 360 | Hallucination correction/retraction |

The SDPO figures and setup come from [Sections 4.1–4.2 and Appendix C of *Aligning Language Models from User Interactions*](https://arxiv.org/html/2603.12273v1#S4). The feature-reward milestones come from [Section 4.2 and Appendix C.2 of *Features as Rewards*](https://arxiv.org/html/2602.10067v1#S4.SS2).

Even the 50-interaction personalization example uses **25 times** our two training interactions. The offline example uses roughly **25,000 times** as many interaction tuples; the feature-reward run takes **360 times** as many optimizer steps, with far larger batches. Our two actions came from a single short exchange. Increasing both exposure and diversity is the next step.

For a hardware reference, *Features as Rewards* reports 12.43 hours on 128 H200 GPUs **for reward computation over its first 300 steps**. This is one component of the training workload. [Appendix I](https://arxiv.org/html/2602.10067v1#A9)

### Why larger experiments are warranted

Published gains from both hindsight learning and feature-based rewards give us a **credible reason for optimism**. The next study expands the three things this pilot barely sampled: teaching situations, repeated updates, and independent evaluation families. More varied examples strengthen the training signal, repeated updates give adaptation time to accumulate, and broader evaluation improves our ability to detect it.

Our working hypothesis is that useful gains will emerge when the model receives a stronger, more varied signal over repeated updates. The funding case is to test that hypothesis at a meaningful scale, with a capable starting policy, a validated reward, and independent checks at several training doses.



<!-- BENCHMARK_FRONTIER -->

<!-- CONTEXTUAL_TEACHING -->

## What the detours taught us {#lessons}

The difficult parts were often the boundaries between components. GPU dependency setup failed before one planned layer sweep and before one native measurement attempt. Their failure receipts identified the setup work still needed. A replacement native measurement job eventually completed with the pinned observer and was terminated. The first generation job then exposed a separate issue: the output-head loader rejected a verified cache symlink. Resolving that path within the pinned cache allowed the replacement worker to generate real outputs.

An artifact audit also caught numerically identical features serialized differently: integral floats became JSON integers, breaking a type-sensitive source hash. We preserved the faulty file and recovered the original representation with matching row and artifact hashes. The lesson was practical: reproducibility requires the exact measurement path, not just similar-looking numbers.

More consequentially, a valid request format did not guarantee an in-role learner, and a completed controller did not guarantee a sound lesson. Missing artifacts, unsupported state claims, invalid learner actions, and absent assessments stayed visible. These findings explain why the proposed 180-episode paired pilot remains unrun, despite implemented adapters and a candidate pool.

By the end of the controlled-generation work, the shared **$100 research cap** held **$61.30 in conservative reservations**. The later v4 pilot's saved accounting snapshot records **$68.30 reserved and $31.70 unallocated**, including its retained $4 allocation. These are dated experiment reservations, not live provider balances. Failed reservations remain counted; the contextual grading and training integration added no hosted research run.

Each failure now has a place in the record and a concrete next action. The infrastructure makes both the successful path and its failure points inspectable.

## The next experiment worth funding {#next}

We are seeking support for a **stage-gated study of whether context-sensitive feature rewards add value beyond learner hindsight alone**. The contribution to test is the connection between a measured action and its observed consequence, evaluated through the teaching application.

The next tranche should pay for reliable experiments and expert review as well as compute. Price the work after freezing its workloads, then report cost per accepted trace and per independently measured improvement, including failures.

### Establish a stronger common starting point

Qualify an instruction/tool-capable policy on complete native episodes. Review the learner’s role, actual activity delivery, accepted submissions, and resulting state. Build an independently accepted training set with diverse teaching decisions. Use the existing 30-context development pool for the planned chat/interactive comparison.

**Deliverable:** reviewed golden traces and a paired native pilot that reports every attempted episode, its outcome, and its failure cause. Resolve failures in complete interactions before expanding training.

### Test the measuring instrument beyond its first corpus

Build the planned 600-example grouped concept set around natural learner evidence. Include recurring failure, productive reasoning, warranted unsolicited explanations, and occasions when withholding help is the error. Compare text, raw-activation and SAE classifiers on the same labels, including chat-to-artifact transfer. Keep need, delivered action and retrospective outcome inputs separate. Extend the six-task controlled-generation comparison across predeclared magnitudes, layers and independent families, with opposite-sign, random and comparison directions.

**Deliverable:** a feature card defining the readout’s validated uses, abstention rules, and measured intervention effects on teaching behavior and correctness.

### Compare teaching updates at a meaningful, matched dose

From a quality-qualified common start, compare strong prompting, matched-budget supervised fine-tuning, F-only, S-only, and F+S. Freeze source-family splits before branching and exclude both v4 versions from training. Keep simulator, observer and contextual readouts fixed within each comparison. Evaluate v4.1 as a new condition with a complete cohort, not as a rescore of old replies. Include situations that call for explanation without a request and situations that call for learner space, so neither perpetual questioning nor automatic answer delivery can win.

**Deliverable:** learning curves across predeclared training doses, paired behavior results, failure analysis, and cost per accepted example. Score intermediate checkpoints to establish when gains emerge. Use those curves and the capability checks to decide whether to expand F+S, revise the signal, or retire the combination.

### Bring the result back to people

After a successful native comparison, run a consented learner study with fresh problems and delayed transfer. Validate the simulator against actual learner behavior, then test sequential updates, retention of prior capabilities, and promotion/rollback over time. Voxq’s evidence-conditioned panels provide a related application for this architecture, with a separate population study.

**Deliverable:** evidence about learning and generalization, followed by a sequential continual-learning experiment.

## What we can conclude {#conclusion}

The journey has sharpened the research question. First we made a teaching interaction reproducible. Then we connected one measured failure and the learner's next turn to real weight updates. V4 exposed how a correct answer, an unreliable tool sequence and an unsupported assessment can fail in different ways. Reviewing those cases exposed another weakness: our learner dialogue sometimes told the tutor how to teach. V4.1 replaces that coaching with the learner's actual work and confusion.

The pilot accomplished its central engineering purpose. A compact SAE readout recognized premature answers, its measurements and subsequent simulated feedback reached the intended training tokens, and the resulting checkpoints produced fresh, reviewable answers. At just two actions, 37 target tokens and one step per branch, F-only and F+S preserved every measured verdict; hindsight-only exposed one regression. The later v4 failures identify work needed for reliable complete lessons. They do not form a matched before-and-after training result.

The new contextual grading and training path makes the next hypothesis precise: reward help that fits the learner's need, including explanations the learner did not know to request. We have tested that connection through actual local gradients and original-token masks. Fitting the broader readouts and running a new hosted comparison are the next empirical steps.

That is a concrete funding case for a larger study: expert-reviewed natural contrasts, a qualified starting policy, repeated matched updates and independent evaluation at intermediate checkpoints. The published precedents used far more exposure than our feasibility run. A stronger and more varied signal may reveal useful gains that a two-action test could neither produce nor resolve. We now have both a working update path and a clearer definition of the behavior worth improving.

The long-term ambition remains a tutor that learns to give better help from the interactions it has. The next milestone is specific: establish that contextual feature feedback adds useful behavior beyond hindsight alone, then test that behavior with people and across sequential learning tasks.

## Limitations and open questions {#limitations}

**Scale and outcomes.** This was a feasibility pilot: two training actions from one exchange, 37 completion tokens and one optimizer step per branch. Eight evaluation families provide little power to resolve small effects; repeated seeds are nested observations. F and F+S showed neither improvement nor degradation on these tasks, while S lost one pass. This is not an equivalence test, a broad safety result, or evidence of human learning. No checkpoint was promoted. The matrix and list tasks measure model capability retention; learner retention and delayed transfer remain unmeasured.

**What scaling can establish.** Larger runs can create a stronger adaptation signal and measure smaller effects. They do not guarantee a gain for this reward or the F+S combination. The published comparisons use different models, tasks, batch sizes and objectives. Their interaction and step counts illustrate exposure, not equivalent compute or a forecast. Reported improvement milestones are not necessarily the earliest detectable gain; the 12.43-hour figure covers reward computation only.

**Data and review.** Source admissions count starting states, not people or completed lessons. Development and reference counts overlap, and some sources share conversations. Some reference families were exposed during development; pretraining decontamination is unverified. The probe corpus is authored, and both its review and checkpoint grading were model-assisted. One overlapping checkpoint-review criterion remained unresolved before unblinding; a separate correctness failure still determined those responses’ overall verdicts. No official TutorMoments-versus-native score comparison or human panel was run. Source licenses, attribution and inherited restrictions remain attached to each adaptation; selected public excerpts are provided in the inspector.

**Measurement scope.** The premature-answer readout was tested on six authored families with related vocabulary across splits. Its negative class means that this particular failure was absent: an unhelpful hint can still be negative. The text baseline collapsed to its intercept, so these results do not establish superiority over a tuned text classifier. An observer feature represents the model's reading of an interaction, not a person's mental state. Probe accuracy establishes classification, not causal control or general teaching quality. Artifact transfer and a broader layer comparison remain open.

**Controlled generation.** The time-bound run completed six of eight planned tasks. It used one selected feature column, one magnitude, greedy Base-model continuation and reused evaluation tasks. Both capability tasks are missing, all outputs hit the 96-token cap, and semantic independence of the comparison feature is unverified. Changing generated tokens establishes a local output effect under these settings; it does not establish a causal teaching feature or improvement from the full 19-weight reward. Exact duplicate review triples were assessed once per reviewer and expanded back to the paired conditions.

**The v4 development extension.** The v4.0 live challenge attempted two cases from one family on two checkpoints. One of four scheduled slots completed; a malformed completion halted one bridge and a tool loop exhausted the other case's call budget. The completed response sequence scored 4/8 in one independent model review. It has no probe activations yet. This is additional failure discovery, not a paired quality estimate or evidence that training caused the failures. The 12-case offline replay confirms execution plumbing. V4 is public development material, not a sealed release holdout. The new token heatmap reproduces one earlier measured score; localization accuracy remains untested. The 27B profile is metadata-pinned, and the continual coordinator has offline tests; neither a 27B extraction nor a live sequential curriculum has run.

**V4.1 and contextual training.** The revised dialogue is a new evaluation condition; no v4.1 model cohort or contextual hosted update has been reported. The two-stage classifier protocol and reward consumer are implemented and tested locally. Broader activation readouts still require fitting, calibration and independent evaluation. The interactive reward example uses authored labels, not measured probe probabilities. Hashes and exact spans verify evidence binding, not the truth of a judgment. Both public v4 versions are excluded from the new training path, but public development exposure still prevents calling either a sealed release holdout.

**Execution and generalization.** The successful training segment was text chat with a simulated learner. It included no interactive artifact or independent learning assessment. The learner’s first malformed draft remained outside the tutor conversation, and the last tutor response had no subsequent learner event, so it was excluded from hindsight training. Earlier full-episode quality gates failed, and the 180-episode pilot remains unrun. The common Initial checkpoint included an earlier feature update and was not a qualified SFT warm start. Gradient comparisons use target-log-probability coordinates, not full parameter gradients. Downloaded adapter archives establish retained files, not restored inference or optimizer state. Persimmon, a Voxq population study, sequential continual learning and release promotion remain future work.

**Accounting.** Reservations conservatively bound shared-budget work and retain failed allocations. They are not invoices, an account balance or a next-phase grant estimate, and they exclude engineering and review labor. Exact provenance, historical snapshots and failure receipts are documented in the [evidence audit](evidence-audit.md).

## A plain-language glossary {#glossary}

These definitions describe the terms as used in this report.

### Actor / policy {#term-policy}
The model that chooses what the tutor says or does. A policy is the rule, represented here by learned model weights, for choosing actions from the available context. Keating's runtime executes the supported actions.

### Activation {#term-activation}
An internal numerical representation produced while a model processes input.

### Sparse autoencoder (SAE) and feature {#term-sae}
An SAE learns a dictionary for expressing dense model activations using relatively few active coordinates. We call those coordinates features. Some may help predict a recognizable behavior, but a coordinate is not automatically a meaningful concept. Our Top-K 50 encoder retains 50 coordinates per token from a 65,536-coordinate dictionary.

### Probe / readout {#term-probe}
A small classifier trained to predict a specified label from another model's representations. Our probe combines 19 weighted SAE features to estimate premature answer delivery. It does not train the frozen observer itself.

### Frozen model {#term-frozen}
A model whose weights are kept unchanged during an experiment. A frozen observer supplies a consistent measuring instrument. A frozen teacher supplies a fixed scoring reference, even when its input contains additional feedback.

### Token and completion {#term-token}
A token is a unit of model text, often a word piece or punctuation. The completion is the generated response after the input context. The two short tutor replies in this experiment contained 37 completion tokens.

### Log probability {#term-logprob}
The logarithm of a token's probability under a model. Logs make products of small probabilities easier to handle. A teacher–student log-probability difference compares how strongly they favor the same token.

### Hindsight / self-distillation / SDPO {#term-hindsight}
Hindsight supplies later feedback to a fixed teacher copy of the model, which then scores the original response. Self-distillation means learning from that model-derived teacher signal. SDPO refers here to self-distillation-based policy optimization; our S objective is a specified sampled-token version. It does not give future feedback to the actor at decision time.

### Reward, advantage, and loss {#term-reward}
A reward states what an experiment values. An advantage weights how an action should be encouraged or discouraged relative to the declared recipe. A loss is the numerical objective the optimizer minimizes. In the historical pilot, a narrow feature score becomes a small negative penalty. The new contextual recipe maps a 0–2 response grade to −1, 0 or +1 at scale 1, counting the action once. 

### Gradient {#term-gradient}
A derivative indicating how a small change in a quantity would change the loss. Our plots show derivatives with respect to target log probabilities.

### Mask {#term-mask}
A set of positions selected for a computation. A training mask lets tutor-generated tokens receive a loss while excluding context tokens such as the learner's reply. A span mask can likewise select only the response being measured by the observer.

### Optimizer step {#term-optimizer}
One application of an algorithm that adjusts trainable weights using gradients. One completed step demonstrates execution. The amount, quality and variety of training evidence determine whether it has a useful effect.

### Checkpoint, adapter, and sampler {#term-checkpoint}
A checkpoint saves a model state. An adapter is a smaller set of additional trainable weights used with a base model. A sampler generates outputs from a chosen saved state using specified settings. A saved adapter archive may omit optimizer state needed to resume training exactly.

### SFT, PPO clipping, and anchor {#term-training}
Supervised fine-tuning (SFT) teaches a model from accepted examples. PPO-style clipping bounds part of the update objective when current token probabilities move relative to the probabilities used to generate the data. An anchor discourages excessive change from a reference.

### Brier error {#term-brier}
The average squared difference between predicted probability and a binary label. Predicting 0.9 when the label is 1 contributes 0.01; predicting 0.9 when it is 0 contributes 0.81. Lower is better on the evaluated data.

### AUC {#term-auc}
Area under the receiver operating characteristic curve: a ranking measure. It describes how often a positive example is scored above a negative one, with ties handled appropriately. AUC 0.5 is chance-level ranking; 1.0 is perfect ranking on the measured set.

### Logit {#term-logit}
The readout's score before it is converted to a probability between zero and one. Each scaled feature activation contributes its value multiplied by a fitted weight. These contributions add together; a sigmoid function converts the combined score into a probability. The inspector shows that arithmetic for five selected features.

### Calibration {#term-calibration}
Agreement between predicted confidence and observed frequency. Among comparable examples given a score near 0.8, roughly 80% should carry the positive label if the scores are calibrated. Our corpus has separate training, calibration and test partitions.

### Span contribution and benchmark diagnostics {#term-span}
A span is an exact section of text identified by its start and end positions. For this linear probe, each selected token contributes an amount to the final logit. Adding every contribution to the calibrated bias reproduces the response score. A large contribution tells us where the arithmetic accumulates, not whether changing that word causes better teaching. Benchmark diagnostics link these measurements and independent review evidence to the original response.

### Native activity and OpenUI {#term-openui}
A native activity is a question or control the application can actually display and accept input from. OpenUI is Keating's structured format for those activities. Converting a source multiple-choice screen into an unanswered OpenUI question lets a new learner choose an option through the real runtime.

### Contextual fit, overhelp and underhelp {#term-context-fit}
Contextual fit asks whether the teaching move addresses what the learner needs at that moment. Overhelp takes over useful work unnecessarily. Underhelp leaves the learner without an explanation or support they need. Both depend on preceding evidence; neither can be identified from the presence of an answer or a question alone.

### Localization and abstention {#term-localization}
Localization identifies the exact words or artifact content associated with a judgment. Abstention means the system lacks enough reliable evidence to judge. An unknown score is kept missing; it does not become a failure or a zero training reward.

### Task family, holdout, and leakage {#term-holdout}
A task family groups related examples, variants, and shared source material. A holdout is reserved from fitting or selection to test generalization. Leakage occurs when information that should be withheld influences training, selection, or the model's input. Keeping paraphrases and reused conversations together reduces one source of leakage.

### Ablation and paired comparison {#term-ablation}
An ablation removes a component to test its contribution, such as F-only versus F+S. A paired comparison uses the same task and sampling conditions across alternatives. Multiple seeds are repeated samples within a task, not new independent task families.

### Causal intervention {#term-causal}
A deliberate change, such as perturbing a feature direction, followed by a comparison against controls. It asks whether changing that quantity changes behavior. A probe that predicts a label has shown correlation; it has not yet shown this causal effect.

### Runtime receipt {#term-receipt}
A record from the application that an event was accepted, delivered, or persisted. A tutor saying “I saved your progress” is not a receipt. A receipt for a submitted answer establishes submission, not understanding.

### Transfer, retention, and continual learning {#term-transfer}
Learner transfer means applying knowledge to a new problem or setting. Learner retention concerns what remains after time. Model capability retention concerns preserving earlier behavior after updates; these are different outcomes. Continual learning studies repeated updates over time while maintaining useful prior capabilities.

## Evidence and reading {#evidence}

This narrative was reconstructed using Entire’s local session metadata and session records, then checked against saved experiment artifacts. Saved artifacts establish which proposed runs completed. The evidence audit records exact session identifiers, limits of attribution, and source hashes. Older notes are treated as dated snapshots; the 14 September comparison supersedes their “next: compare checkpoints” statements.

- **E1.** [Actual feature and hindsight updates](https://github.com/Diogenesoftoronto/keating/blob/main/docs/native-combined-results.md). Two delivered native actions, three acknowledged updates, exact masks and numerical replay. [Packaged numeric data](native-combined-update.json).
- **E2.** [Fresh checkpoint comparison](https://github.com/Diogenesoftoronto/keating/blob/main/docs/checkpoint-behavior-results.md). Frozen task/seed protocol, blind review, unchanged scores and limitations. [Packaged numeric data](feature-hindsight-evaluation.json).
- **E3.** [Native scenario adapters](https://github.com/Diogenesoftoronto/keating/blob/main/docs/native-scenario-adapters.md). Source admissions, family exclusions, visible/private projections, and replay checks.
- **E4.** [Dated completion audit](https://github.com/Diogenesoftoronto/keating/blob/main/docs/plans/native-research-completion-audit.md). Source-supervision limits, earlier canaries, failed layer sweep, pilot preparation, and subsequent corrections.
- **E5.** [Premature-answer experiment](https://github.com/Diogenesoftoronto/keating/blob/main/docs/premature-answer-reward.md). Authored contrasts, exact model/SAE, probe results and restricted reward scope. [Packaged metrics](probe-summary.json).

These repository paths identify the working sources and may precede publication on the remote branch. The download includes frozen local evidence excerpts so readers do not depend on unpublished GitHub files. [Evidence audit and hashes](evidence-audit.md) · [Research brief](funding-brief.md) · [Editable manuscript](manuscript.md) · [Package manifest](snapshot.json).

- **E9.** [V4.1 and contextual training](contextual-teaching.html): exact [dialogue revisions](dialogue-revisions.json), grading-to-update contract and local verification. [Original freeze](v4.0-manifest.json) · [Revised freeze](v4.1-manifest.json).
