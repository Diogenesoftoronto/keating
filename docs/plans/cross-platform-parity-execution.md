# Cross-platform parity execution program

Status: executable goal program
Updated: 2026-08-11

## Purpose

This document defines **how an agentic `/goal` run executes and measures** the
[cross-platform parity build specification](cross-platform-parity-build.md).
It sits above individual implementation plans. Its responsibility is to read
the specification, discover the real repository/runtime state, schedule ready
work, verify evidence, and decide whether the overall goal is complete.

The task graph is not a checklist whose boxes can be trusted indefinitely.
Every `/goal` run revalidates drift-prone evidence before reporting progress.

## Goal declaration

```text
GOAL cross-platform-parity

OBJECTIVE
  Implement and verify the build specified by:
    docs/plans/cross-platform-parity-build.md

EXECUTION POLICY
  Follow:
    docs/plans/cross-platform-parity-execution.md

COMPLETE WHEN
  Every required deliverable is accepted with current evidence,
  every runtime acceptance scenario passes on its real surface,
  release claims match that evidence,
  and no required work remains.
```

## Sources of truth

The goal controller reads these inputs in order:

1. `AGENTS.md` for repository rules and canonical commands.
2. `docs/plans/cross-platform-parity-build.md` for required outcomes.
3. `docs/plans/cross-platform-parity-baseline.md` for the latest accepted P0
   inventory and protected-work snapshot.
4. This document for dependencies, ownership, scheduling, and evidence rules.
5. `docs/EXECUTION_GRAPH.md` for overlapping multimodal protocol work.
6. Current Git status, source, tests, build configuration, package contents,
   installed applications, authenticated APIs, and runtime captures.
7. An optional local cache at
   `.keating/state/cross-platform-parity-goal.json`.

The local cache accelerates discovery but is never authoritative. A cached
`accepted` state becomes `stale` when relevant source, dependencies, generated
artifacts, environment, package version, or runtime target changes.

## Goal state model

Each node has one state:

| State | Meaning |
|---|---|
| `pending` | Dependencies or required decisions are incomplete |
| `ready` | Dependencies are accepted and ownership is available |
| `active` | A coordinator or worker is executing the node |
| `review` | Implementation returned and awaits independent evidence review |
| `accepted` | All node acceptance evidence is current |
| `failed` | A gate failed and the node returned to its owner |
| `blocked` | The same external blocker persisted for at least three goal turns and no useful progress remains |
| `stale` | Previously accepted evidence no longer proves the current tree/runtime |
| `not-required` | A conditional capability was removed truthfully from product claims |

Only `accepted` and approved conditional `not-required` nodes contribute to
completion.

## Evidence model

```text
Evidence {
  nodeId
  gateId
  kind             // test | build | package | rendered | device | auth | runtime
  commandOrScenario
  sourceRevision
  artifactVersion
  environment      // OS, device, viewport, terminal, deployment
  observedAt
  result           // pass | fail
  diagnostics
  sensitiveDataRedacted = true
}
```

Evidence expires when:

- owned source or a consumed contract changes;
- dependency or generated output changes;
- the release version changes;
- a runtime target is rebuilt or redeployed;
- the evidence is source/build confidence for a gate requiring an installed,
  rendered, authenticated, device, or real-provider path.

## Progress calculation

Progress is evidence-weighted, not based on commits or files changed.

| Group | Nodes | Weight |
|---|---|---:|
| Foundations | P0, C1, C2 | 15% |
| Desktop | D1, D2 and truthful D3 resolution | 20% |
| Mobile core | M1, M2, M3 | 25% |
| Mobile hosted/native completion | M4, M5 | 15% |
| Terminal | T1, T2 | 15% |
| Integration/release | W1, I1, Q1, R1, REL | 10% |

Within a group, weight is divided evenly across required nodes. A node in
`review`, `failed`, `blocked`, or `stale` contributes zero. The `/goal` summary
must show both the percentage and the unaccepted gates; percentage alone must
never imply completion.

## Agent policy

- Use Terra at high reasoning for architecture, implementation, migration,
  security, and platform integration nodes.
- Use Luna for independent contract, product-parity, visual, and runtime
  acceptance reviews.
- Luna must not review its own implementation patch.
- If Luna is unavailable, continue independent non-Luna implementation work,
  mark Luna-owned review gates `pending`, and report that limitation. Do not
  silently substitute another model and call the Luna review complete.
- Maximum concurrency is three workers plus the coordinator.
- Every worker receives an exclusive write set and the instruction that it is
  not alone in the codebase and must preserve others' changes.
- Dirty web files, root manifests, generated configuration, documentation,
  versioning, and shared barrels remain coordinator-owned.

## Execution waves

| Wave | Ready nodes | Ownership/gate |
|---|---|---|
| 0 | P0 | Coordinator records baseline, dirty ownership, capability matrix |
| 1 | C1, C2, D1 | Three Terra-high workers with disjoint new-package/desktop ownership |
| 1.5 | D2a, M1a | Independent desktop lifecycle/security and mobile SQLite runtime/journal foundations; neither contributes progress until its full parent node is accepted |
| 2 | W1, M1, T1, D2b | Coordinator integrates web while three workers own mobile storage, TUI protocol, and remaining desktop feature/security integration |
| 3 | M2, T2, D3 | Terra-high implementation; Luna reviews C1/C2 and desktop runtime evidence |
| 4 | M3 | Mobile learner surfaces after repository and agent contracts stabilize |
| 5 | M4 | Auth, courses, sharing, sync queue and conflict recovery |
| 6 | M5 | Live/media/iOS after core mobile interaction is accepted |
| 7 | I1 | Coordinator resolves central files, codegen, versions, docs and migrations |
| 8 | Q1 | Deterministic/static/package verification, followed by Luna review |
| 9 | R1, REL | Installed/device/terminal/hosted runtime acceptance and release decision |

## Ownership contracts

| Node | Primary owner | Exclusive write set | Must not edit |
|---|---|---|---|
| P0 | Coordinator | parity matrix and goal state | feature implementations |
| C1 | Terra-high worker | `packages/learner-contracts/**` | consumers, root manifest, lockfile |
| C2 | Terra-high worker | `packages/design-contract/**` | Panda/mobile/TUI consumers |
| D1 | Terra-high worker | assigned `desktop/**` runtime/build files | web implementation |
| W1 | Coordinator | assigned `web/**` adapters and tests | unrelated dirty web work |
| D2a | Terra-high worker | Electron main/preload/IPC/navigation/lifecycle and focused tests | permissions, OAuth, CSP, web feature code, release metadata |
| D2b | Terra-high worker | remaining Electron permissions/deep links/security plus assigned desktop-aware web seams | unrelated web feature code; D2 cannot be accepted until D2a and D2b pass |
| D3 | Terra-high worker | `packages/p2p-core/**` and assigned pairing seams | mobile sync claims/course feeds |
| M1a | Terra-high worker | `mobile/src/lib/learner-repository/` SQLite runtime/transaction/journal foundation and focused tests | C1 learner schema, provider-state integration, mobile UI; M1 cannot be accepted until M1a and the remaining repository work pass |
| M1 | Terra-high worker | mobile repository/migrations/tests | provider runner and UI screens |
| M2 | Terra-high worker | mobile agent/provider/tool adapters/tests | storage migrations and feature screens |
| M3 | Terra-high worker | mobile primitives/screens/renderers/tests | server auth and course routes |
| M4 | Terra-high worker | mobile auth/share/course client plus assigned server routes | Not Organic secret ownership |
| M5 | Terra-high worker | mobile Live/media/iOS configuration/tests | unrelated Android/core refactors |
| T1 | Terra-high worker | `src/tui/ui/**` and protocol tests | OpenTUI layout or web types |
| T2 | Terra-high worker | assigned `src/tui/**`, Pi adapters, TUI tests/tapes | web React components |
| I1 | Coordinator | root manifests, lockfile, devenv, web dirty files, codegen, versions, docs | none within accepted integration scope |
| Q1 | Verifier | test/evidence outputs only | implementation without reassignment |
| R1 | Luna plus platform verifier | runtime evidence only | source fixes without returning node to owner |
| REL | Coordinator | release metadata and artifacts | unverified feature claims |

