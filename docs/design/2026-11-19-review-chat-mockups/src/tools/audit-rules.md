# Keating design pass: rules for audit and mapping lanes

You are one of several read-only lanes preparing the second round of the Keating redesign. Your output is a Markdown inventory that a designer will work from. Be exact; do not pad.

## Where
- Repository (the ONLY checkout to read): `/home/diogenes/.cache/keating-deploy/design-pass-20261119`, branch `feature/design-pass`, about 300 uncommitted files. The web app is `web/` (React 19, TanStack Router, Panda CSS plus plain co-located CSS, Bun).
- Do NOT read or edit `/home/diogenes/Projects/experiments/keating`; it is a stale checkout.
- Mockups (the design source): `docs/design/2026-11-19-review-chat-mockups/`. Built pages `*-mockups.html`; sources in `src/` (`review.body.html`, `chat.body.html`, `surfaces.body.html`, `more.body.html`, `shared.css`, `glyphs.mjs`, `ui-motion.js`, `shaders.js`, `companion.js`). Boards carry ids such as R1 to R5 (review), C1 to C4 (chat), O1/O2 (onboarding), B1 (benchmark), U1 (activity), M1 (phones), and in `more.body.html` P1/P2 (profile), R1/R2 (rooms), C1/C2 (courses), E1/E2 (training data, export). Each board has numbered design notes under it; those notes are requirements.
- Design system in the app: `web/src/design-system/{glyphs,kit,shaders,motion.ts}`; per-surface stylesheets such as `web/src/pages/chat/chat-surface.css`, `web/src/components/trajectory/review.css`, `web/src/components/rooms/rooms.css`, `web/src/pages/course-workspace/courses.css`, `web/src/pages/learning.css`, `web/src/pages/bench.css`, `web/src/pages/training-data.css`, `web/src/pages/learning-profile.css`, `web/src/components/chat-onboarding.css`.

## Hard rules
- READ-ONLY for the repository: do not edit, create or delete anything under it. No git commands that change state. Never commit, push or deploy. Do not run Vet.
- Write exactly one deliverable file, at the path your brief names, under `/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/maps/`. Screenshots you take go under `.../scratchpad/maps/shots/<your-lane>/`.
- Prefix shell commands with `rtk` where it helps. Do not start another dev server and do not run test suites, builds or installs.
- Every claim needs a pointer: `path:line` for code, board id plus note number for mockups, or a screenshot filename.
- Treat user data as private; nothing leaves this machine.

## Looking at the running app (optional but encouraged)
The app is already running at `http://localhost:3420` (with its API; a local account is created per browser profile). Drive it headlessly with the existing script:

```
S=/tmp/keating-design-shots
CDP_SETTLE=5000 node /home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/harness/cdp.mjs "http://localhost:3420/chat" 1440 900 <steps.json> 2>&1 | grep -E "^EVAL|NOT FOUND|^EXC"
```

`steps.json` is an array of steps, each an object with one or more of: `wait` (ms), `goto` (url, with optional `settle` ms), `shot` (png path), `eval` (JS expression, result is logged as `EVAL ...`), `evalFile` (path to a JS file to evaluate), `clickSel` / `hoverSel` (CSS selector, or any value plus `find`: a JS expression returning the element), `scrollTo`, `move` / `click` ([x,y]), `dragFrom` / `dragTo` (JS expressions, with `steps`, `hold`), `resize` ([w,h]), `reduce` (true: emulate reduced motion). Every run is a fresh browser profile, so seed sample chat sessions first with `{"evalFile":"/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/harness/seed.js"}` (it creates three sessions; the main one is `http://localhost:3420/chat?session=11111111-2222-4333-8444-555555555555`, also viewable at `/review/sessions/<same id>`). Dark theme: `{"eval":"document.documentElement.classList.add('dark');'ok'"}`. Working examples to copy from: `/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/steps/t14.json` (review), `/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/steps/t20.json` (settings dialog), `/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/steps/t28.json` (create a room), `/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/steps/t32.json` (create a course with a lesson), `/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/tools/steps/t37.json` (export sheet and training data). Write step files with a file-writing tool, not shell heredocs containing JSON escapes. Mockup pages can be opened the same way by passing the absolute `.html` path instead of a URL.
A headless run needs `env -u LD_LIBRARY_PATH` only if you launch Chromium yourself; the script already handles it. Keep screenshots to what you need (at most about 25 per lane).

## Vocabulary
- "Glyph": one of the 46 Keating icons in `web/src/design-system/glyphs/data.ts` (names and meanings are in `GLYPH_LABELS` near the end of that file). Any other icon source (lucide-react, inline SVG, emoji, Unicode symbols) is "foreign".
- "Kit": components exported from `web/src/design-system/kit/index.ts`.
- Chart colours: `--series-1`, `--series-2`, `--series-3` (defined in `web/panda.config.ts`); note kinds problem / strength / suggestion use `--destructive`, `--accent-green`, `--amber` with a triangle, octagon and diamond.

## Deliverable
The file your brief names, in Markdown, then a final reply of at most 200 words: what you covered, the count of findings by severity, anything you could not inspect and why, and the path of the file. ALWAYS write the file and send the reply, even if partial.
