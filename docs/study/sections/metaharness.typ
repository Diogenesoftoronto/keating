= Keating as a Teaching Metaharness

== Why a metaharness is different from a chatbot

A tutoring chatbot takes a learner message and emits a response. Its behavior is largely determined by a model, a prompt, and conversational context. A teaching metaharness also decides what instructional act should happen next, which artifacts and evidence should exist around that act, what counts as sufficient evidence for improvement, and how a future policy may be revised when the current one fails.

Keating is metaharnessed along five axes:

1. *Interaction layer.* Provider-backed text, dictation, full-duplex voice, camera, and screen-sharing sessions deliver the teaching exchange through web and terminal surfaces.
2. *Evidence layer.* Learner profiles, session history, feedback, quizzes, question checks, flashcard reviews, goals, and revisit priorities persist beyond a single response.
3. *Artifact layer.* The system produces lesson plans, concept maps, animations, verification records, study plans, decks, benchmark reports, prompt-evolution snapshots, and policy traces.
4. *Governance layer.* Teaching behavior is parameterized by explicit policy controls, and learner-facing evolution is blocked until at least five real outcome signals exist.
5. *Improvement layer.* MAP-Elites explores diverse policies, PROSPER-style comparison selects across multiple objectives, prompt evolution writes reviewable snapshots, and auto-improvement can roll back a regressing candidate.

In practical terms, Keating does not ask only "what should the tutor say next?" It also asks:

- What diagnostic and learner state should exist before explanation begins?
- What scaffold should require reconstruction rather than agreement?
- What evidence distinguishes a plausible response from retained or transferable understanding?
- When a learner returns after time away, which material should be retrieved before new material is introduced?
- Which changes may be accepted, rejected, or rolled back after evaluation?

Those are metaharness questions, not only chatbot questions.

== Operational architecture and evidence boundary

The implementation has four operational layers. First, the Pi/OpenTUI runtime and React web agent run the live, provider-backed exchange. These paths may stream model text, structured tools, images, animations, audio, and video; they are intentionally non-deterministic and provider-dependent. Second, a shared tool and storage layer turns interactions into durable learner evidence and portable artifacts. Third, the local pedagogy core generates inspectable plans, maps, policies, traces, and deterministic fallback scores. Fourth, the improvement layer consumes that evidence through MAP-Elites, counterfactual evaluation when learner data exist, PROSPER-style preference, prompt evolution, and rollback-aware auto-improvement.

Several current product capabilities sit beside this core loop: browser-local model execution, remote sandbox routing, course workspaces, real-time collaboration, Anki import/export, and peer-to-peer course projection. They matter to delivery, privacy, and portability, but the present experiments do not evaluate their educational effect. Likewise, a successful build or deterministic benchmark is not evidence that a provider exchange, live audio path, collaborative room, or human-learning outcome works in deployment.

The production evidence boundary is stricter than the paper's internal stress-test path. When `LearnerState` is supplied, the benchmark uses recorded feedback, quiz results, and inferred learner-turn signals; policy evolution refuses to run below five outcome records. Synthetic learners remain available only when no learner state is supplied, principally for tests and optimizer experiments. The study invokes that fallback deliberately and labels all resulting gains as *within-harness*.

The nearest systems analogues are frameworks that optimize harness code or editable self-improvement procedures outside education @lee2026metaharness; @zhang2026hyperagents. Keating differs in the object being optimized: a pedagogical environment whose state, artifacts, objectives, and mutation rules are organized around diagnosis, retrieval, reconstruction, and transfer.

== Natural entry points for different readers

Readers from education can view Keating as an attempt to operationalize a mastery loop: diagnose, teach, probe, repair, retrieve, and transfer. Readers from ML can view it as a structured controller over provider-backed instructional policies. Readers from systems can view it as an orchestration layer that moves some intelligence from hidden model behavior into inspectable state, artifacts, and objective functions.

The rest of the paper keeps those perspectives aligned. The results section reports what the archived and synthetic evidence can support. The methods section formalizes the benchmark and optimization protocol. The limitations section marks the larger live system as unevaluated wherever direct evidence is absent.
