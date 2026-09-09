# Keatingbot stop-motion v1

22 generated sequences (176 authored poses): idle, listening, thinking, speaking,
success, waving, loading, walking, sitting, flipping, reading, music, science,
maths, coding, chemistry, biology, physics, astronomy, palaeontology, electronics,
and mycology.
Each sheet has eight poses in four columns and two rows, read left to right.
The canonical identity reference is `web/public/brand/mascot-full.png`.

`raw/` preserves the image model's original PNG sheets. Its attempted transparent
outputs contained a painted checkerboard, so these sheets instead use a uniform
magenta background for production extraction. Do not serve the raw sheets.

The preparation script `web/scripts/prepare-stop-motion.py` creates
transparent, normalized head and body atlases. Final production files belong in
`web/public/brand/stop-motion-v1/` as AVIF; intermediate PNGs remain here under
`prepared/`. Original brand PNGs must remain unchanged.

The component uses stepped frame changes, authored pauses, visibility pausing,
and reduced-motion support. Preview all states and variants using the KeatingBot
`StopMotionGallery` Storybook story; `Frames` exposes all eight atlas cells.
Idle adds a continuous 4.8-second weight shift beneath the authored blinks: a
small side-to-side rock and rise-and-fall. It pauses with the sprite and is
disabled by reduced motion or frozen-frame inspection.

Background extraction and frame slicing use ImageMagick, as authorized by the
user. From the repository root, regenerate with:

```sh
rtk proxy python3 web/scripts/prepare-stop-motion.py
```

Each AVIF atlas is 1024×512, with eight 256×256 cells, quality 75 and 4:4:4
chroma. `prepared/report.json` records dimensions, transparency and byte sizes.
The original generated sheets and all existing brand PNGs remain intact.

Open `preview.html` through a static server rooted at `web/` to inspect light and
dark backgrounds, pause playback, and freeze any of the eight frames. It uses the
production animation CSS and verifies every referenced AVIF loads.

Chat uses one full-body mascot above the composer instead of repeated assistant
profile images. Recording and response activity take priority over study-topic
animations. The route loading screen uses the dedicated loading sequence.
Assets load on demand; animation pauses offscreen and respects reduced motion.
The gallery was checked in Chromium on light/dark backgrounds and at 375px;
all 42 referenced atlases loaded (walking/flip compact views reuse body sheets).
Browser checks confirmed changing idle transforms, no mobile overflow, and zero
idle animations under reduced motion. The actual authenticated chat still needs
an end-to-end browser check. Focused tests and the web typecheck pass.
These local changes have not been deployed to production.
