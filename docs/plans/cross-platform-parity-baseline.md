# Cross-platform parity baseline

Status: P0 accepted
Observed: 2026-08-11
Reference: [build specification](cross-platform-parity-build.md) and
[execution program](cross-platform-parity-execution.md)

## What this baseline proves

This is the Wave 0 inventory required by P0. It maps every required learner
capability to an explicit outcome and downstream owner, records protected
pre-existing changes, and identifies the first dependency-safe work. It does
not claim feature parity or runtime acceptance.

Status terms in the matrix mean:

- **Present**: source and focused checks cover the stated behavior.
- **Partial**: useful behavior exists, but the required parity outcome is not
  implemented or verified.
- **Missing**: the required outcome has no implementation on that surface.
- **Unverified**: source may exist, but the required installed, rendered,
  authenticated, device, or terminal path has not been exercised.

## Reference web capability inventory

The web learner product is the semantic and visual reference. Its source-level
capability groups are:

| Capability | Primary web evidence |
|---|---|
| Chat and recovery | `web/src/pages/Chat.tsx`, `web/src/hooks/useKeatingAgent.tsx`, `web/src/components/FailedResponseRecovery.tsx` |
| Providers and models | `web/src/components/ProvidersModelsTab.tsx`, `web/src/lib/provider-models.ts`, `web/src/keating/capabilities.ts` |
| Sessions, branches, export, sharing | `web/src/types/session.ts`, `web/src/hooks/keating-storage.ts`, `web/src/keating/shared-sessions.ts`, `web/src/pages/SharedSession.tsx` |
| Assessments, goals, and plans | `web/src/keating/browser-tools/assessment.ts`, `web/src/keating/browser-tools/teaching.ts`, `web/src/components/QuestionRenderer.tsx`, `web/src/components/QuizRenderer.tsx`, `web/src/components/GoalRenderer.tsx` |
| Decks, SRS, Coming Up, profile | `web/src/components/FlashcardRenderer.tsx`, `web/src/keating/flashcard-types.ts`, `web/src/keating/srs.ts`, `web/src/pages/ComingUp.tsx`, `web/src/components/LearnerProfileTab.tsx` |
| Artifacts and media | `web/src/components/ArtifactViewer.tsx`, `web/src/components/ArtifactBrowserOverlay.tsx`, `web/src/components/MermaidRenderer.tsx`, `web/src/components/HyperframesPlayer.tsx` |
| Courses | `web/src/pages/Courses.tsx`, `web/src/pages/CourseWorkspace.tsx`, `web/src/courses/`, `web/server/api/courses/` |
| Live voice and vision | `web/src/pages/Live.tsx`, `web/src/components/live/`, `web/src/keating/video-capture.ts` |
| Visual identity and recovery | `web/panda.config.ts`, `web/src/keating/ui-settings.ts`, recovery components and error policies |
| Packaging and version truth | root/web manifests, `scripts/sync-version.ts`, release workflows |

The current 874-test/10,749-assertion web suite, Panda/TypeScript, and the Vite/Nitro production build pass.
Canonical JSON and completed browser-source OpenUI now converge on the same
shared renderer. The 390 x 844 acceptance route renders Markdown, math,
Mermaid, and both OpenUI ingress forms; the browser-source grouped response
restores its completed receipt after reload.

## Platform parity matrix

