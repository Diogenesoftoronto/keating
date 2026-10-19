# Operations

Use the existing Devenv shell (`rtk devenv shell` or direnv), Bun, Git, authenticated `gh`, and Railway CLI. Start with `rtk bun scripts/ops.ts --help`; every subcommand has `--help` and `--dry-run`. Worktree creation, releases, deployment and promotion print a plan unless passed `--yes`. Verification and mutation testing execute local checks by default. Status is read-only apart from a local observation cache.

Exit codes: **0** completed or valid plan; **1** failed; **2** invalid arguments or unmet precondition; **3** timeout or still pending. A release notes scaffold also returns 3 because preparation is incomplete. HTTP/version observations establish deployment identity, not authenticated, payment, provider or native-client functionality.

Public IDs, URLs, workflow filenames and the eight-hour promotion wait live in `scripts/ops/config.ts`. Credentials belong in the environment. `.keating/` is gitignored; verification logs live under `.keating/ops/verify-<timestamp>/` and the latest status observation is `.keating/ops/status.json`.

## Fresh worktree

```bash
rtk bun scripts/ops.ts worktree /tmp/keating-release --branch release/next
rtk bun scripts/ops.ts worktree /tmp/keating-release --branch release/next --yes
# Equivalent task (without yes=true, prints a plan):
rtk devenv tasks run keating:worktree --input path=/tmp/keating-release --input branch=release/next --input yes=true
```

The path must not exist. The command fetches origin, creates a branch/worktree from `origin/main` (override with `--base`), sanitizes compiler include/library environment variables during the root install, validates the native node-pty artifact, installs web dependencies and generates Panda, installs Flue with its frozen lock, then builds root TypeScript and copies templates. It prints the prepared path and branch. It does not run tests.

If node-pty fails, the command retries install with `--ignore-scripts`, then rebuilds **in that worktree** with `env -u CPLUS_INCLUDE_PATH -u C_INCLUDE_PATH -u LIBRARY_PATH bun x node-gyp rebuild` from `node_modules/node-pty`. It requires `build/Release/pty.node` afterward and prints the exact worktree-specific remedy on failure. Enter Devenv for the compiler, Python and Node headers. Never copy a native binary from another checkout; existence checks alone do not establish ABI compatibility.

## Verification

```bash
rtk bun scripts/ops.ts verify --dry-run
rtk bun scripts/ops.ts verify
rtk bun scripts/ops.ts verify --only root,contracts,typecheck
rtk devenv tasks run keating:ops-verify --input only=root,contracts
```

Verification generates web Panda, regenerates `web/src/keating/nodepod-boot-files.ts` and explicitly reports changed generated content, then builds root TypeScript and copies templates. Root tests import `dist/`; a successful typecheck alone does not prepare those runtime files. Inspect any generated source diff before release.

The `typecheck` group checks root, web, mobile and package tsconfigs. Root, package contracts, web, mobile, standalone Flue, and Flue persistence-contract tests run **sequentially** to avoid OOM. The final table records pass/fail counts and exact known failures. `.keating/ops/verify-*/` contains each phase's full output. Prerequisite build/codegen failures stop the run; after prerequisites, failed checks do not prevent later checks from running.

`scripts/ops/known-failures.json` records the baseline mobile native-core test and four Flue-host tests by suite, exact name, reason and date. Only exact known failures return 0, and they remain visibly listed. Missing summaries, unknown names, infrastructure errors and mismatched failure counts fail. Passing this baseline does not mean those five defects have been repaired. Update the file deliberately when a baseline failure is fixed or diagnosed.

Browser NodePod scenarios, provider E2E, desktop suites, research workloads, production builds and native platform builds are separate checks. `keating:verify` retains its teaching meaning; use **keating:ops-verify** for repository verification.

## Mutation testing

```bash
rtk bun scripts/ops.ts mutate packages/learner-contracts/src/diagram.ts --dry-run
rtk bun scripts/ops.ts mutate packages/learner-contracts/src/diagram.ts
rtk bun scripts/ops.ts mutate src/core/example.ts --tests test/example.test.ts --threshold 70
rtk devenv tasks run keating:mutate --input target=packages/learner-contracts/src/diagram.ts
# No target uses the repository stryker.config.json defaults:
rtk devenv tasks run keating:mutate
```

