# Development

How to work in the Keating repo: the devenv environment and its task runner.

## Environment

All development dependencies (bun, node, typst, similarity, etc.) are managed by **devenv** (`devenv.nix`). Enter the dev environment with:

```bash
devenv shell
```

`devenv shell` also installs repo-local git hooks (see [Git hooks](#git-hooks)) and runs `keating:install` on first entry when dependencies are missing.

## Tasks

Every build, test, and release workflow is a **devenv task**, namespaced with `keating:` so task names never collide with devenv's built-ins or other projects.

```bash
devenv tasks list          # List all available tasks
devenv tasks run keating:test
devenv tasks run keating:web
```

Tasks that accept arguments pass them through to the CLI, e.g. `devenv tasks run keating:bench linear-algebra`.

See the [devenv tasks documentation](https://devenv.sh/tasks/) for how tasks work, running tasks with arguments, dependencies, and the task runner.

### Install / bootstrap

| Task | Description |
|------|-------------|
| `keating:install` | `bun install` for root + web workspaces |

### Version sync

| Task | Description |
|------|-------------|
| `keating:version` | Show the current package version and Bun version commands. |
| `keating:bump-version` | Run `bun pm version` and sync manifests, e.g. `devenv tasks run keating:bump-version --input version=minor`. Commits and tags follow release checks. |
| `keating:sync-version` | Sync version numbers across all manifests and source files |
| `keating:check-version` | Verify all version strings are in sync (CI-friendly) |

### Build

| Task | Description |
|------|-------------|
| `keating:build` | Build root TypeScript project (requires versions in sync) |
| `keating:generate-nodepod-boot` | Generate NodePod boot files from source tree |
| `keating:build-all` | Sync versions, build root, generate nodepod boot, build web |
| `keating:study-analysis` | Regenerate the versioned paper analysis JSON and Markdown |
| `keating:paper` | Regenerate analysis and compile the published paper PDF |
| `keating:paper-check` | Compile the paper to `/tmp` without replacing the published PDF |

### Test

| Task | Description |
|------|-------------|
| `keating:test` | Run the root test suite (`bun test ./test/*.test.ts`) |
| `keating:test-web` | Run the web test suite |
| `keating:test-e2e` | Real Pi RPC + tool-loop smoke test (requires `KEATING_E2E=1` and secrets) |
| `keating:mutate` | Mutation testing with Stryker against `src/core/` |
| `keating:test-python` | Run the Python suites in `scripts/training` and `scripts/report-site`. Tests needing `torch` or `tinker_cookbook` report as skipped, not errored. |
| `keating:test-native-learning` | Native Pi/controller tests, source and training-export contracts, plus the separately pinned CPU observer/probe suites |
| `keating:research-preflight` | Read-only Tinker and Runpod capability checks using the named Skate entries |

### Notebooks

Marimo notebooks in `analysis/` explain the Python pipeline interactively — move a
slider, watch the chart move.

| Task | Description |
|------|-------------|
| `keating:notebooks` | Open `analysis/` in marimo's sandbox editor |
| `keating:python` | Python shell with pandas, matplotlib, NumPy, marimo, typer and httpx |
| `keating:tutormoments` | Fetch and checksum the untouched 520-moment vanilla release |

Each notebook is self-contained: a PEP-723 header names its own dependencies, and
uv builds a throwaway environment per notebook on first open. There is no shared
virtualenv to maintain and no `pip install` step. Every notebook explicitly includes
pandas, matplotlib and NumPy for experimentation. First use may download packages
and a uv-managed Python interpreter; subsequent runs reuse the cache.

See [benchmark datasets](benchmark-datasets.md) for the vanilla TutorMoments arm,
the separate synthetic Keating episodes, and complementary datasets. Open
`analysis/tutormoments_comparison.py` to inspect original versus adapted events.
Open `analysis/benchmark_sources.py` to browse all six pinned source resources.
Open `analysis/native_scenarios.py` to compare admitted starting states with the
original records, their private review material, and rejection counts. Open
`analysis/native_learning.py` for actual runtime event timelines, or
`analysis/observer_features.py` for the observer/probe workbench.
`analysis/native_pilot.py` compares paired conditions while retaining unattempted,
failed and unassessed episodes in its denominators.
`analysis/observer_capture.py` inspects actual frozen-observer measurements;
`analysis/native_update.py` compares the original and updated checkpoints using
preserved responses, independent reviews and completion-only probability graphs.
`analysis/user_model_evaluation.py` explores finite profiles, separate answer
holdouts and paired panel estimates using explicitly authored data. It contains
zero real respondents; see the [measurement contract](user-model-evaluation.md).
`analysis/profile_information.py` connects profile evidence to posterior updates,
predictive uncertainty and the value/cost of a next question using authored data.
`analysis/feature_hindsight_math.py` calls the real CPU loss kernel to compare
feature feedback, hindsight, ratio clipping and a logged-target reference term.
Its editable scores are authored; it also shows masked context tokens and the
effect of averaging each action's completion before averaging the batch.
`analysis/combined_reward_results.py` shows the [actual three-arm updates](native-combined-results.md)
on two native teaching actions, using a shipped numerical summary. Its offline
sliders expose feature, hindsight and anchor derivatives without dispatching work.
`analysis/checkpoint_behavior.py` shows the [fresh blinded comparison](checkpoint-behavior-results.md)
of all four saved samplers: 64 actual responses, category filters and paired
verdicts. The shipped report shows no observed improvement from these small updates.
`analysis/controlled_generation.py` compares saved SAE interventions with their baseline,
including exact text, token divergence, cutoff reasons and both blinded reviews.
It reads `docs/research-story/generation-examples.json`; until that reviewed export
exists, it displays the missing-input message without substituting synthetic results.
`analysis/source_supervision.py` reads the local TutorMoments aggregate manifests
and shows known labels, usable temporal targets, and group coverage by partition.
It checks the split digest and preserves empty calibration/test coverage. See the
[SAR importer](tutormoments-supervision.md) to build its input bundle.
Run `rtk python scripts/training/benchmark_sources.py fetch` inside the development
shell to populate its original-data cache, or use `verify` to check existing files.
The catalog distinguishes imported original data, authored adaptations, and
StudentSim's software documentation; it does not combine their evaluation scores.

**Notebooks never spend.** Planning notebooks import the real lightweight planning
and validation functions. The feature/hindsight math notebook uses CPU Torch for
local derivatives, without model weights or hosted inference. No notebook
dispatches training or reads credentials. Dataset fetching is a separate explicit task.
`analysis/pilot_costs.py` prices a synthetic in-memory ledger; it never opens the
budget file and never calls `PilotBudget.reserve()`. Model execution is an explicit
CLI operation, with the cost boundaries described below.

### Native research workflow

The [durable pilot executor](native-pilot-executor.md) records selected slots
before dispatch and preserves interrupted attempts without silently rerunning
them. Its deterministic tests run under `keating:test-native-learning`, alongside
the [source SAR importer](tutormoments-supervision.md) and panel measurements.
The [MathDial importer](mathdial-supervision.md) preserves exact teacher-move
labels and grouped source splits. The [candidate-move comparison](native-action-search.md)
executes each alternative in its own Pi session while preserving the learner's
starting evidence. [Hindsight preparation](native-hindsight.md),
[feature-return construction](native-feature-rewards.md), and
[observer layer/intervention experiments](observer-experiment.md) have separate
interfaces so a successful mechanics check does not become a quality claim.
The [combined-loss contract](native-combined-loss.md) keeps action-feature and
hindsight terms separate and documents exactly what its reference term measures.
The [custom update consumer](native-custom-update.md) binds those objectives to
the pinned Tinker callback while rebuilding admission from original captures.
Its CPU sandbox tests exercise the real SDK's derivative transport with local
doubles; hosted updates remain a separate execution step.
The [bounded observer job](observer-experiment-job.md) runs exact layer/pooling
matrices and preserves partial results when a job ends early.
The [continual-learning contract](native-continual-learning.md) records actual
checkpoint ancestry, bounded replay selections and missing retention evidence.
The science tests use managed Python 3.13 for the pinned NumPy/scikit-learn
environments; `rtk uv python install 3.13` installs it if local uv policy requires
an explicit interpreter download.

The [stage-zero implementation map](plans/native-learning-stage-zero.md) records
what has run and what still needs model or human evidence. The
[first research cycle](native-research-run.md) connects the actual episode,
observer measurements, optimizer result and unchanged paired rubric scores. The
[scenario adapter guide](native-scenario-adapters.md) documents all five sources,
family exclusions, vanilla/reference comparisons and ignored raw-data artifacts.

```bash
# Inspect/admit source evidence; no models are called.
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_scenarios.py inspect
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_scenarios.py build --output .keating/native-learning/scenarios/my-development-run

# Verify named Skate credentials and account capabilities; no billable work.
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --script scripts/training/research_access.py

# Run production Pi plumbing with authored policies, then inspect/export receipts.
rtk proxy bun scripts/training/native_plumbing.ts ADMITTED_SCENARIOS.json NEW_OUTPUT_DIRECTORY 20
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/native_observer.py EPISODE.json --output NEW_OBSERVER_INPUT.json
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --script scripts/training/native_report.py EPISODE.json NEW_REPORT_DIRECTORY
```

The credential preflight loads `thinking_machines_api_key@default` and
`runpod_api_key@secrets` directly into memory. It emits names and sanitized account
metadata, never values. Use `skate list --keys-only` to inspect names; plain
`skate list` also prints values.

The [observer guide](observer-pipeline.md) supplies pinned model/dictionary
revisions and separate CPU-test/GPU-run commands. The
[Runpod job guide](observer-runpod.md) describes bounded extraction jobs,
local supervision, output collection and resource cleanup. The
[training export guide](native-training-exports.md) defines the original-token
capture and independent-review requirements. The
[Tinker update guide](native-tinker-update.md) documents dry planning and a single
reserved SFT, PPO or SDPO update. The [checkpoint comparison report](native-update-report.md)
explains the local plots and their evaluation limits. The [paired pilot guide](native-pilot.md) specifies
30 situations × two formats × three learner replicates and independent review.
No notebook dispatches these runs.
The approved research budget is one shared $100 cap across Tinker and Runpod,
with separately reserved suballocations for each bounded operation. The existing Inkling
pilot ledger is not reset or transferred to another experiment. The generic native
episode CLI enforces call/turn bounds but is not itself a provider-dollar ledger.

### Mobile (Expo / React Native)

| Task | Description |
|------|-------------|
| `keating:mobile` | Build, install, and launch the native Expo dev client on Android |
| `keating:mobile-start` | Start Metro for the installed native dev client |
| `keating:mobile-prebuild` | Generate the Android native project from Expo configuration |
| `keating:mobile-prebuild-clean` | Regenerate the Android native project (clean) |
| `keating:mobile-apk` | Build a locally installable Android debug APK |
| `keating:mobile-check` | Typecheck + test the React Native app |
| `keating:mobile-export` | Produce a production Android JS bundle locally |

### Web

| Task | Description |
|------|-------------|
| `keating:web` | Start the Keating web UI dev server (Vite on port 3000) |
| `keating:web-build` | Build the Keating web UI for production (vite + nitro) |
| `keating:web-preview` | Build and preview the Keating web UI production build |
| `keating:storybook` | Launch the Storybook component explorer |

### Product analytics

The event contracts, activation funnel, AI observability fields, survey plan,
privacy boundary, dashboards, and production validation checklist live in the
[PostHog operating plan](analytics/posthog-operating-plan.md). Update that plan
with any analytics behavior change so events keep a clear consumer and stable
meaning.

### Optional Arize AX observability

Arize is a separate, optional OpenTelemetry/OpenInference destination for
evaluation metadata and explicitly shared web-turn content. Its contract,
privacy boundary, relay schema, and verification scenarios live in the
[Arize integration plan](analytics/arize-integration-plan.md). It does not
replace PostHog, local `.keating/` artifacts, or browser session persistence.

Leave all `ARIZE_*` variables unset for ordinary local development: the root
observer and Nitro relay are inert, and `/api/observability/v1/arize/config`
reports that Arize is disabled. A configured deployment needs
`ARIZE_ENABLED=true`, `ARIZE_API_KEY`, and `ARIZE_SPACE_ID`; it may also set
`ARIZE_PROJECT_NAME`, `ARIZE_OTLP_ENDPOINT`, and the separately default-off
`ARIZE_EVALUATION_CONTENT_ENABLED=true`. Set `ARIZE_TRUST_PROXY_IP=true` only
behind a deployment-controlled proxy that replaces caller forwarding headers.
Never use a `VITE_` prefix for these values or expose collector headers to the
browser.

Use the focused Arize tests for a safe local smoke check. They use a recording
export seam and validate disabled mode, strict relay parsing, span hierarchy,
and in-memory retry behavior without network credentials. A live AX trace and
evaluator mapping still require a non-sensitive synthetic turn plus operator
credentials after the production Nitro build is running.

### CLI shortcuts

| Task | Description |
|------|-------------|
| `keating:shell` | Launch the hyperteacher shell |
| `keating:doctor` | Run the hyperteacher doctor |
| `keating:bench` | Run benchmarks (e.g. `keating:bench linear-algebra`) |
| `keating:evolve` | Evolve the teaching policy (e.g. `keating:evolve linear-algebra`) |
| `keating:prompt-evolve` | Evolve a prompt template (default: learn) |
| `keating:plan` | Generate a lesson plan for a topic |
| `keating:map` | Generate a lesson map for a topic |
| `keating:verify` | Generate a fact-checking checklist before teaching |
| `keating:animate` | Animate a teaching artifact for a topic |
| `keating:trace` | Trace a teaching session (filter by substring) |

### Video

| Task | Description |
|------|-------------|
| `keating:video-intro` | Render the narrated Keating intro video |
| `keating:video-web-stitch` | Stitch captured web UI frames into `docs/assets/web-*.mp4` |

## Git hooks

Repo-local git hooks are configured via devenv and call `devenv tasks run` directly — no separate task runner needed:

- `pre-commit`: `keating:check-version`
- `pre-push`: `keating:test` + `keating:test-web`