| Required capability | Desktop current state and required outcome | Mobile current state and required outcome | OpenTUI current state and required outcome | Downstream owner |
|---|---|---|---|---|
| Streaming chat, stop, retry, recoverable errors | **Partial/unverified.** Electron selects the web renderer, but the packaged `file://` origin cannot prove its server paths. D1 must load the real loopback Nitro product; D2 must verify recovery. | **Partial/source-verified.** Direct BYOK streaming, cancellation, and provider errors now share the bounded native function loop. Four provider protocols source-test ordered streamed text/tool/result/text, committed effects before continuation, durable receipt reuse after retry/restart, native historical reconstruction, background abort recovery, and force-kill detection. Real-device/provider and remote-workspace recovery acceptance remain M2 gates. | **Partial.** Pi RPC streaming, abort, and redacted errors exist. T2 must add retry while preserving composer and session context. | D1/D2, M2, T2 |
| Provider/model configuration and truthful capabilities | **Partial/unverified.** The web settings UI exists; its duplex Speech and `/live` selectors now derive from one graded model registry, but loopback/local/hosted states are not packaged or exercised. | **Partial/unverified.** BYOK and SecureStore exist. A native Tutor-header picker now validates, caches, searches, and filters the complete models.dev catalog; entries without a real native transport remain visibly unavailable with exact Custom/router recovery, while the four callable cloud transports plus Custom retain atomic selection, recents, refresh, and fallback. Chat, Live/TTS, image, and video-generation selections remain separate required slices. Unit/typecheck/bundle gates pass, but the installed picker still needs Pixel interaction proof; hosted capability/account states remain M2/M4 work. | **Partial.** Model/thinking controls exist. C1/T2 must add a capability/settings view with reasons and recovery. | C1, D1/D2, M2/M4, T2 |
| Agent workspace and code augmentation | **Partial/unverified.** Web can edit a disposable NodePod source snapshot; trusted host source writes exist only when launched with an explicit project root and `--allow-local-exec`. Packaged capability and confirmation/rollback journeys remain unaccepted. | **Missing by design, truthfully represented.** The new native registry does not advertise workspace tools and carries an explicit no-authenticated-adapter recovery descriptor. M2 must implement only an authenticated remote workspace adapter with truthful read/execute/patch capabilities, learner-visible diff confirmation, snapshot/rollback, and unavailable recovery. | **Partial/unverified.** The Pi compatibility shell may expose local tools and the CLI has explicit edit/improvement commands, but OpenTUI has no capability view or confirmed diff/rollback journey. | D1/D2, M2, T2 |
| Sessions, resume, rename, branches, import/export, sharing | **Partial/unverified.** Web session UI and a P2P storage bridge exist. D1/D2 must prove persistence and honest local/public sharing; D3 owns sync truth. | **Partial/unverified.** Explicit Open/Fork/Delete controls, whole-session and per-response forks, cloned message identities, schema-v2 lineage persistence, parent-first branch views, and original-session recovery now exist and pass focused tests. Physical fork/restart evidence plus the M1 repository, rename, portable data, deep links, and public sharing remain required. | **Partial.** Current session hydration and new-session work. C1/T2 must add library/resume/rename/fork/import/export/share or explicit handoff. | C1, D1-D3, M1/M3/M4, T2 |
| Questions, quizzes, grading, goals, study plans, feedback | **Partial/unverified.** Literal web renderers exist but have no packaged acceptance. | **Implemented/source-verified; device pending.** Legacy cards and canonical shared OpenUI documents now cover Markdown, questions, grouped diagnostics, aggregate quizzes/decks, goals, resources/media, and explicit handoffs. Documents are scoped to their session/message event before persistence; grouped answers, terminal quiz outcomes, and complete deck reviews each commit one ordered learner mutation plus one idempotent receipt atomically before success UI. Portable quiz evidence retains timing, partial credit, flagged, pending, and skipped state. Multi-node controls remain usable after sibling actions and failed/cancelled documents expose retry without discarding input. Physical action/restart evidence is still required. | **Partial.** Classic Pi has interactive widgets; OpenTUI renders static cards. T1/T2 must submit and persist typed actions. | C1, D1/D2, M3, T1/T2 |
| Usage, study activity, and learning evidence | **Partial/unverified.** Web usage and Coming Up pages exist, and web training export now matches native truth semantics by keeping generated artifacts unscored and not recommended for SFT, but curriculum history is not reliably populated and packaged persistence is unaccepted. | **Implemented/device-rendered foundation; current additions device-pending.** Usage & Study Activity aggregates observed lessons, calendar days, topic mix, attachments, feedback, and provider-reported model/token/cost data with provenance and missing-data language. Portable contract v3 and SQLite schema v5 now preserve only actual benchmark/evolution runs and render their web-shaped score trend, latest metrics, recorded-zero warning, and recent policies without deriving scores from activity. A redacted fine-tuning ZIP emits canonical provenance-rich JSONL plus ChatML, Alpaca, KTO, DPO only when explicit preferences exist, GRPO prompts, manifest, schema, and dataset card; rejected responses are excluded from positive SFT. A separate Learn & Coming Up page derives goal progress, assessed mastery, review-only retention, confidence, pending work, priorities, decks, and due work from the SQLite/portable source of truth. Prior Usage/Learn and JSON-sheet device evidence remains valid, but the new history chart/training archive, import merge, clear recovery, non-empty evidence, and force-kill persistence are unaccepted on device. | **Partial.** Timeline, due, learner-state, and feedback commands expose fragments without a unified learner view or shared records. | C1, D1/D2, M1/M3, T1/T2 |
| Decks, SRS, Coming Up, learner profile | **Partial/unverified.** Web implementation exists but restart persistence is not accepted in an installed app. | **Implemented/device-rendered; full journey pending.** Contract-v2 card schedules match the web outcomes for Again/Hard/Good/Easy; native review queues, due/overdue totals, deck lists, Focus/Maintain/Low lanes, exact goal steps, and evidence-labelled profile states are repository-backed. Manual deck authoring now atomically commits a complete deck before opening Review, preserves its draft on failure, and truthfully labels Anki transfer unavailable. The editor rendered on a source-matched Pixel release; create, rate, force-kill, and reopen still require completion. | **Partial.** Textual due/timeline/profile behavior exists without review controls. T1/T2 must add SRS actions and review views. | C1, D1/D2, M1/M3, T1/T2 |
| Typed artifacts: search, preview, save, open, copy, delete, export | **Partial/unverified.** Web views and downloads exist; installed behavior and desktop persistence are unproved. | **Partial/source-and-build-verified.** Assistant Markdown uses a bounded Marked AST with GFM tables/tasks/nesting/strike, inert HTML, confirmed links, consent-gated HTTPS images, copyable code fences, offline KaTeX-generated MathML, and one restricted local Expo DOM renderer for all twelve accepted Mermaid grammars. Mermaid input is bounded and denylisted before strict rendering; output SVG is sanitized, network/navigation/windows/media are disabled, and source/error fallback plus zoom/scroll remain available. Canonical OpenUI resources save atomically or open through explicit handoff; HTTPS audio is consent-gated and plays through Expo Audio. Browser-source OpenUI, highlighted/runnable code, structured citations, native video/animation playback, artifact search/delete/export, and physical rendering remain open. | **Partial.** Canonical/legacy documents now have safe static terminal presentation, including Mermaid source and capable-surface media handoffs; keyboard actions and an artifact library remain open. | C1, D1/D2, M1/M3, T1/T2 |
| Courses, assignments, discussion, reactions, roles, consent | **Missing in package.** Nitro routes and UI exist in the web tree, but `file://` cannot serve them. D1/D2 must prove local and authenticated states separately. | **Partial/unverified.** A native read-only client now establishes an account-scoped session before listing, stores its scoped credential in SecureStore, lists/joins/details courses, uses server-driven two-step teacher consent, retrieves protected materials with native authentication, and atomically starts a course lesson in Tutor. A local real-server learner flow passed, but deployed auth is unavailable; authoring, assignments, discussion/reactions, offline replay/conflicts, public sharing, expiry/sign-out, and full M4 acceptance remain. | **Missing.** T2 must provide a safe learner subset or context-preserving authenticated handoff. | D1/D2, M4, T2/I1 |
| Live voice, camera, screen, and media | **Partial/unverified.** Web Live exists without an Electron permission policy or installed runtime proof. D2 owns permissions and recovery. | **Missing.** M5 owns native Live/media/iOS, safe rendered artifacts, permissions, and handoffs. | **Partial.** Transcript-safe voice tags exist. T2 must make media limitations and handoffs explicit; it must never fake playback. | D2, M5, T2 |
| Terminology, recovery, privacy, and visual identity | **Partial/device-proven foundation.** Literal web reuse can provide look parity only after D1 runs the real product and D2 captures it. | **Partial/device-proven foundation.** The rejected legacy owl/dark-only identity has been replaced with canonical lockup/K/mascot assets, contract-backed system light/dark roles, distinct semantic states, Space Mono, 44 dp controls, reduced motion, and dynamic surfaces. Clean Pixel light captures now cover Learn and the deck editor, and earlier dark Tutor/Sessions evidence covers the primary shell. A complete paired light/dark state plate, keyboard/accessibility review, and M3/M5 journeys remain required. | **Partial.** Redaction exists, but OpenTUI hard-codes an amber palette. C2/T2 must implement green/paper semantic roles and terminal degradation modes. | C2, D1/D2, M3/M5, T2 |
| Version, packaging, installation, and release truth | **Missing.** Desktop is version `2.0.0`; root/web/mobile are `3.3.0`. No installed artifact gate exists. | **Partial.** Expo config and Settings now derive `3.3.0` from package truth, and an Android release APK installs on a physical Pixel. iOS and signed release-distribution gates remain unverified. | **Unverified.** Root packaging includes TUI sources/build, but no installed parity-flow evidence exists. | I1, Q1, R1, REL |

