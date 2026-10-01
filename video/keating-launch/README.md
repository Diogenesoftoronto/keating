# Keating 4.0 — launch video

A 69.5 s product launch video for Keating 4.0, built with [HyperFrames](https://hyperframes.heygen.com)
and regenerated end-to-end by one script:

```bash
./produce.sh              # everything, ending in renders/keating-4-launch.mp4
./produce.sh --no-render  # stop after the review snapshots
```

Install the launch project's audio dependency with `bun install` in this directory.
To rebuild the music and visuals with the existing narration, run `node scripts/music.mjs`,
then `node scripts/build.mjs` and `npm run check`.

Needs `node`, `ffmpeg`, `curl`, `codex` (image generation only on a cache miss), a fal key in
`skate` (`fal_api_key@secrets`) or `FAL_KEY` for Gemini 3.8 speech, and an OpenAI key in `skate`
(`openai-api@secrets`) or `OPENAI_API_KEY` for Whisper word timings. Keys are read at runtime and never written.
Rendering from the repo's devenv shell: `produce.sh` clears the Nix `LD_LIBRARY_PATH`/`ldd` for the
render step, otherwise HyperFrames' Chrome preflight falsely reports missing system libraries.

## What to edit

| To change… | Edit | Then |
|---|---|---|
| What the narrator says, pacing, which beats get captions | `narration.json` | `./produce.sh` (only changed lines are re-voiced) |
| Voice, delivery, pronunciation | `narration.json` → `tts` | `./produce.sh` |
| Music arrangement and mix | `scripts/music.mjs` | `node scripts/music.mjs`, then build and check |
| Current classroom footage and GPT Live screenshot | `assets/clips/classroom-current.mp4`, `assets/stills/feature-live-current.png` | Capture the current app, then build and check |
| Layout, motion, which words trigger what | `src/index.template.html` | `node scripts/build.mjs && npm run check` |
| Illustrations | `prompts/images/*.txt` | `scripts/gen-images.sh` |
| How the illustrations move (MiniMax H3) | `prompts/motion/*.json` | `node scripts/gen-motion.mjs` |
| Beat plan / intent | `STORYBOARD.md`, `BRIEF.md` | — |

`index.html` is **generated**; don't edit it by hand.

The current chat and GPT Live captures use illustrative transcripts in the real current UI.
The account sign-in callback returned HTTP 401, so these shots do not claim successful model
inference. Capture details are recorded in `scripts/current-ui-capture.json`; the repeatable
Playwriter driver is `scripts/capture-current-ui.js`.

## Pipeline

1. **`scripts/stage-assets.sh`**: copies KeatingBot stop-motion atlases, brand art and product stills
   from the repo, re-times the product screen recordings into short clips, and fetches the site fonts
   (Space Mono, JetBrains Mono, Roboto) as local woff2.
2. **`scripts/gen-images.sh`**: generates the two illustrations (hook, close) with `codex exec`, cached
   by prompt hash in `assets/gen/`.
3. **`scripts/voice.mjs`**:
   - Voices each line with fal's `google/gemini-3.8-flash-tts` endpoint. `narration.json` selects one
     of fal's 30 built-in voices plus delivery instructions; the cache key includes engine, model,
     voice and instructions. Each generated take is checked against the script and silence is trimmed.
   - Gets word timestamps from OpenAI Whisper and aligns them back onto the script's own spelling.
   - Sizes each scene as `max(min, lead + voice + tail)` and writes `build/timing.json`.
   - Retains the legacy pad mix in `assets/audio/mix.wav`; the composition uses the separate
     narration and instrumental tracks produced by the next step.
   - **`scripts/music.mjs`** reuses the frozen Lyria instrumental from `../spotlights/music/judgements.mp3`.
     A pitch-preserving slowdown fits its musical arc to the film. Narration is mastered to −16 LUFS,
     music to −18 LUFS with a lower playback gain and short entrance/exit fades. HyperFrames' dynamic
     voiceover carve reduces masking during speech. Provenance and effect attributes live in `assets/audio/`.
4. **`scripts/gen-motion.mjs`**: animates the hook and close stills with MiniMax H3 (image-to-video,
   the still as the first frame, one clip as long as its scene, 2K, then re-encoded to 1080p30). It
   is cached by a hash of the prompt, the still and the length, and the key comes from `skate`
   (`minimax@secrets`) or `MINIMAX_API_KEY`. With no key, or a plan without H3, it logs and the video
   keeps the stills.
5. **`scripts/build.mjs`**: fills the template from `timing.json`.
   - Each illustration is its H3 clip when one exists (a root-level video under the scenes), and the
     still otherwise.
   - Scene windows come from the timing.
   - Captions are built from the word timings.
   - The GPT Live waveform uses the narration's own RMS envelope.
   - The fonts are inlined.
   - Any placeholder left unfilled is an error.
6. **`npm run check`**, then snapshots at ~70 % through each scene, then **render** (1920×1080, 30 fps).

## Look

The video uses Keating's own visual language:
- Paper `#f1ece0`, ink `#1c211b` and green `#1e9b50`, plus the CRT terminal palette for the dark beats.
- Hard offset shadows and `[BRACKET]` labels.
- Space Mono headlines over JetBrains Mono body text.

Two WebGL layers sit under and over the scenes (`#fx-bg`, `#fx-over`). Both are pure functions of
timeline time, driven by one GSAP tween, so scrubbing and rendering match:
- **Ground**: a slowly drifting domain-warped noise field (paper, or the terminal's phosphor field),
  stirred briefly on each cut. When the ground flips between paper and terminal it burns through
  with a glowing phosphor edge; that burn is the reveal transition.
- **Overlay**: light sweeps on key beats, the glitch into *stuck* and *live* (with a chromatic split
  on the scene itself), a flash at the turn, and a rolling scan band, grain and vignette on terminal
  scenes.

Without WebGL, `#root` gets `no-gl` and the plain CSS grounds come back.

KeatingBot uses the real stop-motion atlases. Its frame cadences and idle sway mirror
`web/src/components/keating-bot.css`: waving, thinking, speaking, listening, understanding, success and idle.
