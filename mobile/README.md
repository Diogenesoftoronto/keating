# Keating Mobile

Keating Mobile is the Expo and React Native client for Android-first tutoring. It keeps sessions and saved study notes on-device, stores provider keys in Android Keystore through Expo SecureStore, and calls the selected model provider directly.

## Run on Android

From the repository root:

```bash
devenv shell
devenv tasks run keating:install
devenv tasks run keating:mobile
```

`devenv tasks run keating:mobile` generates the native Android project when needed, builds the Keating development client, installs it on a connected device, starts Metro, and launches the app. Enable USB debugging and approve the computer on the phone before running it.

The devenv shell supplies JDK 17, Android API 36, Build Tools 36.0.0 plus Expo's 35.0.0 fallback, CMake 3.22.1, NDK 27.1.12297006, and platform tools. Android Studio and emulator images are intentionally omitted from the default environment because the primary workflow targets a physical arm64 device.

After the first native build, use `devenv tasks run keating:mobile-start` for JavaScript-only iterations. Run `devenv tasks run keating:mobile-prebuild-clean` before rebuilding after changing native dependencies or `app.json`.

For an emulator-hosted local model server, use `http://10.0.2.2:<port>/v1` as the custom provider URL because Android maps `10.0.2.2` to the development machine.

## Checks and builds

```bash
devenv tasks run keating:mobile-check
devenv tasks run keating:mobile-export
devenv tasks run keating:mobile-apk
```

`devenv tasks run keating:mobile-export` verifies Metro can produce the production Android bundle. For EAS, the `development` profile emits a development-client APK, `preview` emits an internal release APK, and `production` emits the Play Store AAB.

`devenv tasks run keating:mobile-apk` prebuilds the native Android project and produces a locally installable debug APK at `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

Expo SDK 56 currently generates a Gradle 9 wrapper while React Native 0.85's bundled Foojay resolver still targets Gradle 8. The APK task pins the generated, gitignored wrapper to Gradle 8.14.3 after every prebuild so clean builds remain reproducible.

For the downloadable app, `rtk bun run --cwd mobile android:apk:release` builds
`mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk` with
bundled JavaScript and no development server requirement. It requires a full
JDK 21 for LiteRT. The preparation script replaces Expo's default debug signing
for the release variant and derives an increasing Android versionCode from the
package version. The APK must then be aligned and signed before installation.

The [Native downloads workflow](../.github/workflows/native-downloads.yml)
performs those steps using four repository secrets:
`KEATING_ANDROID_KEYSTORE_BASE64`, `KEATING_ANDROID_KEYSTORE_PASSWORD`,
`KEATING_ANDROID_KEY_ALIAS`, and `KEATING_ANDROID_KEY_PASSWORD`. Keep the same
release keystore backed up and reuse it so future APKs can update existing
installations. The workflow never generates a throwaway signing identity.

Tag releases invoke that workflow before publication. To build missing native
installers for an existing release, select the reviewed source branch and run:

```bash
rtk gh workflow run native-downloads.yml --ref main -f release_tag=v3.15.0 -f platform=all -f publish=false
```

`platform` can also be `windows` or `android`. With `publish=false`, outputs stay
in Actions artifacts for review. `publish=true` attaches the verified files to
the existing release, refusing to overwrite existing assets or move tags. The
source version must match the requested release tag; the Actions run records
the source commit. Outputs are `Keating-<version>-windows-x64-setup.exe` and
`Keating-<version>-android-universal.apk`. Windows uses NSIS and verifies a
silent installation plus packaged native storage; Android verifies signing,
alignment, app identity, non-debuggability, bundled JavaScript, and all four
ABIs. Windows Authenticode signing and real-device/GUI acceptance are separate
from these checks.

After publishing, run `rtk bun web/scripts/refresh-download-release.ts` to
verify the public download URLs and refresh the web page's API-outage snapshot.
Include that snapshot in the next web deployment.

## Reused Keating logic

The native UI is purpose-built with React Native. It does not embed the web app. The adapter in `src/lib/keating-core.ts` reuses the web app's dependency-free pedagogy engine directly, so offline study plans, concept maps, quizzes, topic fallbacks, and domain-specific lesson phases stay aligned across both clients.

`src/lib/persona.ts` mirrors the web app's persona/protocol split: the editable teacher persona (John Keating by default) supplies the voice, and the fixed protocol in `src/lib/system-prompt.ts` supplies the pedagogy, so rewriting the persona in Settings can never remove the teaching loop.

## Streaming responses

Replies stream token by token. The web app streams through `@earendil-works/pi-ai`, which does not run under Metro, so `src/lib/provider-client.ts` implements SSE directly for the OpenAI-compatible, Anthropic, and Gemini wire formats and reads the response body with `expo/fetch` (React Native's built-in `fetch` exposes no readable stream). Deltas are buffered and committed to React state on a fixed cadence so the chat list is not re-rendered per token. Servers that ignore `stream: true` and answer with one JSON body still work through a whole-payload fallback. Stopping a response keeps whatever text already arrived.

## OpenUI interactions

Learner-facing questions, question groups, quizzes, goals, decks, study plans, notes, media references, and handoffs travel as canonical `keating-ui` documents shared with the web and terminal clients. `src/lib/system-prompt.ts` teaches that wire format, `src/lib/ui-document-wire.ts` validates and extracts streamed documents, and `src/components/UiDocumentRenderer.tsx` renders them with durable action journals. Incomplete or invalid payloads remain hidden instead of leaking transport data into the transcript.

Submitting an OpenUI interaction records the completed action, produces a clean learner-turn summary, and restores the completed state when the document is rendered again. `src/lib/interactive-tags.ts` remains only as an import compatibility parser for older transcripts; current prompts do not author that retired format.

## Storage and sync boundary

Mobile storage is intentionally local-only in this version. It does **not** join the desktop Electron P2P mesh, does not run Hypercore/Hyperbee/Hyperswarm, and does not sync sessions or library items across devices. The desktop P2P design keeps that stack in the Electron main process behind the `window.keatingP2P` bridge; Android would need a separate native or relay-backed design before it can faithfully participate as a peer.

## Privacy boundary

- API keys are stored only in Expo SecureStore.
- Sessions, learner feedback, and saved notes are stored in AsyncStorage.
- Requests go directly to the provider configured in Settings.
- Browser-only Keating code, desktop P2P code, and the Node-based deterministic core are not imported into Metro.
