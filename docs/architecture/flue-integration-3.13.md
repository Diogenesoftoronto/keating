# Integration of Keating 3.13 into the Flue worktree

The integration imports the complete v3.13.0 release, including download-page
work, learning activities, teaching experiments, learner assessments, and the
updated paper. It retains the portable agent runtime and account-scoped pedagogy
revision verification from `spike/flue-runtime`.

Conflict resolution preserves both real-time and evolution capability scopes,
Flue's signed revision compatibility manifests, the release's mobile session
race protections, and Flue's nested account-response parsing. Mobile account
context wraps the teaching provider because teaching consumes active pedagogy.
Account prompt resolution now runs in the release's asynchronous agent preparation
path, with custom personas retaining precedence. NodePod source snapshots were
regenerated, including the pre-existing portable type consolidation.

The Flue branch was fast-forwarded into local `main` on September 6, 2026.
The initial integration passed 471 root tests, 1,342 web tests, 346 mobile tests,
89 shared-contract/portable-runtime tests, three official Node-host integration
tests, and root/production web builds.

The subsequent custom persistence adapter removes the official host's NodePod
SQLite startup blocker. Real Chromium/NodePod tests now require successful
Flue dispatch, tool reconciliation, repeated learner turns, and preserved state
after stopping and reopening the runtime against the same pod file. Upstream
submission, conversation, attachment, and format-version contract tests exercise
the adapter independently. MCP and detached subagents remain verified on the
Node host, not inside NodePod.

The browser chat still uses Pi's model/tool loop with the portable Flue-style
authoring integration; merging this work does not switch every product chat to
the standalone official host. See [the host spike](../../spikes/flue-host/README.md#nodepod-execution-evidence)
for commands and persistence limits.