## Goal-controller pseudocode

The following is intentionally higher-level than the implementation DAG. It
defines how `/goal` decides what to do and how it knows the build is complete.

```text
PROGRAM CrossPlatformParityGoal

CONSTANT BUILD_SPEC =
  "docs/plans/cross-platform-parity-build.md"

CONSTANT EXECUTION_SPEC =
  "docs/plans/cross-platform-parity-execution.md"

FUNCTION run_goal():
  rules       = read_repository_instructions()
  build       = parse_required_deliverables(BUILD_SPEC)
  execution   = parse_execution_policy(EXECUTION_SPEC)
  repository  = inspect_repository_and_git_status()
  cache       = load_optional_goal_cache()

  graph = construct_dependency_graph(build, execution)
  assert_graph_is_acyclic(graph)
  assert_every_required_capability_has_platform_outcome(build)
  assert_rendering_matrix_covers_web_markdown_mermaid_and_openui(build)
  assert_each_web_openui_component_maps_to_shared_semantics_or_approved_handoff(build)
  assert_every_mutable_file_has_one_owner(execution, repository)

  evidence = discover_current_evidence(
    graph,
    repository,
    installed_artifacts,
    devices,
    terminals,
    authenticated_services
  )

  reject_mobile_surface_evidence_when(
    model_control_only_opens_settings,
    model_catalog_advertises_uncallable_providers,
    model_refresh_failure_looks_like_success,
    poisoned_model_cache_becomes_selectable,
    session_open_delete_are_nested_or_ambiguous,
    fresh_tutor_repeats_new_lesson_title,
    fork_copies_shared_message_ids,
    fork_copies_source_feedback,
    fork_lineage_is_not_persisted_or_visible,
    stop_before_credential_read_cannot_cancel_generation,
    web_renderable_markdown_or_mermaid_is_only_shown_as_source,
    raw_openui_wire_source_leaks_into_learner_prose,
    openui_action_reports_success_before_durable_commit,
    model_authored_html_or_javascript_executes_to_render_content
  )

  state = reconcile_cache_with_evidence(cache, evidence)
  invalidate_stale_nodes(state, repository, graph)
  propagate_dependency_invalidations(state, graph)

  WHILE NOT goal_complete(state, graph):
    report_progress(state, graph)

    IF user_changed_objective():
      stop_and_rebuild_goal_definition()

    ready = nodes_where(
      state is pending OR failed OR stale,
      all_dependencies_are_accepted,
      ownership_is_available,
      required_authority_is_present
    )

    IF ready is empty:
      blockers = diagnose_blockers(state, graph)
      perform_all_safe_non_blocked_work(blockers)

      IF same_external_blocker_persisted_for_three_goal_turns(blockers)
         AND no_meaningful_progress_remains():
        mark_goal_blocked_with_exact_recovery(blockers)
        RETURN BLOCKED

      report_waiting_requirements(blockers)
      RETURN IN_PROGRESS

    wave = select_disjoint_nodes(
      ready,
      maximum_workers = 3,
      reserve_coordinator_for_integration = true
    )

    FOR node IN wave IN PARALLEL:
      agent = select_agent(node)
      contract = build_agent_contract(
        objective = node.deliverable,
        owned_files = node.writeSet,
        forbidden_files = all_other_write_sets,
        acceptance_gates = node.gates,
        preserve_dirty_work = true
      )
      state[node] = active
      dispatch(agent, contract)

    FOR result IN await_wave(wave):
      IF result.changed_files_outside_ownership:
        reject_result(result)
        restore_only_coordinator_owned_integration_state()
        state[result.node] = failed
        CONTINUE

      focused = run_node_focused_checks(result.node)
      review  = independent_review(result.node, focused)

      IF focused.failed OR review.failed:
        attach_diagnostics(result.node, focused, review)
        state[result.node] = failed
        return_to_owner(result.node)
      ELSE:
        state[result.node] = review

    coordinator_integrates_nodes_in_review()
    refresh_generated_artifacts_when_required()
    run_repository_required_vet_after_each_code_unit()

    FOR node WHERE state[node] == review:
      nodeEvidence = execute_acceptance_gates_on_real_required_surface(node)

      IF nodeEvidence.all_pass:
        record_evidence(nodeEvidence)
        state[node] = accepted
      ELSE:
        record_evidence(nodeEvidence)
        state[node] = failed
        return_to_owner(node)

    save_non_authoritative_goal_cache(state, evidence)

  finalEvidence = run_final_acceptance_suite()

  IF finalEvidence.all_required_gates_current
     AND no_required_node_is_pending_failed_blocked_or_stale
     AND release_claims_equal_verified_capabilities
     AND versions_and_artifacts_agree:
    mark_goal_complete()
    RETURN COMPLETE

  invalidate_nodes_for_failed_final_gates(finalEvidence)
  report_progress_and_next_ready_nodes()
  RETURN IN_PROGRESS
```

## Agent-selection pseudocode

```text
FUNCTION select_agent(node):
  IF node.role IN {architecture, implementation, migration, security, integration}:
    RETURN Terra(reasoning = high)

  IF node.role IN {contract_review, visual_review, product_parity_review,
                   installed_runtime_review, release_claim_review}:
    IF Luna.is_available():
      RETURN Luna()
    mark_review_pending(node, reason = "Luna unavailable")
    RETURN NO_AGENT

  RETURN coordinator
```

## Evidence-discovery pseudocode

