# Replaying the November 18 OpenUI study

Run the nine historical receipt and policy checks with Bun and the repository dependencies installed.

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/verify-historical.mjs
```

Append one or more names for a smaller run.

| Check | Evidence it reproduces |
| --- | --- |
| `jev`, `jev-resume` | Both budget segments of the six-turn Jev-guided tutor holdout |
| `gemini`, `comparison` | The six Gemini Decision-guided tutor turns and the comparison with Jev |
| `frozen`, `perimeter` | The 15 identical-input decisions and separate literal `16.` diagnostic |
| `cue-paraphrases` | Both planning decisions on each of six authored learner cues |
| `policy-v2.1`, `policy-v2` | The repaired draft reviews and assessment-preference probes under both policy revisions |

The wrapper copies the original study programs and receipts into a temporary directory, installs the archived first-party sources there and runs each original `--verify` entrypoint. Workspace imports resolve to the private copies. Installed dependencies are reused. Fetch is disabled in each child. Success and failure both remove the temporary directory. [Verifier](../verify-historical.mjs)

The source manifest lists 24 compressed source files with checksums, including the historical planner, review gate, compiler inputs and tutor prompts. The diagnostic contract has a separate checksum. Gemini’s dispatch manifest pins that exact contract. Jev’s original scorer explicitly accepts its dispatch revision and the revision that added `nativePageRequested`. For the web runs the wrapper checks which gate and diagnostic module Bun actually loaded. The cue study similarly checks the loaded planner, its original transport and runner hashes, and both providers’ responses. [Source hashes and provenance](./source-manifest.json) · [Gemini manifest](../gemini-decision/manifest.json) · [Jev export check](../policy-holdout/score.mjs) · [Cue manifest](../cue-paraphrases/manifest.json)

The v2 check applies the recorded restoration patch inside the temporary tree. It verifies the patch and all five restored files. Both policy checks reproduce their published summaries byte for byte. [Policy patch](../policy-v2.1/restore-v2.patch) · [Original evidence](../policy-v2/evidence.json)

The integrity test damages disposable copies of active sources, the archive, an independent runner pin, spending evidence and a selected reply. It checks rejected execution modes, refuses a directory symlink at a writable source location, verifies that the originals retain their hashes, and checks scratch cleanup.

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/replay-source/verify-integrity.mjs
```
