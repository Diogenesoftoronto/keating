# OpenUI and tool-conversation dataset

The current dataset is **openui-conversations.json**, version 2. It contains 12 synthetic sessions, 48–50 messages each: 8 train and 4 validation, split by whole topic family. There are 588 messages, 294 assistant targets, 72 native tool calls, 72 serialized learner responses, 102 OpenUI surfaces and six 20-question exams.

The shorter **openui-sft.json** version 1 remains as an initial focused grammar seed (24 train / 8 validation). Do not concatenate it with version 2 without reconciling topic splits: their holdouts overlap the other corpus's training topics.

## What version 2 teaches

- A preference question, explanation, diagnostic mistake, feedback, retry and transfer.
- Resumable flashcards through OpenUI `Flashcards`, with concrete authored cards and follow-up after a review.
- Resumable quizzes through OpenUI `Quiz`, with multiple-choice, true/false, recall and transfer questions.
- `grade_quiz` for submitted open-ended answers; objective answers are already scored.
- `grade_question_checks` only for pending comprehension responses, never preferences.
- `remember_learner_profile` for an explicitly requested preference and `feedback` for an explicit signal.
- Twenty-question `Exam` surfaces, including a switch from independent testing to assisted practice.
- `Simulation` and `SharedNotes`, with predictions and explanations.
- Identity and generative learning theory, without claiming practice proves mastery or feedback instantly changes weights.

Training topics: equivalent fractions, discounts, loop boundaries and unit prices. Held-out topics: area and arithmetic mean. Guided and independent journeys use different activity order. Topic holdouts still share curriculum templates; this is not novel-interaction generalization proof.

## Build and validate

Use the existing uv environment described in PILOT_SERVING.md. First export the current application prompt and tool declarations:

```bash
rtk bun scripts/training/export_system_prompt.ts .keating/outputs/training/openui-context/system-prompt.txt
rtk bun scripts/training/build_openui_conversations.ts
rtk bun test scripts/training/test_openui_sft.test.ts scripts/training/test_openui_conversations.test.ts scripts/training/test_report.test.ts
rtk proxy env UV_CACHE_DIR=/tmp/keating-uv-cache HF_HOME=/tmp/keating-hf-cache UV_PROJECT_ENVIRONMENT=/home/diogenes/Projects/keating/.keating/training-venv uv run --project scripts/training --locked --no-sync python scripts/training/prepare_openui_conversations.py --output-dir .keating/outputs/training/openui-conversations-v2-new
```

Quiz and flashcard creation never calls the native `quiz` or `deck` tools. Canonical `complete-quiz` and `complete-deck` actions are validated and committed to isolated memory, then serialized as learner turns. The current application prompt now directs creation through OpenUI. Historical trained checkpoints predate this guidance change.

Generation executes the actual local teaching and assessment tool implementations against isolated in-memory storage. It creates no learner account records and makes no provider calls. The source catalog has no application system prompt or credentials. The private compiled JSONL files prepend the exact verified Keating prompt and its 16 tool declarations. The compiler rejects stale prompt sources and schemas, then renders native `tml_v0` at the serving effort of 0.1.

Use **ALL_ASSISTANT_MESSAGES**, including native tool calls. System, user, tool declarations and tool results have no target loss. Convert serialized calls through `ToolCall.model_validate` as demonstrated in the compiler. The largest verified sequence is 27,297 tokens. The existing `run_identity_sft.py` intentionally rejects multi-turn data; a multi-turn training runner must use this rendering contract rather than silently truncate the history.

The compiler produces train/validation JSONL plus a provenance, hash and validation manifest. Output directories are exclusive and private. These checks prove grammar, native rendering and local fixture execution, not browser persistence or better model behavior. The first hosted OpenUI SFT run completed two epochs (16 updates) in `.keating/outputs/training/openui-sft-run`, branching from the identity-trained checkpoint. New-topic creation checks improved from 0/5 to 4/5; full checks including grading and two controls improved from 2/7 to 5/7. This is development evaluation, not human learning evidence. A six-step SDPO continuation uses new responses and their own automated compiler/action feedback; see `.keating/outputs/training/openui-sdpo-run` and its separate evaluation. All six temperature-1 training responses failed before reaching submission/grading; those failures were retained. No historical feedback was reused for this continuation.

## Expanding from Downloads