```text
FUNCTION discover_current_evidence(graph, repository, artifacts, devices,
                                   terminals, services):
  evidence = []

  FOR node IN graph:
    evidence += inspect_owned_source_and_migrations(node)
    evidence += run_read_only_status_checks(node)

    IF node.requires_test:
      evidence += run_focused_test(node)

    IF node.requires_build:
      evidence += build_production_target(node)

    IF node.requires_package:
      evidence += inspect_and_install_package(node)

    IF node.requires_rendered_ui:
      evidence += capture_real_surface(node.requiredViewports)
      evidence += compare_identity_and_semantic_states_to_web_contract(node)
      evidence += execute_rendering_fixture_pack(
        node,
        families = [markdown, mermaid, openui],
        states = [streaming, complete, malformed, retry, restored],
        themes = [light, dark]
      )
      reject_capture_if_obscured_by_other_apps_or_dev_overlays(node)

    IF node.requires_device:
      evidence += exercise_physical_or_approved_native_device(node)

    IF node.requires_native_behavior AND evidence.only_proves_web_handoff:
      record_reachability_evidence(node)
      prohibit_acceptance(node, "Native behavior is still missing")

    IF node.requires_terminal:
      evidence += exercise_real_pty(node.requiredTerminalModes)

    IF node.requires_authentication:
      evidence += exercise_authenticated_service_without_exposing_secrets(node)

  RETURN redact(evidence)
```

## Rendering-parity pseudocode

```text
FUNCTION execute_rendering_fixture_pack(node, families, states, themes):
  fixtures = load_versioned_cross_surface_rendering_fixtures()
  webReference = render_in_packaged_web_or_desktop(fixtures)

  assert fixtures.cover_complete_web_markdown_dialect()
  assert fixtures.cover_every_web_accepted_mermaid_grammar_and_tool_output()
  assert fixtures.cover_every_registered_web_openui_component()
  assert fixtures.cover_shared_openui_json_and_browser_source_ingress()
  assert fixtures.cover_nested_streaming_malformed_unsafe_and_oversized_cases()

  candidate = render_on_required_surface(node.surface, fixtures)

  FOR fixture IN fixtures:
    assert semantic_content(candidate[fixture]) == semantic_content(webReference[fixture])
    assert learner_actions(candidate[fixture]) == required_actions(webReference[fixture])
    assert unsafe_content_remains_inert(candidate[fixture])
    assert errors_preserve_source_and_offer_recovery(candidate[fixture])

    IF fixture.has_durable_action:
      perform_action(candidate[fixture])
      force_kill_and_restart_surface()
      assert action_and_entered_work_restore_exactly_once()

    IF fixture.family == mermaid AND webReference[fixture].rendered:
      assert candidate[fixture].rendered_or_platform_outcome_is_explicit()
      prohibit_mobile_acceptance_when(candidate[fixture].is_source_only_fallback)

    IF fixture.family == openui:
      assert wire_source_is_absent_from_visible_prose()
      assert unknown_versions_and_nodes_fail_visibly_without_dropping_document()

  RETURN evidence_with_source_build_runtime_and_capture_labels()
```

## Completion predicate pseudocode

```text
FUNCTION goal_complete(state, graph):
  FOR node IN graph.requiredNodes:
    IF state[node] != accepted:
      RETURN false

  FOR conditional IN graph.conditionalNodes:
    IF state[conditional] == accepted:
      CONTINUE
    IF state[conditional] == not-required
       AND related_product_claims_are_removed_and_verified():
      CONTINUE
    RETURN false

  RETURN every_runtime_gate_has_current_evidence()
     AND no_acceptance_evidence_is_stale()
     AND rendering_fixture_pack_passes_web_desktop_mobile_and_terminal_outcomes()
     AND no_required_TODO_or_silent_fallback_remains()
     AND release_artifacts_match_source_and_version()
```

## `/goal` progress response

Every `/goal` run should report this compact structure:

```text
Cross-platform parity: <evidence-weighted percent>%
Status: <in progress | blocked | complete>

Accepted:
  <node IDs accepted with current evidence>

Active:
  <node IDs, owner, and current gate>

Next ready:
  <node IDs that can execute without violating dependencies>

Waiting:
  <node IDs and the exact unmet dependency/authority/device/model>

Stale or failed evidence:
  <node IDs and what must be rerun>

Completion blockers:
  <only the gates that prevent the overall COMPLETE predicate>
```

The response must distinguish implementation progress from verification. For
example, “M5 implemented; iPhone acceptance pending” is not M5 accepted.

### Current execution checkpoint — 2026-08-10

This checkpoint is implementation evidence, not a node promotion. The current
mobile tranche includes the web-shaped composer, persisted image/document
attachments with draft recovery and provider-specific multimodal payloads,
exact-model models.dev capabilities, usable non-card interaction fallback,
wired appearance/chat/About You settings, a provenance-labelled Usage & Study
Activity page backed by a validated SQLite/portable snapshot, a schema-v2 learner
record store with resumable SHA-256-bound legacy copy/verify, portable
merge/export/import/clear, private attachment-location separation, learner-facing
export/share, validate-before-merge import, and explicit clear controls, and a read-only native Courses
client with server-driven teacher consent, SecureStore-scoped authentication,
protected material download/share, and an atomic course-to-Tutor handoff.
Repository writes are serialized and committed at learner-semantic boundaries
(user send, completed/stopped/failed response, fork/delete, feedback, and artifact
changes), while high-frequency streaming deltas remain transient. The repository
is now the source of truth: native projection preserves portable-only records,
and imported attachment metadata becomes an explicit missing-file state rather
than a fabricated device URI. Clearing waits for the write tail and uses a
durable intent cleared only after SQLite, AsyncStorage, drafts, files, and About
You have been cleared, so a later bootstrap can resume an interrupted clear.

Portable learner contract v2 now adds web-matched SRS state, immutable review
outcomes, honest legacy migration, and semantic study priorities; native schema
v3 stores those priorities. Learn & Coming Up is separate from Usage and derives
exact goal progress, evidence-only mastery, review-only retention, confidence,
pending assessments, Focus/Maintain/Low lanes, deck due work, and
learner-recorded context from the repository. Review applies the same
Again/Hard/Good/Easy schedules as web. Tutor goal, quiz, and question cards
materialize stable portable records and commit them before success UI, then
rehydrate their visible completed/progress state from those records after a
restart. Failed writes preserve the prior step or entered answers, and exact
retries do not overwrite existing progress. Provisional open-ended credit
remains pending and is excluded from mastery until it is graded.

Manual mobile deck authoring now constructs a complete deck as one semantic
repository mutation: stable deck/card identities are allocated before the
serialized write, the whole validated snapshot commits atomically, the draft
remains visible on validation or storage failure, and Review opens only after
commit. The UI explicitly states that Anki package transfer is not available in
this mobile build rather than presenting manual authoring as transfer parity.

Verification records 186 passing mobile tests with 795 assertions, 26 shared
contract tests with 188 assertions, strict mobile/package typechecks, and a
current source-matched Android release of 2,045 modules and 38 assets. The
105,227,992-byte APK completed 946 Gradle tasks (60 executed, 886 up-to-date),
installed successfully on a Pixel 9 Pro XL, and visibly passed the internal
SQLite schema/journal/close/reopen/persisted-read route. The same release
rendered Usage and Learn in light mode, prepared its JSON export in Android's
share sheet, opened and cancelled the system JSON picker, and rendered the new
deck editor with safe areas and 44 dp+ controls. The non-empty deck
create/rate/force-kill/reopen journey was interrupted by the device lock and is
not yet accepted. Import merge, confirmed clear/recovery, repository-first
reconciliation after process death, complete attachment send, and paired
light/dark state plates remain incomplete. A real local server passed session,
list, create,
invite, private learner join, detail, and authenticated retrieval of a
19,778-byte protected material. The deployed `keating.help` course session
returns `503 notorganic_auth_adapter_unavailable`; the installed Courses screen
surfaces that failure and offers the corrective web route. Device captures are
obscured by another app's picture-in-picture window and therefore prove startup
and recovery rendering only, not look parity.

