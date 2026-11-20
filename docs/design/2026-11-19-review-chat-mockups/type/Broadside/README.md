# Keating Broadside

Expressive editorial display face for big public headlines on textured paper.
Original outlines, drawn in code. No third-party font data is read, traced or renamed.

Use: `font-family: "Keating Broadside"` (weight 400), 40px and up, `line-height` 1.0 to 1.1,
`letter-spacing: normal` to preserve the standard ligatures. Kerning is in the font (`font-kerning: normal`).

## Ligatures (v1.100)

- Standard, on by default (`liga`): `ff fi fl ffi ffl`. Drawn as single shapes, not overlapped letters:
  the first f of a double sends a lower hairline into the flank of the second, the hook reaches over the i
  and its beak hangs where the dot would be, the hook levels out and lands on the top of the l,
  and one crossbar runs through to the next stem.
- Discretionary, opt-in (`dlig`): historical `ct` and `st`. A hairline springs from the top of the c or s,
  loops over at ascender height and comes down on the t. For a headline word or two, not running text.
- CSS: standard ones need nothing. Historical: `font-variant-ligatures: discretionary-ligatures`
  (or `font-feature-settings: "dlig"`). All off: `font-variant-ligatures: none`.
- Browsers switch standard ligatures off when `letter-spacing` is not 0. Keep it at 0 where they matter,
  or force them with `font-feature-settings: "liga"`.
- A zero-width non-joiner (U+200C) between letters stops a ligature. `fï` and `fj` stay separate letters.
- The presentation code points U+FB00 to U+FB04 and U+FB06 map to the same glyphs. Caret positions are in GDEF.

## Design

- Condensed and heavy, vertical-stress contrast: stems 136 (lowercase) / 150 (capitals), hairlines 44 / 46.
- Waisted stems that swell about 10 units toward each end, like worn wood type.
- Arms (E F L T Z, 2 5 7) grow into wedges with a vertical cut.
- Curve terminals (a c f r s, C G J S, 2 3 5 6 9, ?) are cut vertically with a hanging beak.
- Hairline branches spring from low on the stem, leaving a deep notch (n m h r b d p q u).
- Lozenge dots and points (i j . : ; ! ? and the dieresis).
- Corners are softened (7 units convex, 5 concave) so the type sits in paper grain rather than on it.
- Metrics: 1000 UPM, cap height 700, x-height 500, ascender 740, descender -200, line 960 / -240.

## Coverage

199 glyphs: printable ASCII, curly quotes, dashes, ellipsis, bullet, `¡ ¿ © ° ± × ÷ − € £`,
and Latin-1 letters plus `Ć Č Ś Š Ź Ž Ÿ Œ œ ı`. Not included: `Ð ð Þ þ`, `§ ¶ † ™ ® ¢ ¥`,
fractions, superscripts, and Latin Extended beyond the letters listed. Seven of the glyphs are the ligatures above.

## Build

    uv run build.py          # deps declared inline: fonttools, brotli, shapely, numpy
    python proof.py out.png "Headline" --size 150   # optional proof sheet, needs Pillow with Raqm
    python proof.py out.png "office" "noliga:office" "dlig:first act"   # per-line feature switches

`proof.png` is the current sheet; its last three lines show the ligatures on, off, and the historical pair.

- `src/kit.py`: primitives (stem, arm, diag, stroke, beak), softening, curve fitting.
- `src/glyphs.py`: every letter drawing, spacing, accent composition, the ligature drawings and their table.
- `build.py`: tables, names, metrics, automatic kerning, `liga` / `dlig` / carets, TTF and WOFF2 output.

## Limits

- One weight, one style. No italic, no small caps, no alternates. No ligatures beyond the seven above.
- Unhinted, with TrueType (quadratic) outlines. Meant for display sizes; below about 24px the hairlines get weak.
- Kerning is computed from glyph profiles (about 6,100 pairs, ligatures included), not hand-tuned pair by pair.
- Figures are proportional lining figures; there is no tabular set.
- Accented letters are flattened outlines, not components with mark positioning.
