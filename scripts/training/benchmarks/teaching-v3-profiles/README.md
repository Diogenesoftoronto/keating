# Keating teaching v3.2: learner context and later feedback

`keating-teaching-v3-profiles`, version **3.2.0**, is a public development suite with 23 episodes, 120 learner messages and 100 rubric dimensions. It derives from the frozen [v3.0 CLI suite](../teaching-v3/README.md), keeping its original 12 case IDs and central problems, and adding four matched-context episodes while changing the learner language and response expectations. It is a separate benchmark: use its own manifest and do not pool its scores with v3.0.

The central task is choosing useful help from context. Learners say things such as “Wait, why?”, offer a partly right attempt, return after closing the terminal, or reveal a constraint after the tutor has responded. They seldom specify the pedagogical method. Replies should feel like a clear conversation with a tutor, including simple questions when questions help. Necessary units, mathematical restrictions and careful explanations still matter.

## What changed

- Short, uneven learner turns replace directions to produce worked examples, alternative reasoning, formal comparisons and answer-format instructions.
- Later confusion, revised attempts and new constraints test adaptation. Each tutor turn is judged only against information then available; future feedback cannot make an earlier reasonable choice wrong.
- The original twelve cases add `conversational_fit`: clear, direct, context-sensitive replies without unnecessary teacherly framing or rigid templates. This is a behavioral judgment, not a word-count limit, a ban on precision or a demand for slang.
- Existing anchors now accept multiple useful approaches. A focused clarification can be appropriate when a consequential ambiguity remains. The evaluator must not invent a hidden learner preference or treat momentary confusion as a lasting trait.
- The final goal case no longer mandates an unrequested form-status write. It still requires the tutor to avoid claiming completion when error recovery remains unresolved.

The 12 families are fractions, JavaScript arrays, algebra, physical rates, probability, JavaScript closures, caching, SQL, statistics, project learning, literary reading and assessment feedback. Each episode has five or six learner messages. Three reopen the same session; two start a fresh session while retaining local state. Four authored files provide lesson material. Six narrow state checks cover explicitly requested feedback and goal writes; they are separate from teaching judgments.

## Interpret the evidence carefully

These are authored scripts, not collected human conversations. A later “I'm lost” reports the scripted learner's current state; it does not prove that the candidate caused confusion. Similarly, a later correct attempt is not a measured learning gain. Messages introduce their own concrete attempts rather than assuming a variable tutor question or answer occurred. The scripts stay fixed and do not simulate every possible human reaction.

References include observable learner cues, limits on inference and a temporal review rule. Rubrics and references remain outside model requests. `evidence_steps` and `after_step` use zero-based indices over all steps, including session events. Review actual new replies and tool outcomes at the indicated step. Missing evidence stays unknown; runtime completion, cost, token count and number of questions or tool calls are not teaching-quality scores. Human, agent and API review provenance must remain distinguishable; calibration is not assumed.

The runtime is the actual headless Keating Pi CLI/TUI loop with local tools and filesystem persistence. Canonical terminal interactions use JSON in `keating-ui` fences. This suite does not establish browser rendering, Flue delivery, terminal pixels or successful UI submissions. The headless profile excludes the legacy native quiz dialog: a cancelled dialog must not be interpreted as a learner's failed answer. Canonical UI actions and `grade_quiz` can remain available, but a paper worksheet label is not a pending quiz result and these text scripts do not invent submissions. SQL/code reasoning must not be presented as execution through a tool that is unavailable. A generated verification checklist is not independent external fact checking.

## Validate, run and review

From the repository root, validation makes no model calls:

```sh
rtk uv run --project scripts/training --locked --no-sync python scripts/training/benchmark_v3.py validate --suite scripts/training/benchmarks/teaching-v3-natural
```

To run an available registered model through the real CLI harness, replace the uppercase arguments. This makes provider calls, and the output directory must be new:

```sh
rtk uv run --project scripts/training --locked --no-sync python scripts/training/benchmark_v3.py run OUTPUT_DIRECTORY --suite scripts/training/benchmarks/teaching-v3-natural --provider PROVIDER_ID --model MODEL_ID
```

Use `--case-id CASE_ID` for a single episode. For offline integration, use `--tape-directory TAPE_DIRECTORY` instead of provider/model arguments. Offline tapes are plumbing evidence, not model quality. See `run --help` for current custom-endpoint settings and provider exclusions; keep credential values outside artifacts.

Validate separately authored, evidence-bound reviews with:

```sh
rtk uv run --project scripts/training --locked --no-sync python scripts/training/benchmark_v3.py review RUN_DIRECTORY REVIEW_DIRECTORY REVIEW_OUTPUT_JSON
```

Freeze suite and runtime hashes for each run. Shared case IDs support aligned inspection of the same family, not an assumption that v3.0 and v3.1 are identical inputs. A changed score may reflect prompt or rubric changes as well as candidate behavior. Preserve previous manifests and results, disclose the suite version and use a new version for subsequent edits.

Keep these authored evaluation conversations out of training corpora. They are still public, repeatedly usable development targets, not sealed holdouts or promotion gates. Generalization, delayed retention and human learning require independent evidence.

## Matched context probes

Four additional episodes form two pairs: fraction addition and JavaScript loop bounds. Each pair ends with the identical request, “Can we do one more?” Earlier attempts provide different evidence of current understanding. Evaluate whether the tutor uses that evidence to choose a useful next move; neither a particular strategy nor a permanent ability label is prescribed. The condition metadata and evaluator notes are withheld from the tutor.

Use the snapshot commands in the linked harness plan and pass `--runtime-root` to keep concurrent application edits out of a measured run. V3.0 results remain tied to their original definitions; do not pool them with this version.

## Stored learner backgrounds

Four additional episodes form two profile pairs. The learner messages are identical within each pair; the stored background differs. Each short fictional profile names prior learning evidence, current study and personal context. The tutor receives this information through the production CLI learner-context loader, not an extra system persona or a user instruction to choose a particular analogy.

Review useful structural connections to demonstrated prior knowledge. Merely naming a hobby is insufficient. Topic exposure is not mastery; age, language and occupation are not proxies for ability. Accept a neutral example or a brief clarification when it serves the individual better. Later feedback can revise the tutor’s assumptions, without retroactively penalizing an earlier reasonable response.

These fixtures are synthetic and must not be represented as real learner outcomes. Verify the actual profile/context receipt before scoring personalization; absent context is a harness failure.

## Profiles formed through ordinary interaction

Three lifecycle episodes start with an empty named learner and no seeded biography or target facts. The learner only asks questions and makes attempts. The tutor can quietly maintain grounded, tentative observations through the production profile-memory tools. A fresh session tests whether useful information is retrieved and revised appropriately. Score actual stored facts, evidence, corrections and subsequent use separately; a claimed save is not a persisted update. Temporary frustration is not lasting ability, worksheet content is not personal identity, and a correct attempt is bounded evidence rather than mastery.

Named files live in `.keating/profiles/<name>.json`, with memory, goals and sessions in the corresponding profile namespace. The benchmark uses the production `--profile` selection mechanism and automatic learner-context loader.
