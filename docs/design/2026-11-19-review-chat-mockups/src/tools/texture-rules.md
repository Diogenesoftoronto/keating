# Borders, placement and texture rules

The owner looked at the built app next to the mockups and said (2026-11-19):

> "I enjoy the chat message icons like this [the mockup composer: three bare icons, attach, mic and Live, and one green Send]. I find you have this redundant ugly border, a shitty placement in many places I don't like and I want you to fix to look more like these older mockups. I really loved them. I love the textures you have for loading. I loved the effects and the backgrounds, I love all that stuff and I want more of that."

So this pass has two halves: take boxes away, and add texture. The mockup boards are the target. Mockup pixels are app pixels (1px = 0.04808rem, because the root font is 20.8px).

## 1. Quiet icons

- An icon-only button has **no border and no filled box** at rest, and no fill on hover.
- Use the kit `IconButton` (ghost by default; do not pass `bordered`), or add the class `k-bloom` to an existing button. Both get the hover for free: the glyph's own motion, its accent part turning green, and a halftone bloom behind it (`kit.css`).
- Sizes: 28px square (1.3462rem), 22px (1.0577rem) inside dense rows. The glyph is 15px, or 13px in the small size. Never larger boxes around a small glyph.
- A row of icon actions has one uniform gap (2px) and starts flush with the text it belongs to (pull it left by the button's inner padding, as `.acts{margin-left:-6px}` does on the boards).
- Exceptions: a pressed toggle (`aria-pressed`, kit style) and the one primary action of the surface.
- Every glyph sits inside something that can light it: a button, link, tab, menu item, `summary`, or an element with `data-glyph-host`.
- Icon-plus-label controls that the board draws as ghost (`.b.gh`) are ghost: no border.

## 2. One border per thing

- Ink-coloured (dark) borders are for three things only: the composer, hard cards (`k-hard`, with the hard shadow) and filled primary buttons. Everything else that needs an edge uses `--line`; dividers inside a card use `--line-soft`.
- A control inside a bordered card or row does not get its own box unless it is a text field or the primary button. No card inside a card inside a card: flatten to one frame with dividers.
- Do not put a border and a background wash and a shadow on the same element. Pick the one the board uses.
- Selected rows are a wash plus a 3px green bar on the leading edge, square corners. No pill badges that repeat what the selection already says.
- Status is a small square dot plus words, not a bordered pill, unless the board draws a chip.

## 3. Placement

- Put each control where the board puts it. Compare the built screen with its board side by side at 1440 and 390 wide before and after; list every difference you see in spacing, order, alignment, weight and typeface, then close them.
- Titles and names are the UI face (`--font-ui`), semibold. Mono is for labels, metadata, counts and code. A truncated title means the row's layout is wrong: give the title the width and move metadata to its own line.
- Row menus ("more") appear on hover or focus of the row and stay visible on touch screens. They never take a permanent column from the title.
- No avatars, labels or badges the board does not draw. If the app needs something the board lacks, make it quiet and say so in your report.
- Secondary information sits at the trailing edge of the same row as the actions, in mono, faint.

## 4. Texture and effects: more, from one vocabulary

Use these. Do not invent new effects, gradients, glows, blurs or drop shadows.

| Where | What | How |
| --- | --- | --- |
| Anything waiting (page, panel, list, button-sized) | Marbled ink under a small caption | kit `<Loading label="Loading sessions" size="block" \| "inline" \| "page"/>`. Replaces spinners, "Loading..." text and grey skeleton bars. |
| Nothing here yet | The study-object field that follows the pointer | kit `<EmptyState heading="No rooms yet" glyph="people" actions={...}>one sentence</EmptyState>` |
| The filled part of a progress bar that is moving | Flowing ink | chart kit `<Meter live/>` and `<Progress live/>` (stepped streaks in CSS, only while the work is running); `<ShaderSurface variant="progress"/>` for marbled ink inside a hand-built fill |
| Hero, intro and welcome panels | The field, or the halftone | `<ShaderSurface effect="field"/>` or class `k-halftone` |
| Rail heads, section heads, side panels, drop zones, empty table bodies | Halftone dots fading to clear | class `k-halftone` (add `k-green` for the green ink; `--k-halftone-angle` points at the clear side; `--k-halftone-strength` 0 to 1) |
| Previews, diagram stages, drop targets, image placeholders | The drawing grid | class `k-grid` |
| Primary and accent buttons, hard cards that are links | Lift on hover, seat on press | automatic on kit `Button variant="primary" \| "accent"`; add `k-lift` to anything else filled or hard-edged that is clickable |
| Quiet icons | Halftone bloom | automatic on `IconButton`; `k-bloom` elsewhere |
| Sending, saving, finishing | Sparks, the stamp, the bot's reactions | the existing motion helpers in `design-system/motion.ts` and the companion's `useLessonReactions` |

Rules for all of them:

- Decorative only: `aria-hidden`, never the only signal. State is always also in words.
- Text over a texture gets a solid backing (the kit components do this).
- They switch off with the existing preferences (reduced motion, effects off, forced colours, no WebGL). Check each state still reads.
- At most two live shader canvases on screen at once; the rest are the CSS textures.
- Textures go on surfaces and states, never behind running prose, tables or form fields.

## 5. What to report

Before and after pairs (same viewport) for each screen you changed, the list of differences you closed, anything on a board that the app cannot do, and any place you kept a border with the reason.
