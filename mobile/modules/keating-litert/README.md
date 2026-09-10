# Keating LiteRT native module

This local Expo module bundles LiteRT-LM 0.16.0 into Android/iOS builds. Model weights are downloaded separately from the pinned MiniCPM5 int4 URL in `src/lib/offline-model-contract.ts` (relative to the mobile project), checked with SHA-256, and retained in private storage excluded from device backups.

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