The subsequent rendering tranche raises current mobile verification to 211
tests with 881 assertions, strict typecheck, a 2,182-module Android export, and
a successful 758-task debug native build with Expo Audio and React Native SVG
linked. The final source-matched release embedded the same 2,182 modules and 38
assets, completed 987 tasks (60 executed), and produced a 115,176,008-byte APK.
Assistant output now passes through a bounded GFM AST; common Mermaid
flowcharts render as native SVG with source fallback. The native subset covers
all four directions plus Keating-generated visual directives, quoted and
double-circle nodes, and flattened subgraphs while rejecting executable click
directives. Unsafe links/images and
model-authored HTML remain inert or consent-gated. Validated shared OpenUI JSON
documents are removed from raw Markdown, stored as ordered stream events, and
render native Markdown, questions/quizzes, goals, decks, resources/media, and
explicit handoffs. SQLite schema v4 stores per-document action journals, and
each answer, goal step, card rating, or artifact save commits its learner
mutation and idempotent completion receipt in one exclusive transaction.
Documents are scoped to their session/message event before journaling. Completed
quiz answers, saved resources, and deck position restore visibly without one
action disabling sibling nodes; failed/cancelled documents expose a durable retry
control, and consent-gated HTTPS audio resources play through Expo Audio. The
device fixture includes every canonical shared node type plus the recovery
lifecycle. A requested Terra-high review reproduced and then closed the
multi-node lifecycle, cross-session journal, deck restoration, and BT direction
findings; it reported no remaining material issue in the modified scope.

This is not full rendering parity yet. Mermaid grammars beyond the bounded
flowchart subset, typeset math, syntax highlighting/runnable code, structured
citations, native video/animation playback, browser OpenUI source compilation,
and the streamed provider tool execution loop remain open. Mobile now keeps trace-only
assistant turns visible and shows only OpenAI's explicit reasoning-summary
stream; raw Anthropic thinking, Gemini thought parts, OpenAI reasoning text, and
compatible-provider reasoning fields are discarded at the provider boundary.
Reasoning summaries remain ephemeral, and all durable reasoning events are
scrubbed on save, load, migration, and portable projection because historical
events cannot be proven to be summaries rather than hidden chain-of-thought.
At this checkpoint provider-emitted tool calls remained visible as requested
calls, not falsely labelled executions; the later M2 tranche below replaces
that limitation for three local deterministic tools. The post-build physical gate is also
unverified: ADB and USB enumeration no longer saw the previously connected
Pixel, so the new APK has not completed rendering, action, force-quit, and
restart acceptance.

The model-catalog tranche now retains the complete validated models.dev catalog
for mobile discovery and search. Only entries with a concrete native transport,
endpoint convention, and credential flow can mutate active provider settings;
all others show an exact unavailability reason plus Custom/OpenRouter recovery.
The live 2026-08-10 smoke retained 6,248 models across 183 providers, with 396
models callable through the four implemented cloud transports. The provider
filter is a bounded horizontal scroller rather than an unbounded wrapped wall.
On web, Speech Settings and `/live` now derive duplex Gemini/OpenAI choices from
one graded registry while keeping TTS selection independent. Native Live/TTS,
image generation, and video generation remain separate pending transport
slices, and camera/screen input is not treated as video generation.

The evaluation/export tranche introduces portable learner contract v3 with
immutable `benchmark-run` and `evolution-run` records. Scores must be finite
percentages, topic/session linkage stays literal, same-ID divergence fails
closed, and v1/v2 imports migrate to empty histories rather than inferred
runs. Native SQLite schema v5 adds both record kinds through a transactional
copy migration. Usage renders latest metrics, a 0-100 benchmark/evolution
trend, a recorded-zero warning, and recent evolved policies from those actual
runs only. The same page can now prepare a redacted fine-tuning ZIP containing
canonical provenance-rich JSONL, ChatML, Alpaca, explicitly labelled KTO,
DPO only when real chosen/rejected evidence exists, GRPO prompts, a manifest,
schema, and dataset card. Explicitly missed responses remain in negative
evidence and are excluded from positive SFT; unscored responses remain labelled
unscored.

Before the M2 tranche, verification was 31 shared-contract tests with 224 assertions, 228 mobile tests
with 950 assertions, both strict typechecks, a 2,191-module Android export, and
a source-matched release build of 987 tasks (60 executed) with 38 assets. The
APK is 115,281,112 bytes with SHA-256
`e16c367cb8402b049ab710aab8ac10fe4685d50b6945e37a074d48525b00a32b`.
Escalated ADB access succeeded but listed no authorized device, so the current
chart, ZIP share, migration, and restart flows remain physically unverified.
Vet was invoked after each logical unit but the large pre-existing dirty diff
still caused `DiffApplicationError` before a verdict.

Independent Terra-high review initially found raw title metadata bypassing
redaction, unbounded synchronous native archive materialization, unsupported
accepted-quality claims for generated artifacts, cross-kind chart selection
collisions, and a non-executable migration test. The closure pass redacts all
exported title metadata, caps source characters and message counts with a
desktop/web recovery instruction, labels generated artifacts unscored,
namespaces chart keys by record kind, and runs the populated v4-to-v5 copy
migration against Bun SQLite while checking row and index preservation.
The web canonical export and ChatML envelope now use the same truthful artifact
semantics: generated artifacts stay unscored and are not recommended for SFT.
The focused web export/archive suite passes 15 tests with 78 assertions, and
the web strict typecheck passes.

The first M2 tool-loop tranche replaces trace-only mobile function calls with a
bounded provider-native loop. OpenAI Responses, Anthropic Messages, Gemini
generateContent, OpenRouter, and custom compatible transports now receive exact
tool declarations and provider-specific result continuations. The native
registry advertises only three deterministic local capabilities: study-plan,
concept-map, and practice-quiz generation. Arguments use closed schemas and
strict runtime validation; unknown, malformed, aborted, timed-out, and failed
calls produce truthful error results. Each successful call proposes a stable
artifact id from a semantic key derived from session, triggering learner turn,
tool name, and canonical arguments. The coordinator appends the matching call
and result trace, idempotently upserts the artifact, and persists that combined
state before the next provider round. Repeated semantic calls reuse the first
result without reapplying the effect. Usage is summed across billable rounds,
the loop is capped at four rounds and eight calls per round, and partial tool
traces remain visible when continuation fails or is cancelled.