## Current evidence

| Surface | Command or observation | Result | Epistemic limit |
|---|---|---|---|
| Web | Full `rtk devenv tasks run keating:test-web`, strict `rtk bun run typecheck`, production Vite/Nitro build, and Playwriter rendered acceptance | 874 pass, 0 fail; 10,749 assertions; Panda/TypeScript pass; production build pass. At 390 x 844 the isolated `/rendering-smoke` route rendered Markdown, math, Mermaid diagrams, every canonical shared node, and the completed browser-source document through the canonical renderer. The browser-source grouped response remained `Answers saved` after reload with one source journal. | Current source/unit/build and rendered/reload evidence for both OpenUI ingress forms. Document identity includes session/fork, message, and fence position. Completed source fences compile only after closure through the dependency-free trusted compiler, carry source hash/revision provenance, and migrate only bounded notes/plan state. Partial, unsafe, malformed, or unsupported source is escaped inert text: the legacy script-capable renderer is never mounted, including for authored animation HTML. Group, quiz, and deck completions use aggregate receipts and atomically materialize IndexedDB learner evidence; exact retries do not duplicate records. The isolated smoke journal intentionally does not write learner-session data. This pass used headless Chrome because the user's Playwriter extension was disconnected; it is not physical-phone evidence. |
| Web training export | `rtk bun test ./src/test/export.test.ts ./src/test/training-archive.test.ts` from `web/` plus web typecheck | 15 pass, 0 fail; 78 assertions; generated artifact records and ChatML envelopes are unscored and not recommended for SFT | Focused data-contract evidence only; not a packaged download/import journey |
| Web Live/speech model registry | Focused speech-input, OpenAI Realtime, Live failure, export, and archive tests plus web typecheck | 47 pass, 0 fail; 200 assertions; duplex Speech and `/live` model options share one graded registry while TTS remains independent | Focused source/runtime-shape evidence only; no microphone/camera/session provider acceptance |
| Desktop D2a | `rtk bun run --cwd desktop test` and `rtk bun run --cwd desktop typecheck` | 12 pass, 0 fail; strict typecheck pass | Focused lifecycle/security behavior only; full D2 feature parity remains pending |
| Desktop package | `rtk bun run --cwd desktop build:main` and `rtk bun run --cwd desktop dist --dir` | Pass; rebuilt Electron output launched `/chat` on an ephemeral loopback Nitro origin, local course session returned 200, and the persisted 32-byte P2P secret was mode `0600` | Linux packaged smoke only; not permissions, OAuth/deep-link, CSP, or full feature-state acceptance |
| Shared contracts C1 | `rtk bun test ./packages/learner-contracts/test` and package typecheck | 45 pass, 0 fail; 350 assertions; strict typecheck pass. In addition to portable contract v3, fixture-pack v2 declares the Markdown dialect, all twelve accepted Mermaid grammars, every registered web OpenUI component, every current shared JSON node including `question-group`, nested/lifecycle/theme/max-size scenarios, and bounded malformed/unsafe/future recovery cases. The dependency-free OpenUI compiler accepts only bounded declarations, literals, references, and registered components; it never evaluates authored JavaScript or HTML and maps animation source to a source-free handoff. The UI contract preserves grouped forms, aggregate quiz/deck completion, structured row answers, callouts, nested plans, concept maps, notes, and bounded actions; portable quiz results retain timing and terminal outcome metadata. | Source/unit evidence plus Terra-high implementation and a low-effort security audit; required independent Luna contract review remains unavailable |
| Mobile | `rtk bun run --cwd mobile typecheck` | Pass | Static only |
| Mobile | `rtk devenv tasks run keating:mobile-check`, Android export, and source-matched release build | 315 pass, 0 fail; 1,296 assertions; strict typecheck; Expo Android export pass | Adds fixture-pack v2, grouped diagnostics and terminal quiz/deck actions, the trusted OpenUI source ingress, and the local rich renderer while retaining provider/tool, models.dev, Usage, export, and recovery coverage. The current clean release APK is 121,281,227 bytes with SHA-256 `30c1c92b5c5e1bcb6254c09f030bcdeb97a539fbac06271216991fb71ad8228b`. Not real-provider or physical-device proof; escalated ADB currently lists no attached or authorized device. |
| Mobile Markdown/Mermaid/OpenUI | Focused Markdown document, local rich-renderer, Mermaid, OpenUI wire, aggregate renderer payload, durable render-state, semantic-action, and split-stream tests | Pass within the 315-test mobile suite; local rich-renderer group 24 pass, 64 assertions | The bounded native GFM path typesets inline/display math as offline KaTeX-generated MathML, labels and copies fenced code, and renders all twelve accepted Mermaid grammars in one bundled Expo DOM document with strict Mermaid security, sanitized SVG, blocked network/navigation/windows/media, zoom/scroll, accessible descriptions, and visible source/error recovery. Canonical JSON and completed browser-source OpenUI now compile into the same shared document without evaluating authored JavaScript or HTML. Split and fully closed stream fences remain hidden until the single canonical document event, preventing raw wire leakage and double rendering. Grouped text/choice/blanks/rows, terminal quiz results, and complete deck reviews submit in order, materialize atomically, restore from one receipt, and reject divergent replay. Physical pixels, structured citations, native video/animation, and code execution/handoff remain open. |
| Android native rendering builds | `rtk devenv tasks run keating:mobile-export`; clean generated DOM output followed by `rtk env CPLUS_INCLUDE_PATH= C_INCLUDE_PATH= OBJC_INCLUDE_PATH= EXPO_NO_BUNDLE_SPLITTING=1 ./gradlew assembleRelease` | Pass. Expo emitted one 2,207-module offline DOM bundle plus the 2,209-module native bundle and 38 assets; Gradle completed 987 tasks. The source-matched APK contains exactly one DOM JS entry and one HTML entry, no stale CSS/webfont files, and is 121,281,227 bytes (SHA-256 `30c1c92b5c5e1bcb6254c09f030bcdeb97a539fbac06271216991fb71ad8228b`). | Native compilation/bundle proof only. The no-split flag avoids Expo 56's missing shared-chunk serializer artifact; clearing host Guix include paths prevents host glibc headers contaminating the Android NDK build. ADB lists no attached or authorized device, so install/render/action/restart acceptance was not run. |
| Mobile model catalog | Live `parseModelsDevCatalog(await fetch("https://models.dev/api.json"))` smoke | Pass on 2026-08-10; all 6,248 validated models across 183 providers remained discoverable, while 396 models across the four implemented cloud transports were callable | Confirms the current public API contract and truthful selection gate; not on-device network/cache/UI proof, and not transport support for the other providers or specialized media endpoints |
| Mobile M1a | Physical Pixel 9 Pro XL release route `keating:///repository-smoke` plus PID-filtered logs | Pass; UI and log marker confirm schema, transaction journal, close, reopen, and persisted read; `libexpo-sqlite.so` loaded under Hermes; final Terra closure review found no material issue | Physical Android evidence for the internal repository foundation only; C1 learner tables and full M1 migration remain pending |
| Mobile visual/navigation foundation | Pixel 9 Pro XL release Tutor, Sessions, and Live captures plus focused theme/identity tests | Clean captures verify the canonical lockup/mascot, bot Tutor tab, five-tab layout, header-level model location, safe areas, and a physical header swipe to Sessions; Terra-high review was clean | Model-picker and branch-tree interaction, light theme, reduced-motion streaming, assessment/settings, keyboard, adaptive icon, and iOS plates remain pending |
| Android release/device | `rtk ./gradlew assembleRelease`; `rtk adb install -r`; Pixel 9 Pro XL deep links and system sheets | Build and install pass: 2,045-module bundle, 38 assets, 946 Gradle tasks, 105,227,992-byte APK. The source-matched release visibly passed repository close/reopen, rendered Usage and Learn, prepared the export share sheet, opened/cancelled the JSON picker, and rendered the manual deck editor with 44 dp+ controls. | Non-empty create/rate/force-kill/reopen was interrupted when the phone locked; import merge, confirmed clear/recovery, full settings/model/attachment plates, and iOS remain pending |
| OpenTUI | `rtk bun test ./test/opentui-host.test.ts ./test/tui-view-model.test.ts ./test/tui-ui.test.ts` plus root typecheck | 17 pass, 0 fail; 88 assertions; strict typecheck pass | Canonical fixture/legacy import presentation and durable action validation, conflict, restart-resume, and completed replay are source-verified. Keyboard host dispatch, filesystem-backed storage, real PTY, and live-provider proof remain open. |
| Canonical mobile task | `rtk devenv tasks run keating:mobile-check` | Pass after correcting the persisted working-directory assumption in `devenv.nix` | Static/unit evidence only; no native device proof |
| Vet | Required vet invocations after each current logical unit | Repeated invocations failed before review with `DiffApplicationError` while reconstructing the aggregate pre-existing dirty diff; the latest rendering/docs run reproduced the same failure | Vet produced no verdict; it is unverified, not passed |

