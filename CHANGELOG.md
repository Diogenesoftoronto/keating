# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.0] - 2026-08-04

### Added
- Added authenticated course workspaces with a course library, role-aware membership, consent controls, invitation links and QR joining, shared lessons and notes, submissions, realtime conflict handling, and an optional Pear peer-to-peer mirror.
- Added the **Coming Up** study board, which unifies due flashcards, verifications, learner priorities, and spaced-repetition evidence into actionable lanes with completion controls.
- Added safe Anki `.apkg`, CSV, and TSV import/export support, preserving stable deck, note, and card identities while omitting unsupported active media.
- Added a rebuilt terminal teaching cockpit with model, thinking, session, and busy status; typed transcript rendering; lesson and artifact rails; history; and a searchable command palette.
- Added an AT Protocol blog surface and Standard.site publication workflow, including discovery routes, a dry-run publisher, and explicit deployment configuration.
- Added feature-led landing and product-tour surfaces for the web classroom, live multimodal teaching, Courses, Coming Up, publication, CLI artifacts, and the new TUI.
- Added capability-aware model selection, live transcript improvements, and an explicit retry action for failed image generation.

### Changed
- Reorganized primary navigation and landing content around the complete Keating product, with responsive header behavior across phone, tablet, and desktop widths.
- Replaced coupled course-workspace `useState` groups with typed reducers and consolidated shared flashcard, storyboard, and local-setting contracts after a repository-wide `similarity-ts` review.
- Consolidated persisted React settings behind a stable `useSyncExternalStore` adapter so model, speech, and interface preferences share one typed synchronization path.
- Upgraded learner state from schema 2 to schema 3 to persist Coming Up priorities and Anki identities; existing state migrates with safe empty defaults.
- Namespaced the canonical devenv tasks under `keating:*`; topic-bearing tasks now accept `--input topic=<topic>`, while direct CLI commands remain available for positional workflows.
- Expanded production release validation to test, build, verify synchronized versions, inspect the npm archive, and produce native Linux and macOS archives for x64 and arm64 runners before publication.

### Fixed
- Fixed pending OAuth handoffs and subscription authentication recovery across production redirects.
- Fixed persisted settings snapshots changing identity without a notification, which could cause unnecessary React rerenders and subscription loops.
- Fixed crowded intermediate-width headers where navigation, actions, and account controls competed for space.
- Fixed course sharing projections exposing identity and private learner metadata to the optional peer mirror.

### Security
- Reduced Pear course projections to identity-neutral shared content and excluded private activity, consent, progress, comments, and unshared submissions.
- Kept course authorization, durable session resolution, hosted-provider credentials, and publication credentials on server-side boundaries.

## [2.10.0] - 2026-08-03

### Added
- Added structured browser-tool argument validation with nested object and array checks, explicit required and optional parameter guidance, enum/default documentation, and classified execution errors.
- Added visible Hyperframes diagnostics for runtime exceptions, rejected promises, blocked dependencies, and animations that load without a controllable timeline.
- Added responsive scaling and centering for fixed-size Hyperframes compositions inside chat and artifact iframes.

### Changed
- Expanded the model chooser search control across medium layouts and gave it the dominant desktop column, with model/provider-aware placeholder copy and a keyboard-accessible clear action.
- Promoted legacy textual failure responses into real tool failures so the model, canonical event stream, and learner-facing tool cards receive the same failure state and actionable message.
- Migrated the repository's canonical development commands from duplicated `just` and `mise` definitions into `devenv tasks`, including build, test, web, mobile, CLI, release-hygiene, and git-hook commands.
- Deferred NodePod, its generated source bundle, and Lix sandbox loading until the browser sandbox is actually booted, and split heavyweight web dependencies into dedicated production chunks.
- Regenerated the NodePod boot source bundle after the tool-contract and runtime changes.

### Fixed
- Fixed the model search field becoming too narrow beside provider and capability filters on medium and large displays.
- Fixed authored 1920×1080 Hyperframes scenes being clipped rather than fitted to the responsive player.
- Fixed missing, malformed, unavailable, and failed tool calls being reported as successful results or reduced to a generic failure message.
- Fixed OAuth storage access typing after the `pi-web-ui` storage API became synchronous.

## [2.9.0] - 2026-07-31

### Added
- Added a dedicated `/live` surface for real-time multimodal teaching sessions, rendered as Keating's CRT monitor: the learner's camera or screen becomes the phosphor screen, with a boot-style status bar, live transcript, and an in-flight tool-call feed.
- Added full-duplex live voice sessions through OpenAI Realtime and Gemini Live, including interruption and barge-in, a shared tool-call lifecycle, and a provider-neutral canonical event stream so persistence and replay work regardless of provider.
- Added optional camera or screen-share vision for live sessions, with provider-aware routing (native video lane or sampled still frames) and luma-histogram dedup that drops static frames while still catching a page scroll or a hand entering frame.
- Added conversation seeding for voice sessions: recent text turns are replayed and the real Keating system prompt is adopted, so a live session continues the lesson rather than starting as a generic assistant.
- Added microphone capture on the audio rendering thread via an AudioWorklet (with a ScriptProcessorNode fallback), so React renders and tool execution no longer drop or glitch microphone audio.
- Added streaming progressive renders for image generation (SSE partial-image events) and live animation authoring shown from in-flight tool-call argument deltas.
- Added Speech settings for camera/screen source, frame rate, and Realtime reasoning effort, with capability-aware controls that explain themselves when a model lacks vision.

### Changed
- Refreshed the landing hero copy and call to action.
- Extended provider capability negotiation to resolve realtime tiers and decide how vision reaches each model.

## [2.8.0] - 2026-07-30

### Added
- Added runtime-derived system guidance that tells the model when live workspace inspection is connected, where Keating's bundled source is mounted, and when to inspect its own implementation before answering.
- Added a persisted **Open reasoning automatically** preference, separate from reasoning visibility and model effort, plus Storybook coverage for collapsed, manually opened, and preference-expanded reasoning disclosures.
- Added NodePod directory listing support for the composed workspace inspection tool.

