Record the full set of Keating walkthroughs against the finished app, then put them where learners will see them: the walkthrough viewer, the learner documentation, and the landing page. You are lane W2. The planning lane (W1) wrote the plan, the recorder, the fixtures and one proof recording; you run it for real.

WHERE
- Repository: `/home/diogenes/.cache/keating-deploy/design-pass-20261119` (branch `feature/design-pass`, hundreds of uncommitted files; that is expected). Read its `AGENTS.md`. Never commit, push or deploy. Do not run Vet. Do not edit the stale checkout at `/home/diogenes/Projects/experiments/keating`.
- The app is running at `http://localhost:3420` (client and API; a local account per browser profile). Do not start another dev server. Do not run test suites or builds.
- Memory: one headless browser at a time and one encode at a time, always closed when done. No parallel captures. If a command dies with signal 9, wait and run it again.
- Screenshots and scratch output under `/tmp/keating-design-shots/W2/`; that folder is wiped on restart, so anything you want to keep goes in the repository paths below.

READ FIRST
1. `docs/walkthroughs/PLAN.md` (the 13 storyboards, their start states, destinations and capture boundaries) and `scripts/walkthroughs/README.md` (how to record one, how to record all, the fixtures, the known limits).
2. `scripts/docs-site/README.md` (the content, screenshot and video contracts of the learner documentation), `scripts/docs-site/shots.json`, `scripts/docs-site/content/*.json`.
3. `docs/design/2026-11-19-review-chat-mockups/src/tools/lanes/LP-landing.md`, section 8 "Watch it work", and the landing page's clip manifest it describes (find it under `web/src/components/` with the `landing` prefix).
4. What changed in the app since W1 planned: the chat shell (bare icon buttons, an icon-only Live button, a quiet reasoning label, an ink "New" button and one-line session metadata in the rail, your messages as plain cards with their tools shown on hover, reply actions shown on hover for earlier replies), Settings (four groups: Interface, Learning, Models and connections, Data and support, each with sections; deep links like `/chat?settings=models.jobs`), sharing (a consent sheet), and a borders-and-texture pass on every surface. Control labels may differ from the storyboards: check each against the live app before recording and update the storyboard, not the app.

SCOPE (you own)
- `scripts/walkthroughs/**` and `docs/walkthroughs/**` (storyboards, fixtures, recordings, viewer pages).
- `scripts/docs-site/content/**`, `scripts/docs-site/shots.json` and `scripts/docs-site/assets/**` for the pages and screenshots that show changed interface.
- `web/public/landing/walkthroughs/**` (media) and the landing page's clip manifest file (data only: add entries; do not change the component).
DO NOT TOUCH application source under `web/src` (other than that one manifest), `web/server`, `packages`, `mobile`, or `video/`.

WHAT TO DO
1. Record all 13 walkthroughs in the plan, desktop (1280x800) for all and phone (390x844) where the plan asks. Use the fixtures and the scripted local provider; nothing hosted, no sign-in, no payments, no real model downloads, no live voice. Where a storyboard needs two people (the study room), use two browser profiles in sequence as the plan describes; if the handoff cannot be recorded honestly, record the one-person version and say so.
2. For every take: check it yourself. Extract a frame every three seconds and look at each; confirm the pointer is visible and lands on the control named in the step, captions match what is on screen and stay up long enough to read, chapters seek to the right moment, nothing is covered by a development overlay (hide the OpenUI inspect button and any dev-only chrome before recording), no error overlay, no half-loaded state, no real personal data. Re-record a take that fails any of these. Each clip: H.264 MP4 with `+faststart` plus WebM when smaller, a poster, WebVTT captions, at most about 4 MB.
3. Publish each through the viewer (`docs/walkthroughs/<name>.html` and `index.html`), steps beside the player, light and dark.
4. Learner documentation: for each page in `scripts/docs-site/content` that shows or describes interface that changed, update the words to the labels the app uses now, retake its screenshots through the existing capture contract, and embed the matching walkthrough where the plan's "Destinations" says. Keep the documentation's own structure and voice. Build it once at the end (`rtk bun scripts/docs-site/build.ts`) and look at three pages.
5. Landing page: cut four clips of about a minute or less for the "Watch it work" strip (A lesson in chat; Reading a session back; A course with friends; The first five minutes), copy them with posters and captions into `web/public/landing/walkthroughs/`, and add their entries to the manifest. Titles and one-line descriptions as on the landing board unless the take shows something different.
6. While recording you are the first person to use the finished app end to end. Keep a list of everything that looks broken, unfinished, inconsistent or confusing: wrong label, clipped text, a boxed icon, a control that does nothing, a state that never resolves, a slow step. One line each, with the walkthrough, the step and a still's path saved under `docs/walkthroughs/findings/`. Do not fix app code; the list is the deliverable.

DELIVERABLE (final reply, at most 350 words): the takes recorded with lengths and sizes; which were re-recorded and why; what could not be recorded honestly; documentation pages updated; the landing clips; and the findings list with the three you consider most important first.