## Protected worktree snapshot

The following paths were already modified, deleted, or untracked when P0 began
and are protected. Wave workers must not edit, revert, format, stage, or absorb
them unless the coordinator explicitly reassigns a path after reviewing its
diff.

### Modified or deleted

```text
.gitignore
README.md
devenv.nix
docs/DEVELOPMENT.md
docs/peer-review-notes.md
docs/plans/keatingbench-paper-plan.md
docs/refs.bib
docs/runpod-benchmarks.md
docs/study.typ
docs/study/frontmatter.typ
docs/study/sections/availability.typ
docs/study/sections/discussion.typ
docs/study/sections/introduction.typ
docs/study/sections/limitations.typ
docs/study/sections/metaharness.typ
docs/study/sections/methods.typ
docs/study/sections/results.typ
scripts/study-analysis.mjs
web/package.json
web/panda.config.ts
web/public/keating-metaharness.pdf
web/server/api/courses/[...path].ts
web/server/api/oauth/openai-codex.ts (deleted)
web/server/api/oauth/refresh.ts
web/server/api/oauth/token.ts
web/server/utils/course-pear-gateway.ts
web/server/utils/course-repository.ts
web/server/utils/course-session.ts
web/src/App.tsx
web/src/components/AssistantChatPanel.tsx
web/src/components/KeatingApiKeyPromptDialog.tsx
web/src/components/ProvidersModelsTab.tsx
web/src/components/courses/CoursesAccessGate.tsx
web/src/components/live/LiveVisualizer.tsx
web/src/components/settings/CloudProviderKeysSection.tsx
web/src/courses/client.ts
web/src/courses/contracts.ts
web/src/courses/operations.ts
web/src/courses/useCoursesAccess.ts
web/src/hooks/useKeatingAgent.tsx
web/src/keating/browser-tools.ts
web/src/keating/browser-tools/shared.ts
web/src/keating/capabilities.ts
web/src/keating/nodepod-boot-files.ts
web/src/keating/oauth.ts
web/src/keating/openui/study-plan.tsx
web/src/keating/security/policy.ts
web/src/lib/provider-models.ts
web/src/pages/Chat.tsx
web/src/pages/CourseWorkspace.tsx
web/src/pages/Courses.tsx
web/src/pages/Live.tsx
web/src/pages/Paper.tsx
web/src/test/browser-tools-assembly.test.ts
web/src/test/course-operations.test.ts
web/src/test/oauth.test.ts
web/src/test/openui-study-plan.test.ts
web/src/test/provider-models.test.ts
web/vite.config.ts
```

