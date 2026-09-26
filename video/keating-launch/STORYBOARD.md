# Storyboard — Keating 4.0 launch (~73 s)

Scene durations are **derived from the voiced narration** (`build/timing.json`): each scene
lasts `max(min, lead + voice + tail)`. Times below are the planned targets; the render uses
the measured ones. Narration lines live in `narration.json`.

Spine: **problem → turn → promise → proof (show, don't claim) → what's new in 4 → everywhere → invitation.**

| # | id | ~t | Narration | Picture | Bot | Transition in |
|---|----|----|-----------|---------|-----|---------------|
| 1 | `hook` | 0–6 | "Seen this before? You asked to learn — and you got more to read." | Dark terminal field. Three chat-answer cards (ChatGPT / Claude / Gemini, landing copy: recursion, photosynthesis, probability) slam in and keep stacking, text scrolling upward faster and faster. Headline "Seen this before?" in Roboto 900, then "You asked to learn. / You got more to read." with red underline rule. Codex illustration (learner buried in scrolls) fades in behind at 25 % as texture. | — | cold open |
| 2 | `stuck` | 6–9 | "And it's still not clicking." | Wall freezes; everything desaturates; a mono caption `…still not clicking.` types out; cursor blinks. Cards drop out of frame. | — | hard cut on "And", glitch + chromatic split |
| 3 | `reveal` | 9–12.5 | "So we made Keating." | Cut to paper. KeatingBot (body, **waving**, 4 s cadence) pops up from the bottom with a squash; Space Mono lowercase "so we made keating" letter-steps in beside him. | waving | phosphor burn to paper + flash |
| 4 | `promise` | 12.5–19 | "You do the thinking. Keating helps it click — a teacher that starts with your goals, and builds on what you already know." | Split: left big type "You do the thinking." (ink) then "Keating helps it click." (green). Right: bot switches to **thinking** cadence. Sub line in JetBrains Mono appears on "a teacher that…". | thinking | push left |
| 5 | `socratic` | 19–24 | "Ask it anything, and it asks you something back." | Real footage `web-classroom.mp4` (question → Keating reasoning → it asks the learner back) in a 1500×844 card with hard green shadow; bracket label `[CLASSROOM]`. Small head-bot **speaking** in corner. | head speaking | card rises |
| 6 | `quiz` | 24–29.5 | "Not another wall of text. A question you can actually answer." | Rebuilt landing "Try it yourself" quiz card: `sum(n)` code block, question "What does the base case return?", options A 0 / B 1 / C 3. Selection moves to A, card flashes green ✓ "sum(0) returns 0". | body **success** one-shot on ✓ | card flip |
| 7 | `own` | 29.5–35.5 | "Choose your model. Shape your teacher. Take your data with you. It's open source." | Three stacked tiles cascade on each phrase: model picker still (`feature-models.jpg`), a Teacher Persona card (live HTML: "Persona: John Keating — editable"), an export chip `learner.json ↓`. Last beat: `[OPEN SOURCE]` stamp. | — | stagger |
| 8 | `live` | 35.5–40.5 | "New in Keating 4: talk it through out loud, with GPT Live." | `KEATING 4.0` badge slides in. `feature-live.jpg` in CRT panel; bot head **listening** → **speaking**, audio waveform bars pulse to narration. | head listening→speaking | badge wipe |
| 9 | `memory` | 40.5–46.5 | "Local recall brings back what you said before, on your own device — so reviews and courses pick up where you left off." | Left: device outline with "recall" quote chips floating in (exact earlier learner excerpts, e.g. *"I think recursion is a loop that calls itself"*). Right: `feature-coming-up.jpg` → `feature-courses.jpg` crossfade. | body **understanding** | slide |
| 10 | `judge` | 46.5–51.5 | "Independent reviews propose what could change. You decide what sticks." | Proposal card "Review suggests: slow down on base cases" with two buttons `[ACCEPT]` `[DISMISS]`; a cursor (you) clicks ACCEPT; stamp "you decide". | — | card drop |
| 11 | `anywhere` | 51.5–56 | "In your browser — or right in your terminal." | Large web card (`[WEB]`) + two stacked terminal cards (`[TUI]` collaborative host, `[CLI]` plan/map/verify), real footage. | — | slide |
| 12 | `close` | 56–64 | "Done offloading? Ready to think for yourself? Start at keating.help." | **A:** Codex illustration (learner on a summit of books, bot beside) as hero with slow push-out; "Done offloading?" then "Ready to think / for yourself?". **B** (on "Start"): paper end card wipes up — bot waves ~2 s then idle cadence + sway; logo lockup, `keating.help`, `Keating 4.0 · open source`. | waving → idle | paper wipe |

Captions: bottom ink pill, JetBrains Mono 34 px, phrase groups of ≤ 6 words, active word in phosphor green, driven by whisper word timings. Shown only from `socratic` to `anywhere` (`captions: true` in `narration.json`); the opening and closing beats carry the line as on-screen type instead.

Shaders: a WebGL ground (drifting noise paper / phosphor field, stirred on every cut, burning through with a green edge wherever paper and terminal meet) and an overlay (light sweeps on the reveal, "actually", "open", the Live badge, "sticks." and "Start"; glitches into *stuck* and *live*; CRT scan band, grain and vignette on terminal scenes).

Audio: narration (gpt-audio-1.5 voice *cedar*, verbatim-checked, one file per scene, cached by content hash) + a synthesized soft pad bed (A-minor-ish drone, ffmpeg sine stack, 0.18 gain, sidechain-ducked under voice), loudness-normalised to −16 LUFS in the final mux.