Audited archive: `keating-training-2026-09-06T20-43-04-888Z.zip`. Its 361 canonical records contain 10 accepted, 298 unscored and 53 rejected responses. Ten are marked recommended for SFT. There are no structured native tool-call messages, although some assistant text contains UI/artifact markup. Seven records reference the obsolete `ask_user_question` tool. The private audit is `.keating/outputs/training/downloads-synthesis-audit.json`.

Use the archive as scenario evidence, not an unquestioned answer key:

1. Reconcile canonical records with portable sessions and the case-study lineage ledger. Parent forks, copied history, near-duplicates and synthetic descendants must stay in one family. The archive has no exact session ID in both splits, but that does not prove copied-history isolation.
2. Assign train/validation before generation. Preserve archive and source-record hashes, family ID, source message indices, feedback type and quality status in every synthetic scenario manifest. Quarantine unmatched sources.
3. Extract the useful situation: learner goal, prior explanation, actual response, available tools and explicit feedback. Keep unscored answers as context until reviewed. Use rejected examples as repair prompts; accepted examples still need semantic review.
4. Generate bounded branches: correct reasoning, a specific misconception, a partial answer, uncertainty, an accessibility preference, a failed tool, a timed-out assessment, and a later transfer task. Preserve the historical prefix; label everything invented after it as synthetic. Never describe invented outcomes as observed progress.
5. Use the current system prompt and tool schemas. Translate requests for the retired question tool into OpenUI `Question`. Execute supported tools with local doubles, compile all UI, round-trip learner submissions, check tool result IDs and grade only actually submitted answers. Do not invent tool results to make an attractive transcript.
6. Independently review correctness, answer keys, plausible distractors, justified grading, continuity and pedagogy. A generator should not be its own sole evaluator. Explicit, inferred and judge rewards remain separate signals. A negative comment is not automatically a valid DPO preference pair unless the alternatives share the same context and are independently assessed.
7. Evaluate the adapted model on untouched source families using fresh rollouts and real artifact interactions. Measure syntax, tool choice, successful execution, waiting for responses, grading and transfer prompts separately. Human retention and independent transfer need real learner assessments.

The authored version 2 corpus is separate from this proposed source-derived expansion. The audit has not generated or approved Downloads-derived training targets. Public report assets include synthetic sessions and aggregate audit counts, not the original learner conversations.


## Current runs and interaction evaluation

- SFT: `run_openui_sft.py`, `ALL_ASSISTANT_MESSAGES`, two epochs at 1e-4, eight training conversations, 16 optimizer updates; validation examples never enter training.
- Evaluation: `evaluate_interactions.py` plus `interaction_check.ts`, with seven predeclared cases in `data/interaction-eval.json`. The five interaction families (temperature, speed, probability, taxi fares and time conversion) are separate from SFT and SDPO training families. Identity and arithmetic are regression controls. Generation uses temperature 0; the SDK smoke uses Keating's 0.1.
- SDPO: `run_interaction_sdpo.py`, six distinct situations, one fresh trajectory per situation at temperature 1. The same checkpoint supplies the student and feedback-conditioned teacher before each update, so checkpoint staleness is zero. Feedback comes from this response's compiler or actual local execution, and failed responses remain included. PPO clipping is 0.2, token advantages are clipped at 3× an EMA, learning rate is 1e-5. This is SDPO-inspired, not a full reproduction of Trajectory SDPO++.
- Local OpenUI SFT: `http://127.0.0.1:8791/v1`, model `keating-bot-openui`.
- Local comparison SDPO: `http://127.0.0.1:8792/v1`, model `keating-bot-openui-sdpo`.

Both endpoints use the existing private pilot token and the original shared $100 reservation ledger. The earlier 20-update continuation over two historical feedback seeds was prepared but never launched. Structural checks do not establish answer-key quality or effective teaching; inspect the actual traces. The renderer can still fail on new prompts and higher-temperature samples.

The unchanged post-SDPO evaluation passed **6/7** full checks (SFT: 5/7; identity-only: 2/7). The diagnostic grading call now executes correctly. Exam creation still fails: twenty questions are authored, but the `Exam` constructor has too many arguments. Its requested across-midnight coverage is also absent. Both new checkpoints passed one four-card SDK generation and canonical review at temperature 0.1. No further training was launched after this bounded comparison.
