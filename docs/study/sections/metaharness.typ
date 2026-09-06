#import "../preamble.typ": modest-table

= Current System and Design Rationale

== What changed

Keating now has three distinct evaluation entry points. `bench` summarizes recorded assessment and feedback evidence. `teaching-bench` executes new tutor continuations on training cases. `auto-improve` proposes a teaching skill and evaluates its exact revision on fresh paired comparisons before activation. The first operation cannot establish the effect of changing a tutor; the second can expose teaching behavior; the third makes a bounded decision about experimental use.

#figure(
  modest-table(
    columns: (1fr, 1.35fr, 1.35fr),
    table.header([Earlier failure mode], [Implemented response], [Remaining evidence gap]),
    [A policy change alters a retrospective proxy score], [A fixed recorded corpus has policy- and weight-independent scores], [Observed performance is not a causal treatment effect],
    [A prompt diagnostic or synthetic policy score authorizes use], [Only a validated skill revision can enter the new activation path], [Rubric judgments still need human calibration],
    [Evidence used for search appears to validate the result], [Training informs proposals; validation and a consumed holdout gate activation], [Public cases and semantic overlap can contaminate evaluation],
    [Discarding an edit also discards its rationale], [Evidence-linked hypotheses persist after rejection], [Long-run benefits of accumulated hypotheses remain unmeasured],
    [A changed prompt inherits an old score or changes a live session], [Content-addressed revisions and session pinning bind evaluation to instructions], [The bounded evaluator does not cover every live tool or interface]
  ),
  caption: [The redesign addresses specific evaluation defects without converting implementation safeguards into efficacy claims.],
  placement: top,
)

Legacy `evolve` still produces parameter proposals for inspection and research. It no longer installs an unvalidated policy through that command. Legacy `prompt-evolve` scores and snapshots remain diagnostics; the newest saved snapshot is not automatically the active teaching prompt. MAP-Elites and PROSPER-style selection remain available as research mechanisms, but they are not the new skill activation gate. A count of five feedback records is not a validation sample or evidence of improvement.

== Runtime, evidence, and revision state

The live runtime uses Pi in the terminal and a Pi Agent in the browser. It combines a base teaching prompt or selected persona with teaching tools and learner context. Local deterministic functions continue to produce inspectable pedagogical artifacts. The new shared experiment engine in `shared/evolution/` controls the evaluator, corpus, proposal, and decision independently of those live interfaces.

The experiment state has three complementary parts. *Raw evidence* stores the fixed case manifest, actual messages and tool calls, criterion judgments, errors, model/runtime attribution, and unique execution identifiers. *Hypotheses* record a proposed explanation or teaching adjustment, its evidence references, and whether it remains proposed, was supported offline, or was rejected. *Revisions* bind the base prompt and complete skill contents to a SHA-256 identifier, a parent revision, and an experiment record. Rejecting a candidate preserves its evidence and hypothesis; it leaves the incumbent active.

The deployed teaching procedure receives the base prompt and active skill instructions. It does not receive the hypothesis ledger, rubric, or held-out evaluation results through the evaluator interface. The proposer receives training evidence and retained hypotheses. A separate judging call receives the case rubric and actual execution, without the candidate's skill instructions. These are role and information boundaries; the default adapters can use the same underlying provider and model for all roles.

Before activation, the store saves the complete decision record and checks the active pointer under an exclusive lock. Later activation and resumed-session loading revalidate the revision and its saved evaluation evidence. Existing sessions retain their prompt revision; new sessions can use an accepted revision with the matching base persona. Changing the base prompt starts from that base's own empty skill revision instead of inheriting an unrelated evaluation result.

CLI/Pi records live under the current project's `.keating/state/teaching-evolution/`. Browser records use a separate IndexedDB database and Web Locks. The browser evaluator uses disposable storage; its evaluation and activation modules are excluded from the mutable NodePod boot bundle. This is a local trust boundary, not protection from a malicious owner rewriting the application or its database. Durable state is currently project-local or browser-origin-local, with no account-wide synchronization and no browser account namespace.

== Bounded teaching execution

Evaluation invokes the actual pedagogical runtime with a restricted tool set. A CLI episode starts a fresh Pi child process and temporary workspace, with in-memory sessions and no ambient project context or user extensions. Allowed tools are `plan`, `map`, `verify`, `quiz`, `grade_quiz`, and workspace-confined `read`. The browser adapter creates a fresh Pi Agent and disposable IndexedDB database with `deck`, `quiz`, `grade_quiz`, and `grade_question_checks`. It uses the selected model and thinking level. Shell execution, source edits, recursive evolution, and animation's nested inference are excluded from these evaluators.

The default episode limits are 90 seconds, six provider calls, eight tool calls, and 2,048 output tokens per provider call. CLI subprocess output is limited to 1 MiB; browser output is limited to 128,000 characters. Timeout and cancellation reach the running actor, and disposable workspaces are cleaned up. The judging and proposing adapters have no tools. These controls make experiments bounded and inspectable, but do not reproduce the full live environment: speech, arbitrary sandbox tasks, courses, collaboration, deployed authentication, and UI usability require separate evaluation.
