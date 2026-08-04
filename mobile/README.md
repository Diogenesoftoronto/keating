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

## Reused Keating logic

The native UI is purpose-built with React Native. It does not embed the web app. The adapter in `src/lib/keating-core.ts` reuses the web app's dependency-free pedagogy engine directly, so offline study plans, concept maps, quizzes, topic fallbacks, and domain-specific lesson phases stay aligned across both clients.

`src/lib/persona.ts` mirrors the web app's persona/protocol split: the editable teacher persona (John Keating by default) supplies the voice, and the fixed protocol in `src/lib/system-prompt.ts` supplies the pedagogy, so rewriting the persona in Settings can never remove the teaching loop.

## Streaming responses

Replies stream token by token. The web app streams through `@earendil-works/pi-ai`, which does not run under Metro, so `src/lib/provider-client.ts` implements SSE directly for the OpenAI-compatible, Anthropic, and Gemini wire formats and reads the response body with `expo/fetch` (React Native's built-in `fetch` exposes no readable stream). Deltas are buffered and committed to React state on a fixed cadence so the chat list is not re-rendered per token. Servers that ignore `stream: true` and answer with one JSON body still work through a whole-payload fallback. Stopping a response keeps whatever text already arrived.

## Interactive cards

Replies can carry `<keating-quiz />`, `<keating-question />`, and `<keating-goal />` tags in the same double-encoded JSON wire format the web tools emit. The web app produces them from browser tools; the mobile app has no tool loop, so the teaching protocol in `src/lib/system-prompt.ts` asks the model to emit them inline and `src/lib/interactive-tags.ts` parses them back out. Malformed payloads are dropped rather than shown as raw markup, and a tag still mid-stream stays hidden until its closing `/>` arrives.

Quizzes are graded locally by `src/lib/quiz-grading.ts` — exactly for multiple choice, true/false, and multi-blank fill-ins, and by a partial-credit heuristic for written answers, which the teacher then judges properly when the results are reported back as a learner turn. Submitting a card sends that report as a normal message, so the whole exchange stays in the transcript. Answers are also held in memory by `src/state/card-state.ts` so a completed card scrolled off screen comes back completed.

The web app's scene, image, animation, and flashcard deck cards are not ported yet.

## Storage and sync boundary

Mobile storage is intentionally local-only in this version. It does **not** join the desktop Electron P2P mesh, does not run Hypercore/Hyperbee/Hyperswarm, and does not sync sessions or library items across devices. The desktop P2P design keeps that stack in the Electron main process behind the `window.keatingP2P` bridge; Android would need a separate native or relay-backed design before it can faithfully participate as a peer.

## Privacy boundary

- API keys are stored only in Expo SecureStore.
- Sessions, learner feedback, and saved notes are stored in AsyncStorage.
- Requests go directly to the provider configured in Settings.
- Browser-only Keating code, desktop P2P code, and the Node-based deterministic core are not imported into Metro.
