# Gemini voice casting

This directory holds voice auditions for the Keating films. `voices.json` has
24 original English and French Canadian voice briefs. `generated/` contains
previously-created Gemini prompted voices, which are not compatible with fal's
TTS API. The fal renderer uses its 30 supported Gemini 3.8 preset voices and
style instructions instead. Run `node video/voice-casting/fal-audition.mjs` to
generate and audition those preset voices in English and French Canadian.

Run `node video/voice-casting/cartesia-audition.mjs` to fetch Cartesia's public
voice library and synthesize a smaller English / French Canadian comparison.
Cartesia's public API provides preset voices, cloning, accent localization, and
delivery controls; it does not expose prompt-to-new-voice design in the public
API. This audition compares its available voices and Sonic delivery controls.

The French profiles request contemporary Québécois French, including Montreal
and Quebec City accents, with an explicit direction to avoid caricature.
Fal Gemini presets are built-in voices, not persistent custom voice designs.