### Changed
- Rebuilt the active system prompt when the workspace runtime initializes or changes, keeping live capability guidance outside evolvable persona prompts and preventing duplicate capability sections.
- Kept reasoning available but collapsed by default during streaming; learners can still open it manually or opt into initially expanded disclosures.
- Routed NodePod workspace listings, UTF-8 source reads, and diffs through the mounted `/workspace` VFS with normalized source paths.
- Regenerated the browser NodePod boot snapshot to match the live workspace contracts.

### Fixed
- Fixed browser-sandbox sessions advertising workspace inspection while the model remained unaware that it could inspect Keating's own source.
- Fixed composed NodePod inspection requests treating the sandbox like a remote host filesystem and failing to list or read the mounted source tree reliably.

## [2.7.0] - 2026-07-30

### Added
- Added an explicit model-facing catalogue for all five conversational Question formats and all eight scored Quiz formats, including selection guidance, type-specific controls, and a parser-valid mixed-format example.
- Added reciprocal links between prerequisite, follow-up, and related OpenUI study plans through stable plan identifiers.
- Added complete learner-profile hydration before the first model turn, including full session, goal, quiz, question-check, card-review, and flashcard evidence plus explicit coverage gaps.
- Added durable quiz-attempt evidence with stable result identifiers, answers, partial credits, timing, flags, pending open-ended questions, and merged model grades.
- Added Storybook coverage for open questions, mobile quizzes and recovery, quiz sessions, and linked multi-level plans, plus a canonical `just storybook` command.

### Changed
- Made canonical StudyPlans require at least two nested layers beneath each top-level area and expanded the model example into linked core and lab plans with concrete activities, outcomes, timing, and dependencies.
- Replaced capability activation and automatic continuation with a runtime-filtered tool set that exposes every currently supported schema from the first turn.
- Removed generic confirmation prompts for known trusted interactions while preserving fail-closed rejection for unknown tools, unsafe voice invocations, and untrusted-web code execution or destructive actions.
- Replaced confidence-weighted quiz scores with explicit partial-credit points and normalized objective plus model-graded open-ended evidence for learner profiles and reward exports.
- Improved narrow-screen quiz, result, recovery, and navigation layouts with wrapping content, scrollable sticky assessments, dismissible sessions, and mobile-safe touch targets.
- Updated generated NodePod runtime files and historical architecture prose to match the complete-context and immediate-tool model.

### Fixed
- Prevented incomplete streamed OpenUI statements from mounting partial questions or controls before their required fields arrive.
- Persisted asynchronous open-ended quiz grades into the original attempt and refreshed derived learner evidence after grading.
- Fixed linked study-plan navigation, default hierarchy disclosure, and empty-program OpenUI rendering.
- Fixed retry availability for model-unavailable and permission failures and clarified the recovery action as `Retry response`.

## [2.6.0] - 2026-07-26

### Added
- Added detailed, recursively nestable OpenUI study plans with durable leaf progress, concrete outcomes, time estimates, explicit prerequisites, and automatically derived dependency graphs.
- Added full-screen expansion for Mermaid diagrams across chat, Markdown, artifacts, and OpenUI, with keyboard dismissal and focus restoration.
- Added a prominent failed-response recovery card that retries the original prompt without making the learner reconstruct it.
- Added canonical OpenUI prompt examples for interactive questions and substantial lesson plans so the model reliably emits the live component grammar.

### Changed
- Replaced the legacy Dio/Bifrost hosted-model implementation with Not Organic's account-scoped DPoP provider contract, shared wallet, provider-owned checkout, and dedicated `/api/notorganic/**` routes.
- Reworked hosted-model settings, pricing, proxy routing, and deployment configuration around the Not Organic provider-owned account and wallet flow.
- Made lesson-plan prompts require multiple meaningful coverage areas, nested subtopics, outcomes, stable identifiers, and explicit dependency links instead of shallow checklists.

### Fixed
- Fixed failed assistant turns being difficult to retry by moving recovery out of the quiet message-action row and into an accessible alert with a primary action.
- Fixed wide Mermaid diagrams being constrained to an unreadably small inline viewport.
- Fixed release bundle and npm-package verification expecting the removed top-level Pi extension path instead of the current `dist/src/pi/hyper-teacher/index.js` entrypoint.

## [2.5.0] - 2026-07-22

### Added
- Added GPT Realtime 2.1 full-duplex voice around canonical conversation events, including interruption and barge-in handling, parallel tool-call lifecycles, reconnect state, and privacy-safe realtime telemetry.
- Added provider-capability negotiation and provider-native search routing for OpenAI, Google, and Anthropic, with explicit MiniMax client-adapter and citation semantics.
- Added shared, serializable generative UI documents and actions for quizzes, questions, goals, decks, images, scenes, and artifacts, with compatible web, Pi, and OpenTUI rendering paths.
- Added durable conversation replay with corruption-tolerant recovery, pending UI actions, checkpoints, and privacy-safe persistence that excludes audio and sensitive tool payloads by default.
- Added fail-closed tool authorization, untrusted-search provenance enforcement, and a bound visual confirmation flow for effectful operations.
- Added tailored tutor openings, topic categorization and topic-shift handling, and richer session insights across the existing learning and usage surfaces.
- Added a native Android client built with Expo and React Native, including secure provider-key storage, on-device lesson artifacts, offline-capable plans/maps/quizzes, and General Translation wiring for English Canadian and French Canadian locales.
- Added web General Translation wiring for the shared navigation/footer shell and local translation bundles for Canadian English and French.

### Changed
- Consolidated overlapping browser storage contracts and documented intentional browser, core, OpenUI, and TUI protocol mirrors through the similarity audit.
- Expanded the live MiniMax harness to verify a real Pi RPC tool call and assistant completion with `MiniMax-M2.7-highspeed` while keeping credentials out of output and persistence.
- Made reasoning display a separate UI preference from reasoning effort; reasoning cards now have an explicit disclosure arrow and render Markdown, math, tables, and code consistently with assistant messages.
- Made inline artifact previews optionally single-card so new lesson plans, maps, animations, and other artifacts can replace the previous preview instead of stacking in the chat chrome.

### Fixed
- Fixed French Canadian mobile localization being unreachable by letting `gt-react-native` resolve the device locale instead of pinning the provider to English Canadian.
- Fixed the chat nav artifact button so it toggles the artifact browser/side panel closed as well as open.

## [2.4.1] - 2026-07-18

