Borders, placement and texture pass over one group of screens in the Keating web app. Your task message names your lane and its scope.

Read `_common.md` in this folder first, then `../texture-rules.md` in full (it quotes the owner and is the reason this lane exists), then this brief.

GOAL, inside your scope only
1. Take boxes away and fix placement, so each screen reads like its mockup board: bare icon buttons, one border per thing, titles in the UI face, controls where the board puts them.
2. Add texture and effects from the shared vocabulary (texture-rules section 4) wherever its table applies: every waiting state, every empty state, hero and intro panels, rail and section heads, moving progress fills, primary actions.

METHOD
1. BEFORE: capture each screen in your scope at 1440x900 and 390x844 (light) with `tools/harness/cdp.mjs` (seed a profile first with `harness/seed.js` on the app's own origin; pass the app URL, not about:blank, as the first argument). Capture the matching board from the built mockup page (`docs/design/2026-11-19-review-chat-mockups/<page>-mockups.html`, pass the plain file path). Look at each pair and write the difference list: borders, spacing, order, alignment, typeface, weight, icon size and placement.
2. Run `harness/probe-borders.js` on each screen. Fix everything it lists unless texture-rules section 2 allows it; say which you kept.
3. Fix with kit components first (`IconButton`, `Button`, `Chip`, `Card`, `Loading`, `EmptyState`, `Note`, `StatusDot`). Delete local CSS that redraws what the kit already does. Sizes come from the boards: board px / 20.8 = rem.
4. Replace every ad-hoc loading and empty state with kit `Loading` / `EmptyState`. Keep the exact words, roles and live-region behaviour that tests and screen readers rely on.
5. Add `k-halftone`, `k-grid`, `k-lift` and shader surfaces where the table says. Stay inside the budget of two live shader canvases per screen.
6. AFTER: capture the same screens again; check one screen each in dark, with reduced motion, and with effects off.

CONSTRAINTS
Presentation only. No change to behaviour, data, permissions, routing, what is sent anywhere, or copy (you may remove a label or badge that repeats what the board shows another way; list each). Keep test ids, aria labels, roles and keyboard order. Do not edit the kit, glyphs, shaders, charts or motion helpers: if you need something from them, say what in your report. Do not edit files outside your scope even to fix a typecheck error; list it.

VERIFY: focused tests for every file you changed; `bunx tsc --noEmit` once at the end; before and after pairs under /tmp/keating-design-shots/<lane>/.

REPORT (400 words at most): per screen, the differences you closed; borders you kept and why; textures and effects you added and where; what a board shows that the app cannot do; test and typecheck results, with failures marked yours or not yours.
