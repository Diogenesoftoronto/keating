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

Validation on September 6, 2026: 471 root tests, 1,342 web tests, 346 mobile tests,
89 shared-contract/portable-runtime tests, and three official Node-host integration
tests pass. Root and production web builds pass. Two real-browser NodePod checks
pass: portable state execution and explicit rejection of the unsupported official
Flue SQLite adapter. The strict official-host NodePod acceptance probe fails;
this work does not claim official Flue currently runs in NodePod.

See [the host spike](../../spikes/flue-host/README.md#nodepod-execution-evidence)
for commands, the exact limitation, and the adapter work still required.
