# OpenUI components redesign, wave O (2026-11-20). Common to every lane.

Repository: `/home/diogenes/.cache/keating-deploy/openui-design-20261120` (branch `feature/openui-design`, from `d06a2691`). Work only here. Never commit, push or deploy. Do NOT touch `/home/diogenes/.cache/keating-deploy/design-pass-20261119` (another session is editing it) or `/home/diogenes/Projects/experiments/keating`.

## What this wave is

Keating's tutor puts "OpenUI" components inside chat replies (defined in `web/src/keating/openui/library.tsx`). The 2026-11-19 design pass redesigned some of them (Question, Quiz chrome, Flashcards, StudyPlan, Callout, the Assignment frame) to boards L1/L2. The rest were never designed, and the owner looked at what exists and said three things. All three bind you:

1. **"ew boxes in boxes look"** (`/home/diogenes/.cache/keating-deploy/lane-evidence/openui-design-20261120/owner-boxes-in-boxes.png`, the Practice and Fieldwork cards: a frame holding a rounded box per step, each holding a bordered field). **Inside a lesson frame nothing else has a border box.** Fields are filled wells (`--paper-deep`, no border). Lists are flat rows on `--line-soft` rules. A per-row note opens on demand from a quiet "Add a note" action, it is not a permanent field. Stages (diagram, chart, visualiser, recorder, image) are the `k-grid` texture with no outline. No card inside a card, no bordered pill, no bordered select, no bordered secondary button. This overrides board L2 where L2 draws a box (its assignment steps box).
2. **"hierarchy, colour use, icons are not being utilized where they should"** (`.../owner-hierarchy-colour-icons.png`: the System design workbench and a Practice card with a recorder). Four text levels only (frame title, section head with glyph, body, mono meta). Colour carries meaning from one palette (green progress/done/live/section glyphs, amber hints and criteria, red wrong/recording, ink for the single primary button). Every section head and every action carries a Keating glyph.
3. From 2026-11-19 (still true): quiet borderless icon buttons with the halftone bloom; texture (halftone, grid, marbled-ink `Loading`, `EmptyState`) instead of chrome; the boards win over older builds.

## Read first

- `web/src/components/lesson/lesson.css`, the block "Lesson vocabulary, board L3" to the end of the file. **That is the vocabulary**: `.lesson-section`, `.lesson-section-title` (glyph + text + optional `.lesson-meta`), `.lesson-rows`, `.lesson-group` (flat rows, `data-done`), `.lesson-progress > i`, `.lesson-stage.k-grid` (+`.lesson-bleed`), `.lesson-readouts/.lesson-readout`, `.lesson-quiet`, `.lesson-foot-meta`, `.lesson-status[data-tone]`, `.lesson-criteria`, `.lesson-live`, `.lesson-figure`, `.lesson-label`, `.lesson-hint`, `.lesson-field`, `[data-lesson=prose]`. Fields, sliders and body h3/h4 inside `.lesson-frame` get defaults from `@layer base`, so delete per-component field styling and they become wells automatically. **Do not edit `lesson.css`** (the coordinator owns it). If you need a shared part that is missing, put it in your own component CSS file and name it in your report.
- `web/src/components/lesson/LessonFrame.tsx` (`LessonFrame`, `LessonHeader`, `LessonCallout`, `LessonScore`).
- `docs/design/2026-11-19-review-chat-mockups/src/tools/texture-rules.md`.
- `web/src/design-system/kit/README.md`, `web/src/design-system/glyphs/README.md`, `web/src/design-system/charts/README.md`.
- Board L1/L2 for the frame anatomy: `docs/design/2026-11-19-review-chat-mockups/lessons-mockups.html` (screenshot: `/home/diogenes/.cache/keating-deploy/lane-evidence/openui-design-20261120/before/board-lessons.png`). Today's state of every component: the other PNGs in that `before/` folder.

## The frame anatomy (from L1/L2)