### Pre-existing untracked

```text
docs/generated/
docs/study/evaluated-policy.json
test/final_dataset.json
test/traces/
web/scripts/dev.mjs
web/server/utils/course-material-storage.ts
web/src/components/WebSearchPart.tsx
web/src/components/courses/CourseAddMenu.tsx
web/src/components/courses/CourseArtifactCard.tsx
web/src/components/courses/CourseAssembler.tsx
web/src/components/courses/CourseBuilder.tsx
web/src/components/courses/CourseCommandPalette.tsx
web/src/components/courses/CourseContentManagers.tsx
web/src/components/courses/CourseDiscussion.tsx
web/src/components/courses/CourseKeatingPanel.tsx
web/src/components/courses/CourseReactionBar.tsx
web/src/components/courses/CourseReviewPanel.tsx
web/src/components/courses/CourseSwitcher.tsx
web/src/components/courses/course-ui.ts
web/src/courses/course-anki.ts
web/src/courses/course-artifacts.ts
web/src/courses/course-ask.ts
web/src/courses/course-assembly.ts
web/src/courses/course-comments.ts
web/src/courses/course-search.ts
web/src/courses/from-study-plan.ts
web/src/keating/browser-tools/courses.ts
web/src/keating/course-collaboration.ts
web/src/test/browser-tools-courses.test.ts
web/src/test/course-access.test.ts
web/src/test/course-anki.test.ts
web/src/test/course-assembly.test.ts
web/src/test/course-comments.test.ts
web/src/test/course-search.test.ts
web/test/web-search-part.test.ts
```

