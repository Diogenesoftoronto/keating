# OpenUI to OpenTUI portability gaps

Status: source-backed assessment
Observed: 2026-08-26
Scope: Keating web learner product (`web/src/`) compared with `keating tui`
(`src/tui/`)

## Executive finding

The remaining OpenTUI gap is substantial, but it is no longer a basic OpenUI
rendering gap.

Current OpenTUI consumes the shared learner contract, compiles supported OpenUI
source through the trusted shared adapter, presents every canonical semantic
node, exposes keyboard actions for stateful nodes, and journals action delivery.
It also has real terminal product surfaces for sessions, artifacts, spaced
repetition, courses, sharing, models, thinking controls, and recovery. The old
claim that OpenTUI only renders static cards is no longer accurate.

The important gaps now sit one layer above rendering:

1. OpenUI actions do not consistently materialize into the same durable learner
   records that power web profile, Coming Up, usage, and portable data.
2. completed and in-progress documents are not restored as active interactions
   when a session is reopened; only the latest live document owns controls.
3. the web's learner dashboard, portable-data workflow, complete session
   lifecycle, and authenticated course workspace do not have terminal-native
   equivalents.
4. graphical, media, Live, hosted-account, and code-execution capabilities need
   useful context-preserving handoffs, not pretend terminal implementations.

This assessment distinguishes three terminal surfaces:

- `keating tui` is the learner-focused OpenTUI cockpit assessed here.
- `keating shell` is the classic Pi compatibility surface. It has additional
  slash commands, tools, package UIs, and direct runtime behavior, but those do
  not automatically make a workflow available in OpenTUI.
- the root CLI offers deterministic one-shot commands such as import/export and
  benchmark operations. A command that exists after exiting the cockpit is a
  useful fallback, not a first-class OpenTUI workflow.

## What is already ported

| Capability | Current terminal outcome | Evidence |
|---|---|---|
| Chat and recovery | Streamed assistant text, stop, queued follow-ups, exact draft restoration, retry, and sanitized errors | `src/tui/opentui-host.ts`, `src/tui/prompt-recovery.ts`, `src/tui/host-controller.ts` |
| Models and reasoning | Searchable authenticated-model picker, in-place provider connection/repair with exact-session refresh, direct model selection, thinking levels, auto-retry/compaction, and queue modes | `src/runtime/provider-login.ts`, `src/tui/model-picker.ts`, `src/tui/settings.ts` |
| Sessions | Project-scoped resume, rename, full-branch fork, earlier-turn fork, lineage display, and new session | `src/tui/session-browser.ts`, `src/tui/host-controller.ts` |
| OpenUI ingress | Canonical JSON, legacy tool results, and completed supported OpenUI source compile into the shared semantic document without evaluating authored JavaScript or HTML | `src/tui/ui/adapter.ts`, `packages/learner-contracts/src/openui-source.ts`, `src/tui/host-controller.ts` |
| Semantic node coverage | Markdown, callouts, questions, grouped questions, quizzes, goals, plans, decks, artifacts, maps, notes, images, media, and handoffs all have terminal presentations | `src/tui/ui/render.ts` |
| OpenUI actions | Keyboard controls cover answers, grouped responses, quizzes, goal and plan completion, notes, deck ratings/completion, artifact saves, and handoffs | `src/tui/host-controller.ts` |
| Action safety | Owner-only filesystem journals, document locks, pending/final receipts, correlation checks, idempotency conflicts, and preserve-work recovery exist | `src/tui/ui/journal.ts`, `src/tui/ui/filesystem-journal.ts`, `src/tui/ui/rpc-action-transport.ts` |
| Markdown and composer | OpenTUI Markdown rendering plus source-preserving code, readable TeX, spoilers, explicit link/image targets, Mermaid source handoff, bounded `@path` text attachments, a Tab-triggered project file picker, and sent-attachment detail | `src/tui/composer.ts`, `src/tui/view-model.ts`, `src/tui/sacred-transcript.ts` |
| Diagnostics | Local read-only runtime summary, exact RPC-exposed session messages, recent event ring, sanitized Pi process diagnostics, and inline tool failures | `src/tui/debug.ts`, `src/tui/opentui-host.ts` |
| Artifact library | List/filter, preview, copy path, export a copy, and recoverably move to project trash | `src/tui/library.ts`, `src/tui/opentui-host.ts` |
| Review | Due-card queue and Again/Hard/Good/Easy scheduling with local learner-history provenance | `src/tui/review.ts` |
| Courses | Local/optional remote listing, search, outline/lesson review, and starting a lesson in a fresh tutor session | `src/tui/courses.ts`, `src/tui/opentui-host.ts` |
| Sharing | Explicit confirmation and a sanitized read-only web share that excludes tool traffic, credentials, and local files | `src/tui/share.ts` |
| Capability boundary | Agent read/search is explicit; execution and source mutation are not advertised without a diff/confirmation/validation/rollback surface; `/shell` preserves the exact Pi session | `src/runtime/tool-policy.ts`, `src/tui/settings.ts`, `src/tui/shell-handoff.ts` |

