Bring the Keating design mockups in line with the app as it was finally built, so the boards are a true record again. You are lane M1.

WHERE
- Repository: `/home/diogenes/.cache/keating-deploy/design-pass-20261119` (branch `feature/design-pass`, hundreds of uncommitted files; that is expected). Never commit, push or deploy. Do not run Vet. Do not edit the stale checkout at `/home/diogenes/Projects/experiments/keating`.
- Mockups: `docs/design/2026-11-19-review-chat-mockups/`. Sources are `src/*.body.html` plus `src/shared.css`; `cd src && node build.mjs <outDir>` builds every page (use an out dir under `/tmp/keating-design-shots/M1/`), then copy the `*-mockups.html` files up into the mockups folder. Each page must stay under 512 KB.
- The app runs at `http://localhost:3420`. Do not start a server. One headless browser at a time (`src/tools/harness/cdp.mjs`; usage in `src/tools/audit-rules.md`; working step files in `src/tools/steps/`). No test suites, no builds of the app.

WHY
The boards were drawn first; the app was then built by many lanes, and the owner steered it afterwards: bare icon buttons with no boxes, one border per thing, more texture (`src/tools/texture-rules.md` quotes the owner and is the rule now). In places the app is ahead of the boards, in places a board shows something the app cannot do, and some built screens were never drawn.

SCOPE (you own): `src/chat.body.html`, `src/review.body.html`, `src/surfaces.body.html`, `src/more.body.html`, `src/system.body.html`, `src/lessons.body.html`, `src/flows.body.html`, and `src/shared.css` EXCEPT its last block (from the comment "Landing page" to the end), plus the built pages. Do NOT touch `src/landing.body.html`, the landing block of `shared.css`, `src/glyphs.mjs`, the bots pages, `src/tools/**` (read only), or anything under `web/`.

METHOD
1. For each board, capture the board and the built screen at the same width and compare. The audit maps in `src/tools/maps/` (`gaps-learning.md`, `gaps-collab.md`, `settings-map.md`, `charts-map.md`, `icons-map.md`, `inline-components-map.md`) list what differed before the build; treat them as a starting list, not the truth: look.
2. Where the app is now the better or the only possible version, change the board to match the app: markup, spacing, labels, icon choice, typeface, borders, states. Where the board is still better and the app merely has not caught up, leave the board and add the difference to your report.
3. Things already known:
   - Chat C1: the composer, the rail, the header, the learner's message and the reply actions were rebuilt in the app after the owner's note. The composer on C1 was updated; check the rest of C1 and every other board that draws a composer, a rail or message actions (phone boards, the Materials board, rooms, review).
   - Settings S3 (Data and support): remove the published-link count, "Unpublish" and "Delete everything on this device"; the app has no data source or action for them. Add what the app shows instead (the share mode and the fresh-checkbox sentence).
   - Settings S1 to S4: section headings in the display face, rows in one soft card with soft dividers, the selected group as a hard card, the Learning profile's footer wording ("Saved · nothing to apply" when clean), eight Models sections, the "Right now" aside.
   - Rooms: the app has facilitator controls but no separate call bar or whiteboard.
   - Courses: the join page cannot show the course title before consent.
   - Built but never drawn: Coming up; the share consent sheet; the join pages; Live's ended and failed states; the Settings search results; the kit's `Loading` and `EmptyState`. Add a board for each, drawn from the app, in the existing board format (number, title, one-line purpose, the frame, numbered notes).
4. Every board's notes must be true of the app. Rewrite notes that describe something that was not built or was built differently. Keep notes short and plain.
5. Add one new board at the top of `system.body.html`, "Borders, icons and texture": the rules from `src/tools/texture-rules.md` shown as examples (a bare icon with its bloom next to a boxed one marked as not used; one border per thing; the loading block; the empty state; halftone, grid and lift), so the rules can be seen, not only read.
6. Rebuild, open each page, and check: no page over 512 KB, no unresolved macro, no layout broken by your edits, the Theme, Motion and Shaders toggles still work.

DELIVERABLE (final reply, at most 350 words): per page, what you changed to match the app; the list of places where the board is still ahead of the app (each with the board id and one line), most visible first; boards added; page sizes.
