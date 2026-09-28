# Keating LiteRT native module

This local Expo module bundles LiteRT-LM 0.16.0 into Android/iOS builds. MiniCPM5 int4 and Gemma 4 E4B weights are downloaded separately from their pinned URLs in `src/lib/offline-model-contract.ts` (relative to the mobile project), checked with SHA-256, and retained in private storage excluded from device backups.

Local judgements use CPU candidate likelihood scoring through the official C API. Each decimal candidate gets a fresh session with the same rendered prompt; the pinned runtime's log likelihood is converted to nonnegative NLL. This shares the verified model and exclusive inference lease with the offline tutor. Local judgement selection and hosted network consent are separate Settings controls. Calibration binds the complete model checksum and `litert-0.16.0-cpu-candidate-nll-v1` scorer identity.

Android's Java SDK does not expose scoring. The Gradle preparation task runs `mobile/scripts/prepare-litert-scoring.mjs` to download and checksum the pinned official C SDK, then builds a small JNI bridge for arm64-v8a and x86_64. It reuses the desktop SDK cache when available. Generated SDK files stay inside the ignored module `.generated/` directory. iOS compiles the same C++ scorer against the existing pinned C API XCFramework.

Android builds need a complete **JDK 21**, including `javac`; a Java 21 runtime alone is insufficient. Set `JAVA_HOME` to that JDK before building. The SDK adapter declares a Java 21 compiler toolchain and emits Java 17 bytecode for Android. Its separate Java-only Gradle project keeps the SDK's Kotlin 2.3 metadata off Expo's Kotlin 2.1 compile classpath. The dependency remains statically checked and is packaged transitively.

After changing native sources or the config plugin, run Expo prebuild again. From `mobile/`:

```sh
rtk bunx expo prebuild --platform android --no-install
```

Then, from `mobile/android/`:

```sh
rtk proxy ./gradlew :keating-litert:assembleDebug :app:assembleDebug --no-daemon
```

Android requires API 26 or later. Offline inference supports arm64-v8a and x86_64; 32-bit processes retain the online paths and show the offline option as unavailable. If Gradle does not discover the selected JDK, configure its `org.gradle.java.installations.paths` property to the local JDK path; do not commit a machine-specific path. Cross-compilation also needs a clean include environment: host `CPATH`, `C_INCLUDE_PATH`, `CPLUS_INCLUDE_PATH`, or `LIBRARY_PATH` entries must not inject desktop system headers into the Android NDK.

For iOS, the config plugin adds the local binary podspec, which pins the official XCFramework URL and checksum. Build with macOS/Xcode and CocoaPods; Expo Go cannot load this module. iOS source/prebuild checks on Linux do not establish Swift compilation or device operation.

Downloads commit bounded byte ranges to disk, pause when backgrounded, and resume from the existing file length. Corrupt or incomplete files remain unusable and can be removed from Settings. Native file creation is scoped to the model directory, including Android's no-backup storage; inference only accepts model files inside that directory. Generation events and cancellation use request IDs. Images, audio, and unsupported binary documents fail before model loading.

Native device checks still need to exercise an actual download, interrupted resume, offline generation, history, cancellation, and removal. The local deterministic tests cover those lifecycle boundaries with injected file/runtime implementations; they do not substitute for a device run.


Gemma 4 E4B uses the full 3.66 GB LiteRT bundle, including vision and audio encoders. MiniCPM5 remains the smaller text-only default and the independent local judgement model. The two downloads have separate files, SHA checks, resumable progress and removal controls; selecting Gemma never changes the judgement calibration identity.

The conservative Android profile targets the 2025 Pixel 10 (Tensor G5, 12 GB RAM): Gemma uses CPU with four threads, a 4,096 token context, 512 output tokens, disabled thinking and the pinned runtime's speculative decoding flag. The image budget is 280 visual tokens per image. GPU initialization alone is not proof that a driver can complete Gemma inference, so this profile does not guess GPU support or silently send requests to a hosted model. The iOS runtime keeps its GPU/CPU fallback but uses the same context/output/image budgets.

Gemma accepts images and WAV recordings through the attachment picker. Documents exposes WAV when Gemma is selected; the microphone's Dictation control continues to use configured online transcription and says so. Full lesson history is limited to two images, four media attachments and 16 MiB of media before hydration. Text input plus system instructions is bounded separately. Oversized lessons are rejected with recovery instructions rather than silently truncated. PDF, video, speech output and live voice are not implemented by this native offline path.

The download size is storage, not a guaranteed runtime memory measurement. Pixel execution and iOS native compilation still need real-device verification. Google publishes device-dependent memory results in the [Gemma LiteRT model card](https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm); its results do not validate Keating on every phone. Pixel specs: [Google Pixel 10](https://store.google.com/product/pixel_10_specs).
# Julia 1 local judgement on Android

Julia is a separate, non-generative decision model under Settings → Local
judgement, independent of the selected tutor. Its four pinned files (ONNX graph,
external FP32 weights, tokenizer and configuration) download only after an
explicit action, in bounded resumable ranges, and require exact sizes and SHA256
verification before use. The approximately 614 MB download is not a memory
estimate: tokenization and inference need additional working memory.

The native path uses `onnxruntime-react-native` and Maven ONNX Runtime **1.24.3**,
with the CPU provider, four intra-op threads, one inter-op thread, sequential
execution, no CPU arena, one decision per call, and a strict **1,024-token**
context / **256-token** question-and-option budget. There are 2–20 options,
each at most 48 tokens; oversized evidence, reserved `<mask>` markers and
lossy inputs are rejected. A shared pure JavaScript encoder restores the
official Metaspace splitting behavior and matches the publisher's Rust encoder.
Inference accepts all five native tensors and uses raw logits with stable
softmax; it does not use the upstream display-only rounding.

Julia and the larger LiteRT tutor share an exclusive inference lease. The
tutor is unloaded before Julia inference; Julia is unloaded before tutoring.
Backgrounding pauses downloads, unloads idle inference, and discards an in-flight
result. Cancellation prevents applying a result; it does not promise to
interrupt a native forward pass immediately. No hosted request occurs unless
hosted judgement is separately enabled.

Downloading/selecting Julia and installing calibration are separate actions.
Julia's calibration identity includes the artifact revision, native runtime,
encoder and context configuration, and its device store is separate from
MiniCPM's. Without independently measured matching thresholds, automatic grading
and recommendations abstain and grades remain pending. Existing MiniCPM
calibration cannot authorize Julia results.

Verification: Android arm64 native ONNX/JSI compilation passed against RN 0.85.3;
the resulting AAR contains both `libonnxruntime.so` and `libonnxruntimejsi.so`.
Shared encoding matched all 100 published parity cases plus 21 Unicode,
whitespace, structured-state and numeric cases against official Rust WASM.
Mobile type checking and 486 mobile tests passed. Pixel inference, memory,
latency and battery measurements are deferred; Julia is currently enabled on
native Android, not Expo Go, mobile web, or iOS.
