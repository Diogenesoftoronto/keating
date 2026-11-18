# Teaching Check v1.1.0

`frozen-checker.json.gz` preserves the 171 repository files identified by the v1.1 release. They comprise 166 source files including the checker, its inventory program, three suite inputs and the manifest. The gzip payload is a JSON map from repository-relative paths to exact UTF-8 contents. The compressed data has SHA-256 `91673f5bcabb680b397c742530d42b08b564172cf397f6f05ea47954517e4197`.

The first retained v1.1 manifest in the November 11 checkpoint sequence appears at ordinal 24, commit `4b575ae0df3d8260679b62aca44b134b01e3df6e`. Git records the author as **T3 Code** at 03:02:23 −05:00. Ordinal 23, commit `f4738dcdbff9143aea07cc4a0f0b82cc8f7a8f01`, still contains the v1.0 manifest. The subsequent source snapshot from **Diogenesoftoronto**, commit `2615c3348dfe790c6e985f1b808831282b59ff34`, retains the same v1.1 manifest. Its root lockfile and two package manifests had already changed.

The v1.1 manifest has SHA-256 `59da1fc04cc0509f43d0c5b44d3f9d3ae78addd0bb4736b42dedb9f1f7328459`. Every archive entry was extracted at ordinal 24 and independently matched to the manifest. The test checks the compressed digest, the complete entry allowlist, every source digest, the suite files in this checkout and the pinned Bun revision.

## Offline verification

Keating 4.2.0 also distributed this benchmark with a later manifest at commit `feb14a770371032619839271cfb3d1a4fe5079ff`. Its manifest SHA-256 is `8a5c194975d96ab62befd32960c399e9a1519844a71128bc325f83df30757359`. Six files differed from the first recording, including the inventory program, lockfile and manifest. `v4.2.0-delta.json.gz` contains their exact Git contents. Its SHA-256 is `3efe952422349a7cf8b53ca039621b9b07450be4f02271bd40679b7c0806d4ec`. The test checks all 171 files against each recording’s own manifest.

Run these commands from the repository root with the existing dependencies installed.

```sh
rtk bun test scripts/training/test_benchmark_bundle.test.ts
rtk proxy python3 -B scripts/training/benchmarks/teaching-v1/versions/1.1.0/smoke.py
rtk proxy python3 -B scripts/training/benchmarks/teaching-v1/versions/1.1.0/smoke.py --snapshot 4.2.0
```

The smoke test opens a temporary tree with the archived sources, validates the Bun revision, and copies the eight named package versions from the local installation. The original checker accepts a plain reply to the direct-answer contract. It also accepts a Question borrowed from the frozen suite history, compiles it and executes one action. It rejects an inert reply under that same Question contract. These three fixtures measure the checker’s behavior.

The original collector reports seven unresolved speech-provider imports when rebuilding from the declared 171 files. For example, the archived `web/src/keating/speech.ts` imports `./speech-providers/tavus-live` and `./speech-providers/openai-tts`. Adding `--inventory` to the smoke command reproduces the bundler diagnostic. The live `benchmark.py contracts` command still verifies its own checkout and refuses changed sources before issuing a score.