The second M2 tranche connects those exact provider envelopes to real SSE
rounds rather than a parallel text-only parser. OpenAI Responses, Anthropic,
Gemini, and compatible chat streams incrementally emit visible text and only
provider-designated reasoning summaries, reconstruct fragmented calls, retain
the native assistant turn required for continuation, and fail closed when a
required correlation id is absent. The durable event renderer consumes
text/tool/result/text order directly and removes raw OpenUI wire JSON while
retaining the scoped interactive document event. Retry can rehydrate a prior
semantic result from its persisted call/result trace plus durable artifact;
missing artifacts fail closed, repeated same-turn calls reuse the cached result,
and later learner turns reconstruct completed historical exchanges in each
provider's native protocol. App backgrounding now aborts through the normal
partial-state persistence path, and a non-terminal force-killed trace exposes a
retry route after restart.

The current mobile suite is 278 tests with 1,081 assertions and strict
typecheck. Focused request/continuation, streaming, registry, loop, receipt,
ordered-trace, Markdown, Mermaid, and OpenUI tests pass. A fresh Android export
passes, and the source-matched release build bundles 2,195 modules and 38 assets
while completing 987 tasks (60 executed). The release APK is 115,321,876 bytes
with SHA-256
`69ca7ec3b69eb234c32cf1b9de95114627907e8484e7fb4b43e2b2fbcb0ddf8f`.
The canonical debug task also produces a 273,615,761-byte APK with SHA-256
`b599e5336e32fda9ba505abe2f233bcd53a15c0acd9b4e606ae947ccc2b70aec`.
This remains source/build evidence only: no real provider or physical-device
call/result/retry journey has been accepted, and ADB again listed no authorized
device. Authenticated remote workspace read/execute/patch, confirmed diffs,
snapshot/validation/rollback, device-proven background recovery,
course/media/improvement tool adapters, and full web tool parity remain open.
Vet was invoked after each logical unit but still failed before a verdict with
`DiffApplicationError` on the aggregate pre-existing dirty diff.

The requested independent Terra-high review found and the implementation now
closes stateless-provider history loss across third and fourth rounds, wrong
OpenAI PDF encoding, unsafe OpenAI response-item-id substitution, optional
Gemini function-call ids, models.dev `tool_call` capability loss, accidental
custom-endpoint tool advertising, weak single-word effect hashes, retry-variant
artifact timestamps/message linkage, normalized-argument idempotency, silent
non-durable commits, unavailable-capability recovery text, and provider-id
collisions in durable traces. Remaining review blockers are deliberately still
open in M2. This tranche closes the prior source-level streaming-order, durable
retry-receipt, historical tool transcript, and background-recovery implementation
gaps. Physical/real-provider recovery evidence and the authenticated remote
workspace slice with confirmed diffs, snapshot, validation, rollback, and
device-proven exactly-once recovery remain required.

The rendering-contract tranche now establishes one versioned fixture pack in
`@keating/learner-contracts` for the web Markdown dialect, twelve Mermaid
grammar families, every registered web OpenUI component, and every shared JSON
node kind. The shared UI contract preserves callouts, all conversational and
scored question forms, nested/dependency-linked study plans, concept maps, and
editable notes instead of flattening them to generic resources. Bounds cover
question content, plan depth/count/identity/dependencies, cycles, and new plan
and notes actions. Classification and matching answers retain their item,
selected option, and optional reason as structured rows; matching uniqueness is
validated instead of inferred from flattened strings. The package suite passes
34 tests with 257 assertions and
strict typecheck.

Mobile's physical smoke route consumes that shared fixture directly. Native
rendering now includes callouts, rich blank/classification/matching controls,
recursive study-plan progress, concept maps, and notes; plan progress and notes
commit as portable artifacts through the existing atomic OpenUI action store.
The canonical mobile task passes 282 tests with 1,096 assertions and strict
typecheck; the focused Markdown/Mermaid/OpenUI/action group passes 17 tests with
59 assertions. This advances M3 implementation but does not accept it: native
Mermaid remains the documented flowchart subset, typeset math/highlighting and
native video/animation remain open, and ADB again listed no connected device.

Web now depends on the shared contract and has a canonical document bridge.
Complete browser OpenUI `LearningSurface` source can be validated against the
live registry and compiled to shared semantics, but ordinary source fences
deliberately remain on the legacy renderer until their aggregate semantics and
state can migrate without loss. Canonical JSON is accepted through the
persisted `openui` fence and rendered through the shared document renderer;
partial or invalid JSON stays hidden or surfaces recovery instead of leaking
wire source into Markdown. Explicit fence IDs are now scoped to their persisted
session/fork, assistant message, and fence position. Legacy message-scoped state
and completed journals migrate forward without deleting the prior recovery key.

The canonical path covers Markdown, Mermaid maps, rich questions/quizzes,
goals, decks, nested plans, resources, notes, media, and handoffs. It constructs
full validated action envelopes with deterministic cross-runtime keys, commits
the resulting document, completed receipt, and pending host-delivery descriptor
in one storage write, replays
stale-renderer retries without another effect, restores exact answers/plan
state/notes, exposes lifecycle retry, keeps ephemeral documents mount-local,
records artifact saves and handoffs, and keeps unavailable media recoverable.
Each action now materializes into existing IndexedDB learner records and its
validated receipt journal in one transaction: question checks, goals,
plan/note/artifact projections, and deck plus immutable review records. A fixed,
receipt-linked learner-response outbox survives reload and compaction and is
acknowledged only after the session snapshot callback persists the generated
turn. Retention is distinct from runtime lifecycle, and matching/selection
answer keys compile to validated option identities or fail closed.
The isolated production `/rendering-smoke` route writes only its fixture journal.
At 390 x 844, the built preview rendered the reference Markdown and math, six
Mermaid SVGs, and the canonical OpenUI region; an answer committed and restored
its exact text after reload. A fresh headless-Chrome dev run repeated the 390 x
844 Markdown, math, Mermaid, canonical OpenUI action, and reload path with no
application console error; expected offline fixture-media DNS failures remained
recoverable. A prior dev-browser run additionally restored a plan checkbox and
edited notes. Web passes 860 tests with 10,666 assertions, strict typecheck, and
the production Vite plus Nitro build.

W1 remains in progress because browser-source grouped Question and aggregate
quiz/deck completion are not yet lossless, and bounded source-state migration
for notes/plan progress plus source digest/timestamp provenance is not enabled.
Ordinary source fences therefore deliberately remain on the legacy renderer.
The canonical JSON path now has rendered/action/reload, fork identity,
learner-record transaction, and crash-recoverable delivery evidence, but the
complete W1 source-ingress predicate still does not pass.

The goal runner applies this checkpoint as follows:

```text
mobileCheckpoint = verify_tasks_against(BUILD_DOCUMENT, current_mobile_diff)
record_implementation_evidence(mobileCheckpoint)

IF hosted_course_adapter_unavailable
  keep M4 pending
  record exact deployed blocker and corrective user path

IF physical_capture_is_obscured OR full_M3_journey_is_incomplete
  do not accept M3 or visual parity

IF native Live, grounding recovery, account/wallet/checkout,
   remaining settings, source-matched force-kill/offline portable-data and
   repository journeys, Anki package transfer,
   course authoring/discussion/replay/conflicts,
   public sharing, iOS, or dependency gates remain incomplete
  preserve their owning nodes as pending

next_acceptance_gate = required Luna review of C1 and C2; Luna remains
                       unavailable in the callable agent roster
next_implementation_work = finish W1 grouped Question and aggregate quiz/deck
                           contracts plus bounded source-state migration;
                           validate the native
                           rendering and call/result loops on a connected phone;
                           then implement
                           authenticated confirmed-diff workspace
report_progress_from_accepted_nodes_only()
```