### Added
- Added the initial realtime voice and interactive OpenTUI release foundation, including hosted web-search routing and a live MiniMax Pi RPC harness.

## [2.4.0] - 2026-07-17

### Added
- Added streamed OpenUI learning documents, lifecycle-aware learning surfaces, and a smaller capability-driven browser tool protocol that keeps learner-facing composition in the teaching response.
- Added the separate OpenTUI host, explicit browser/cloud/external/host runtime boundaries, recoverable interrupted turns, and a schema-validated training evidence archive.
- Added a mobile-first voice composer with press-and-hold dictation, a full-screen realtime conversation surface, keyboard switching, and provider-aware fallback between duplex voice and speech-to-text.
- Added proactive learner-context updates so the tutor can record observed motivations, communication preferences, learning style, strengths, and challenges as evidence accumulates.
- Added a documented storage ownership model for UI bootstrap values, durable app records, learning records, IndexedDB migrations, P2P authority, and future server-backed storage.

### Changed
- Reduced response comparison to a 1% default chance and replaced the cramped mobile side-by-side layout with a focused alternative switcher while preserving explicit preference evidence.
- Reworked custom-provider and custom-model setup around reducer-driven forms, provider-scoped API keys, Inkling defaults, non-blocking model discovery, and clear same-origin proxy documentation.
- Made the Keating mascot part of loading and voice states, reduced chat text to 11px on narrow screens, restored mobile transcript gutters, and made the ask, quiz, and settings surfaces more space-efficient.
- Made structured tool visualization the default, improved deeply nested JSON wrapping, and consolidated the shared fill-in-the-blank template parser used by ask and quiz renderers.
- Unified Usage and Benchmark under the application navigation, paper-and-ink theme, shared learning-insights header, responsive metrics, and mobile-safe filters.
- Moved coordinated provider, model, question, and quiz state toward reducers and used transitions for non-urgent visualizer and navigation updates.

### Fixed
- Fixed custom providers being rejected when their `/models` endpoint is missing or incompatible; providers can now be saved and models added manually after an advisory discovery warning.
- Fixed missing API-key entry and reuse for custom models and providers, including Thinking Machines Inkling-compatible Anthropic Messages endpoints.
- Fixed duplicate range and number controls for response comparison settings.
- Fixed IndexedDB upgrade/version-change behavior, migration metadata, blocked-upgrade reporting, and inconsistent backend capability declarations.
- Fixed nested tool-call text overflowing or becoming unreadable and fixed visualizer mode opening in the less useful raw view.
- Fixed narrow-screen chat content touching the viewport edges and comparison alternatives becoming effectively unusable on mobile.

## [2.2.0] - 2026-07-10

### Added
- Added evidence-led browser learner profiles: quizzes, flashcard reviews, structured diagnostics, message-level feedback, and tutor-supported misconceptions now contribute to cautious topic-level mastery, retention, confidence, strengths, weaknesses, and reported challenges.
- Added automatic and model-assisted diagnostic grading. Keyed matching checks are scored immediately; free-text checks remain pending until the tutor records a correct, partial, or incorrect verdict.
- Added browser local-execution routes and project-file access hardening for the agent runtime, plus per-model benchmark outcomes and richer reward/export attribution.
- Added a two-turn automatic session-title trigger so AI titles are based on an actual learner exchange rather than the opening prompt alone.

### Changed
- Reworked real-learner benchmark and evolution inputs around performance-shaped evidence, while preserving learner comments and the exact generated response they refer to.
- Refined browser teaching interactions across flashcards, quizzes, question forms, session feedback, and Hyperframes playback controls.
- Updated the web OAuth/provider path: the prior Gemini CLI OAuth isolation is included in this release, keeping Gemini-specific credentials and flows distinct from the standard Google provider path.

### Fixed
- Fixed assistant-message feedback attribution: feedback now persists the referenced response, message timestamp, and session context instead of assigning the latest session topic as if it were message-level evidence.
- Fixed OpenAI Codex OAuth callback/token wiring, agent-runtime configuration, and browser project-file/local-execution safeguards.
- Fixed Hyperframes bridge handling so interactive playback controls remain reliable through iframe boundaries.

## [2.0.0] - 2026-07-02

### Added
- Added the Electron desktop app workspace with typed P2P IPC, a sandboxed preload bridge, persisted per-user swarm secrets, and a Hyperbee/Corestore-backed storage adapter.
- Added `@keating/p2p-core` for shared Hypercore/Hyperswarm storage, cloud seeder support, P2P RPC types, and desktop storage integration.
- Added the public download, privacy, and terms pages, plus sitemap entries for the new public routes.
- Added the session browser replacement surfaces and model preference hooks that move session/model management out of the older dialog/sidebar split.
- Added stale-build recovery for lazy route chunks so deployed users can reload cleanly when a new web bundle replaces old chunks.

### Changed
- Bumped Keating to `2.0.0` for the desktop/P2P release line.
- Reworked settings, provider, speech, and UI preference surfaces around shared local-setting hooks.
- Moved more retro visual styling into shared CSS so the app, landing, settings, and public pages read as one product surface.
- Updated the desktop build so it builds `@keating/p2p-core` before compiling Electron main/preload code.

### Fixed
- Fixed `@keating/p2p-core` package exports so Electron/Node resolve runnable JavaScript from `dist/` instead of TypeScript source.
- Fixed Bun test startup for `@keating/p2p-core` by removing eager `sodium-native` loading from `deriveTopic` and deferring native Hyperbee loading until storage opens.
- Fixed the speech settings subscription path through the shared Keating setting hook.

## [1.4.1] - 2026-06-30

### Added
- Added a real `devenv.nix` workflow with `bun`, `just`, optional `bumpy`, a `bump-version` helper, and repo-local git hooks for version checks plus root/web test gates.
- Added **model-judged open-ended quiz grading**: short-answer, transfer, and single-blank fill-in questions now render as "pending review" with the reference answer and a labeled, non-authoritative heuristic hint, are excluded from the auto-graded tally, and are graded by meaning through a new `grade_quiz` tool whose per-question verdicts flow back into the result card via `QuizGradesContext`.
- Added **fine-tune dataset import** for the CLI and web app (ChatML, Alpaca, and JSONL) backed by a dependency-free shared `shared/finetune-parse.ts`, plus related export improvements and tests.
- Added `||spoiler||` click-to-reveal masks in markdown, leaving fenced code literal.
- Added a Mermaid rendering regression test that covers uppercase and parameterized mermaid fences.