These are meaningful implementations, not placeholders. They should be retained
while filling the following gaps.

## Prioritized gap matrix

### P0 — required for honest learner-product parity

| Gap | What web can do | Current OpenTUI limitation | Terminal outcome to port |
|---|---|---|---|
| One durable learner state | Question checks, quiz outcomes, goals, plans, decks, reviews, priorities, and feedback feed browser learner storage and portable records | The UI receiver mainly updates a resulting document and two action journals. OpenUI quiz/deck/goal actions do not consistently update core learner records. The separate `tui-review.json` schedule is not the OpenUI deck schedule or the web store | Materialize an action's learner mutation and receipt atomically into a project learner repository. Use that repository for OpenUI controls, Review, learner summaries, and export. Never show success before both records commit |
| Resumable OpenUI interactions | The browser reloads a document's resulting state and receipts, preserving resumable/workspace interactions | Session hydration rebuilds transcript entries but does not reactivate historical OpenUI documents or load their resulting documents from the journal. Multiple documents in a turn are appended, but only the last activated document retains controls | Persist document identity with session/message/fence position, restore resulting state and entered work on resume/restart, list all actionable documents, and replay the exact pending action key rather than merely proving the journal can replay a caller-supplied key |
| Learner hub / Coming Up | Web combines due work, learner-selected Focus/Maintain/Low priorities, goals, verification work, assessed evidence, confidence, decks, and review | Review exposes due cards and estimated topic urgency, while profile, goals, quizzes, feedback, and due-work fragments live in separate files or classic commands | Add a terminal learner view backed by the shared repository: profile/context, goals, pending grading, due work, priorities, assessed evidence with provenance, and review. Keep usage distinct from mastery |
| Portable data | Web imports/exports sessions, learner state, artifacts, goals, feedback, and optional sandbox history through the versioned portable contract | Library exports individual artifacts and the root CLI has fine-tune import/export, but OpenTUI has no validated whole-product portable import/export workflow | Add command-palette import/export with validation, previewed counts, deterministic merge/conflict reporting, secret redaction, failure recovery, and an explicit destination path |
| Complete session lifecycle | Web searches, resumes, renames, forks, shows branch lineage, confirms deletion, and participates in portable export/share | OpenTUI has resume/rename/fork/share and generic searchable selectors, but no confirmed recoverable session deletion or session-focused export | Add owner-scoped search, recoverable delete/restore, and session export. Preserve active-session recovery and branch lineage |
| Authenticated learner courses | Web supports authenticated list/join, role and consent enforcement, protected materials, lesson work, assignments, artifacts, discussion, reactions, and progress | The terminal course reader performs an optional unauthenticated GET, silently returns no remote courses on failure, and can only start a lesson prompt. Its own comment says authentication remains the web app's job | First port an authenticated learner subset: truthful sign-in state, list/join and consent, protected reading download/open, lesson progress and assignments. For collaboration and authoring not yet implemented, generate an authenticated web handoff that preserves course, lesson, session, and unsent work |

### P1 — high-value terminal equivalents after the data boundary is fixed

| Gap | Current limitation | Recommended outcome |
|---|---|---|
| Assessment fidelity | OpenUI quiz timing is recorded as zero, answers begin as pending even when locally gradable, and terminal controls do not expose web's flag/skip/partial-credit workflow. Standalone row, slider, and dropdown questions fall back to generic selection/text behavior | Track elapsed time, objective credit, skipped/flagged/pending status, and per-question drafts. Reuse one terminal form engine for every shared question kind and write the resulting portable evidence atomically |
| OpenUI deck continuity | Rating an OpenUI card starts from a fresh SRS state and removes it from the displayed document; the separate Review surface owns another schedule | Route both OpenUI decks and saved artifact decks through the same SRS repository and show next due state from the durable prior schedule |
| Real handoffs and resource actions | Map/media notices preserve source, but `open-handoff` currently records a callout rather than opening/copying a concrete capable target. Images, audio, video, and animation have save/source controls but no unified handoff | Provide safe `Open`, `Copy target`, and `Open web/desktop` actions with explicit target and context payload. Preserve session/document/course IDs and any entered draft. Require confirmation for network or executable targets |
| Composer attachments | `@path` safely embeds bounded text files, Tab opens a project text-file picker, and the sent transcript identifies attached files; there is no persistent attachment tray with remove/error states, binary/image handling, or model-capability feedback | Add a visible attachment tray with remove/error states. Keep text embedding local; represent binary/image attachments only when the selected model/runtime really supports them, otherwise retain the file and offer a capable-surface handoff |
| Capability-aware settings | OpenTUI now has authenticated model selection, in-place provider repair, runtime controls, and local read-only diagnostics, but not the web's richer capability/unavailable reasons, recent/filter views, learner context, appearance/accessibility controls, portable-data/privacy controls, or hosted account/capability status | Add the remaining model capability truth, learner profile/context, terminal appearance/accessibility choices, portable-data/privacy controls, and hosted account status. Hosted wallet/checkout should remain a web handoff |
| Learner feedback | Classic Pi commands can record topic feedback, but the OpenTUI transcript has no per-response thumbs/confused controls or reviewable comment path | Add keyboard response feedback and optional comment capture, backed by the same portable feedback records as web. Forked messages must not inherit source feedback |
| Transcript affordances | Terminal output is readable, but lacks first-class copy for messages/code blocks, structured citation actions, and expandable tool/reasoning detail | Add focused transcript actions for copy, citation target, artifact save, and safe tool-result detail. Do not expose private chain-of-thought; only show provider-supported summaries and observed usage |