Evidence-weighted progress remains 11.7% because this tranche does not satisfy
the complete M2, M3, or M4 acceptance predicates and C1/C2 still await the
required Luna reviews.

## Ordered repository checks

These are the expected commands after their corresponding tasks exist. All
shell commands follow repository RTK requirements.

```bash
rtk devenv tasks run keating:check-version

rtk bun test ./packages/learner-contracts/test/*.test.ts
rtk bun test ./packages/design-contract/test/*.test.ts

rtk devenv tasks run keating:test
rtk devenv tasks run keating:test-web
rtk devenv tasks run keating:build-all

rtk devenv tasks run keating:mobile-check
rtk devenv tasks run keating:mobile-export
rtk devenv tasks run keating:mobile-apk

rtk devenv tasks run keating:desktop-check
rtk devenv tasks run keating:desktop-package
rtk devenv tasks run keating:desktop-package-smoke

rtk devenv tasks run keating:parity-contract
rtk vhs validate docs/*.tape

KEATING_E2E=1 rtk bun test ./test/e2e/tui.e2e.test.ts
```

Commands that do not yet exist are deliverables of P0/I1 and must not be
reported as passing until they are implemented in `devenv.nix` and exercised.

## Current execution checkpoint — 2026-08-11 rich rendering and terminal foundation

Fixture-pack v2 is now the executable rendering oracle. It covers every current
shared node including grouped questions, nested documents, lifecycle and theme
states, maximum bounded inputs, malformed/unsafe/future documents, partial
browser source, and a serializable recovery matrix. The shared package passes
45 tests with 350 assertions and strict typecheck. Its dependency-free trusted
OpenUI compiler accepts only bounded declarations, literals, references, and
registered components. It does not evaluate authored JavaScript or HTML;
animation input becomes a source-free capable-surface handoff. Partial,
malformed, unsafe, and future-component inputs have distinct inert recovery
outcomes.

Mobile consumes those fixtures through its persisted message/wire path. Its
bounded GFM renderer now adds copyable labelled code, inline and display math
as offline KaTeX-generated MathML, and one bundled Expo DOM renderer for all
twelve Mermaid grammars accepted by web. Mermaid source is size/grammar
allowlisted and rejects directives, active content, navigation, URLs, HTML,
imports, controls, and excessive work before rendering. Mermaid runs with
strict security and HTML labels disabled; generated SVG is sanitized before
mounting. The DOM surface denies network, navigation, windows, mixed content,
cookies, and media, while preserving source, visible error recovery,
accessibility descriptions, zoom, and scrolling.

Canonical shared OpenUI JSON and completed browser-source programs render every
positive v2 fixture on mobile through the same semantic document. Source
programs compile only through the trusted shared parser. Split or fully closed
wire fences remain hidden while streaming and emit one canonical document after
closure, so raw source cannot flash or double render. Grouped questions,
completed quizzes, and completed decks each submit one ordered aggregate
action, materialize one atomic learner mutation, persist one receipt, resume
exact retries, and reject divergent replay.

The canonical mobile gate passes 316 tests with 1,299 assertions and strict
typecheck. Mixed paragraphs now retain typeset KaTeX even when math is nested
inside strong/emphasis/link/media tokens rather than degrading it to styled
source. Android production export succeeds. The current canonical debug task
completed from this source and produced
`mobile/android/app/build/outputs/apk/debug/app-debug.apk`, 273,615,761 bytes,
with SHA-256
`b599e5336e32fda9ba505abe2f233bcd53a15c0acd9b4e606ae947ccc2b70aec`.
The Expo 56 DOM serializer requires `EXPO_NO_BUNDLE_SPLITTING=1` to avoid an
invalid missing `__common` chunk. The Android NDK build task now clears host
Guix `C_INCLUDE_PATH`, `CPLUS_INCLUDE_PATH`, and `LIBRARY_PATH` so host glibc
headers cannot contaminate the cross-compile.

Web source ingress now uses that same compiler. Incomplete or rejected source
is escaped inert text; the former legacy fallback is never mounted, including
when a valid `LearningAnimation` with authored HTML has a malformed or unknown
sibling. The NodePod boot bundle was regenerated after the cutover. Ordinary
assistant text now uses the same complete `MarkdownBlock` as the diagnostic
route, closing the reduced-chat-renderer split for spoilers, GFM, KaTeX,
highlighted/runnable code, streaming fences, and Mermaid. A browser run at
`/rendering-smoke` rendered Markdown, MathML, an accessible Mermaid SVG, and
every canonical OpenUI fixture; a plan action committed revision 1 and restored
checked after reload. External fixture-image and analytics DNS failures were
visible and did not become application or hydration errors.

The ordinary persisted Chat product path is now accepted for this rendering
slice at a 390x844 viewport. A seeded completed assistant turn rendered a
semantic Markdown heading and emphasis, inline and display MathML, an accessible
Mermaid graphics document, and canonical OpenUI inside `/chat` rather than the
diagnostic route. The resumable OpenUI control committed a reviewable structured
learner response, then survived a full reload as checked and disabled with the
same learner-response receipt and no lifecycle alert. This run exposed and
fixed a session replay defect: durable event replay retained only the first
runtime `runId`, so a post-reload `ui.document.upserted` could be stored but not
projected when its correlated `ui.action` arrived. Durable replay now crosses
successive runtime runs while the live runtime still rejects foreign-run
events. Regression tests cover both protocol replay and a reopened runtime.

The credential-unavailable path was also accepted in ordinary Chat: the exact
learner prompt and an actionable authentication failure persisted across
reload instead of the composer clearing the prompt without a transcript turn.
Send and stop controls now have explicit accessible names. The renewed web gate
passes 879 tests with 10,763 assertions, strict typecheck, and the production
Vite/Nitro build. Live-provider Markdown/OpenUI generation is still unverified
because the selected hosted provider had no usable credential in this profile;
the acceptance above uses the real persisted session and renderer/action host,
not a successful provider-inference claim.

OpenTUI now has a shared-contract adapter, owner-only filesystem journal, and a
real Pi RPC action receiver. It validates canonical input, imports legacy
`keating.ui`, presents all canonical fixture nodes with explicit Mermaid/media
handoffs, rejects browser-only programs, resumes exact persisted pending work
after restart, replays final receipts, and rejects idempotency-key collisions.
Production pedagogical tool results are adapted directly into the canonical
document, so OpenUI controls are no longer reachable only through synthetic
`ui_document` tests. The PTY-backed `keating tui` discovered 53 commands,
hydrated the configured model and thinking state, opened its command palette,
dispatched a real `keating-ui-action-v1` action, and received
`{status: completed, revision: 1}`.

