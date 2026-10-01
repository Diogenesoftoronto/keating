# Keating 4.0 — launch film brief

- **Goal**: announce Keating 4.0 and restate the product thesis — *you do the thinking, Keating helps it click*.
- **Audience**: curious self-learners and developers who've felt "AI answers" become more reading, not more understanding.
- **Format**: 1920×1080, 30 fps, ~70 s, narrated (Gemini/fal, warm teacher delivery), burned-in word-timed captions, warm instrumental felt piano, plucked strings and light percussion beneath the voice.
- **Call to action**: `keating.help` — start a session in the browser or download the app.
- **Tone**: calm, wry, anti-hype. Mirrors the landing page copy. No invented stats; 4.0 features are described as capabilities, never outcomes (release notes: benchmarks ≠ human learning effectiveness).
- **Look**: Keating's own system, not a generic SaaS preset —
  - paper `#F1ECE0`, paper-deep `#E9E2D2`, card `#F6F2E8`, ink `#1C211B`, ink-soft `#4A5247`, green `#1E9B50` / `#14743C`, wash `#DDEBDD`, terminal `#0C1510`, phosphor `#4BE388`, red rule `#D5604B`.
  - Space Mono (display, tight tracking, lowercase headlines like "so we made keating"), JetBrains Mono (body/labels), Roboto 900 for the loud hook words.
  - 1.5–4 px ink borders, hard offset shadows (no blur), CRT panels with scanlines, bracketed nav labels `[LIKE THIS]`.
- **Mascot**: KeatingBot stop-motion atlases from `web/public/brand/stop-motion-v1/` (8 frames, 4×2). Frame stepping reproduces the app's CSS cadences (idle / waving / thinking / speaking / listening / understanding / success) via GSAP `set` calls — seek-safe, no CSS animation.
- **Imagery**: real product footage/stills from `video/keating-surface-tour/assets/`; two Codex-generated risograph illustrations in the style of `web/public/posters/` (textless; all type is live HTML).
- **Constraints**: deterministic, reproducible from `./produce.sh`; the OpenAI key is read at runtime from `skate get openai-api@secrets` and never written to disk.
