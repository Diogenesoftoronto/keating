# Keating task runner — use `just <task>` to run any task
# All tasks run from the project root unless noted

# Default: list available tasks
default:
    @just --list

# Install dependencies (root workspaces, including mobile, plus web)
install:
    bun install
    cd web && bun install

# Build, install, and launch the native Expo development client on Android
mobile:
    cd mobile && bun run android

# Start Metro for the installed native development client
mobile-start:
    cd mobile && bun run start

# Generate the Android native project from Expo configuration
mobile-prebuild:
    cd mobile && bun run android:prebuild

# Regenerate the Android native project after native dependency/config changes
mobile-prebuild-clean:
    cd mobile && bun run android:prebuild:clean

# Build a locally installable Android debug APK
mobile-apk:
    cd mobile && bun run android:apk

# Check the React Native app without producing build artifacts
mobile-check:
    cd mobile && bun run typecheck
    cd mobile && bun run test

# Produce a production Android JavaScript bundle locally
mobile-export:
    cd mobile && bun run export:android

# Sync version numbers across all manifests and source files
sync-version:
    bun scripts/sync-version.ts

# Verify that all version strings are in sync (CI-friendly)
check-version:
    bun scripts/sync-version.ts --check

# Build the root TypeScript project
build: check-version
    bun x tsc -p tsconfig.json
    bun scripts/copy-core-templates.ts

# Generate NodePod boot files from source tree
generate-nodepod-boot:
    bun scripts/generate-nodepod-boot-files.ts

# Build everything (root + web)
build-all: sync-version build generate-nodepod-boot
    cd web && bun run build

# Run the root test suite
test:
    bun test ./test/*.test.ts

# Run the web test suite
test-web:
    cd web && bun test

# Real Pi RPC + MiniMax tool-loop smoke test. Reads minimax@secrets from Skate.
test-e2e: build
    KEATING_E2E=1 bun test ./test/e2e/tui.e2e.test.ts

# Run mutation testing
mutate:
    stryker run

# Launch the hyperteacher shell
shell:
    bun src/cli/main.ts shell

# Run the hyperteacher doctor
doctor:
    bun src/cli/main.ts doctor

# Run benchmarks
bench topic="":
    bun src/cli/main.ts bench {{ topic }}

# Evolve the teaching policy
evolve topic="":
    bun src/cli/main.ts evolve {{ topic }}

# Evolve a prompt template
prompt-evolve name="learn":
    bun src/cli/main.ts prompt-evolve {{ name }}

# Generate a lesson plan
plan topic:
    bun src/cli/main.ts plan {{ topic }}

# Generate a lesson map
map topic:
    bun src/cli/main.ts map {{ topic }}

# Generate a fact-checking checklist before teaching
verify topic:
    bun src/cli/main.ts verify {{ topic }}

# Animate a teaching artifact
animate topic:
    bun src/cli/main.ts animate {{ topic }}

# Trace a teaching session
trace substring="":
    bun src/cli/main.ts trace {{ substring }}

# Start the Keating web UI dev server
web:
    cd web && bun run dev

# Launch the Storybook component explorer
storybook:
    cd web && bun run storybook

# Build the Keating web UI for production
web-build:
    cd web && bun run build

# Preview the Keating web UI production build
web-preview:
    cd web && bun run build && bun run preview

# Render the narrated Keating intro video
video-intro:
    bun scripts/render-keating-intro.mjs

# Stitch captured web UI frames into docs/assets/web-*.mp4 (frames produced via playwriter MCP — see AGENTS.md)
video-web-stitch:
    bun scripts/stitch-web-frames.mjs