### Changed
- Documented the recent provider-auth, voice-default, and provider-aware web-search hardening work in the public update surfaces instead of leaving it implicit in the git history.
- Mermaid code fences in chat and shared markdown now render as diagrams instead of remaining as plain code blocks.
- Mermaid fence extraction now accepts parameterized and uppercase fences such as ` ```Mermaid title="..." `.

### Fixed
- Fixed the changelog compare links so `[Unreleased]` now tracks from `v1.4.0`, and restored links for the `1.4.0` and `1.3.0` release lines.
- Fixed OAuth provider sign-in.
- Fixed the quiz "Review" remediation button so system-initiated remediation sends are queued and flushed when the agent goes idle instead of being silently dropped mid-stream.
- Fixed production PostHog initialization by passing `VITE_POSTHOG_*` build-time variables through the web Docker build.
- Fixed the production `/ingest` analytics proxy by adding Nitro proxy rules that mirror the Vite development proxy.
- Fixed Mermaid diagrams disappearing after SVG validation by falling back to a lenient HTML parse for Mermaid SVG output that is safe but not strict XML.
- Kept SVG sanitization active for Mermaid output while preserving safe diagrams: unsafe elements, event handlers, JavaScript URLs, and unsafe CSS are still removed.

## [1.4.0] - 2026-06-20

### Added
- Added the **Dio provider**: an in-browser hosted-model option behind a feature flag, with recovery-email sign-in, an OAuth success page, and atomic event locking on the provider server (`web/src/dio-provider/server.ts`, `DioSuccess`, `OAuthCallback`).
- Added **flashcards and reward exports** to the web app.
- Overhauled the **Providers & Models settings tab** and the provider-models catalogue (`ProvidersModelsTab.tsx`, `provider-models.ts`) with expanded model coverage and tests.
- Added syntax-highlighted code blocks in chat via a new `CodeHighlighter` component wired into `MarkdownBlock`.
- Integrated **PostHog product analytics**: events routed through a Vite/Nitro `/ingest` reverse proxy with exception capture, plus custom captures across the landing page, chat, quiz, and agent hooks.
- Added the animated **Keating intro video** pipeline (`video/keating-intro`, `render-keating-intro.mjs`, `stitch-web-frames.mjs`) and refreshed VHS tapes, with new `web-landing`, `web-paper`, and `web-tutorial` demo clips.

### Changed
- **Relicensed the project from MIT to MPL-2.0** (`LICENSE`, `package.json`, footer link).
- Polished the chat experience: `AssistantChatPanel`, the API-key prompt dialog, and quiz rendering.
- Raised the PWA precache limit to 20 MB to accommodate the larger bundle.

### Fixed
- Added missing `react-markdown` and `react-syntax-highlighter` dependencies.

## [1.3.0] - 2026-06-10

### Added
- Added an interactive 3D CRT hero on the landing page (WebGL via three.js) featuring the Keating mascot, a phosphor screen that boots a live terminal sequence, and a branded "K" launch key that opens a session. Falls back to the 2D terminal demo when WebGL is unavailable.
- Added the brand lockup and "K" mark to the hero monitor bezel, matching the retro brand CRT.
- Added in-browser sandbox/NodePod runtime building blocks: snapshot database, portable session data, sandbox export, and a transpile path (`nodepod-snapshot-db.ts`, `portable-data.ts`, `sandbox-export.ts`, `lix-sandbox.ts`, `hero-tui.ts`).
- Added expanded usage analytics: a dedicated chart-data pipeline and topic grouping (`usage-chart-data.ts`, `usage-topic-groups.ts`) with new tests.
- Added Storybook stories for `ChatIntro`, `MarkdownBlock`, `JsonCrackBlock`, `QuizResultCard`, `SettingRow`, and `Toggle`.
- Added portable data export/import and a browser-download helper, with `session-date` utilities and coverage tests.
- Added `keating version` CLI command and `/version` Pi extension command to report the current version.
- Added `scripts/sync-version.ts` to keep all version strings in sync with the root `package.json`.
- Added `just check-version` (read-only CI check) and `just sync-version` (auto-fix) tasks.
- Added `just plan <topic>` and `just verify <topic>` tasks for artifact generation.

### Changed
- Reworked the chat transcript: Keating replies now render on a theme-aware retro panel — a readable cream panel with dark ink in light mode, a phosphor CRT with scanlines in dark mode — and the conversation column is wider for better line lengths.
- Shipped a broad retro UI and mobile-polish pass across the landing page, navigation, footer, session cards, session sidebar, session manager, and settings, including shared settings components (`SettingRow`, `Toggle`) and reworked copy buttons.
- Overhauled the usage page and charts and expanded the browser storage layer with portable snapshots and import/export.
- Reworked NodePod boot-file generation and runtime so the browser sandbox bundle stays aligned with the checked-in generator.
- Bumped version to 1.3.0 across root, web, and browser-agent-runtime packages.
- Replaced hardcoded version constants in `src/cli/main.ts` and `src/pi/hyperteacher-extension.ts` with a shared `src/core/version.ts` that reads from `package.json`.
- Updated `bin/keating.js` to read its version dynamically from `package.json`.
- Updated all documentation (`README.md`, `docs/TUTORIAL.md`, VHS tapes, `Blog.tsx`) to use `just` and `keating` commands instead of `mise`.
- Removed all references to `mise` from the README and task runner docs.

## [1.2.0] - 2026-06-09

### Added
- Added observable self-evolution transaction artifacts: baseline and after snapshots, structured JSON reports, Mermaid transaction diagrams, trace entries, and improvement archive export coverage.
- Added a self-evolution health panel to the web usage charts so humans can inspect recent improvement loops, verdicts, score deltas, policy signatures, and rollback state.
- Added timed quiz sessions with start/in-progress/completed timing, countdown support for time-limited questions, per-question elapsed time, and richer quiz result cards.
- Added structured tool argument/result visualization in chat for easier debugging of agent tool calls.
- Added branch-aware session forking with fork-point truncation, original-session navigation, and focused tests for fork metadata behavior.

### Changed
- Prompt evolution now refuses to apply regressive winners and reports when the best generated candidate was intentionally not applied.
- Auto-improve now records clearer before/after policy and prompt state and rolls back policy and prompt artifacts when a run regresses.
- Browser persistent-storage requests now use the native storage API directly and avoid noisy denied-permission warnings when the browser refuses persistence.
- Quiz result cards and related light-mode surfaces use stronger foreground contrast.
- Fine-tune export scripts now live as real template files under `src/core/templates/finetune/`, and the browser operational protocol lives in Markdown instead of a large embedded string.
- Version synchronization now updates CLI/bin version surfaces along with web, extension, and package metadata.
- The NodePod boot-file generation task now points at the checked-in Bun TypeScript generator.

### Fixed
- Fixed NodePod boot-file generation so the generated bundle no longer embeds its own previous output.
- Fixed release-blocking web type errors in active-quiz extraction and quiz result event details.
- Fixed the web sandbox test import to use `bun:test` instead of `vitest`.
- Fixed the CLI help banner and package shim so `keating --version` reports the current release instead of falling through to shell startup.

## [1.1.0] - 2026-06-03

### Added
- Added OpenAI image-model support to the `generate_image` browser tool, with model, size, quality, mode, and diagram-kind controls plus browser-local SVG fallback.
- Added richer local image-generation fallbacks for learning diagrams, including anatomy and comparison layouts suitable for antibody/minibinder lessons.
- Added interactive quiz taking inside lesson-plan artifacts. Lesson plans now expose `Lesson` and `Quiz` modes, generate multiple-choice/multi-select/transfer checks from the saved plan, and can redo quizzes with more focus on missed sections.
- Added provider filtering to the model chooser and compatibility entries for MiniMax M3 in MiniMax provider lists.
- Added a Vite development proxy for `/api/agent-runtime/remote/**`, matching the Nitro remote-runtime route used by production builds.

### Changed
- Centralized real-learner benchmark scoring, deterministic synthetic teaching simulation, outcome thresholds, and real/synthetic blending in a shared browser-safe benchmark helper.
- Improved blog and tutorial navigation with search/filtering, version-oriented update browsing, topic navigation, hover affordances, and mobile-safe control layouts.
- Improved artifact browsing by removing redundant side-panel headings and moving close controls into the search row.
- Improved chat copy affordances for assistant text, code blocks, reasoning, tool arguments, tool output, and generated image payloads.
- Reasoning blocks now parse `<think>` / `<thinking>` tags, deduplicate repeated reasoning, and auto-collapse after a response completes.
- Updated Keating packages to Pi `0.78.0` line packages where available.

### Fixed
- Fixed adaptive quiz scoring so skipped fallback questions are excluded from raw score, weighted score, denominator, percentage display, submission payloads, and persisted quiz stats.
- Fixed benchmark blending so real and synthetic coefficients stay non-negative and sum to one as real learner data grows.
- Fixed browser benchmark traces so real learner outcome counts and synthetic fallback state are persisted and reflected in benchmark artifacts.
- Fixed chat send failures that could hide or fail to persist a user message when the provider threw before streaming began.
- Fixed rendering of generated image/question/goal tags so tag-heavy messages no longer appear blank, misplaced, or duplicated.
- Fixed raw model thinking tags leaking into assistant messages.
- Fixed duplicate question text/header rendering and added collapsible question UI.
- Fixed animation artifacts that previously displayed storyboard text without playable visual motion.
- Removed redundant Keating and Features nav links.

## [1.0.0] - 2026-06-02

### Added
- Added explicit web agent serving modes: `keating web --browser-only-agent`, `keating web --remote`, and `keating web --cloud`.
- Added `/api/agent-runtime/config` so the browser can discover whether it is running in browser-only, remote, or Keating Cloud mode.
- Added `/api/agent-runtime/remote/**` as the controlled proxy path for remote-only work in remote and cloud modes; browser-only mode intentionally returns a fallback error instead of silently executing on a server.
- Added `agent_runtime` and `remote_execute` browser tools so the agent can inspect capabilities and hand off work that cannot run locally.
- Added `packages/browser-agent-runtime/`, a shared local-first sandbox runtime package with memory sandboxes, capability routing, transactional snapshots, Daytona-shaped compatibility, a NodePod adapter seam, and an RPC relay protocol.
- Added roadmap documentation for PDS/AT Protocol storage and educator tooling in `docs/plans/storage-atproto-educator-tools.md`.

### Changed
- Bumped Keating to the 1.0.0 major release line.
- Made browser-only execution the documented free-tier default. Browser-compatible work stays on the learner's device, while native binaries, durable compute, public inbound networking, server-side secrets, unrestricted host filesystem access, and microVM isolation require remote or cloud mode.
- Reframed the self-modifying-agent architecture around a shared runtime boundary so CLI, browser, NodePod, Daytona, microsandbox, and Keating Cloud can converge on one capability model.
- Updated README and architecture docs to describe the new serving contract and remote/cloud fallback behavior.

### Notes
- The remote microVM provisioner is not yet implemented. The v1 release establishes the mode/config/proxy/tooling contract that Daytona, NodePod, microsandbox, or another backend can implement behind `/api/agent-runtime/remote/execute`.

## [0.3.13] - 2026-05-28

### Added
- Added a `keating edit` CLI command that applies a single search/replace edit to any source file under the project, with stdin (JSON payload) and interactive (`---` separator) input modes plus an optional `--backup-dir` for pre-edit snapshots.
- Added `keating improve accept <id>` and `keating improve reject <id>` subcommands that resolve a pending self-improvement proposal using the snapshots and baseline score stored in the improvement archive.
- Added an `auto-improve --force` flag that bypasses the new 30-minute cooldown when re-running the full self-improvement loop intentionally.
- Added MAP-Elites grid persistence: each focus topic now reads and writes a JSON grid under `.keating/outputs/evolution/`, so successive runs build on prior cells instead of resetting.
- Added new mutable source targets for the self-improver — `src/core/mutation.ts`, `src/core/map-elites.ts`, and `src/core/prompt-evolution.ts` — so the system can iterate on its own evolution machinery.
- Added a resizable session sidebar in the web chat with a draggable column-resize handle that persists its width to `localStorage` between sessions.
- Added a year-by-year activity heatmap on the Usage page with a year selector, replacing the previous fixed 12-week window.

### Changed
- `auto-improve` now snapshots the previous teaching policy before the run and rolls it back automatically when the loop verdict is REGRESSED, so a bad run cannot corrupt the active policy.
- The Ax/GEPA optimizer now benchmarks every candidate on its Pareto front instead of returning a placeholder baseline, and tags each evolution run with the optimizer it actually used (`gepa` or `mapElites_fallback`) plus the fallback reason when applicable.
- Prompt evolution now resumes from the prior `*.evolved.md` artifact when available, so successive `evolve-prompt` calls accumulate improvements rather than restarting from the base prompt.
- `bench` now derives benchmark weights from the learner's recorded thumbs-up / confused / thumbs-down feedback, so reported scores reflect real session signals instead of a fixed default profile.
- Web `auto_improve` tool is now gated to one run per chat session and exposes an explicit `force` parameter, mirroring the new CLI cooldown.
- Web policy loading now actually parses the stored policy markdown (JSON block or `field: value` pairs) instead of always falling back to `DEFAULT_POLICY`; `clampPolicy` rounds `exerciseCount` and caps it at 5.
- Web `DEFAULT_POLICY` rebalanced toward more analogies, Socratic dialogue, retrieval practice, and diagrams to match the latest evolved policies.
- Web prompt evolution lookups now use a real IndexedDB `promptName` index rather than the generic topic index, fixing stale prompt suggestions when a topic and prompt share a name.
- The web chat now merges consecutive assistant messages into a single bubble for cleaner transcripts, and user message bubbles were restyled from amber to green for stronger learner/assistant contrast.
- The desktop sidebar collapse toggle was removed in favor of the new drag-resize handle; the mobile drawer toggle is unchanged.

### Fixed
- `improveReject` no longer requires the caller to supply snapshots — it now restores them from the improvement archive automatically when omitted.
- MAP-Elites candidates now record their actual parent policy name (was always `null`) and persist the grid to disk on every run so cell descriptors survive restarts.
- Fixed missing `mkdir -p` when saving a MAP-Elites grid into a fresh project that has no `evolution` directory yet.
- Fixed a typo in the v0.3.11 blog title ("For k Trees" → "Fork Trees").

## [0.3.12] - 2026-05-26

### Added
- Added portable web session sharing with server-backed short links, compressed snapshot links, and local-only short links.
- Added Nitro share storage endpoints for publishing and loading shared chat sessions.
- Added UI settings for share-link mode and app-wide font family selection.
- Added an OpenCode Entire plugin hook file for session and turn lifecycle tracking.

### Changed
- Shared sessions now preserve model and thinking-level metadata when copied or forked.
- Shared-session loading now falls back between embedded URL snapshots, local cache, and server storage.

## [0.3.11] - 2026-05-22

### Added
- Added a persistent large-screen sessions sidebar to the chat view with search, load, fork, rename-entry access, and nested fork navigation.
- Forked chat sessions now preserve parent metadata and appear as an explorable session tree in the sidebar and session manager.
- Added a user profile image setting for web chat avatars.
- Added a web animation renderer setting with Manim-web as the default and Hyperframes as an optional renderer for generated animation artifacts.

### Changed
- Forking a session now has a visible transition so the session split is easier to track.
- Assistant messages now use the Keating logo instead of the generic robot icon, and message sizing/alignment was tightened across desktop and mobile views.
- Usage session rows now prioritize readable session text with date, turn count, and token metadata anchored at the bottom.
- Keating web now uses the logo image as the favicon and Apple touch icon.

### Fixed
- Fixed mobile overflow in the chat composer, suggested prompts, session rows, and deepest-dive usage sections.
- Fixed the mobile settings dialog close button sizing so it uses the header height more naturally.
- Fixed the settings icon visibility on small chat screens.
- Removed the redundant generate-title action from the chat header.

## [0.3.10] - 2026-05-22

### Added
- Added a Google Search grounding setting for Gemini/Google web chat requests.
- URL-heavy user prompts now suggest enabling Google grounding when it is available.

## [0.3.9] - 2026-05-21

### Added
- Web chat now streams the in-progress assistant message directly from `agent.state.streamingMessage`, so the response appears token by token instead of waiting for the final assistant message to commit.
- Live reasoning blocks now surface during model thinking when the provider emits `thinking_*` stream events, using the existing collapsible "Reasoning" UI in the chat transcript.

### Changed
- While a request is still waiting on its first streamed token, the chat thread shows rotating prefill status lines instead of a blank assistant bubble.

## [0.3.8] - 2026-05-19

### Added
- Web chat composer now supports attachments through a paperclip button, including multiple local files before send.
- Image attachments are sent to vision-capable models as image input, while readable text/code/data files are converted into local text attachment blocks.
- Composer attachment chips show selected files and provide inline remove controls before sending.

### Fixed
- Sending images with a text-only model now produces a visible chat error that explains the model cannot read images and suggests switching to a vision-capable model such as Gemini Flash/Pro or GPT-4o.
- User transcript rendering now shows attached images inline and summarizes text file attachments without dumping full file contents back into the message bubble.

## [0.3.7] - 2026-05-17

### Added
- Chat header now exposes a "Generate title with model" sparkle button (and a matching mobile-menu entry) that asks the active model to rename the current session and persists the result to storage.
- New "Speech & Voice" tab in Settings with a provider abstraction. Built-in providers: Gemini Live (existing, refactored), OpenAI TTS (`gpt-4o-mini-tts`, `tts-1`, `tts-1-hd`), OpenAI Realtime (WebRTC duplex, preview), and Supertonic-3 (local ONNX, experimental — sessions load, synthesis pipeline pending). Users can also add OpenAI-compatible custom TTS endpoints inline.
- Microphone toggle for duplex speech providers (consumed by OpenAI Realtime when active).
- Usage page gained five charts: topic-mix donut, feedback-signal donut, hand-rolled SVG curriculum-timeline Gantt, 12-week activity heatmap, and an "Open checklists / weak spots" coming-up panel. Powered by `recharts` for pie charts and hand-rolled SVG elsewhere.
- Suggested-prompts strip auto-appends new suggestions when the scroll-right button is pressed at the end of the list, until the underlying pool is exhausted.

### Changed
- Chat-page header icons (new session, history, settings, share, usage, speech, artifacts) now show together at sm/md/lg sizes instead of disappearing at md; the hamburger collapses to xs only, and its dropdown gained the previously missing "New session" / "Session history" entries.
- Settings dialog widened to `max-w-5xl`, sidebar widened on md/lg, and the heavy "Providers & Models" tab gained a sticky chip-style sub-section navigator (Cloud / Visibility / My Models / Custom Providers) with scroll-to-section jumps.
- The speech section moved out of "Providers & Models" into the dedicated "Speech & Voice" tab.

### Fixed
- Several Settings sections and chat-header icons were previously unreachable at the md breakpoint because the mobile menu disappeared before all icons fit inline; both issues are addressed by the new header layout and the Settings sub-navigator.

## [0.3.6] - 2026-05-16

### Added
- Added an Ink-powered `keating setup` flow for interactive provider, model, thinking, and runtime onboarding, plus `keating setup --yes` for non-interactive default configuration.
- `keating --list-models` now passes through to the Pi runtime, and `keating --list-model` is accepted as a compatibility alias.

### Changed
- Renamed the npm package from `@interleavelove/keating` to `keating`.
- The default shell provider is now `google` with `gemini-3.1-pro-preview`.

### Fixed
- Existing configs that still name the removed `google-gemini-cli` provider are normalized to `google` when Keating reads them.
- Shell launch now checks provider credentials before starting Pi, falls back from Google to configured OpenAI or Anthropic credentials, and reports recovery commands when no provider is configured.
- Common CLI errors such as missing command input, missing runtime, and missing build artifacts now include concrete recovery commands.

### Fixed
- Dotenv startup tips are now suppressed unless `KEATING_DEBUG=1` or `DEBUG=1` is set.
- Curl and npm installs now verify that the CLI launcher, compiled Pi extension, and embedded agent runtime are present before publishing release artifacts.
- Release and npm packages no longer include local `bin/.keating` state or `bin/keating.config.json`.
- Runtime discovery now checks Keating's bundled `@mariozechner/pi-coding-agent` dependency and reports actionable setup guidance when no AI runtime is available.

### TODO
- Move rendered VHS tapes (`docs/assets/*.mp4`, `web/public/tapes/*.mp4`) out of git history and into git-lfs (or an external CDN). They were committed inline in 0.3.0 to keep the blog working immediately; ~1.7MB today, will grow.

## [0.3.5] - 2026-05-12

### Fixed
- Standalone `curl | bash` installer now works correctly. The release tarball was archived without its top-level `keating-VERSION-OS-ARCH/` directory, so the wrapper script pointed at a nonexistent path. The release workflow now stages files inside the versioned directory before archiving.
- The install wrapper script at `~/.local/bin/keating` now uses `exec node ...` to invoke `bin/keating.js` instead of trying to `exec` a standalone binary that does not exist in the tarball.
- Added `require_command node` to the install script so the installer fails early with a clear message if Node.js is not available on the system.

## [0.3.4] - 2026-05-10

### Added
- Chat panel now renders GitHub-flavored markdown tables via `remark-gfm`.
- LaTeX math expressions are typeset with KaTeX using `remark-math` and `rehype-katex` plugins. Inline `$...$` and block `$$...$$` delimiters are supported.

## [0.3.3] - 2026-05-09

### Added
- Interactive quiz UI renders live forms inside chat with multiple-choice, fill-in-the-blank, true/false, and open-ended question types.
- Animation storyboards render as navigable scene cards with duration, visual descriptions, audio cues, and transitions.
- Version sync script (`scripts/sync-version.mjs`) enforces the root `package.json` version across the web package, CLI extension, and hardcoded web strings.

### Fixed
- Dark mode contrast fixed across landing, tutorial, blog, paper, and footer pages by replacing hardcoded hex colors with theme-aware Tailwind classes.
- Chat viewport overflow fixed by switching `.chat-page-panel` from `display: block` to `display: flex; flex-direction: column; height: 100%`.

## [0.3.2] - 2026-05-09

### Added
- Per-message fork and feedback actions (thumbs up, thumbs down, fork from message).
- Artifact chips in assistant messages that open the artifact browser directly.

### Changed
- Chat UI migrated from Lit to `@assistant-ui/react` for better streaming and composer primitives.
- Mobile responsiveness improved with adaptive toolbar buttons, touch-friendly targets, and responsive message bubbles.
- CLI theme refreshed to match the web retro-green terminal palette.

### Fixed
- React error #310 crash (hook-count mismatch under StrictMode double-render) fixed by removing StrictMode and memoizing the adapter object.

## [0.3.1] - 2026-05-08

### Added
- Added an Artifacts button to the chat header and a new artifact browser overlay for browsing Keating plans, maps, animations, benchmarks, and evolution outputs from the web app.
- Added a rename-capable session manager dialog with load, rename, and delete actions for saved chat sessions.

### Changed
- The web chat now prompts once for persistent browser storage, automatically resumes the most recent saved session, and records session-end events when starting a new session or switching sessions.
- Added typed schemas for optional and required parameters across the web tool surface, including `feedback.signal`, `prompt_eval.prompt`, and `keating_voice` speech fields.
- Updated the site blog with the v0.3.1 release notes, the full 19-tool web schema table, and the `createSimpleTool` to `createTool` fix.

### Fixed
- Web model tool registration now exposes all 19 Keating tools with proper JSON Schema parameter definitions instead of empty `properties: {}` schemas.
- Replaced the browser-side `createSimpleTool` helper with `createTool` registrations so model calls can supply the expected tool arguments for planning, mapping, animation, verification, benchmarking, feedback, state inspection, prompt evaluation, timelines, due work, and voice output.
- Custom provider model discovery now uses Keating's same-origin backend proxy instead of making cross-origin browser requests to local or remote provider endpoints such as Ollama's `/api/tags`.
- Anthropic-compatible and non-standard custom chat providers now route through the same backend proxy path, avoiding browser CORS failures from direct provider requests.
- The Nitro chat proxy now handles model-discovery GET requests as well as chat POST requests.

## [0.3.0] - 2026-04-30

### Added
- **Pedagogical Engines**: Library-level scaffolding for `flashcards` (spaced-repetition decks with mnemonics), `quiz` (multi-level workbooks with answer keys), `mastery` (longitudinal progress tracking), and `projects` (multi-stage assignments with milestones, deliverables, and rubrics).
- **Command Spec Registry**: New `core/commands.ts` defines a single source of truth for CLI/shell command surfaces, enabling consistent help output across CLI and web.
- **Terminal & Theme Modules**: Extracted `core/terminal.ts` and `core/theme.ts` so palette, ASCII headers, and console section helpers are reusable across CLI, shell, and benchmarking output.
- **VHS Workflow Tapes**: Added `intro.tape`, `learning-flow.tape`, `improve-flow.tape`, and `feedback-flow.tape` to record demonstrable end-to-end workflows.
- **ChatIntro Polish**: Web boot screen now renders the KEATING logo with a vertical emerald gradient and CRT-style glow.

### Changed
- **CLI ASCII Logo**: Replaced the misaligned block-character logo with the clean ANSI Shadow font, aligning the CLI brand with the web UI.
- **Browser Tools / Storage / Core**: Significant expansion of `web/src/keating/{browser-tools,core,storage}.ts` with broader tool surfaces and persistence improvements.
- **Hyperteacher Extension**: Updated extension wiring (`src/pi/hyperteacher-extension.ts`) and runtime to expose the new pedagogical engines through the Pi agent.
- **Project Scaffold**: `core/project.ts` and `core/paths.ts` reorganized to support the new artifact types.

## [0.2.0] - 2026-04-16

### Added
- **Ax Optimization Framework**: Integrated multi-objective policy and prompt learning (GEPA/ACE) using `@ax-llm/ax`.
- **MAP-Elites Archive**: Implementation of MAP-Elites for diverse policy discovery and quality-diversity search.
- **Engagement Policies**: Temporal awareness and engagement optimization for teaching actions.
- **Improved Benchmarking**: Enhanced metric reporting, simulation robustness, and better handling of edge cases.
- **Retro Aesthetic Polish**: Finalized pixel-art identity, VT323 typography, and emerald green theme across all pages.

### Changed
- Completed rebranding of "Feynman" assets and paths to "Keating".
- Migrated core backend interactions to use Nitro proxies for robust CORS handling in production.
- Refactored chat interface to handle streaming and error states more gracefully.

## [0.1.4] - 2025-04-10

### Fixed
- CLI now works when installed globally via npm/bun - paths are resolved relative to package installation directory instead of current working directory
- Model selector properly syncs with dynamic provider discovery
- Agent state updates persist correctly across boot sequence
- Mise task names use hyphens instead of colons for compatibility
- Mise web tasks use `cd` instead of `--cwd` flag

### Changed
- Web app converted to React with Keating browser tools integration
- Model selector rewritten with dynamic provider discovery
- **Migrated to Nitro + Vite** for a high-performance, runtime-agnostic server engine.

### Added
- `web:build` and `web:preview` tasks for production builds

## [0.1.3] - 2025-04-05

### Added
- Synthetic provider support for custom model endpoints
- PWA support for offline-capable web app
- Browser WebGPU model with tutorial and blog pages
- Landing page with hero, features, and chat modal
- Install tabs (npm/bun/pnpm/curl/agent) with copy buttons
- Retro redesign: grungy paper + CRT terminal aesthetic

### Fixed
- Chat panel text disappearing issue
- Model loading animation
- Mobile navigation with hamburger menu
- Railway deploy configuration (SERVER_HOST=0.0.0.0)
- Bun server for Railway deploy

### Changed
- Simplified workflows: Railway handles deploy, CI just verifies build

## [0.1.2] - 2025-04-01

### Added
- Initial public release
- Pi-powered hyperteacher shell
- Lesson plan generation (`keating plan <topic>`)
- Mermaid concept maps (`keating map <topic>`)
- Manim-web animation bundles (`keating animate <topic>`)
- Verification checklists (`keating verify <topic>`)
- Teaching benchmark suite (`keating bench`)
- Policy evolution (`keating evolve`)
- Self-improvement proposals (`keating improve`)
- Doctor command for runtime diagnostics (`keating doctor`)

## [0.1.1] - 2025-03-28

### Added
- Web UI with model selector
- Browser WebGPU model support
- Tutorial and documentation pages

## [0.1.0] - 2025-03-25

### Added
- Initial release
- Core hyperteacher functionality
- Pi agent integration
- Teaching policy system

[Unreleased]: https://github.com/Diogenesoftoronto/keating/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/Diogenesoftoronto/keating/compare/v2.10.0...v3.0.0
[2.10.0]: https://github.com/Diogenesoftoronto/keating/compare/v2.9.0...v2.10.0
[2.9.0]: https://github.com/Diogenesoftoronto/keating/compare/v2.8.0...v2.9.0
[2.8.0]: https://github.com/Diogenesoftoronto/keating/compare/v2.7.0...v2.8.0
[2.7.0]: https://github.com/Diogenesoftoronto/keating/compare/v2.6.0...v2.7.0
[2.6.0]: https://github.com/Diogenesoftoronto/keating/compare/v2.5.0...v2.6.0
[2.5.0]: https://github.com/Diogenesoftoronto/keating/compare/v2.4.1...v2.5.0
[2.4.1]: https://github.com/Diogenesoftoronto/keating/compare/v2.4.0...v2.4.1
[2.4.0]: https://github.com/Diogenesoftoronto/keating/compare/v2.3.1...v2.4.0
[2.2.0]: https://github.com/Diogenesoftoronto/keating/compare/v2.0.0...v2.2.0
[2.0.0]: https://github.com/Diogenesoftoronto/keating/compare/v1.4.1...v2.0.0
[1.4.1]: https://github.com/Diogenesoftoronto/keating/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/Diogenesoftoronto/keating/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Diogenesoftoronto/keating/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Diogenesoftoronto/keating/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Diogenesoftoronto/keating/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.13...v1.0.0
[0.3.13]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.12...v0.3.13
[0.3.12]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.11...v0.3.12
[0.3.11]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.10...v0.3.11
[0.3.10]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Diogenesoftoronto/keating/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Diogenesoftoronto/keating/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/Diogenesoftoronto/keating/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Diogenesoftoronto/keating/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Diogenesoftoronto/keating/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Diogenesoftoronto/keating/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Diogenesoftoronto/keating/releases/tag/v0.1.0