The terminal transcript now uses OpenTUI's production `MarkdownRenderable`
instead of flattening assistant Markdown into raw text. Its shared rendering
fixture verifies semantic headings, emphasis, links and image targets, GFM
tables, labelled code, incomplete streaming fences, spoilers, inline and
display TeX source, and all Mermaid source. Mermaid remains readable source
with an explicit graphical web/desktop handoff because OpenTUI has no native
diagram renderer; that is honest functional fallback, not graphical look
parity. Canonical OpenUI documents remain interactive through the terminal
adapter, while unknown and browser-only programs remain inert and recoverable.

Terminal capability and layout selection is now deterministic and consumes the
shared design contract. Tests cover true color, 256-color, 16-color,
`NO_COLOR`, Unicode and ASCII profiles plus exact 80x24, 100x30 and 140x40
layout decisions. Failed sends preserve the learner's exact draft and expose
Ctrl+R and `/retry`; retries do not duplicate the transcript. An actual 80x24
PTY run in `NO_COLOR` plus ASCII mode rendered the compact layout and ASCII
borders and exercised the truthful empty-retry path. OpenTUI's native
compositor still emits some RGB escape sequences for internal blank-cell fills,
so this is semantic no-color evidence, not a byte-level zero-SGR claim.

The Sessions browser is now a real project-scoped Pi session surface, available
through Ctrl+S and `/sessions`. It sorts saved sessions by modification time,
marks the active session, exposes message count and parent/fork lineage, and
offers explicit Resume, Resume and rename, whole-branch fork, and earlier-turn
fork actions. The operations use Pi RPC rather than a second Keating session
store. Successful switches clear stale documents, hydrate the selected
transcript and header, and preserve the original session. Earlier-turn forks
restore Pi's exact source prompt into the composer for editing; cancellation
and failures retain the active session.

An actual 80-column PTY opened the Sessions browser against eight project
sessions. A separate live RPC check switched an ephemeral runtime to the most
recent saved session and confirmed the selected path plus all 152 messages
were hydrated. It did not rename or fork user session files. The deterministic
controller seam verifies the exact rename, clone, fork-message enumeration,
fork dispatch, cancellation, stale-document clearing, and draft restoration
transitions.

The built-runtime check found that root tsc previously left shared-contract
imports pointing at unpublished TypeScript workspace packages, and that the
Node launcher then entered OpenTUI despite its Bun-only native FFI. Root now
emits the shared contract sources inside `dist`, TUI imports them through
runtime-local bridges, and the root package no longer declares those private
workspaces as install dependencies. `node bin/keating.js tui` hands the exact
invocation to Bun; release bundles are configured to carry a private Bun
binary, while npm installs give an actionable missing-Bun error. A dry-run npm
pack confirms both compiled contract trees and the handoff module are present.
The rebuilt Node entry successfully delegated and opened the real Sessions
browser in ASCII plus semantic `NO_COLOR` mode.

OpenTUI now exposes Library, Review, and Settings from the command palette,
with `/library`, `/review`, `/settings`, and a Ctrl+L Library shortcut. Library
uses the real project artifact index, bounded Markdown previews, source-only
HTML/SVG handling, export copies, and recoverable project trash instead of
unlinking learner work. Review discovers generated flash-card artifacts, uses
the shared canonical SM-2 transition for observed terminal ratings, persists an
owner-only atomic schedule, and labels topic urgency as an estimate derived
from local learner history rather than measured provider usage or proven
mastery. Settings reads and changes the real Pi RPC model, thinking, retry,
compaction, steering, and follow-up state. It reports the explicit OpenTUI
policy: the model receives `read`, `grep`, `find`, and `ls`, while execute and
source-mutation tools remain unavailable because this surface has no visible
diff/confirm/validate/rollback flow. The exact-session `/shell` handoff reports
classic Pi's broader policy separately, so OpenTUI never claims that it
augmented its own code.

The shared terminal rendering fixture now passes 34 tests with 217 assertions.
It exercises OpenTUI's production `MarkdownRenderable`, the declared Markdown
and teaching-extension matrix, every declared Mermaid grammar and recovery
case, every canonical OpenUI node, trusted OpenUI source compilation without
HTML/JavaScript evaluation, durable action replay, and the real Pi action
transport. This is semantic rendering evidence: Mermaid remains complete
readable source plus same-session graphical handoff in OpenTUI, while web,
desktop, and mobile retain the graphical-rendering requirement. A rebuilt
80x24 ASCII/semantic-`NO_COLOR` PTY opened the new Library against the real
project and displayed saved Markdown, Mermaid, quiz, benchmark, timeline, and
trace artifacts.

The `/shell` handoff now captures the active Pi session file before stopping the
OpenTUI RPC runtime and launches classic Pi with that exact `--session` path.
Two focused tests cover exact-session and no-session behavior; a rebuilt PTY
entered the `/shell` handoff and launched classic Pi under the same project.
This removes the prior directory-only handoff that could silently open a
different conversation.

The session browser now reads the same project-local `.keating/sessions`
directory that the Pi RPC runtime writes. An isolated live RPC run resumed a
seeded session, cloned the whole branch, renamed the clone, forked an earlier
turn with the exact source prompt restored, and confirmed three distinct runtime
paths while the original remained saved. A rebuilt 80x24 PTY in that isolated
project displayed the project clone rather than unrelated global sessions.

Accepted RPC sends now remain pending until `agent_end`. A later provider error
or stop restores the exact draft instead of losing it after initial transport
acceptance. An actual 80x24 ASCII, semantic-`NO_COLOR` PTY stopped a response
and visibly restored `Preserve this exact isolated provider-failure draft.`
with Ctrl+R, `/settings`, and `/shell` recovery. The same built terminal opened
Settings and Review; Review truthfully labelled the empty observed-card and
estimated-topic state. A controller event regression sends a future OpenUI
document after a valid one and proves the valid document stays focused while a
visible recovery error is added.

The complete terminal deliverable evidence now passes 312 root tests with
86,718 assertions, strict root typecheck, the canonical root build, scoped diff
validation, deterministic 80x24/100x30/140x40 and color-capability projections,
and real 80x24 PTY journeys for Sessions, Library, Review, Settings, provider
stop recovery, canonical OpenUI action delivery, and `/shell`. T1 and T2 remain
in `review`, not `accepted`, because the goal graph requires C1 and C2 to be
accepted first and their independent Luna reviews are still unavailable. The
configured release-bundle Bun copy also remains source/test evidence until an
actual release archive is assembled and launched outside the checkout.

The desktop canonical check now passes 14 tests with 50 assertions and strict
typecheck. Focused OAuth coverage passes 20 tests with 47 assertions, including
the Electron handoff that opens the real provider HTTPS URL instead of a child
`about:blank` window that the navigation policy denies. The permission boundary
allows only camera/microphone requests from the owning Keating main frame,
denies foreign origins and subframes, and explicitly denies display capture
until a learner-visible source picker exists. These are deterministic policy
results, not physical device-permission evidence.