### P2 — useful parity, but not a blocker for the core learning loop

| Gap | Recommended outcome |
|---|---|
| Usage and study activity | Add a provenance-labelled terminal dashboard for observed sessions, activity calendar/topic mix, and provider-reported tokens/cost. Missing provider usage must remain “unavailable,” never estimated |
| Bench/evolution history | Index benchmark, evolution, prompt-evolution, and improvement records as typed library views with trends and links to their source artifacts instead of requiring raw-file inspection |
| Training data workflows | Expose the existing deterministic fine-tune import/export commands through a guided terminal flow, including format, source, redaction, scoring cost disclosure, counts, and dataset-card path |
| Course authoring/collaboration | After the authenticated learner subset is stable, consider terminal-native course outline/material/card editing and discussion. Until then, use the authenticated workspace handoff; do not duplicate a large drag-and-drop browser builder literally |
| Image generation | Let a capable configured provider generate and save an image artifact with prompt, provenance, alt text, and web/desktop handoff. The terminal does not need inline raster rendering to support the learning workflow |

## Features that should not be copied literally

Parity means an equivalent outcome, not a terminal imitation of browser pixels.

| Browser capability | Correct terminal treatment |
|---|---|
| Graphical Mermaid, Hyperframes, remote images, audio, and video | Keep readable description/source/provenance and offer a safe capable-surface handoff. Never claim playback or graphical rendering |
| Live camera, microphone, and screen sharing | Preserve the learner's prompt/session and hand off to web, desktop, or mobile. Voice tags may remain transcript-safe metadata; they are not audio |
| Hosted account portal, wallet, and checkout | Show account/capability status and use an authenticated browser handoff. Do not move product assertion, DPoP, payment, or wallet authority into OpenTUI |
| Browser sandbox and arbitrary model-authored code execution | Keep OpenTUI's truthful read/search boundary. Use `/shell` for the exact session until a proposed-diff, confirmation, validation, snapshot, and rollback surface exists |
| Drag-and-drop boards, masonry session cards, animations, and pointer-only controls | Use searchable lists, tree rows, explicit keyboard actions, and stable focus. Preserve semantics and recovery, not layout |
| Marketing, paper, pricing, download, privacy, terms, and blog routes | Link when useful; do not port them into the learner cockpit |

## Recommended implementation sequence

1. **Unify persistence before adding panels.** Define one project learner
   repository adapter for terminal actions and migrate `tui-review.json` without
   losing existing schedules. Atomically commit mutation plus receipt.
2. **Restore document lifecycle.** Scope documents to session/message/fence,
   persist exact drafts and action keys, restore every unfinished document, and
   make prior documents selectable from transcript or a document list.
3. **Build the learner hub.** Put profile, goals, evidence, priorities, due work,
   and SRS on the unified repository. Clearly label observed, assessed,
   estimated, and provider-reported data.
4. **Finish local ownership workflows.** Add portable import/export, recoverable
   session deletion, session export, response feedback, and richer artifact
   actions.
5. **Add authenticated course access and handoffs.** Implement the safe learner
   subset first. Send unsupported collaboration, media, Live, hosted account,
   and code augmentation to capable surfaces with concrete preserved context.
6. **Improve terminal ergonomics.** Complete assessment forms, attachment state,
   copy/citation actions, capability-aware settings, usage, and typed history
   views.

## Acceptance evidence for a future parity claim

Source presence is not enough. At minimum, exercise the installed TUI in real
80x24 and wider terminals and prove:

- a production Pi response emits multiple shared OpenUI documents, each remains
  addressable, and an unfinished typed response survives process restart;
- a question, quiz, goal, plan, notes edit, and deck review each commit exactly
  one portable learner mutation and one receipt, then restore after restart;
- a failed write leaves the learner's exact work visible and retrying does not
  duplicate evidence;
- session search/rename/fork/delete/restore/export and portable import/export
  preserve lineage and reject malformed or secret-bearing data;
- authenticated course consent and protected-material failure paths are honest,
  or the handoff opens the exact course/lesson with the current draft preserved;
- Markdown, code, math, links, citations, every canonical OpenUI node, malformed
  input, and media/map handoffs remain readable in color, `NO_COLOR`, Unicode,
  and ASCII modes;
- provider usage, learner mastery, and estimated urgency remain visibly distinct.
