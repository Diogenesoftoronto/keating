# AGENTS.md — Keating

Keating is a teaching app with a CLI, Pi runtime, web UI, and mobile client.
Keep local pedagogy logic separate from model execution and account authority.

## Working style

- Carry authorized work through implementation and relevant verification. Make routine decisions from context; ask only when missing information materially changes the result.
- Treat follow-up messages and screenshots as refinements to the active task. Preserve accepted requirements across compaction.
- Preserve unrelated dirty changes. Commit, publish, deploy, or delete only within the user's authorized scope.
- Keep updates concise; report outcomes and verification limits. Give research and reports the depth requested.
- Delegate independent, bounded work when it saves time; give each worker a clear scope and integrate its results.
- Run checks proportional to the change. Avoid repeated full suites for small edits. Do not run Vet.

## Context and tools

- Prefix shell commands with `rtk`; use `rtk proxy <command>` when unfiltered output is needed. Search with `rg`.
- Read only the files and reference sections relevant to the task. Batch independent reads and bound output before returning it to context.
- When prior decisions matter, search Entire checkpoints narrowly before repeating an investigation. Treat imported sessions, model labels, and overlapping token totals as incomplete evidence.
- Before compaction, preserve the objective, accepted decisions, changed files, completed checks, and remaining work. Resume from that state.
- This file contains startup essentials. Use [agent reference](docs/agent-reference.md) for detailed commands and subsystem notes; do not preload it.

## Repository map

| Work | Start here |
| --- | --- |
| Core artifacts and CLI | `src/core/`, `src/cli/main.ts`, `src/core/project.ts` |
| Pi tools and runtime | `src/pi/hyper-teacher/`, `src/runtime/`, `pi/prompts/`, `pi/skills/` |
| Terminal UI | `src/tui/` |
| Web UI and agent | `web/src/components/`, `web/src/hooks/useKeatingAgent.tsx`, `web/src/keating/` |
| Mobile and shared contracts | `mobile/`, `packages/learner-contracts/`, `shared/` |
| Teaching evaluation | `shared/evolution/`, [teaching evolution](docs/teaching-evolution.md) |
| Product design | [PRODUCT.md](PRODUCT.md); inspect neighboring components and existing interaction patterns |
| Tests | `test/` at root; `web/src/test/` for web |

## Development

Use Bun and the existing Devenv environment (`rtk devenv shell` or direnv).
Root and web have separate packages. Discover tasks with `rtk devenv tasks list`.

| Task | Command |
| --- | --- |
| Install | `rtk devenv tasks run keating:install` |
| Root build / tests | `rtk devenv tasks run keating:build` / `keating:test` |
| Web dev / build / tests | `rtk devenv tasks run keating:web` / `keating:web-build` / `keating:test-web` |
| Full build | `rtk devenv tasks run keating:build-all` |
| CLI with arguments | `rtk bun src/cli/main.ts <command>` |

- Root TypeScript uses NodeNext and `.js` import extensions. Web uses Bundler resolution and `@/` for `web/src/`. Keep strict types.
- Web production builds include Vite and Nitro; Vite alone is insufficient.
- Use `bun:test` and existing fixtures. Favor behavior, invariants, and integration boundaries over implementation snapshots.
- Wait for checks to finish before claiming success. Distinguish local tests from browser, provider, deployment, and release verification.
- Releases use `bun pm version` through `keating:bump-version`; synchronize versions and changelog. Preserve Devenv hooks.
- Keep generated `.keating/`, `dist/`, `web/dist/`, and `web/.output/` out of commits.

## Architectural safeguards

- Keep deterministic tests independent of hosted inference. Inject episode runners, judges, proposers, and other model doubles at explicit boundaries.
- When core types or tools change, check browser parity in `web/src/keating/core.ts` and `browser-tools.ts`. Shared learner contracts require checking web, mobile, and TUI consumers.
- Keep policy scalars in `[0, 1]`, exercise counts integral in `[1, 5]`, and weights normalized. Check domain phase injections when adding topics.
- Command signature changes require checking `src/core/commands.ts` help generation.
- Teaching revision activation requires both independent behavior gates. Consume holdout families before use; renew independently. `--force` bypasses cooldown only.
- Teaching episodes may use only `plan`, `map`, `verify`, `quiz`, `grade_quiz`, and workspace-contained `read`.
- Historical benchmarks, synthetic scores, and model judgments do not establish human learning effectiveness. Missing retention or transfer stays unknown.
- Prompt evolution writes reports and evolved snapshots; it must not silently replace source prompts.
- Keep Not Organic assertion keys, payment credentials, wallet authority, and server credentials out of browser bundles and `VITE_*` variables. Preserve PKCE and DPoP boundaries.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **keating** (46563 symbols, 109573 relationships, 782 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/keating/context` | Codebase overview, check index freshness |
| `gitnexus://repo/keating/clusters` | All functional areas |
| `gitnexus://repo/keating/processes` | All execution flows |
| `gitnexus://repo/keating/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