The canonical build and package-smoke tasks were run sequentially. Running them
together had previously raced and packaged an older web bundle, so concurrent
invocation is not acceptance. The resulting unpacked release was launched as a
real Electron window with an isolated user-data directory and no development
server. Its packaged Nitro origin served `/api/courses/session` with a 200 local
learner response, and the Courses navigation rendered `COURSE LIBRARY · LOCAL
WORKSPACE` from the same packaged process.

This installed-window pass exposed two defects hidden by source checks. First,
the sandboxed preload had been emitted as ESM and never exposed
`window.keatingP2P`, silently leaving desktop on browser storage. The preload is
now emitted and staged as CommonJS and exposes only `call` and `onPeerStats`.
Second, optional `undefined` fields in otherwise valid storage calls failed the
JSON-only IPC boundary; the preload now converts parameters to their exact JSON
representation before main-process validation. The final package reported a
native P2P writable length of 3. A submitted learner prompt plus actionable
provider-authentication recovery survived a full process restart from that
P2P store, and the false browser-persistence warning no longer appeared.

At the packaged window's 948 by 968 content size, the current logo, tutor
avatar, header actions, recoverable error card, fork control, and web-parity
composer were visually inspected. The packaged `/rendering-smoke` route also
rendered semantic Markdown, MathML, accessible Mermaid graphics, and the
canonical OpenUI reference; its only browser log errors were expected
unresolvable external fixture media. This complements the already accepted
ordinary `/chat` rendering/action/reload path rather than replacing it with a
diagnostic-only claim.

Desktop provider and OAuth credentials now use a main-owned credential vault
instead of the replicated P2P store. The vault accepts only bounded credential
ids and values, writes versioned ciphertext through atomic owner-only files,
serializes mutation, rejects corrupt/unsupported/symlinked state, and fails
closed when Electron cannot provide real OS encryption. On Linux, Electron's
`basic_text` fallback is explicitly rejected. Legacy `provider-keys` values are
deleted from P2P only after encrypted persistence succeeds; all new provider
and OAuth writes route through the validated credential IPC/preload bridge, and
direct generic-P2P access to that store is rejected.

The renewed desktop gate passes 26 tests with 159 assertions and strict
typecheck. The web gate passes 884 tests with 10,781 assertions and strict
typecheck. Production desktop build and unpacked package assembly pass. A
clean-profile packaged run exposed both `keatingP2P` and the six-method
`keatingCredentials` bridge. This host has no secure Electron keyring, so a
dummy credential was rejected with `Secure credential encryption is
unavailable`; the Settings UI labelled the OS vault, displayed that error, and
kept the entered-key retry guidance. A filesystem scan found neither dummy
secret, and a direct generic P2P write was rejected. This is fail-closed runtime
evidence, not a positive OS-keyring round trip. That run also exposed and fixed
a renderer teardown defect: the P2P stats timer now stops when `webContents` is
destroyed, and the rebuilt packaged process exited without the former repeated
disposed-frame sends.

Acceptance status remains incomplete: an escalated host ADB check still lists
no attached or authorized device, so the current APK has no physical Android
rendering/action/restart evidence; desktop still lacks real camera/microphone,
learner-selected screen capture, actual OAuth system-browser return, course
realtime WebSocket, a positive secure-keyring round trip,
installed-outside-checkout, and 1024/1440 reference-diff
evidence; T1/T2 promotion waits on the C1/C2 dependency reviews; and Luna remains
unavailable for the required independent reviews. `vet` was invoked after each logical edit
but still fails before a verdict with `DiffApplicationError` while
reconstructing the aggregate pre-existing dirty diff. These stronger
implementation and runtime slices do not satisfy another complete weighted
node, so evidence-weighted `/goal` progress remains 13.7 percent.

## Final runtime scenarios

### Desktop

- Install the packaged artifact outside the checkout with a clean user profile.
- Open Chat, Courses, Course workspace, Live, settings, and OAuth recovery.
- Exercise an `/api/**` request and course realtime WebSocket.
- Restart and confirm session/artifact persistence.
- Exercise camera, microphone, screen, navigation, external-link, and denied
  permission paths.
- Capture 1024px and 1440px views and compare against the web production build.

### Mobile

- Physical Android arm64 and iPhone or signed approved native build.
- Compact and large screens, light/dark, dynamic text, keyboard and safe areas.
- Offline, slow network, provider error/expiry, background, force-kill, resume.
- Complete a question and quiz, review a due card, fork a session, save/export
  an artifact, open a share, and resume a course.
- Open the Tutor-header model selector, load the models.dev catalog, search by
  name/ID/provider, combine provider and capability filters, select a model,
  restart, and confirm the provider/model/base URL plus recent choice persist.
  Repeat offline and with a failed refresh to prove cached fallback and retry.
- Search the complete models.dev catalog for a provider without a native
  adapter and confirm it remains discoverable but unavailable with an exact
  reason and router/Custom recovery path. It must not mutate the active model.
- Select and restart with independent chat, duplex Live, text-to-speech, image,
  and video-generation choices wherever their transports exist. Confirm camera
  or screen input is labelled separately from video generation. A missing
  transport must expose a preserved-context handoff, not a success-looking
  picker value.
- Fork both a whole session and an earlier assistant response, confirm the
  copied transcript stops at the chosen response, verify lineage in Tutor and
  Sessions, reopen the original, restart, and confirm the branch tree persists.
- Denied camera/audio/attachment permission preserves the learner's draft and
  offers a corrective action.
- With no remote workspace configured, code augmentation is visibly unavailable
  and no mutation tool is sent to the model. With an authenticated test adapter,
  inspect a proposed patch, reject it without a write, approve it against a
  snapshot, run validation, and roll it back; force-kill during each boundary
  must resolve to either the original or fully applied revision, never a partial
  file.

### OpenTUI

- 80x24, 100x30, and 140x40 terminal sizes.
- True color, 256 color, 16 color, `NO_COLOR`, and ASCII fallback.
- Resume session, complete quiz, review card, open artifact fallback, recover
  from a provider failure, and switch through `/shell`.
- Unknown media/document kinds remain saved and offer a useful handoff.
- Show whether the active Pi/runtime exposes read, execute, and source-mutation
  tools. Apply a source edit only after a visible diff and explicit confirmation,
  then validate and restore the snapshot on failure; otherwise offer `/shell`
  without claiming OpenTUI changed its own code.

### Cross-surface

- The same fixture session, branch, goal, graded quiz, deck review, artifact,
  and course state produces the same learner-visible meaning on every surface.
- Web-to-mobile sharing and import/export preserve IDs and do not duplicate
  material.
- Hosted Not Organic, courses, public sharing, and cloud sync are verified
  separately from local mode.

## Failure and recovery rules

1. A failed gate returns the node to its owner with exact diagnostics.
2. The coordinator does not mark a partial implementation accepted to increase
   progress.
3. User work and entered learner content are preserved across every retry.
4. Missing credentials, devices, signing authority, Luna availability, or
   deployment access are reported as explicit waiting requirements.
5. The overall goal is marked `blocked` only after the same external blocker
   persists for at least three goal turns and no meaningful safe work remains.
6. The overall goal is marked `complete` only through the completion predicate,
   never because the token/time budget is low or the implementation appears
   substantial.
