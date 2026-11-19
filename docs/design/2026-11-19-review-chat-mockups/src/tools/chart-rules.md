# Keating chart language

One visual language for every chart, meter and data graphic in the web app. The inventory of what exists today is `/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/maps/charts-map.md` (ids such as U04, B01, L09 refer to it). The mockups' drawings are in `docs/design/2026-11-19-review-chat-mockups/src/shared.css` under "Dashboards" (`.hb`, `.stk`, `.st3`, `.iv`, `.hm`, `.lchart`, `.lg`, `.tile`) and on the board "D1 Charts" once it is added to `system-mockups.html`.

Sizes below are in CSS px at the design scale. The app's root font is 130% (1rem = 20.8px), so convert with rem = px / 20.8 and write rem in CSS (6px → 0.2885rem).

## Principles
1. **Colour is assigned by job.** Categorical series take `--series-1`, `--series-2`, `--series-3` in that fixed order (never cycled, never chosen by rank; a fourth series means the chart is redesigned or folded into "Other"). One-measure magnitudes (a single bar, a meter, a heat ramp) use `--series-1`. Status uses the status tokens and is never colour alone: correct `--accent-green` with the `check` glyph, incorrect `--destructive` with `x`, partial or warning `--amber` with `minus` or `alert`. Review note kinds keep their triangle / octagon / diamond.
2. **Text wears ink.** Values, labels, axis text and legends are `--ink`, `--ink-soft` or `--k-ink-faint`; never a series colour. Numbers are tabular (`font-variant-numeric: tabular-nums`) in the mono face.
3. **Square geometry.** No rounded bar ends, no pills, no circles. Marks are rectangles; points are squares; rings are 2px outlines. This matches the glyphs.
4. **Thin marks, quiet scaffolding.** Tracks and bars 6px tall; a headline stacked bar 14px; lines 2px; points 10px squares with a 2px ring in the surface colour; grid and axis rules 1px in `--line` at reduced strength (`color-mix(in srgb, var(--ink) 12%, transparent)`); no chart borders; no drop shadows.
5. **A 2px gap in the surface colour** between adjacent fills (stack segments, neighbouring bars, heat cells use 3px).
6. **Never colour alone.** Two or more series always have a legend whose entries carry the name AND the number; up to four series are also labelled directly at the mark. A second cue (pattern, shape, position or text) accompanies any state colour.
7. **One scale per chart.** No dual axes.
8. **Readable without sight or hover.** Every chart has an accessible name that states its main reading ("Confident 41, confused 12, off-track 5"), marks are reachable by keyboard where they carry detail, and a "View as table" disclosure with the same numbers exists for any chart with more than three values. Single-value meters use `role="meter"` or `role="progressbar"` with value text.
9. **Hover and focus show the same tooltip**, positioned by the kit, dismissed by Escape, never the browser's native `title`.
10. **Motion is an entrance, once.** Bars and meters grow from zero, lines draw left to right, points pop in order, heat cells fade; 400 to 600ms, the app's standard ease; nothing loops; reduced motion shows the final state. Live signals (audio level, timers) update without easing tricks.
11. **Both themes are chosen, not flipped.** Use the tokens; never literal hex. Track background is `--paper-deep`.

## Primitives (the kit): `web/src/design-system/charts/`
| Primitive | What it draws | Notes |
|---|---|---|
| `Meter` | one value on a 6px track | value/max, optional `threshold` tick (1px ink line with a label), `tone` = `data` (series-1, default) / `ink` / `ok` / `warn` / `bad`, `indeterminate` (a sliding 30% segment; static hatch under reduced motion), `size` = `sm` 4px / `md` 6px / `lg` 14px, value text slot on the right in mono |
| `Progress` | done / total as discrete steps | up to 12 steps are separate 6px cells with 2px gaps (done = ink fill, current = series-1 outline, to do = track); more than 12 collapses to a `Meter`; always paired with "n of m" text |
| `Countdown` | time remaining | a `Meter` that empties, with the clock in mono beside it; turns `warn` under 25% and `bad` under 10%, and says so in text ("12 s left") |
| `BarList` | ranked horizontal bars | label, 6px bar, value; optional drill-in button per row; sorted by value unless order is meaningful |
| `StackBar` | parts of a whole | `md` 6px (in tables and rows) or `lg` 14px (a card's headline); 2px gaps; zero-width segments are omitted but stay in the legend; optional pattern per segment for print and forced colours |
| `IntervalPlot` | a point with its range on a shared 0 to 100 (or given) axis | 22px row; 1px axis rule and faint ticks at 0 / 50 / 100; range 4px at 45% series-1; point 10px square; optional shared `band` (leader's range) at 11%; hollow point for "too few signals"; value text beside the mark |
| `LineChart` | up to three series over an ordered x | 2px lines, square 8px end markers, direct labels at the line ends, three faint horizontal rules, x labels only at first and last; unconnected sample dots are allowed when the data is not continuous (`connect={false}`) |
| `HeatGrid` | a quantity per cell (calendar, matrix) | four-step ramp of series-1 over the track colour (28%, 52%, 76%, 100%), 3px gaps, legend "Less ▢▢▢▢ More" with the numeric range on hover; selected cell gets a 2px ink outline |
| `StateGrid` | a category or state per cell (checks passed, rubric cells) | same cell geometry as `HeatGrid`, but each state has a glyph or pattern and a legend with counts; never the quantity ramp |
| `Timeline` | start/end bands on a time or ordinal axis | 6px bands on lanes, 2px gaps, lane labels in ink on the left, hatch pattern for "waiting" |
| `Stat` | a headline number | label in mono 10px faint, value in the display face 24px, one supporting line 11px soft; used for count tiles |
| `Legend` | names with numbers | 9px square swatch, name, bold value; entries can be buttons (`aria-pressed`) when they select a segment |
| `ChartTooltip` | hover/focus detail | dark ink panel, mono 11px, max 260px |
| `ChartTable` | "View as table" | a `<details>` with a real table built from the same data |
| `ChartFrame` | title, scope chip, reading, body | gives the chart its accessible name and optional "all time" style scope chip |

Real-time canvases (audio waveform, oscilloscope, piano roll) keep their renderers but sit in a `ChartFrame`, take their colours from the tokens through CSS variables, and label state in text.

## What changes where (adoption)
- The kit's existing `Meter` (`web/src/design-system/kit`) becomes a re-export of the chart `Meter` so there is one implementation.
- Every hand-rolled track, native `<meter>`/`<progress>`, Recharts chart and ad-hoc stacked bar moves to these primitives, keeping its data, labels and behaviour.
- Authored content (Mermaid diagrams, model-written interactive pages) is not restyled mark by mark; its host frame, fonts and colours come from the tokens.
