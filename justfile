# Keating task runner — use `just <task>` to run any task
# All tasks run from the project root unless noted

# Default: list available tasks
default:
    @just --list

# Install dependencies (root + web)
install:
    bun install
    cd web && bun install

# Build the root TypeScript project
build:
    bun x tsc -p tsconfig.json

# Build everything (root + web)
build-all: build
    cd web && bun run build

# Run the root test suite
test:
    bun test ./test/*.test.ts

# Run the web test suite
test-web:
    cd web && bun test

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

# Generate a lesson map
map topic:
    bun src/cli/main.ts map {{ topic }}

# Animate a teaching artifact
animate topic:
    bun src/cli/main.ts animate {{ topic }}

# Trace a teaching session
trace substring="":
    bun src/cli/main.ts trace {{ substring }}

# Start the Keating web UI dev server
web:
    cd web && bun run dev

# Build the Keating web UI for production
web-build:
    cd web && bun run build

# Preview the Keating web UI production build
web-preview:
    cd web && bun run build && bun run preview

# Render documentation diagrams
docs-diagrams:
    bun scripts/render-docs-diagrams.mjs

# Render the narrated Keating intro video
video-intro:
    bun scripts/render-keating-intro.mjs
