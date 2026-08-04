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
| `keating:bumpy` | Run bumpy (version bumper). Passes through args. |
| `keating:bump-version` | Bump version and sync across manifests (e.g. `keating:bump-version version`) |
| `keating:sync-version` | Sync version numbers across all manifests and source files |
| `keating:check-version` | Verify all version strings are in sync (CI-friendly) |

### Build

| Task | Description |
|------|-------------|
| `keating:build` | Build root TypeScript project (requires versions in sync) |
| `keating:generate-nodepod-boot` | Generate NodePod boot files from source tree |
| `keating:build-all` | Sync versions, build root, generate nodepod boot, build web |

### Test

| Task | Description |
|------|-------------|
| `keating:test` | Run the root test suite (`bun test ./test/*.test.ts`) |
| `keating:test-web` | Run the web test suite |
| `keating:test-e2e` | Real Pi RPC + tool-loop smoke test (requires `KEATING_E2E=1` and secrets) |
| `keating:mutate` | Mutation testing with Stryker against `src/core/` |

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