- `LessonFrame glyph=… title=… kind=…`: halftone head; 16px glyph in green; semibold UI title; kind in mono; trailing mono meta (duration, "1 of 3", timer) and quiet `IconButton`s go in `tools`.
- Body: sections separated by soft rules. Section heads are `.lesson-section-title` with a 13px glyph first.
- Footer (`footer` prop, `.lesson-foot`): quiet glyph+text actions at the leading edge (flush, `.lesson-quiet` or kit `Button variant="ghost"`), mono meta, and **one** primary on the trailing edge (`.lesson-primary` or kit `Button variant="primary" size="sm"` with a glyph). Disabled primary stays ink at reduced opacity, never a grey fill.
- Glyph vocabulary (names exist in `web/src/design-system/glyphs/data.ts`; check by eye, names mislead, `up` is a thumbs-up): add `plus`, remove `x` or `trash`, connect `link`, record `video`/`mic`, stop `stop`, play `play`, retry `refresh`, hint `bulb`, criteria `target`, prediction `bulb`, submission `doc`, files `clip`, notes `note`/`pen`, time `clock`, steps `checklist`, image `image`, map `route`/`tree`, components `chip`/`server`/`shapes`, checks `verified`/`check`/`alert`, language `globe`/`speaker`, code `code`/`terminal`, music `music`, simulation `signal`/`trend`, people `people`/`person`, expand `expand`.

## Rules of the work

- Keep behaviour, data flow, ARIA names, test ids, analytics and action payloads unchanged. This is presentation. If a test asserts on a class or text you change, update the test only when the old assertion was about styling; never weaken a behavioural assertion.
- Replace Panda `css()` box styling and per-component borders with the vocabulary. Remove dead CSS you replaced. No new colours, gradients, glows or shadows beyond the vocabulary and kit.
- Light and dark (terminal) must both read: the tokens handle it if you use them. Phone width (390px) must not overflow; dense rows wrap.
- Numbers are formatted for people (no `83.89830508474574`): use the existing formatter for that component.
- Mockup pixels are app pixels at 1px = 0.04808rem (root font is 20.8px).

## Verifying

