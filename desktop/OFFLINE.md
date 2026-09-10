# Native offline tutor

The existing bundled React UI consumes `window.keatingOffline`. Types are in
`src/offline-contract.ts`. Status includes `available`, `installed`, `downloading`,
`bundled`, `generating`, `downloadedBytes`, `totalBytes`, and optional `error`.
Download resolves only after verification/installation; cancellation rejects that
download and retains its partial file. Poll status for progress. Generation returns
answer text; cancellation rejects generation. The model accepts text only.

`generate({prompt,maxTokens?,temperature?})` accepts plain text or the coordinator's
JSON envelope `{system:string,conversation:Array<{role:'user'|'assistant',content:string}>}`.
The last turn must be user. System and history are passed to separate native
conversation settings, not inserted as an opaque JSON user message. Inputs are
limited to 24 KB; output limits are integers 1–4096, temperature 0–2. Temperature
zero uses the CPU-supported TopP sampler with top-k=1. ThinkingConfig is disabled
for direct answers with this int4 model. Each request initializes an isolated CPU
engine; killing that process cancels initialization or generation and releases RAM.

The standard installer bundles official LiteRT-LM 0.16.0 C API libraries and a
small compiled helper. No global CLI, Python, model account, or npm native binding
is needed. The 1,553,670,064-byte model is an optional SHA-256-verified download
under Electron userData/offline-tutor, preserved across application updates.
HTTP ranges resume partial downloads; ignored ranges restart cleanly. A model is
never activated before checking its full SHA-256. The model URL is pinned to HF
commit `02e8a867ae318e633f2372ac81fc78dc4d8448e7` and hash
`9858563beafbc6d5e0d25fcee3827541515296a9302ed3d088b16a58d4fbe7b8`.

Run the existing main/web build, then `bun run dist` for the normal installer or
`bun run dist:offline --linux AppImage deb rpm` for the full offline edition.
The latter uses `release-offline/` and distinct artifact names. Both invoke a
beforePack hook that stages/probes the runtime and fails on missing artifacts or
native dependencies. `bun run stage:offline` also stages the development runtime.
The full edition includes verified model weights and its model card; it executes
weights in place without copying them into userData. `bundled:true` explains why
remove rejects: install the standard edition to reclaim bundled-weight storage.
Downloaded weights are removable while inference is idle.

Build requirements: CMake >=3.20 and a native C compiler on a matching runner.
Verified archive targets: Linux x64/arm64, macOS arm64, Windows x64. macOS Intel,
Windows arm64, universal and cross-platform builds fail explicitly. Windows uses
the static compiler runtime; the official DLL imports Windows system libraries.
macOS uses system frameworks and ships the SDK's advertised install-name filename
`liblitert-lm.so` despite its source `.dylib` extension. Linux needs the Vulkan loader
even for CPU inference; DEB/RPM declare it. AppImage users also need that loader.
The SDK requires glibc >=2.27; the final helper's minimum follows the compiler
runner (the local Fedora smoke binary requires glibc 2.34). Build release helpers
on the oldest supported distribution. SDK license notices are bundled.

Local evidence: official SDK archive SHA-256 checked, Linux x64 build/probe passed,
actual MiniCPM arithmetic and multi-turn name recall passed, cancellation followed
by generation passed, full offline resources staged. The first arithmetic turn
took 14.67 seconds including engine initialization. Twelve lifecycle/contract tests
and fifteen existing native runtime tests passed; desktop TypeScript passed.
macOS/Windows execution, signed installer installation, and packaged Electron UI
interaction have not been verified here. Staging is not an installer release.

Reproduce after compiling desktop sources and staging the helper:
`node desktop/scripts/smoke-offline.mjs /absolute/path/to/MiniCPM5-2B_int4.litertlm`
(run from repository root).

Sources: https://github.com/google-ai-edge/LiteRT-LM/releases/tag/v0.16.0
and https://huggingface.co/mlboydaisuke/MiniCPM5-2B-LiteRT.
