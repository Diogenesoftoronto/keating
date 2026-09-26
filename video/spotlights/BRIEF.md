# Keating 4.0 spotlights — brief

Four short films (~35–50 s), one per 4.0 feature, built with the **same engine and look as
`video/keating-launch`** (read its STORYBOARD.md, AGENTS.md, `src/index.template.html`, `scripts/*`).
The previous spotlights were a generic slideshow of small screenshots and viewers could not tell what
was going on. These fix that and each film uses a **different format**.

## What makes them readable

- **One idea on screen at a time.** Each scene has a kinetic headline (Space Mono / Roboto 900, ≤ 5 words)
  that names what we are looking at, plus at most one product card.
- **Product cards are big.** The shots in `assets/shots/` are tight UI crops of varying aspect
  (e.g. 1875×506, 780×680). Show each one at a legible size: at least ~55 % of frame width, or height-fitted,
  upscaled if needed (they are crisp). Paper card, 2 px ink border, hard green offset shadow, `[BRACKET]` label.
  After it lands, push in (≈1.15–1.35×) on the element that matters and draw a green highlighter ring or
  underline on it — the narration names that element.
- **Illustrations carry the story.** `assets/art/*.png` are 1536×1024 sunburst poster illustrations in
  Keating's palette (paper #f1ece0, ink #1c211b, green #1e9b50, coral accent). Show them full-bleed or large
  with slow Ken Burns (push/pan), subtle parallax (e.g. a duplicated, masked foreground layer drifting
  faster), print grain, and a slow ray rotation from the launch film's shader ground blended over the sky.
- **Motion clips.** `video/spotlights/motion/<art>.mp4` are 5 s, 1080p30, silent image-to-video animations of
  each storyboard still (fal MiniMax H3 Max or ByteDance Seedance 2.5 via `gen-video.mjs`; some run 6 s; paid,
  $20 total budget tracked in `motion/ledger.json` — never regenerate them from a build, never use `motion/rejected/`). Stage them next to the stills and prefer the clip
  over the still, like the launch film's `art()` helper does; the still stays as the fallback and as the
  hold frame when a scene runs longer than 5 s (freeze on the last frame or slow the clip, never loop it).
- Captions: the launch film's ink pill with the active word in green, ≤ 6 words per group, every scene.
- Audio: Gemini 3.8 Flash TTS (`gemini-3.8-flash-tts`) per line with whisper word timings, −16 LUFS — but the bed is the film's
  Lyria 3.5 track `music/<id>.mp3` (~60 s instrumental, made by `gen-music.mjs`; paid, never regenerate from a build)
  instead of the synthetic pad: trim to the film length, 0.3 s fade-in, 1.5 s fade-out on the logo, sidechain-duck it
  under the voice (bed around −24 LUFS under speech, up to about −18 between lines). Fall back to the pad when missing.
- Each film ends on the Keating logo lockup + `keating.help` (~1.5 s), with the film label
  (`narration.json` → `label`) as a small `[BRACKET]` tag throughout.
- Use KeatingBot atlases (`assets/bot/*.avif`, 4×2 frames) where the film calls for Keating's presence.

## Formats

**judgements — explainer.** A left rail with big numerals 1 · 2 · 3 that fill green as the steps land and stay
as a tracker. hook: referee illustration, headline "WHO CHECKS THE CHECKER?". step1: writing → sealed red
envelope stills, then the `answer` card with "Your response" highlighted. step2: scale illustration — the pans
tip until balanced — then the `checking` card. step3: `released` card, highlight "flag a missed problem".
practice: `queue` flashcard card and a big count-up to **288**. close: `exam` card then logo.

**recall — short story.** Picture-book pacing. night / weeks / blank are full-bleed illustrations with chapter
cards ("TUESDAY NIGHT", "3 WEEKS LATER", "EXAM DAY") in the corner. weeks: loose calendar pages fly off
(animate duplicated crops or SVG sheets). thread: the notebook illustration, then a glowing green SVG thread
draws from the notebook to the `panel` card (the recalled passage + its source). device: `settings` card
(highlight the recall toggle / 36 MB), then `phone` card. close: `library` + `profile` side by side, "Your past
work, working for you." then logo.

**live — conversation.** Audio leads the picture. Scenes `ask` and `answer` are different voices
(`voice` field in narration.json: learner = marin, Keating = cedar). Draw each speaker's waveform live from the
RMS envelope of its line (learner in ink, Keating in green) over/inside the CRT of `live-2-waves`, with
speech-bubble transcript lines typing in as they are said. Bot head-listening during ask, head-speaking during
answer. open: `live-1-talk` illustration then `picker` card, highlight "GPT Realtime 2.1". context: `surface`
card with the transcript highlighted. ceiling: meter illustration with an SVG needle animating up toward the
red limit, then stopping and falling as "stops the microphone at once" is said. close: `gemini` card then logo.

**onboarding — kinetic poster.** Brisk: hard cuts and whip-pans, giant words that fill the frame
("HELLO." / "OPTIONAL." / "ASK · STUCK · ANALOGIES" / "PLAIN · CAPTIONS · EASIER TYPE · LESS MOTION" /
"PURSUITS" / "YOUR TEACHER"), timed to the word timings. Poster stills slam in with scale overshoot; product
cards (`welcome`, `teach`, `access`, `pursuit`, `persona`, `tour`) pop in as stamped cards with a slight tilt
that settles. End with body-waving bot + "Show me around" before the logo.

## Layout

```
video/spotlights/
  shared/scripts/voice.mjs      # launch voice.mjs, parameterised by film dir; per-scene `voice`/`instructions`
                                # override (part of the cache hash); passes `art`/`shots`/`role` into timing.json
  shared/scripts/build.mjs      # generic: template + build/timing.json -> index.html; captions for every scene;
                                # RMS envelope for every scene (data.env[id]); {{start:id}} {{dur:id}} {{total}}
                                # {{label}} {{fonts}} {{captions}} placeholders
  shared/scripts/stage-assets.sh  # fonts/bot/brand from ../keating-launch/assets, art from ../storyboard,
                                # shots from .keating/outputs/video/spotlight-<id>/public/shots (if missing, run
                                # `node video/shared/capture.mjs video/spotlight-<id>/shots.json <dir>` from repo root)
  <id>/narration.json           # given — do not change the lines
  <id>/src/index.template.html  # unique per film
  <id>/produce.sh, package.json, hyperframes.json, meta.json   # like keating-launch, output
                                # renders/keating-spotlight-<id>.mp4 (1920×1080, 30 fps)
```

Do not modify anything under `video/keating-launch`. Never print or write API keys; read them from the
environment or `skate get openai-api@secrets` at runtime. Built/rendered artefacts (assets/, audio/cache,
build/, index.html, renders/, snapshots/) should be gitignored like the launch project does.