- Storybook is running at `http://localhost:6107` (the coordinator's; it hot-reloads). Story ids: `curl -s localhost:6107/index.json`. If it is down, start your own on a free port (`cd web && env -u LD_LIBRARY_PATH bunx storybook dev -p 61NN --ci --no-open`, in the background) and stop it when done.
- Screenshots: `node docs/design/2026-11-19-review-chat-mockups/src/tools/harness/cdp.mjs http://localhost:6107/iframe.html 900 1000 <steps.json>` with steps like `[{"goto":"http://localhost:6107/iframe.html?id=<story>&viewMode=story","settle":4000},{"shot":"<out>.png","full":true}]`. Also take 390-wide and dark (`&globals=theme:dark` if the story toolbar supports it, otherwise `{"eval":"document.documentElement.dataset.theme='dark'"}` and check what the app uses). Look at every shot yourself. Put shots in `/home/diogenes/.cache/keating-deploy/lane-evidence/openui-design-20261120/<lane>/` (before and after pairs).
- `docs/design/2026-11-19-review-chat-mockups/src/tools/harness/probe-borders.js` (as `{"evalFile": ...}`) lists border-rule breaks; run it on your stories and fix what it lists.
- Add or update stories so every component and state in your scope has one (missing today: Explanation, LearningImage, SharedNotes, AudioResponse, VideoResponse, Connect, PersonBrief).
- Machine limits: one headless browser at a time (the driver closes its own); focused tests only (`cd web && env -u LD_LIBRARY_PATH bun test <files>`); `cd web && bunx tsc --noEmit` ONCE at the end; no full suites, no builds. If a command dies with signal 9, wait and retry once.
- Other lanes edit other files at the same time. Touch only your scope; list typecheck errors in files you do not own instead of fixing them.

## Report (your final message)

Per component: what changed, before/after shot paths (desktop, phone, dark), tests run with results, anything you kept boxed and why, anything you could not do, and any shared part you think `lesson.css` should gain.

## ADDED WHILE YOU WORK (2026-11-20, owner): relative size

"holy moly buttons are huge. way too big relative to the other stuff. really need to work on that relative sizing" (`/home/diogenes/.cache/keating-deploy/lane-evidence/openui-design-20261120/owner-buttons-too-big.png`: LanguagePractice's Check, Finish practice, the boxed Listen and the full-width Record yourself). Read the "RELATIVE SIZE" block at the end of `lesson.css`. Action buttons are 24px tall with 10.5px labels (kit `Button size="sm"`), icon buttons 28px (22px dense), wells 28px, no full-width buttons on desktop, readout numbers at most .9rem, glyphs 13px in sections / 16px in the head. Remove any component CSS that makes controls bigger than that (paddings, min-heights, font sizes, Panda `size` props). Check every control you touch against the body text next to it in your shots.

## ADDED: boards L3/L4 are drawn (lane O5). Match them.

Built page: `docs/design/2026-11-19-review-chat-mockups/lessons-mockups.html` (CSS block "Boards L3/L4, 2026-11-20", `l3-` classes, end of `src/shared.css`). Crops: `/home/diogenes/.cache/keating-deploy/lane-evidence/openui-design-20261120/O5/p-l2b.png, p-l3a.png, p-l3b.png, p-l4a.png … p-l4d.png` (Paper), `dark-*.png` (Terminal), `m390b-*.png` (phone). Decisions to match:
1. Head: green 16px glyph, title, mono kind; duration/timer = clock glyph + mono in head; head never wraps (title may go two lines; kind hidden under 520px container). No bloom on icon buttons at rest.
2. Footer: quiet actions leading, mono meta, one ink primary trailing (stays right when wrapping); disabled primary = ink at 50% opacity, never grey.
3. Rows: 14px check, body text, optional mono note below, trailing action. Done row = green wash fading out by 75% + solid green check. Per-row note well sits under the text.
4. Wells: `--paper-deep`, no border. In dark that barely shows; the board mixes 7% ink in dark. CHECK YOUR WELLS IN DARK and do the same if needed (component CSS, `[data-theme=dark]`/whatever the app uses).
5. Criteria: green section glyph on the head, amber `target` per item, body text.
6. Status: 6px square dot; ok green, warn amber, bad red, hollow dot for queued/unanswered; in check lists the dot hangs left.
7. Slider: 2px track, ruler ticks below (major every 25%, minor every 5%), 4px green fill to a 12px square ink thumb with paper ring; mono ink tag above thumb while dragging (overlays, does not push layout); value at trailing end of label row, dotted underline, click to type → small well; faint 1px start tick.
8. Chart: non-scaling 2px green stroke, HTML/unscaled labels, short end label ("84%"), "Now 0.98%" beside a dashed ink line with an amber square point; mono axis label top-left and along the bottom ("1 … Prevalence per 100k … 5,000").
9. Exam navigator: 20px filled borderless cells; answered green wash + green text, flagged amber, current solid ink, rest well-coloured; mono key with counts below.
10. Language practice: no instruction box; 4px progress; "Listen. Say it. Compare." is a section head with speaker glyph; Listen/Slower quiet; Record (mic) is the ink primary in the footer, not full width.
11. Recording: red blinking square ("Recording"), timer ≤ 18px, on the grid stage, no outline.
12. Sizes: controls 24px, icon buttons 22px in frames, readouts 18px, no full-width buttons.

Coordinator note on decision 4: `lesson.css` now defines `--lesson-well` on `.lesson-frame` (light: paper-deep; under `.dark`: paper-deep + 7% ink) and the base field rules use it. Use `var(--lesson-well)` for any well you style yourself (code areas, navigator cells, recorder stage fills) instead of `--paper-deep`.

## ADDED (owner, 2026-11-20): toggles, checks and the writing surface

"I feel like the check boxes could use some work they could have stuff like a microphone icon checkbox … depending on what they are for. I didn't like that generic text box, we need that styled." (`.../owner-checkboxes-textbox.png`)
- **Any checkbox that switches a capability or mode** (microphone, camera, timed, trace, show answers, loop, metronome, hints…) uses `web/src/components/lesson/LessonToggle.tsx`: `<LessonToggle glyph="mic" glyphOff="micoff" checked={on} onChange={setOn} hint="optional mono line">Include microphone</LessonToggle>`. A real checkbox sits underneath, so labels, roles and tests keep working. Pick the glyph that names the thing (`clock`, `mic`/`micoff`, `camera`/`cameraoff`, `speaker`/`mute`, `eye`/`eyeoff`, `route` for trace, `bulb` for hints, `refresh` for loop). Group several in `<div className="lesson-toggles">`. Example: the recorder in `ResponseCapture.tsx`.
- **Checklist checkboxes** (steps, plan items, "mark done") stay checkboxes: `lesson.css` now draws them as 14px palette squares whose tick stamps in, and `.lesson-group > [data-done=true]` sweeps its wash across. Don't restyle them yourself.
- **Free-text answers**: every `<textarea>` inside a frame is now ruled paper (faint rules scrolling with the text, amber margin rule, green underline while writing; the section's glyph leans in on focus). Code editors are excluded when they have `spellCheck={false}`, an aria-label containing " code" or "solution", or a class containing "code" — make sure yours match one of those. Remove any background/padding you set on answer textareas so this shows.
