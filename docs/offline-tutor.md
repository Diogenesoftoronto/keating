# Offline tutor distribution

Normal native apps bundle the inference runtime. The MiniCPM5 2B int4 weights are an optional 1,553,670,064-byte download (about 1.55 GB), retained in application data across updates. Users can pause, resume, or remove this download. Downloaded weights must pass the pinned SHA-256 check before they become selectable.

The desktop Settings → Providers & Models panel and onboarding expose the download. Once installed, **MiniCPM5 2B (Offline)** is available without provider credentials. An explicit model selection is preserved. Inference runs through a restricted native bridge, without a hosted inference endpoint.

MiniCPM5 is text-only. Images require a configured vision model. Audio requires an audio-capable model or a successful transcript of that exact recording included in the submitted text. Arbitrary text alongside a recording does not count as transcription. Unsupported attachments produce an actionable error before inference.

## Desktop builds

The normal Electron build packages the React web application and Nitro output. Its packaging hook stages a pinned LiteRT-LM 0.16.0 C runtime and a small process-isolated runner, verifies the SDK checksum, and probes the runner before packaging. No global LiteRT command is required on the user's computer.

From `desktop/`:

```sh
rtk bun run build:main
rtk bun run dist
```

For a separate installer containing the model:

```sh
rtk bun run build:main
rtk bun run dist:offline
```

The full offline edition includes the pinned weights at build time. It is intentionally a separate large download; ordinary installers do not include model weights. Build-time downloads require network access even though the resulting edition is intended for offline use.

Build on the target operating system and architecture with CMake and a C compiler. The runtime staging script lists the supported upstream targets and fails explicitly for unsupported targets or cross-compilation. A successful runtime probe establishes library loading, not successful model inference or installer operation on another device.

Linux also needs the Vulkan loader, including for CPU execution; DEB/RPM declare that dependency. See [native desktop details](../desktop/OFFLINE.md) for platform dependencies and the repeatable inference smoke check. Linux x64 model generation, history recall, cancellation/restart, and an unpacked full offline Electron build were verified locally. The runtime probe and model checksum also passed inside `desktop/release-offline/linux-unpacked/`. Installer installation and macOS/Windows execution remain separate checks.

## React Native mobile

The local Expo module in `mobile/modules/keating-litert/` links LiteRT-LM 0.16.0 into native builds. Android resolves the pinned Maven artifact; the iOS config plugin configures the pinned binary framework dependency during prebuild. Rebuild the native app after changing this module. Expo Go and mobile web previews do not contain the native runtime.

Android builds require JDK 21 because the LiteRT SDK ships Java 21 bytecode. Configure the build environment accordingly; the older Java 17 toolchain cannot compile this dependency. Android minimum API is 26. iOS compilation requires macOS/Xcode.

Offline Android inference requires a 64-bit process; 32-bit devices retain online models and are not offered an unusable download. See the [mobile module build notes](../mobile/modules/keating-litert/README.md) for the SDK adapter, compiler setup, and device checks.

Settings → Offline tutor provides download, pause/resume, and removal controls. Downloads use bounded HTTP ranges and keep progress on disk. Backgrounding the app pauses downloading; resume explicitly after returning. Model files stay outside disposable caches and are excluded from device backup. Storage is checked before downloading, and model removal waits until inference is stopped.

The native provider supports text responses; it cannot continue an online model's outstanding tool call. Start a new lesson or switch back to the online model in that case.

Local verification passed mobile TypeScript, focused lifecycle/provider tests, Metro Android export, Android/iOS prebuild, and Android debug APK assembly with JDK 21 and a clean native include environment. A debug APK uses the development client; this is compilation/packaging evidence, not a production release or proof of offline inference on a phone. iOS compilation and mobile device inference remain unverified.

## Browser

The browser uses `@huggingface/transformers` and `RASMUS/MiniCPM5-2B-ONNX`, rather than the native `.litertlm` artifact. Browser availability depends on the required WebGPU features. See [browser models](browser-models.md).

## Verification boundaries

Unit tests cover selection, native routing, download lifecycle, and unsupported input. A production web build verifies bundled application compilation. Native library probes, actual model generation, installer execution, and Android/iOS device tests are separate checks; passing one does not establish the others. Neither synthetic checks nor a successful generated answer establish teaching effectiveness.
