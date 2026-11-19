# Keating design pass, round two: rules for the gap-closing lanes

Round one rebuilt the screens. A board-by-board audit then compared every mockup with the built app and inventoried the charts, icons, settings and lesson components. Round two closes what it found. The owner's standard, in their words: "the little things matter".

## Read first
1. `/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/build-rules.md`: repository path (`/home/diogenes/.cache/keating-deploy/design-pass-20261119`), hard rules, shared building blocks, budget and resuming, deliverable format. It binds you. Never commit, push or deploy. Do not run Vet. Do not edit the stale checkout at `/home/diogenes/Projects/experiments/keating`.
2. This file.
3. The audit sections your brief names, in `/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/maps/` (`gaps-learning.md`, `gaps-collab.md`, `charts-map.md`, `inline-components-map.md`, `settings-map.md`). Each finding has an id, the mockup requirement, the app evidence with file and line, a severity and a suggested fix. Line numbers may have shifted by a few lines since the audit (an icon migration ran afterwards); find the code by its content.
4. The mockup boards your brief names: sources under `docs/design/2026-11-19-review-chat-mockups/src/` (`chat.body.html`, `review.body.html`, `surfaces.body.html`, `more.body.html`, and the new `system.body.html` with Settings S1 to S4 and Charts D1, and `lessons.body.html` with lesson components L1 and L2 when your brief mentions it), with `shared.css`. The numbered notes under each board are requirements.

## How to treat a finding
- Default: implement the finding's suggested fix so the app matches the mockup and its notes. Do every severity, low included; low findings are the "little things".
- EXCEPTIONS listed in your brief are places where the app is deliberately ahead or different (often because the owner asked for it in another piece of work). Leave the app as it is there; the mockups will be updated instead. Do not "fix" them.
- "App is ahead" paragraphs in the audit are not work for you; they are notes for updating the mockups.
- If a finding turns out to be wrong (the app already does it, or the suggested fix would lose a real feature, break a permission rule or change what data leaves the device), do not force it. Say so in your report with the reason.
- Do not remove features, states, copy variants, error handling or accessibility behaviour. When a layout changes, every existing state must still have a place.

## The system you build with
- Kit: `web/src/design-system/kit` (Button, ButtonLink, IconButton, Chip, Segmented, Tabs, TabPanel, AppBar, AppMenu, SubBar, Card, Eyebrow, Field, TextInput, TextArea, SearchField, Avatar, AvatarStack, StatusDot, Note, Kbd, Prose, DefinitionList, Sheet, Menu). Read its README. Prefer a kit component to a hand-rolled one; if the kit lacks something several screens need, add it to the kit ONLY if your brief gives you the kit, otherwise build it locally and report it under "Needs from kit".
- Glyphs: `web/src/design-system/glyphs` (119 glyphs; names and meanings in `LABELS` at the end of `data.ts`). The app no longer uses any other icon set; never import one. Pick glyphs by meaning (`up`/`dn` are thumbs; `shield` is "unverified", `verified` is the tick; `export` is download, `import` is upload; busy is `spin` with class `k-glyph-working`).
- Charts: `web/src/design-system/charts` (Meter, Progress, Countdown, BarList, StackBar, IntervalPlot, LineChart, HeatGrid, StateGrid, Timeline, Stat, Legend, ChartTooltip, ChartTable, ChartFrame). Read its README and `/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/chart-rules.md`. When your brief lists chart ids (for example U04, B01), move those graphics onto these primitives, keeping their data, labels, states and behaviour. No hand-rolled tracks, no native `<meter>`/`<progress>` paint, no charting library, no literal colours.
- Motion: `web/src/design-system/motion.ts` (`motionAllowed`, `useMotionAllowed`, the shared ease and springs) and Motion 14 (`motion` package). The mockups' choreography is in `src/ui-motion.js`; entrances play once; reduced motion (the OS setting or `html[data-reduce-motion="true"]`) shows the final state.
- Shaders: `web/src/design-system/shaders` (`ShaderSurface`, effects paper, field, ink). Decoration only; everything must look finished with effects off.
- Type roles: reading text (tutor replies, lesson reading, transcripts) is the Literata serif through kit `Prose`; interface text is the UI sans; labels, counts, chips and code are JetBrains Mono; display numbers are Space Mono. The app's root font is 130% (1rem = 20.8px): the kit's body is 0.625rem (13px), labels about 0.5rem (10.4px), section titles 0.77rem (16px). Older helpers (Panda `css()` constants with 0.75rem to 1rem text, rounded 0.5rem corners, drop shadows, `retro-*` classes) are what you are replacing when they sit inside a redesigned surface. Corners are 4px (`0.1923rem`); nothing is pill-shaped; the one "hard" shadow (`var(--k-hard-shadow)`) is reserved for the single most important card or the composer.
- Highlights use `var(--k-wash)` (it has a dark-theme value); status is never colour alone.
- Styles: plain CSS in the co-located stylesheet your surface already has; add Panda `css()` only where the file already uses it for that element, and run `bun run panda` in `web/` once at the end if you added any.

## Quality bar
- Phone (390px and 320px wide), tablet and desktop; light and dark; keyboard only; reduced motion; visual effects off. No horizontal page scroll. Targets at least 44px on coarse pointers.
- Sentence case, the app's existing vocabulary, no new jargon. Do not change copy unless a finding says so.
- Icons that share a row share a size. Buttons in a footer: quiet and secondary actions on the left, the primary on the right.
- Accessibility is part of "done": names, roles, focus order, focus return after a sheet or menu closes, live regions for status.

## Working alongside others
Several lanes run at once, each with its own files. Touch only your scope. If you need a one-line change in a file you do not own (for example a prop passed down), report it under "Needs from other lanes" instead of making it, unless your brief explicitly lets you. The machine is short on memory: iterate with focused tests (`cd web && env -u LD_LIBRARY_PATH bun test <files>`), run `bunx tsc --noEmit` ONCE at the end, never run the whole suite, never build, never start a server. The app is already running at `http://localhost:3420` (with its API and a local account per browser profile); if you can drive a headless browser, use `/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/harness/cdp.mjs` as described in `/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/audit-rules.md` to look at your screens in light, dark and at 390px before you report, and say which states you saw.

## Deliverable (max 300 words)
- Findings closed (ids), findings left with the reason, exceptions respected.
- Charts moved to the kit (ids).
- Files changed and added; tests added or updated and their results; the typecheck result.
- What you looked at in a browser, and what you could not check.
- Needs from other lanes / needs from kit.
- Anything the mockups should now show differently (the app ended up better than the board).
