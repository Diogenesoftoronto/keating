Rebuild the Keating landing page (the `/` route of the web app) to the new mockup. You are lane LP.

Read `_common.md` in this folder first, then `../texture-rules.md`, then this brief.

WHY
The owner asked for a landing page redesign that keeps the charm and the problem-then-solution shape, and that shows a painful part of learning with AI models. The mockup's answer: keep the wall of text as the picture, but lead with the pain it causes: it made sense when you read it, and it was gone the next day.

DESIGN (the target; board pixels are app pixels)
- Built page: `docs/design/2026-11-19-review-chat-mockups/landing-mockups.html`. Open it in a browser and use it; the opening is interactive.
- Sources: `src/landing.body.html` (boards LP1 the three openings, LP2 the page, LP3 the phone, with the notes under each) and the block "Landing page" at the end of `src/shared.css`.
- Build opening A ("It made sense yesterday."). Keep the hero's copy and its right-hand "play" in one component so another opening can replace it later without touching the rest of the page.

SCOPE (you own, under `web/src/`)
`pages/Landing.tsx`, `pages/landing-page.css`, `components/Landing*.tsx`, `components/landing-*.css`, `components/landing-examples.ts`, new files beside them with the same `Landing` / `landing-` prefix, and their tests. You may add static media under `web/public/landing/`.
DO NOT TOUCH: `components/Nav.tsx` and `components/Footer.tsx` (shared with the other public pages; use them as they are), the other public pages (Pricing, Download, Blog, Paper), the kit, glyphs, shaders, charts and motion helpers (use them; report what they lack), `hooks/useLandingAnalytics.ts` and `hooks/useSeo.ts` (use them), any app page, and anything under `web/src/keating`.

WHAT TO BUILD (board LP2, top to bottom)
1. Opening. Kicker "Seen this before?", the headline, the lead, the two actions and the fine print. On the right, the three tilted chatbot windows (from `landing-examples.ts`; keep the line "Illustrated examples · authored text, not provider transcripts") and the four beats: You ask, It answers, You nod, The next morning. It advances by itself, holds longest on the last beat, pauses while the pointer or keyboard focus is inside it and while it is off screen, and each beat is a real button (`aria-pressed`). With reduced motion it rests on the last beat and does not advance. The blurred wall in the last beat is decoration at that point: hide it from assistive tech and give the play one visually hidden sentence that tells the same story.
2. "You asked to learn. You got more to read." with the mascot under falling printouts (`KeatingBot variant="body" state="dizzy"`, sheets in CSS; still under reduced motion). This replaces `FrustrationClip` on this page. Leave `FrustrationClip.tsx` and the files under `public/landing/clips/` where they are, unused, so the swap can be undone; say so in your report.
3. The study. Copy exactly as drawn. The chart has three rows (practice with a chatbot +48%; the exam without it −17%; the exam with the same model told to give hints, no drop), drawn to the chart rules (`tools/chart-rules.md`): text in ink, every value written, hatch as well as colour for the loss, and a table alternative for assistive tech (`ChartFrame` from the chart kit gives you the frame and the table). The citation links to https://www.pnas.org/doi/10.1073/pnas.2422633122 and opens in a new tab. Do not add numbers or claims about the study beyond what the board says.
4. "so we made keating": keep `LandingIntro`'s film behaviour exactly (the video, captions, playing inside the click, the blocked-playback message). Restyle only. The field shader sits behind it.
5. The lesson. The left column as drawn. The right column is a working miniature of chat, not a picture: a subject picker (the three examples), the learner's message, Keating's question back with three guesses (choosing one shows Keating's next line; a wrong guess gets a kind correction, not the answer), the code or text to predict from, then the existing practice check from `LandingPractice` (keep its logic, data and the reset). Use the composer look from `web/src/pages/chat/chat-surface.css` ("Composer, as drawn on board C1"); the composer here is for show: it must not accept input or send anything, and it must not be focusable as if it did (make it an illustration with `aria-hidden`, and keep "Try it. Nothing is sent." visible). Do not import the real chat panel, the agent or any model code into this route.
6. Four pairs: the pain in display type, a sentence, then the answer in green, a sentence, and a small screen beside it. The four screens are built from kit components with fixed sample data. Add " · example" to each small screen's label, as today's page does for its examples.
7. "Make it your own": three tiles, the two links (setup guide via `DOCUMENTATION_URL`, the source on GitHub; keep today's targets).
8. "Watch it work". Read clips from a small typed manifest in your scope (title, one line, duration, poster, mp4, webm, captions, link to its walkthrough guide). Render only entries whose media exists; never a placeholder. Today one recording exists: `docs/walkthroughs/media/lesson-in-chat.mp4` and `.webm` (with its captions and still beside it); copy those into `web/public/landing/walkthroughs/` and list that one. The layout must look right with one clip and with four. Videos use `preload="none"` and a poster, and play inside the click.
9. Closing: keep `LandingClosing`'s two actions and their analytics; restyle to the board (mascot clapping, "Done offloading?", the headline).
10. Phone (board LP3), the Terminal (dark) theme, reduced motion and effects off all have to read well. No horizontal scroll at 320px.

MUST KEEP
- Analytics: the same event names and properties as today (`download_intent`, `start_session_clicked`, `landing_lesson_selected`, and the section-view tracking that `useLandingAnalytics` drives through `data-landing-section`). Give each new section a `data-landing-section` value. Do not add new event names or send anything new.
- SEO: `useSeo` stays, canonical unchanged. New title: "Keating: it made sense yesterday". New description: "A chatbot explains it and you nod. The next day it is gone. Keating is an AI teacher that asks before it tells, checks what stuck, and remembers where you are. Start in the browser or download it."
- Every link and destination on today's page still exists on the new one.
- The page stays light: no new dependencies; nothing from the app's chat, agent or model code in this route's bundle; images sized so nothing shifts as they load.

CLAIMS (important)
Every sentence that says Keating does something must be true of the app as it ships, by default, for a new user. Check each against the code before you write it into the page, and soften or cut what is not true. In particular:
- "Replies are checked before you see them. A second pass reads each reply against the lesson and your sources. When something could not be verified, it says so." Read the turn pipeline, the judgement settings (`web/src/keating/judgement-model.ts`, its default backend) and how unverified replies are marked. Word it to match what happens with default settings.
- "What you practised returns as short reviews, spaced out." Check Coming up (`pages/ComingUp.tsx`) and the flashcard scheduler.
- "Goals and practice carry into the next session. You can read and edit everything Keating is told about you."
- "run one in your browser with no connection at all", "stay on your device unless you share them", "Export all of it".
List each claim, what you found, and the final wording in your report.

VERIFY
Focused tests for every file you changed (add tests for the beats: buttons, reduced motion, pause on focus; for the manifest filter; keep existing landing and analytics tests green). `bunx tsc --noEmit` once at the end. Capture the page at 1440x900 and 390x844, light and dark, and compare with the board; run `harness/probe-borders.js` on it. Captures under /tmp/keating-design-shots/LP/.

REPORT (400 words at most): what you built; the claims table; anything on the board the app cannot back up; what you kept from the old page and where it went; test and typecheck results, with failures marked yours or not yours.
