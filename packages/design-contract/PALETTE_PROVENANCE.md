# Palette provenance

`@keating/design-contract` is the canonical semantic projection for new
surfaces. It intentionally does not reproduce component CSS.

The light/dark anchors come from the current web semantic-token source in
`web/panda.config.ts` and the matching root artifact palette in
`src/core/artifact-theme.ts`:

| Role | Light | Dark | Existing source token |
| --- | --- | --- | --- |
| surface | `#f1ece0` | `#0c1510` | `paper`, `terminal` |
| surfaceRaised | `#f6f2e8` | `#11201a` | `card` |
| surfaceMuted | `#e9e2d2` | `#1b2a1f` | `paperDeep`, `secondary` |
| text | `#1c211b` | `#dcefe0` | `ink` |
| mutedText | `#4a5247` | `#9dbfa8` | `inkSoft` |
| accent | `#1e9b50` | `#4be388` | `primary`, `phosphor` |
| accentText | `#14743c` | `#4be388` | `accentDim` |
| onAccent | `#ffffff` | `#0c1510` | `primaryForeground` |

`src/core/theme.ts` is an ANSI-oriented earlier projection. Its `#10b981`,
`#059669`, and `#f4f1ea` values establish the same green-paper intent, but
the web semantic tokens above are the exact source for the shared contract.

The semantic contract preserves this distinction: `accent` is suitable as a
filled surface with the product's `onAccent` foreground; `accentText` is the
contrast-safe foreground for paper surfaces. White on the light primary is a
large/control-label pairing and is tested at the WCAG large-text threshold.
Consumers must not use `accent` as body text on paper.

## Typography provenance

Typography is aligned to the active web font tokens in `web/panda.config.ts`:
the system UI stack for ordinary controls, `Space Mono` for display, and
`JetBrains Mono` for code/body monospace. This package keeps the stacks as
portable family arrays; `cssVariables()` projects all web-consumable colors,
typography, spacing, radii, states, motion, and density roles. Its numeric
`native` projection intentionally remains outside CSS for native renderers.
