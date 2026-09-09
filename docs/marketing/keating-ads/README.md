# Keating — five ad storyboard packages

Five distinct, problem-first concepts for **20-second vertical 9:16 ads**. Each starts by recognizing a learner's frustration, then introduces Keating. These are image-and-prompt packages for a later video generator; **no videos have been generated**.

| Concept | Learner problem | Image | Paste-ready video prompt |
| --- | --- | --- | --- |
| You asked to learn | An explanation can be accurate and still leave a learner alone with a wall of text. | [Storyboard](01-information-overload/storyboard.png) | [Prompt](01-information-overload/prompt.md) |
| A curiosity needs a path | Knowing what you want to learn does not mean knowing how to organize the journey. | [Storyboard](02-direct-your-learning/storyboard.png) | [Prompt](02-direct-your-learning/prompt.md) |
| You already explained that | Rebuilding learning context at every session consumes energy that could go toward learning. | [Storyboard](03-keep-the-thread/storyboard.png) | [Prompt](03-keep-the-thread/prompt.md) |
| More than a transcript | A useful personal learning conversation is not automatically something another person can follow. | [Storyboard](04-share-what-you-learned/storyboard.png) | [Prompt](04-share-what-you-learned/prompt.md) |
| A place for the question | Studying alone can leave a learner without somewhere to bring a half-formed question. | [Storyboard](05-learn-together/storyboard.png) | [Prompt](05-learn-together/prompt.md) |

## Use a package

1. Choose one concept and upload its `storyboard.png` to your video generator's storyboard/reference-image input.
2. Paste the complete contents of that folder's `prompt.md`. It is standalone: the attached storyboard supplies the visual identity; no other reference image is required.
3. Set 20 seconds, 1080×1920 (9:16), 24 fps, if the tool provides those controls. The prompt has six exact shot ranges totaling 20 seconds, on-screen copy, voiceover, movement, transitions, sound, and safe areas.
4. Treat the six-panel sheet as a sequence guide. Read left-to-right, top-to-bottom. Never animate the whole sheet as the video. Sheet panels are composition references and are **not pixel-exact 9:16 frames**; recompose each shot to vertical video without stretching or clipping copy.
5. If the tool accepts only a start frame, crop/reframe panel 1; for an end frame use panel 6. Do not put the full sheet into a start/end-frame slot. If the tool supports only short clips, generate each specified shot separately and assemble in order.

The written prompt is authoritative for text, timing and product behavior. Keep the first two shots unbranded, with Keating introduced in shot 3. Generated interface scenes are illustrative compositions rather than literal shipping UI captures. Do not add a public course marketplace, live presence, guaranteed learning outcomes, or perfect-memory claims. The course concepts use course creation, private invitations and asynchronous discussion.

## Visual direction and production record

Generated with the built-in image generator using actual Keating landing screenshots and its established mascot: warm paper, ink outlines, hard offset shadows, monospace typography, forest-green accents and phosphor terminal surfaces. The mascot remains the familiar cream CRT head with green screen, antenna, oval eyes and smile.

Original visual reference files used during image generation:

- `docs/assets/screenshots/landing-sacred-deck.png`
- `docs/assets/screenshots/landing-review-feature.png`
- `web/public/brand/mascot-head-v2.png`

Each folder includes `image-prompt.md` recording its exact initial generation prompt. Concepts 03 and 05 also include `image-edit-prompt.md` recording targeted removal of accidental branding in the learner-problem panels. The final corrected PNGs are saved in those folders. All five final PNGs were opened and visually reviewed for theme, six-shot narrative, readable headlines, CTA and mascot continuity. The scoped local `.gitignore` exception makes the storyboard PNGs trackable despite the repository-wide PNG ignore rule.

Before publishing a generated video, review its actual text rendering, narration pacing, frame safe areas and UI claims: these storyboard packages are creative direction, not evidence that a particular video model followed it. Keep the final CTA `keating.help` unless the campaign destination is explicitly changed.

