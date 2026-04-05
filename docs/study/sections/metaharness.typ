= Keating as a Teaching Metaharness

== Why a metaharness is different from a chatbot

A tutoring chatbot takes a learner message and emits a response. Its quality is mostly determined by the prompt, the model, and short conversational context. By contrast, a metaharness decides what *kind* of instructional act should happen next, what artifacts should exist before that act, what evidence counts as success, and how future policies should be revised when current ones fail.

Keating is metaharnessed along four axes:

1. *Artifact layer.* The system can generate lesson plans, concept maps, animations, verification checklists, prompt-evolution reports, benchmark reports, and policy traces.
2. *Governance layer.* Teaching behavior is parameterized by a policy with explicit controls such as formalism, retrieval practice, and challenge rate.
3. *Evaluation layer.* Policies are benchmarked against a synthetic learner suite rather than revised purely by intuition.
4. *Improvement layer.* Mutation, selection, and archival comparison operate on the teaching harness itself.

In practical terms, Keating does not ask only "what should the tutor say next?" It also asks:

- What diagnostic state should exist before explanation begins?
- What scaffold should force reconstruction rather than agreement?
- What evidence would show that a policy is helping one learner type while harming another?
- Which parameters of the teaching environment should be changed after a failed run?

Those are metaharness questions, not chatbot questions.

The nearest systems analogues are recent agentic frameworks that optimize harness code or editable self-improvement procedures outside education @lee2026metaharness; @zhang2026hyperagents. Keating differs in the object being optimized. The target is not a coding harness or a general self-improving agent, but a pedagogical environment whose artifacts, objectives, and mutation rules are defined around explanation quality, retrieval, reconstruction, and transfer.

== Natural entry points for different readers

Readers from education can think of Keating as an attempt to operationalize a mastery loop: diagnose, teach, probe, repair, retrieve, and transfer. Readers from ML can think of it as a structured controller over an LLM-based instructional policy. Readers from systems can think of it as a benchmarked orchestration layer that moves some of the intelligence from the model's hidden behavior into inspectable artifacts and explicit objective functions.

The rest of the paper keeps these perspectives aligned. The results section focuses on what the harness learns from data. The methods section formalizes the benchmark mathematically and operationally.
