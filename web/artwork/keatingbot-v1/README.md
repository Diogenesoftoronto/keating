# Keatingbot sprite sources

These PNGs are the generation originals. They remain outside `public/` and are not distributed with the website. The canonical idle head already has transparency; the other sources use white backgrounds.

From the repository root, rebuild all optimized frames and both atlases with:

```sh
rtk proxy node web/scripts/build-keatingbot-sprites.mjs
```

This exact Node invocation was verified with the installed Sharp package. A direct Bun invocation on this machine could not load `libstdc++.so.6`; no new dependency or environment change is needed for the Node command above.

For a head-only preview while body sources are incomplete:

```sh
rtk proxy node web/scripts/build-keatingbot-sprites.mjs --head-only
```

An optional source directory can be passed as a positional argument. The default is this directory.

The script removes only near-white pixels connected to an image edge (all RGB channels at least 220, maximum channel spread 22). It then removes one original-resolution alpha boundary pixel to clean the white matte fringe before downsampling. It preserves existing transparency, enclosed highlights, and the cream casing. Head alignment uses the largest connected green screen region; body frames fit inside 224×224 pixels with feet at y=236, or y=224 for the hop pose. Body horizontal placement uses the green face center, so a raised hand does not shift the torso sideways. No artificial frame jitter is generated.

Outputs:

- `public/brand/bot-frames-v1/*.png`: twelve transparent 256×256 frames.
- `public/brand/keatingbot-sprites-v1.png`: 1024×1024 head atlas.
- `public/brand/keatingbot-body-sprites-v1.png`: 1024×1024 body atlas.
- `public/brand/keatingbot-sprites-v1.manifest.json`: source names, cleanup results, trim and screen bounds, final geometry, and row mappings.

Both atlases were visually inspected on dark and light backgrounds. All twelve frames have transparent corners; atlas dimensions, alpha channels, and body baselines were checked. The listening head source has no neck; it is aligned by its screen without inventing or stretching missing artwork.

## Distinct thinking and speaking sequences

The same build optionally consumes `head-thinking-sequence.png` and `body-thinking-sequence.png` as 2×2 grids, and `head-speaking-sequence.png` and `body-speaking-sequence.png` as 4×2 grids. Missing sequence sources are skipped so base atlases can still be rebuilt independently.

Each source cell is cleaned separately. A shared sequence scale keeps the character from changing size when its pose changes; faces are registered horizontally and bodies retain their foot baseline. Cells are ordered left-to-right, then top-to-bottom. Exact duplicate cells fail the build rather than being presented as additional artwork.

Sequence strips are emitted as `public/brand/keatingbot-{head|body}-{thinking|speaking}-v2.png`: four 256px thinking frames (1024×256) or eight speaking frames (2048×256). The manifest records source/cell/output hashes, frame counts, crop geometry and positioning for each optional strip. The original v1 atlases remain the fallback for the other states.

Grid boundaries are rounded independently, so odd source dimensions produce cells differing by at most one pixel without rescaling the original sheet. Sequence frames use two source-pixel boundary cleanup passes before resizing.

## Status artwork

Optional `status-loading.png`, `status-404.png`, `status-403.png`, and `status-500.png` produce transparent 512×512 images in `public/brand/bot-status-v1/`. They fit a 448px box with baseline y=480. Status originals with existing alpha receive a two-pixel boundary cleanup to remove generation matte fringes; the enclosed cream casing, screen digits, lock, and static texture remain intact. Status geometry and source/output hashes are included in the manifest.

## Twelve-frame greeting wave

Optional `body-wave-sequence.png` is an authored 4×3 grid, read left-to-right then top-to-bottom. It follows the same cell cleanup, fractional-boundary rounding, shared scale, face registration, and foot baseline pipeline. The output is `public/brand/keatingbot-body-waving-v3.png`, a transparent 3072×256 strip with 12 distinct poses. Source, cell, and output SHA256 hashes and final geometry are recorded in the manifest.

The explicit `waving` body state plays the 12 poses over 2.2 seconds and holds the final resting pose until the 7.5-second cycle repeats. Reduced motion shows the sixth friendly raised-hand pose; frozen inspection accepts frames 0–11. A head requested in the waving state uses its existing idle artwork. Existing thinking and speaking strips are unchanged.

The wave original has vertically shifted rows: the 1448×1086 source uses row boundaries 0, 331, 667, 1086, scaled proportionally if resolution changes, while columns retain rounded quarter boundaries. This preserves the second-row antennas. The rebuilt strip was inspected on dark background: all 12 frames are nonblank and uniquely hashed, with visible lift, wrist-wave and lowering poses, shared scale and y=236 feet.
