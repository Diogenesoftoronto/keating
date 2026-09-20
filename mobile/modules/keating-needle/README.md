# Keating Needle native embeddings

This Expo module binds the published Needle C API directly. It does not use
LiteRT, Python or a guessed mobile SDK. The source of truth is `assets.json`:
immutable Hugging Face revision, platform static-library hashes, header hash,
and model-weight hash. `modelIdentity` includes all of those identities and is
not an assertion about the installed Python package version.

The only model is the pinned `needle3.cact` archive. The JavaScript application
installs it separately into the module's private no-backup directory. Native
inference checks its path, size and SHA-256 and supplies those exact verified
bytes to `needle_load`. A successful hash check on an earlier file is not used
as a substitute. Text batches are limited to 16 items, 4096 UTF-8 bytes per item,
16384 bytes total; output dimensions must be 1–4096 with finite vector values.

The engine is process-global and not thread safe. One native worker and a C++
mutex serialize calls. Concurrent embedding/verification requests are rejected
before queuing. Module destruction prevents late results from being delivered.
Loaded model bytes remain alive until process exit.
There is no native cancel or unload function: callers may discard a stale
result but must not promise interruption or immediate model-memory release.
The wrapper does not call external tools or expose Needle's tool execution.

## Build preparation

From the repository root:

```sh
rtk node mobile/scripts/prepare-needle.mjs --platform android-arm64
rtk node mobile/scripts/prepare-needle.mjs --platform android-arm64 --check
```

Android's Gradle task runs the same checksum verification before CMake. The
existing Android SDK/NDK and CMake toolchain are required. ARM64 links the real
published library. Other Android ABIs build a stub and report `supported=false`.
The module does not change the application's ABI filters.

On macOS with Xcode, CocoaPods evaluation runs:

```sh
rtk node mobile/scripts/prepare-needle.mjs --ios-xcframework
```

That verifies the device and ARM64 simulator libraries, then assembles a local
XCFramework. A tiny inert x86_64 simulator slice lets Intel simulators build the
module while reporting it unavailable; it never attempts inference. Model
weights are not bundled. Generated SDK artifacts live in ignored `.generated/`.
Keep the pinned metadata and preparation script in source, not the binaries.

The script verifies cached libraries and headers too. Cached XCFrameworks are
checked against the pinned device library, the extracted ARM64 simulator
library, and both packaged headers; metadata alone is not trusted. Corrupt downloads are
never promoted. Model verification and embedding errors contain no learner
text. `needle_last_error` exists upstream, but its unrestricted diagnostic text
is deliberately not exposed across the application bridge.

Deterministic JS/native-boundary tests do not establish Android packaging,
Swift compilation, mobile linking or device inference. Those remain separate
checks on the supported toolchains and devices.
