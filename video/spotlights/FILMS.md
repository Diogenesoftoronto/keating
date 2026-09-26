# Keating films beyond the spotlights — brief

Three more films on the spotlight engine (`shared/scripts/*`, read `BRIEF.md` first and follow it wherever this
file does not say otherwise). Each is a **different kind of video** from the four spotlights, so do not reuse their
layouts: no product cards, no numbered rails, no chapter tags. The look (paper, ink, green, coral, print grain,
Space Mono / Roboto 900, the launch film's ray shader) stays.

`<id>/narration.json` is given; do not change its lines. New fields:

- `output`: the render name — `renders/<output>.mp4` instead of `keating-spotlight-<id>.mp4`.
- `size`: `[width, height]` of the composition. The spotlights are 1920×1080; `lesson` is 1080×1920 and
  `changelog` 1080×1080.
- `title` (manifesto): the on-screen title card for that scene.
- `role` (lesson): `keating` or `learner`; `voice`/`instructions` override the voice for that line (already supported).
- `voice: false` (changelog): no narration at all — see below.

Shared-script changes must keep the four spotlights building byte-for-byte the same (defaults unchanged); do not
re-render them. `build/timing.json` for `manifesto` and `lesson` already exists and the TTS cache is warm; you have
no OpenAI key in the sandbox, so never delete `audio/cache` or `build/timing.json`, and if `voice.mjs` needs
changing, make sure the cache still hits. Music beds are `music/<id>.mp3` (Lyria, paid — never regenerate).
Motion clips are `motion/<name>.mp4` (paid — never regenerate, never use `motion/rejected/` or `motion/raw/`).

## manifesto — cinematic brand film (1920×1080, ~50 s)

No UI at all. Six full-bleed illustrations `m-1-screens … m-6-flight`, each playing its motion clip (clips are
5–8 s; slow them to fill the scene, then hold the last frame — never loop), with a slow Ken Burns on top and the
ray shader very faint. Cross-dissolve between scenes (≈0.8 s), no hard cuts. The mood goes from muted to bright:
grade scene 1 slightly desaturated and dark, lift to full colour by scene 3.

Each scene's `title` is set big (Roboto 900, ≈140 px, ink on a paper strip with the hard green offset shadow,
like the launch headlines) and arrives once the voice starts that line — letter-by-letter or a mask wipe, calm, not
bouncy. Titles sit lower-left over the picture; move them where the art is quiet. Captions are the small ink pill
at the bottom, as in the spotlights. The music leads here: the bed can sit higher than in the spotlights between
lines (≈ −17 LUFS) and swells into the close. Close: "KEATING" title over the birds, then the logo lockup +
`keating.help` for ≈2 s while the last chord rings.

## lesson — vertical micro-lesson (1080×1920, ~40 s)

A tiny Socratic lesson told as a conversation. Layout, top to bottom:

- `[KEATING // ONE-MINUTE LESSON]` tag, then the topic line "WHY IS WINTER COLD?" (Roboto 900) that stays all film.
- An illustration panel 1080×1200 (full width). Clips `l-1-winter` and `l-4-beam` are already cropped to exactly
  1080×1200. `l-2-globe` and `l-3-orbit` have **no clip**: use the 1024×1536 still, `object-fit: cover`,
  `object-position: center 30%`, and animate it in HTML — for the globe, a slow push-in plus a soft light sweep
  from one side (a radial gradient `mix-blend-mode: screen`) that makes the tilt obvious; for the orbit, a slow
  rotation of the ray layer and a small green dot travelling round the dashed orbit. The `close` scene has no art:
  keep the beam panel and dim it, or use the KeatingBot.
- Below the panel, a chat thread: each line appears as a speech bubble as it is spoken (typing on with the word
  timings). Keating's bubbles are on the left, paper with the green offset shadow and a small KeatingBot head
  (head-speaking while talking, head-listening while the learner talks); the learner's are on the right, ink with
  paper text. Keep only the last two bubbles; older ones slide up and out. These bubbles are the captions — no
  separate caption pill.
- A small live waveform under the active bubble from that line's RMS envelope (green for Keating, ink for learner).
- When the learner says "spreads out thinner", highlight those words in green in the bubble and pulse the beam panel.
- Close: bubble "You worked that out — I only asked." stays, then the logo lockup + `keating.help` for ≈1.5 s.

## changelog — kinetic typography (1080×1080, ~25 s)

No voice, no illustrations, no screenshots: type and the music. Skip `voice.mjs` (or give it a `voice: false` path)
and write `build/timing.json` yourself from the music: detect the beat of `music/changelog.mp3` (it asks for
118 BPM; measure it — onset envelope from ffmpeg, then the best-fitting constant tempo and phase) and give each scene
`beats` × beat length, starting on the first strong downbeat. Trim the track to the film, 1.2 s fade-out on the logo,
master to −14 LUFS, true peak ≤ −1 dBTP (social loudness; this film has no speech).

Each card: `big` fills the frame (Roboto 900, as large as fits, tight tracking), `small` in Space Mono under it.
Hard cuts on the beat, alternating treatments so it never repeats twice in a row: ink-on-paper, paper-on-green,
green-on-ink; slam-in with overshoot, mask wipe, per-letter stagger, split-flap flip for the numbers. Scenes with
`count` count up to the number. Small `[KEATING // 4.0]` tag in a corner throughout. A thin progress bar along the
bottom edge. Close: the logo lockup + `keating.help`.

## Delivery

Each film gets `src/index.template.html`, `produce.sh` (renders to `renders/<output>.mp4`), `package.json`,
`hyperframes.json`, `meta.json`, `.gitignore`, like the spotlights. Run `npm run check` (zero findings), look at the
snapshot contact sheet, fix what reads badly, then render. Extend `publish.sh` so it can publish these by id too
(`web/public/tapes/<output>.mp4`, poster, captions only where there is narration).
