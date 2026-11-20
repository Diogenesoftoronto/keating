Find and fix two behaviour bugs that turned up while the walkthroughs were being recorded. You are lane B1. These are bugs in what the app does, not in how it looks.

Read `_common.md` in this folder first, then this brief. The findings, with stills, are in `docs/walkthroughs/findings/README.md`.

RULES FOR THIS LANE
- Reproduce each bug before changing anything, and say how you reproduced it. A fix without a reproduction is not accepted. If you cannot reproduce one after a real attempt, stop on that bug and report exactly what you tried and saw.
- Fix the cause, not the symptom. Do not hide duplicates in the list, and do not add a retry around the toolbar.
- Smallest change that fixes it. No restyling, no refactors, no renamed exports. Keep what is stored and what is sent the same except where the bug is the storage itself.
- Add a test for each fix that fails before the fix and passes after.
- The walkthrough recorder can drive the exact flows: `scripts/walkthroughs/README.md`, storyboards in `scripts/walkthroughs/storyboards/` (`phone-tour.json`, `review-a-session.json`), fixtures in `scripts/walkthroughs/fixtures/`. Record to a folder under /tmp/keating-design-shots/B1/ (pass `--out=`); do not overwrite anything under `docs/walkthroughs/`.

BUG 1: one flashcard reply appears twice in Materials
Finding: "Phone tour · Open Materials. Making one new flashcard deck shows two indistinguishable one-card 'Recursion cards' entries." The flow is: open the seeded session "How recursion returns", press the study chip "Make flashcards", press Send, the scripted tutor replies with one flashcard deck, open Materials: two entries for that one deck under Practice.
Where to look: Materials lists one entry per stored presentation record (`web/src/keating/session-materials.ts`, the loop over `records`, de-duplicated by `record.id`). A record's id is `${document.id}:${node.id}` (`presentationsFromAssistantText` in `web/src/keating/judgement/active-work-host.ts`), and a document's id is derived from the scope `{ sessionId, messageId }` when the reply does not carry one. Records are written from the reply component when a live turn finishes (`web/src/components/AssistantChatPanel.tsx`, the effect that calls `recordAssistantPresentations`, guarded by `liveTurnRef`). My unproven guess: the same reply is recorded under two message ids (for example once for the streamed message and once for the message that replaces it when the turn pipeline releases or persists the reply), giving two document ids for one deck. Check what the two stored records actually contain (read the presentation store in the page after reproducing) before believing that.
Also decide, from what you find, whether records already stored twice on people's devices need handling. If they do, prefer reading them correctly over rewriting stored data, and say what you chose.

BUG 2: the selection toolbar stops appearing in Review
Finding: "Reviewing a session · Open a rewrite draft. The selection toolbar repeatedly failed to reopen for the rewrite after the three notes had been saved. The existing note affordance appeared on the marked passage. A nearby unmarked passage also failed to reopen the toolbar." So after saving notes on a transcript, selecting further text (marked or unmarked) no longer brings up the toolbar that offers a note or a rewrite.
Where to look: `web/src/components/trajectory/**` (the transcript's selection handling and the toolbar), and the hooks it uses for passage selection. First establish whether a person selecting text with a real pointer drag and with the keyboard hits this, or only the recorder's synthetic selection does. If it is only the recorder, the app is fine: say so, and fix the storyboard step in `scripts/walkthroughs/` instead (that folder is in scope for this purpose only).

SCOPE: the files named above and their tests; anything else you must touch to fix the cause, listed in your report with the reason. DO NOT TOUCH styles, the kit, the mockups, `docs/walkthroughs/` media and pages.

VERIFY: focused tests for every file you changed; `bunx tsc --noEmit` once at the end; reproduce each flow again after the fix and confirm the result (for bug 1, the count of entries in Materials and the stored records; for bug 2, the toolbar appearing after three saved notes on both a marked and an unmarked passage).

REPORT (350 words at most): for each bug, how you reproduced it, the cause in one or two sentences with file and line, the fix, the test, and what you saw after. Anything else that looked wrong on the way, one line each, unfixed.
