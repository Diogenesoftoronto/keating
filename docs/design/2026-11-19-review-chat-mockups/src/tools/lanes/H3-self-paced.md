Rebuild SELF-PACED COURSES in the Keating web app (the `/learn` index and a course) on the new design system. You are lane H3. These pages had no design until now and still wear the older style.

Read `_common.md` in this folder first, then this brief.

DESIGN: `docs/design/2026-11-19-review-chat-mockups/src/flows.body.html` board SP1 ("Your courses" and "Inside a course") with its six notes; classes in `src/shared.css` under "Live, self-paced, course builder" (`.spc`, `.crow`, `.arow`) and the lesson frame from `lessons.body.html` (`.act`). Built page: `flows-mockups.html`.
INVENTORY (every control, label and state; nothing may be lost): `tools/maps/gaps-collab.md`, "Undrawn screens" section H (self-paced: index, draft and course header, preparation and progress, plan and practice).
CHARTS: `tools/maps/charts-map.md` entries S05 (activity status rail) and S06 (token budget): chart-kit `Progress` (done ink, current outlined, to do track, with "n of m" written) and `Meter`.

SCOPE (you own, under `web/src/`): `pages/SelfPaced.tsx`, `pages/self-paced.css`, any `components/self-paced/**`, and their tests.
DO NOT TOUCH: the self-paced planning, preparation, marking and evidence logic and storage (presentation only), course (taught) files, lesson components owned by other lanes (use the shared lesson frame in `web/src/components/lesson/` for the activity card).

WHAT TO BUILD
1. Index: kit `AppBar`; the bot and "Study one thing at your own pace"; the start form as one card (Paper or topic; Link, optional; What you already know, optional; What do you want to be able to do?) with the cost of drafting stated beside "Draft a plan" ("Drafting your plan…" and Cancel while it runs; the form toggles as today when a library exists); "Your courses" as rows: title, state in words with the next step, progress as counted cells, one action (Continue / Review plan / Open); loading, empty and error states with the bot and one action.
2. A course: back to all courses and a More menu (Edit title or goal, Download as Markdown); the title in the reading face with the goal; "Before you start (n)" when present; TWO separate blocks: "Where you are" (step n of m as `Progress`, counts of answers without help and with help) and "Preparation" (activities ready as a `Meter`, the token budget, and its controls: Pause / Resume, Stop preparing, Prepare the remaining activities, Try again, Allow n more tokens, each in the state the inventory lists).
3. The plan as the list you work down: each activity a row with a glyph for its state (done `check`, done with help `minus`, current, locked `lock` with what unlocks it, delayed recall `clock` with when it opens, skipped), its kind, and Open / Review / Close; "I already know this" / "Bring back"; "Plan changes (n)" as a disclosure.
4. The open activity in the shared lesson frame: notes or refresher behind "Show the notes" with the sentence that answers after that count as "with help" placed under the answer field (not inside the button label), "Mark as read", "Show a hint", the answer field, "Submit answer" ("Marking…"), "Mark this answer", the result in the shared words ("Correct", "Not quite", "Partly" with glyphs), evidence and attempts, then "Next: {title}".
5. Draft review: "Review this plan" with "Approve and start preparing" (primary, right) and "Discard" (quiet, left, confirmed with `ConfirmDialog`).
6. Phone: one column; the two blocks stack; the plan rows keep their state glyph and action; the activity's footer has the primary full width.

VERIFY: focused tests for every file you changed; typecheck once; look at `/learn` and a course at 1440x900 and 390x844 in light and dark (seed a draft and an in-progress course through the page's own storage module in a browser step, the way `harness/seed.js` seeds sessions; say what you could not reach).