Tests default to files directly importing the target, discovered with `rg`; supply `--tests` when coverage goes through an index/re-export or dynamic loading. Root targets whose tests import `dist/` need the root build first. Explicit targets enable every mutator type. Repository-wide runs retain the repository config’s operator exclusions and print a warning that most mutator types are excluded; a high score under those exclusions is limited evidence. The command runner executes `bun test <files>` with quoted literal paths, uses an isolated sandbox under `/tmp`, and prints the score and survivors as `file:line mutator`. Reports and logs remain in the printed `/tmp/keating-stryker-*` directory. Zero valid mutants, infrastructure failure or a score below the threshold (default 60) returns 1.

TypeScript 7.0.2 is the native port and has no JavaScript `parseConfigFileTextToJson` API. Stryker's TSConfigPreprocessor otherwise crashes. Both configs deliberately set `tsconfigFile` to a **nonexistent** sentinel, `stryker-no-tsconfig.json`; Bun resolves source imports and normal typechecks run separately. Do not create that sentinel file. Ignore patterns begin with `/`: bare `src` would also exclude `packages/*/src`.

## Release

```bash
rtk bun scripts/ops.ts release patch --title "Teaching fixes"
# Reviewed notes file contains the section body, without a version heading:
rtk bun scripts/ops.ts release patch --title "Teaching fixes" --notes /tmp/release-notes.md --yes
rtk bun scripts/ops.ts release --push --yes
rtk bun scripts/ops.ts status --tag vX.Y.Z --wait
```

Preparation requires a clean tree, fetches origin and requires HEAD to descend from `origin/main`. It accepts patch/minor/major or an exact newer X.Y.Z. With `--notes`, it inserts/replaces the `## X.Y.Z` changelog section, bumps via `bun pm version --no-git-tag-version`, synchronizes source/manifests and lock metadata, refreshes Bun's lock, checks graph changes, commits `Release X.Y.Z: <title>` through the existing hooks and creates annotated `vX.Y.Z`. A usable GitNexus CLI/index is required for the commit gate. It does not push.

Without `--notes`, `--yes` writes a scaffold from commit subjects since the last tag and stops with exit 3 **before bumping, committing or tagging**. Review/edit the scaffold, save its reviewed body to a notes file, commit the reviewed changelog to restore a clean tree, then rerun with `--notes`. Notes containing TODO/scaffold markers are refused. Keep notes files outside the checkout or commit them; untracked files make the tree dirty.

Publishing is separate: `release --push --yes` fetches, rechecks cleanliness and fast-forward ancestry, requires the annotated current-version tag on HEAD, then pushes HEAD to main and the tag. Hooks remain enabled. If the second push fails, inspect the remote tag and retry only the missing publication. If preparation fails after writing versions, inspect its changes and complete normal checks/review before committing; never reset other sessions' work.

```bash
rtk devenv tasks run keating:release --input version=patch --input title="Teaching fixes" --input notes=/tmp/release-notes.md --input yes=true
rtk devenv tasks run keating:release --input push=true --input yes=true
```

`sync-version.ts --check` checks source manifests, each existing Bun workspace version against its own manifest, and package-lock's top-level/root-package version. Independently versioned packages keep their own versions. The old `.mjs` entry point delegates to the same implementation. Version checks never resolve dependencies or rewrite files.

## Status and monitoring

```bash
rtk bun scripts/ops.ts status
rtk bun scripts/ops.ts status --tag vX.Y.Z --wait --timeout 30m --interval 30s
rtk devenv tasks run keating:release-status --input tag=vX.Y.Z --input wait=true
```

Run the wait command once in the background and retain its exit status. It queries GitHub Release and main CI runs, staging's HTML version and snapshot SHA, production's HTML `softwareVersion`, and the local candidate's age/eligibility. Wait mode prints changes only and finishes when the tag's Release workflow succeeds and clean staging serves the matching version **and commit**. Failed Release returns 1; pending/missing runs or mismatched staging return 3 at timeout. A tag's local commit is preferred for matching; when absent, the tag-filtered Release run supplies it. Missing observations stay unknown. Green Release/staging does not establish production promotion, registry publication, Flatpak provenance or provider functionality.