The parity build specification, execution program, and this baseline are
goal-owned additions and are not part of the protected pre-existing snapshot.

## Accepted P0 decisions and first safe wave

P0 is accepted because all required web capability groups now have a desktop,
mobile, and terminal outcome plus an owner, and the dirty-work ownership
boundary is explicit.

The first safe Wave 1 nodes are:

1. **C1 learner contracts:** new `packages/learner-contracts/**` only. Do not
   edit consumers, the root manifest, lockfile, or dirty web files.
2. **C2 design contracts:** new `packages/design-contract/**` only. Do not edit
   Panda, mobile theme, OpenTUI, manifests, or the lockfile.
3. **D1 packaged Nitro runtime:** `desktop/src/main.ts`, new desktop runtime and
   staging modules/scripts, `desktop/package.json`, and focused desktop tests.
   Do not edit preload/IPC, P2P, or web sources.

## Current `/goal` state

| Node | State | Current evidence or exact next gate |
|---|---|---|
| P0 | `accepted` | Capability matrix, ownership, and protected-work snapshot above |
| C1 | `review` | The portable learner contract is now v3 with web-matched SRS schedules, immutable review/evaluation outcomes, explicit legacy uncertainty, semantic study priorities, deterministic merge, and bounded UI/session/evidence contracts. Fixture-pack v2, grouped/aggregate UI semantics, the inert trusted OpenUI source compiler, lossless portable quiz completion metadata, all current node kinds, and the positive/negative/lifecycle/theme/limit rendering matrix pass all 45 tests with 350 assertions plus strict typecheck. Terra-high implementation and the low-effort security audit closed reproduced findings; the required independent Luna contract review remains unavailable and pending. |
| C2 | `review` | Nine tests with 608 assertions and strict typecheck pass; live palette/typography provenance, full validation/projection, contrast, native values, and terminal degradation passed a fresh Terra review; required Luna visual/contract review is unavailable and pending |
| D1 | `accepted` | Six focused tests and desktop typecheck pass; Electron Builder output copied outside the checkout launched `/chat` on an ephemeral loopback origin; packaged course/session and agent-runtime APIs returned 200; course realtime WebSocket delivered presence, snapshot, gateway status, and pong without a dev server |
| D2a | `accepted` | Process-singleton P2P/Nitro lifecycle, macOS reactivation, renderer-scoped IPC cleanup, startup-race-safe idempotent shutdown, same-origin navigation, safe externalization, bounded/sanitized IPC, and owner-only P2P secret permissions passed 12 focused tests, strict typecheck, a fresh Terra review, package build, and Linux runtime smoke; this internal subnode contributes no progress independently |
| D2 | `in progress` | Electron now owns allowlisted camera/microphone permission policy, explicit screen-capture denial, safe external OAuth navigation, bounded renderer-scoped IPC, local Courses/Nitro state, P2P-backed learner persistence, and a separate OS-encrypted provider/OAuth credential vault. All desktop `provider-keys` traffic bypasses replicated P2P storage; legacy plaintext migrates only after secure persistence, generic IPC bypass is rejected, and unavailable OS encryption preserves the entered key with a visible recovery error. The current desktop gate passes 26 tests with 159 assertions and strict typecheck; web passes 884 tests with 10,781 assertions; production desktop build and package smoke pass. A clean-profile packaged run verified both preload bridges, P2P rejection, visible fail-closed credential recovery, and clean renderer teardown. D2 remains open for a positive OS-vault round trip on a host with a secure keyring, actual OAuth return/deep link, camera/microphone, learner-selected screen capture, course realtime, outside-checkout installation, and 1024/1440 reference-diff evidence. |
| W1 | `accepted` | Canonical shared JSON and completed browser-source OpenUI converge on one shared document renderer. Partial and rejected source is escaped inert text; closed source compiles through the dependency-free trusted parser, carries hash/revision provenance, and migrates only bounded notes/plan state. The legacy source renderer is never mounted, including for authored animation HTML. Grouped Question, aggregate quiz/deck completion, receipt-linked delivery, and IndexedDB materialization are lossless and exactly-once. The 874-test/10,749-assertion suite, strict typecheck, Vite/Nitro build, regenerated NodePod boot bundle, and renewed 390 x 844 headless-Chrome Markdown/math/Mermaid/both-ingress reload run pass. The user's Playwriter extension was disconnected, so the rendered evidence is local headless Chrome rather than their Chrome or a physical phone. |
| M1a | `accepted` | Expo SQLite 56 is pinned and Metro resolves it. The typed adapter matches Expo's void exclusive-transaction API; schema metadata and a resumable journal cover calendar-valid timestamps, monotonic phases, CAS, uniqueness, immutable transaction snapshots, and bounded fresh-transaction recovery. Fourteen focused tests (54 assertions), all current 83 mobile tests (327 assertions), strict typecheck, Android export, and final Terra review pass. A physical Pixel 9 Pro XL release run visibly passed and logged schema, journal, close, reopen, and persisted read after loading native `libexpo-sqlite.so`. M1a excludes C1 learner tables and contributes no progress independently. |
| M3 learner/visual surfaces | `review` | In addition to the canonical identity/navigation, models.dev picker, sessions, Composer attachments, settings, Usage, Courses, Learn, Review, evaluations, and exports, native rendering consumes fixture-pack v2 and covers callouts, rich question modes, aggregate grouped/quiz/deck actions, recursive study plans, concept maps, notes, every current canonical node, both canonical JSON and trusted browser-source ingress, per-event scoping, and atomic learner mutation/action receipts. The bounded offline Expo DOM renderer adds KaTeX-generated MathML, all twelve accepted Mermaid grammars, strict source validation/SVG sanitation/navigation denial, zoom/scroll, source recovery, and code copy. The current mobile suite is 315 tests with 1,296 assertions; strict typecheck, Expo export, and a clean source-matched release build pass. M3 remains in review until the physical rendering/action/share/restart journey passes, along with paired light/dark, keyboard/accessibility, structured citations, native video/animation, code execution/handoff, remaining grounding/Live, and iOS gates. Remote workspace augmentation belongs to M2, not M3. |
| M1 | `pending` | Dependency implementation has advanced despite C1 remaining in review: schema v2, ordered v1 upgrade, strict portable records, private attachment locations, deterministic import/export/merge/clear, quotas and failure tests, SHA-256-bound resumable AsyncStorage copy/verify, repository-first reconciliation that preserves portable-only records, a durable cross-store clear intent, and learner-facing export/share, validate-before-merge import, and explicit clear controls. M1 still waits for C1 acceptance plus a source-matched physical offline/force-kill export/import/share/delete/restart journey and record smoke. |
| M2 | `in progress` | Exact request and continuation envelopes exist for OpenAI Responses, Anthropic, Gemini, and compatible/OpenRouter chat, including accumulated stateless history and optional Gemini ids. models.dev tool support gates declarations and unverified Custom endpoints stay plain-text. Three closed-schema deterministic local artifact tools execute through a four-round/eight-call safety boundary. The real loop now consumes provider SSE, persists and renders ordered text/tool/result/text events, hides OpenUI wire across split chunks until one canonical document event, reuses repeated semantic results, restores prior durable receipts after retry/restart, reconstructs completed historical tool exchanges natively, aborts background work into a recoverable partial turn, and fails truthfully for malformed, unknown, cancelled, timed-out, or missing-correlation calls. The current 315-test/1,296-assertion mobile suite, strict typecheck, export, and clean source-matched release build pass. M2 remains unaccepted until real-provider and physical background/retry/force-kill evidence plus authenticated remote workspace read/execute/patch, learner-confirmed diffs, snapshot/validation/rollback, and exactly-once recovery all pass. |
| T1 | `review` | The shared-contract adapter, owner-only filesystem journal, and real Pi action transport cover every practical terminal action, exact restart replay, collision recovery, malformed/future-document recovery, and production tool-result ingress. Canonical controls were dispatched in the built PTY. T1's own gate is current, but C1 remains in review pending the required Luna contract review, so the dependency rule prevents promotion to accepted. |
| T2 | `review` | The OpenTUI product now covers project-scoped Sessions with live clone/rename/earlier-turn fork, Library, Review, Settings, production semantic Markdown, every canonical OpenUI node/action, explicit Mermaid/media source and same-session handoff, deterministic 80x24/100x30/140x40 plus color/no-color/ASCII projections, exact async draft recovery, explicit read/search-only agent tools, and exact-session `/shell`. The root suite passes 312 tests with 86,718 assertions, the root build passes, and real 80x24 PTYs exercised the product surfaces. T2 cannot be accepted until C2, and transitively T1/C1, are accepted after the required Luna reviews. |
| All other nodes | `pending` | Their graph dependencies are not accepted |

Evidence-weighted goal progress is currently **13.7%**: P0 contributes 5%,
D1 contributes one third of the 20% Desktop group, and W1 contributes one fifth
of the 10% integration/release group. C1 and C2 contribute zero while their
required Luna reviews are unavailable; accepted internal M1a and the M3
visual-foundation tranche contribute zero independently. T1 and T2 have current
deliverable evidence but contribute zero until their C1/C2 dependency edges are
satisfied. Implementation or static checks on other surfaces do not count until
their documented acceptance gates pass.
