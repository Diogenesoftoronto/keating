# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Diogenesoftoronto/keating/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/Diogenesoftoronto/keating/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Diogenesoftoronto/keating/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Diogenesoftoronto/keating/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Diogenesoftoronto/keating/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Diogenesoftoronto/keating/releases/tag/v0.1.0