## Staging deployment

```bash
rtk bun scripts/ops.ts deploy-staging
rtk bun scripts/ops.ts deploy-staging --yes
rtk devenv tasks run keating:deploy-staging --input yes=true
```

The plan shows SHA, dirty state and Railway target IDs. The existing staging flow creates its bounded immutable snapshot, waits for its exact fingerprint and chat health, and publishes the promotion candidate/archive. Dirty previews remain ineligible. Uploads and deployment listing use explicit `--project`, `--environment`, `--service`; no per-directory `railway link` is required. If older CLI versions reject these flags, enter Devenv/use the pinned scheduler CLI rather than silently deploying to a linked target.

Compatibility tasks `keating:staging-deploy`, `keating:staging-scheduler`, staging status tasks and `keating:promote-staging` retain their existing semantics. **`devenv up` still deploys staging intentionally**, through `processes.staging`.

## Promotion and rollback

```bash
rtk bun scripts/ops.ts promote
rtk bun scripts/ops.ts promote --yes
rtk bun scripts/ops.ts promote --now --yes
rtk devenv tasks run keating:promote --input now=true --input yes=true
```

The plan shows the local candidate, its age versus eight hours, preliminary eligibility, and production's version from the latest status cache (with observation time; unknown before status runs). Applying invokes the existing local `promote-staging` flow, preserving archive checksums, clean committed-source identity, successful staging deployment, live fingerprint, health and persistent lease checks. `--now` bypasses age only. The local state directory and Railway worker state are separate: coordinate operators before local recovery; never run simultaneous local and hosted promoters or clear an unresolved lease blindly.

The hosted worker remains the normal hourly authority. To ask it for a gated check, use the existing `keating:promote-staging`; `--input now=true` requests immediate promotion. Submission/restart acceptance does **not** prove production has changed: inspect worker logs and production afterward.

Rollback must reference a full SHA previously promoted successfully by that same authoritative state store:

```bash
# Hosted worker request (a real outward action):
rtk devenv tasks run keating:promote-staging --input now=true --input sha=<full-previously-promoted-sha>
```

For coordinated local recovery only, `rtk bun scripts/promote-staging.ts promote --now --sha <full-sha>` uses local promotion history. Do not substitute a local history for the hosted worker's receipts. Inspect production and the in-flight operation before considering `release-lease --operation <exact-id>`. Never retry an uncertain upload without reconciling the retained lease/deployment first.

## Troubleshooting

- **node-pty:** use the printed sanitized rebuild command in the new worktree with Devenv's native toolchain. A missing `pty.node` is a hard failure.
- **Root tests cannot import dist:** run `rtk bun x tsc -p tsconfig.json` then `rtk bun scripts/copy-core-templates.ts`, or use ops verification.
- **Missing Panda/styled-system:** run `rtk bun run --cwd web panda`; ops worktree/verify prepares it. Vite-only builds do not prove Nitro production builds.
- **Web test `Nitro's resolved development assets mount…` fails with `Cannot resolve module …/web/dist/index.html`:** the test needs a client build. `verify` builds it when `web/dist` is missing; otherwise run `rtk bun x --cwd web vite build`.
- **Railway linkage:** ops staging targets explicit IDs. Inspect config and CLI version before any manual linking; never rely on another checkout's linkage.
- **Stryker TS7 API error:** keep the nonexistent sentinel and run typechecks separately; leading `/` on ignore patterns protects nested package source directories.
- **Unknown status / gh error:** authenticate `gh` for the configured repository and retry status. Keep workflow completion, staging identity and production identity as separate evidence.

Task inputs are decoded as JSON into argv inside TypeScript, never interpolated into shell commands. Optional `args`/`tests` arrays must be structured arrays, not strings containing shell text. Ordinary named inputs (`--input target=…`, `--input yes=true`) cover the common commands.
