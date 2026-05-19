# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Diogenesoftoronto/keating/compare/v0.3.8...HEAD
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
