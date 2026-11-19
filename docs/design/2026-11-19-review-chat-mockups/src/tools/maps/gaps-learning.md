# Keating redesign gap map · A4

Audited the active design-pass checkout at `/home/diogenes/.cache/keating-deploy/design-pass-20261119`. App paths below are relative to that checkout. Mockup sources are under `docs/design/2026-11-19-review-chat-mockups/src/`. The board captures are `mock-<board>.png`, and app captures are in [shots/A4](./shots/A4/). The desktop harness viewport was 1440×900. The mockups scale an intrinsic 1120px artboard in that viewport. Phone mockups draw 320px frames, and app phone captures use 390×844. Type values below are computed CSS pixels before artboard scaling. Findings describe the seeded or fresh local state and the inspected source. Sample content and counts are excluded.

App screenshots are combined at their original resolutions. Read panels from left to right. The dark mockup sheet contains C1, C4, R2 and R5 in that order. [Dark mockups](./shots/A4/mock-dark.png)

- light, dark, code, Materials open. [chat-desktop.png](./shots/A4/chat-desktop.png)
- light, dark, sessions, new session. [chat-phones.png](./shots/A4/chat-phones.png)
- desktop new session. [app-chat-empty.png](./shots/A4/app-chat-empty.png)
- index, workspace light, workspace dark. [review-desktop.png](./shots/A4/review-desktop.png)
- selection, note editor, rubric, Socratic pass. [review-details.png](./shots/A4/review-details.png)
- light, dark, note sheet. [review-phones.png](./shots/A4/review-phones.png)
- Question, Model, You, Ready. [onboarding-desktop.png](./shots/A4/onboarding-desktop.png)
- Question. [app-onboarding-phone.png](./shots/A4/app-onboarding-phone.png)
- desktop, phone. [benchmark.png](./shots/A4/benchmark.png)
- desktop, phone. [activity.png](./shots/A4/activity.png)
- desktop, phone. [coming-up.png](./shots/A4/coming-up.png)


<details>
<summary>Source paths for abbreviated evidence references</summary>

- [web/src/components/AssistantChatPanel.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/AssistantChatPanel.tsx)
- [web/src/pages/Chat.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/Chat.tsx)
- [web/src/pages/chat/ChatHeader.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/chat/ChatHeader.tsx)
- [web/src/pages/chat/chat-surface.css](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/chat/chat-surface.css)
- [web/src/components/SessionBrowserDesktop.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/SessionBrowserDesktop.tsx)
- [web/src/components/SessionBrowserSheet.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/SessionBrowserSheet.tsx)
- [web/src/components/session-panel.css](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/session-panel.css)
- [web/src/components/ChatMascotMenu.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/ChatMascotMenu.tsx)
- [web/src/components/KeatingBot.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/KeatingBot.tsx)
- [web/src/components/TurnProgress.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/TurnProgress.tsx)
- [web/src/components/ReviewNoticeCard.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/ReviewNoticeCard.tsx)
- [web/src/components/NotOrganicCreditRecovery.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/NotOrganicCreditRecovery.tsx)
- [web/src/pages/TrajectoryReviewIndex.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/TrajectoryReviewIndex.tsx)
- [web/src/pages/TrajectoryReview.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/TrajectoryReview.tsx)
- [web/src/components/trajectory/TrajectoryReviewWorkspace.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/TrajectoryReviewWorkspace.tsx)
- [web/src/components/trajectory/TrajectoryCanvas.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/TrajectoryCanvas.tsx)
- [web/src/components/trajectory/TurnRail.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/TurnRail.tsx)
- [web/src/components/trajectory/SelectionToolbar.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/SelectionToolbar.tsx)
- [web/src/components/trajectory/AnnotationEditor.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/AnnotationEditor.tsx)
- [web/src/components/trajectory/ReviewDesk.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/ReviewDesk.tsx)
- [web/src/components/trajectory/PatternDigestPanel.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/PatternDigestPanel.tsx)
- [web/src/components/trajectory/MarginProposals.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/MarginProposals.tsx)
- [web/src/components/trajectory/SocraticPass.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/SocraticPass.tsx)
- [web/src/components/trajectory/review-icons.ts](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/review-icons.ts)
- [web/src/components/trajectory/review.css](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/review.css)
- [web/src/components/ChatOnboarding.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/ChatOnboarding.tsx)
- [web/src/components/chat-onboarding.css](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/chat-onboarding.css)
- [web/src/pages/KeatingBench.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/KeatingBench.tsx)
- [web/src/keating/bench-stats.ts](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/keating/bench-stats.ts)
- [web/src/pages/bench.css](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/bench.css)
- [web/src/pages/Usage.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/Usage.tsx)
- [web/src/components/UsageCharts.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/UsageCharts.tsx)
- [web/src/pages/learning.css](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/learning.css)
- [web/src/components/usage/HostedCreditsPanel.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/usage/HostedCreditsPanel.tsx)
- [web/src/components/LearningInsightsHeader.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/LearningInsightsHeader.tsx)
- [web/src/pages/ComingUp.tsx](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/ComingUp.tsx)

</details>

## C1 · A session in progress

The compact header, local-storage line, serif replies, study chips and companion perch are in place.  
The header actions, library hierarchy and code/composer treatments still differ.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| C1-1 | C1 notes 4, 7 · Sources is a bordered book control, Materials and Review are quiet, Review uses the pen. | ChatHeader.tsx:252,270–280 and chat-surface.css:7 give the controls matching outline boxes, use book for Review and always show the Materials count. Sources has no caret in its trigger. `chat-desktop.png` (light) | wrong icon | medium | Update ChatHeader.tsx and chat-surface.css to use the pen and separate the two action styles. |
| C1-2 | C1 Model control · status dot before the model name. | ChatHeader.tsx:213–250 renders the name and caret without a leading status mark. `chat-desktop.png` (light) | missing element | low | Add the model availability mark to ChatHeader.tsx with a meaningful state label. |
| C1-3 | C1 note 6 · 248px rail with Sessions, labeled New, date groups and a filter affordance. | The seeded rail measured 263px. The header presents a count and icon controls, and the rendered list uses activity buckets and the earlier library rather than the drawn date groups. Search tools omit the illustrated filter button and shortcut keycap. SessionBrowserDesktop.tsx:373–429,502–535. `chat-desktop.png` (light) | different layout | medium | Bring the desktop default width and the rail header, dates and search controls into alignment in SessionBrowserDesktop.tsx and session-panel.css. |
| C1-4 | C1 rows · colored dot followed by the readable subject abbreviation. | chat-surface.css:47–51 sets the category font to zero and leaves the color dot. The subject is harder to identify by sight without color. `chat-desktop.png` (light) | accessibility | medium | Keep the abbreviation visible in chat-surface.css and let the remaining metadata truncate. |
| C1-5 | C1 notes 3, 5 · hard composer shadow, quiet icon tools, bulb plus reasoning caret. | AssistantChatPanel.tsx:3644–3660 uses the shared card shadow and chat-surface.css:29–32 outlines the Live action. The visible reasoning control lacks the bulb. `chat-desktop.png` (light) | different layout | medium | Apply the Kit hard shadow and match the toolbar affordances in AssistantChatPanel.tsx and chat-surface.css. |
| C1-6 | C1 latest reply · avatar, author and time on one row. | Seeded replies show a small textual author/time row without the illustrated 24px face. The body mascot remains on the composer ledge. AssistantChatPanel.tsx:4185–4248. `chat-desktop.png` (light), `chat-desktop.png` (dark) | missing element | low | Add the compact face to the latest tutor reply’s metadata in AssistantChatPanel.tsx. |
| C1-7 | C1 code figure · uppercase language, supporting execution detail and glyph-only Edit/Copy controls above numbered lines. | The code is numbered in chat. Edit and Copy are full text-and-icon pills, and the shared execution header gives an environment-dependent status line. AssistantChatPanel.tsx:1928–2003. `chat-desktop.png` (code) | different layout | low | Use compact icon controls in AssistantChatPanel.tsx’s chat code integration while retaining accessible labels. |
| C1-8 | C1 note 3 · the learner bubble sheds the heavy outline and shadow. | A clear outline is still visible around the learner message in both desktop themes, with a separate boxed avatar. AssistantChatPanel.tsx:3884–3950. `chat-desktop.png` (light), `chat-desktop.png` (dark) | colour | low | Use the softer learner surface and lighten the adjacent avatar box in AssistantChatPanel.tsx. |
| C1-9 | C1 note 6 · count-bearing subject chips replace the old selectors. | The rail has only search and row subject markers. Neither desktop nor phone renders an All/subject chip strip, so browsing by subject is unavailable. SessionBrowserDesktop.tsx:395–424, SessionBrowserSheet.tsx:205–246. `chat-desktop.png` (light), `chat-phones.png` (sessions) | missing element | high | Add shared subject-chip filtering to SessionBrowserDesktop.tsx and SessionBrowserSheet.tsx. |
| C1-10 | C1 open Materials · the header says Session workspace and the drawn materials are organized under tabs beside a compact avatar. | The empty panel says Materials, exposes All materials and emphasizes three creation actions. The composer companion does compact correctly. Chat.tsx:754–825,1133–1150 and chat-surface.css:33–45. `chat-desktop.png` (Materials open) | different copy | low | Align the panel title in the Chat.tsx materials integration and add its real empty variant to C1. |

**App is ahead**

Draw the branch-aware and resizable library in C1, including Pin, Move and per-session actions (SessionBrowserDesktop.tsx:107–139,472–489,562–575). Draw the keyboard-accessible target picker and source-checked quote chips for the companion (ChatMascotMenu.tsx:163–189,334–409).

## C2 · A new session

The greeting, centered composer, starter grid and collapsed rail actions are implemented.  
The empty state still takes a different visual shape and opens the session rail according to app state.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| C2-1 | C2 note 2 · three columns with two complete rows and a refresh glyph on the swap action. | The grid has three columns and six starter slots; the swap control is underlined text with no glyph. AssistantChatPanel.tsx:2964–2977. `app-chat-empty.png` | wrong icon | low | Add the refresh Glyph to Other suggestions in AssistantChatPanel.tsx. |
| C2-2 | C2 greeting · 25px display face and the second sentence about beginning from what the learner already knows. | The default greeting uses a serif heading at 1.24rem and the shorter mobile-style explanation. chat-surface.css:58–60 and AssistantChatPanel.tsx:2979–2985. `app-chat-empty.png` | different copy | medium | Restore the desktop sentence in AssistantChatPanel.tsx and the display face in chat-surface.css. |
| C2-3 | C2 note 4 · the empty board opens with the three-control collapsed spine. | The session panel is expanded in the seeded new-session capture. A collapsed implementation exists with Expand, New and Search and obeys the current sidebar state. Chat.tsx:974–986,1040–1063 and SessionBrowserDesktop.tsx:348–367. `app-chat-empty.png` | different layout | medium | Give the first empty session the illustrated default in Chat.tsx while preserving an explicit sidebar choice. |
| C2-4 | C2 lower row · Other suggestions at left and teaching maxim at right, below the starter grid. | The draft shortcut hint is attached to the composer with the independent Other suggestions button below the grid. AssistantChatPanel.tsx:2977,3663–3665 and chat-surface.css:72–75. `app-chat-empty.png` | different layout | low | Arrange the desktop empty-state footer with both items in chat-surface.css and AssistantChatPanel.tsx. |
| C2-5 | C2 note 3 · one greeting mascot above the question. | The greeting renders a small sprite above the heading and a second full-size sprite beside the empty composer. AssistantChatPanel.tsx:2979–2985,3450–3495 and chat-surface.css:53–57. `app-chat-empty.png` | different layout | medium | Present just the greeting pose until the first turn in AssistantChatPanel.tsx. |

**App is ahead**

Draw the real prompt prefilling, carryover draft and seeded-personalization variants on C2 (AssistantChatPanel.tsx:2900–2977,3663–3665).

## C3 · What a turn can look like

The three phases, recovery treatment, verification badge and jump control have source implementations.  
Progress placement and failure composition are the important remaining differences. This board’s provider-dependent states were inspected in code.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| C3-1 | C3 note 1 · the named phase rail sits in the tutor’s in-thread thinking row, followed by elapsed detail. | The three stages sit in a dedicated TurnProgressCard at the thread tail, above a separate spinner/headline and the step expander. Ordinary streaming without draft activity or search calls does not render this rail. AssistantChatPanel.tsx:3449–3451 and TurnProgress.tsx:54–95. `chat-desktop.png` (light) is the idle comparison. | different layout | high | Fold the compact rail into the tutor’s thinking turn in AssistantChatPanel.tsx and TurnProgress.tsx. |
| C3-2 | C3 note 2 · one red-ruled notice with one primary recovery action per failed turn. | Auth and retry render as separate conditional branches and can coexist when an auth failure also has retry enabled. Credit recovery uses its own section with wallet/checkout controls. Shared red-rule CSS exists. AssistantChatPanel.tsx:4255–4295, NotOrganicCreditRecovery.tsx:29–81 and chat-surface.css:67. `chat-desktop.png` (light) is the idle comparison. | state not handled | high | Choose one primary recovery surface per failed turn in AssistantChatPanel.tsx and keep secondary actions inside it. |
| C3-3 | C3 note 3 · the pill and thin bar signal new unseen content. | LatestReplyControl also shows a Jump to latest pill any time the reader is away, even without unread content. The bar is gated on unread. AssistantChatPanel.tsx:3544–3576 and chat-surface.css:68–70. `chat-desktop.png` (light) is the settled comparison. | different copy | low | Add the deliberate manual-jump state to C3 or gate the pill on unread in AssistantChatPanel.tsx. |
| C3-4 | C3 progress · Keating name/avatar and dots, with a Glyph caret on steps. | TurnProgress.tsx:77–89 uses a spinner and foreign Lucide alert/caret icons. `chat-desktop.png` (light) is the idle comparison. | wrong icon | low | Use Keating Glyphs and the quiet thinking affordance in TurnProgress.tsx. |

**App is ahead**

Add the expanded query timeline with source counts and explicit failed-search states to C3 (TurnProgress.tsx:34–48). Draw the persistent plain jump pill and the rendered withheld/rate-limit badge variants (AssistantChatPanel.tsx:3572–3576 and ReviewNoticeCard.tsx:78–97).

## C4 · Chat on a phone

Mobile keeps the reply at desktop size and the fork action is rendered directly on the turn.  
The header and new-session composer placement differ most. Desktop and phone share data and cards while retaining separate wrappers.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| C4-1 | C4 session header · menu, truncated title, model plus Socratic subtitle, Materials and More. | The UI includes an extra compact brand, Sources and Review icons and a separate unlabeled-by-sight model caret. The subtitle is Socratic, subject and message count. ChatHeader.tsx:160–252,270–291 and chat-surface.css:11–15,91–95. `chat-phones.png` (light), `chat-phones.png` (dark) | phone layout | medium | Keep the model in the subtitle and move the secondary controls into More at the phone breakpoint in ChatHeader.tsx. |
| C4-2 | C4 note 3 · both lists share row treatment, subject chips, search copy and empty states. | Both use the shared library/card logic and Find a session. The desktop and sheet render separate tools, category handling and empty-state wrappers. SessionBrowserDesktop.tsx:396–429,540–557 and SessionBrowserSheet.tsx:206–243,327–345. `chat-phones.png` (sessions), `chat-desktop.png` (light) | phone layout | medium | Share the rail/search/empty-state presentation in SessionBrowserDesktop.tsx and SessionBrowserSheet.tsx. |
| C4-3 | C4 new-session panel · four vertical starters above a thumb-reachable bottom composer. | Phone CSS turns the six-card desktop grid into one column while keeping the shared DOM placement after the composer. chat-surface.css:65,72–75 and AssistantChatPanel.tsx:2976–2986. `chat-phones.png` (new session) | phone layout | medium | Place the mobile new-session composer below the starter region in AssistantChatPanel.tsx and chat-surface.css. |
| C4-4 | C4 note 1 · phone replies are 15px and do not shrink meaningfully. | The probe reads 16px Literata at both desktop and 390px. The no-shrink requirement is met, with 1px larger phone copy than the drawn frame. chat-surface.css:19–20. `chat-phones.png` (light) | type scale | low | Update C4’s ruler to show the shipped 16px or tune the shared size in chat-surface.css. |

**App is ahead**

Draw a real branching entry and the mobile list’s longer session-management states in C4 (SessionBrowserSheet.tsx:240–319). The three chips can wrap, retaining access when labels lengthen (chat-surface.css:33–38).

## R1 · Review index

The queue leads, with a narrow progress strip, state filters, dates and a compact pattern summary.  
The open queue and first-review states render. The two-reviewed pattern state was inspected in source.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| R1-1 | R1 queue · active review row has a green left rule and Draft/Final status treatments vary by state. | The next row gets a faint full-row background. Its marker is an ink square whose fill changes by state, with no left accent on the row. review.css:77–89. `review-desktop.png` (index) | colour | low | Add the next-row edge and status accents to review.css. |
| R1-2 | R1 row date · recent unreviewed sessions are dated Today with a time. | The row always formats date as abbreviated month/day, even today. A review date adds the Reviewed prefix. TrajectoryReviewIndex.tsx:163–178. `review-desktop.png` (index) | different copy | low | Use readable local relative dates for today and yesterday in TrajectoryReviewIndex.tsx. |
| R1-3 | R1 note 1 · header instruction and progress strip occupy a compact but legible region above the list. | The instruction wraps early into a short narrow block while the queue spans the available page. Strip metadata and filters are approximately 11px with a 20.8px root. review.css:28–45,69–75. `review-desktop.png` (index) | spacing | low | Adjust the intro width and strip alignment in review.css to match the board’s proportions. |
| R1-4 | R1 note 4 · before two reviews the pattern area is a single quiet line. | The compact panel still renders a distinct heading with a full explanatory sentence underneath in the captured zero-review state. PatternDigestPanel.tsx:37–54 and review.css:100–111. `review-desktop.png` (index) | different layout | low | Use one inline pattern hint in PatternDigestPanel.tsx at low evidence. |

**App is ahead**

Draw saved filter/sort state, zero-review recovery copy and clickable source citations in the pattern panel (TrajectoryReviewIndex.tsx:50–64,145–162 and PatternDigestPanel.tsx:61–100).

## R2 · Review workspace reading

The desktop layout delivers the core design. The Margin docks, chrome is 84px, and the transcript uses page-wide view controls.  
The remaining differences are mostly labels, outline details and the handling of inactive turns on touch.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| R2-1 | R2 outline · role squares with excerpts and a green active accent treatment. | The app shows K/L squares with first words. Its current row uses an inset ink rule and a pale card background. The outline is wider at 1440 than the artboard’s inset column. TurnRail.tsx:63–89 and review.css:182,194–207. `review-desktop.png` (workspace light), `review-desktop.png` (workspace dark) | different layout | low | Align the active turn rule and outline proportions in review.css. |
| R2-2 | R2 note 6 · note and focus affordances are limited to the turn the reviewer is in. | The desktop hides inactive controls until hover or focus. Touch inputs fall outside this CSS and retain Note on this turn plus More on each rendered turn. TrajectoryCanvas.tsx:332–344 and review.css:135–138. `review-phones.png` (light) uses the harness’s fine-pointer emulation. | accessibility | medium | Use a single active-turn condition for action visibility and expose actions through the phone toolbar in TrajectoryCanvas.tsx. |
| R2-3 | R2 header · serif session title, outlined Draft control with a themed caret. | The heading is serif, but the status is a native select with native arrow. TrajectoryReviewWorkspace.tsx:274–290. `review-desktop.png` (workspace light), `review-desktop.png` (workspace dark) | wrong icon | low | Use the Kit select with a Glyph caret in TrajectoryReviewWorkspace.tsx. |
| R2-4 | R2 note 7 · a numbered quote marker coordinates with the corresponding desk card. | Numbering and opening the related card are implemented. The cards remain a sequential scroll list and the highlight uses a single tint plus inline numeral, independent of card vertical position. TrajectoryCanvas.tsx:201–216,905–919, ReviewDesk.tsx:254–301 and review.css:148–156. `review-desktop.png` (workspace light) shows the empty-note baseline. | different layout | low | Give selected quote and note a shared active treatment in ReviewDesk.tsx and review.css. |

**App is ahead**

Draw the artifact view, raw source, runnable-code interactivity, review export confirmation and save-before-export state on R2 (TrajectoryReviewWorkspace.tsx:258–264,367–393 and TrajectoryCanvas.tsx:340–387,1035–1066).

## R3 · Making a note

The four-choice selection toolbar and docked note form were captured on the seeded transcript.  
Kind selection, quote, reason, optional links and bottom actions work together. The form still contains extra chrome and the opening sequence differs.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| R3-1 | R3 selected text and its editor · selection remains visible in the transcript when the form opens beside it. | Commit clears the browser range, leaving the quote in the editor and removing the selection tint from the transcript until a note is saved. TrajectoryCanvas.tsx:875–882. `review-details.png` (selection), `review-details.png` (note editor) | state not handled | high | Track and render a temporary source mark while composing in TrajectoryCanvas.tsx. |
| R3-2 | R3 note 5 · per-note Draft/Final and human authorship move into the note’s edit menu. | A Note details disclosure renders status and authorship even on a new draft. AnnotationEditor.tsx:274–285. `review-details.png` (note editor) | different layout | medium | Show provenance controls only while editing a saved note in AnnotationEditor.tsx. |
| R3-3 | R3 keyboard bar · shows selected character tally, local turn and context-specific shortcut legend. | The toolbar choices show their individual keycaps, and the generic page footer lists workspace hints. There is no selection tally. The number keys and R are implemented. SelectionToolbar.tsx:14–34 and TrajectoryCanvas.tsx:885–899,1090–1115. `review-details.png` (selection) | missing element | medium | Add a selection-context status line in TrajectoryCanvas.tsx. |
| R3-4 | R3 editor · one optional-link row and Finish this note aligned with Cancel and Add note. | The Finish action is in the optional-links flex row. At the real margin width it wraps onto the next line and Note details occupies a separate row. AnnotationEditor.tsx:245–290. `review-details.png` (note editor) | different layout | medium | Put Finish this note on the lower action row in AnnotationEditor.tsx. |
| R3-5 | R3 selected note card has a kind-colored edge and hard emphasis, with the turn identified in its header. | The drawer inserts a general editor with uppercase New note and generic Selected turn text. The selected quotation has a neutral leading rule. AnnotationEditor.tsx:120–134 and ReviewDesk.tsx:234–235. `review-details.png` (note editor) | spacing | low | Pass the turn ordinal and kind to the editor header in ReviewDesk.tsx and AnnotationEditor.tsx. |

**App is ahead**

Draw existing-note Update, stale quote recovery and assistant-finished field provenance in R3 (AnnotationEditor.tsx:137–145,256–288 and TrajectoryReview.tsx:472–490). Add the actual key handling for N/J/K and selection 1–3/R to the board annotation (TrajectoryReviewWorkspace.tsx:180–218 and TrajectoryCanvas.tsx:885–899).

## R4 · The Margin’s other tabs

Rubric criteria, score labels, dashed proposals and the three pass actions exist.  
The app uses a taller in-flow menu and shares the rewrite ledger with the full results view.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| R4-1 | R4 note 4 · pass launcher follows the three tabs, then opens one compact menu with Model pool at the bottom. | The pass launcher is above the tabs. Opening it puts a full native pool select first, stacks three framed actions and pushes Notes/Rubric/Rewrites down. ReviewDesk.tsx:195–233 and SocraticPass.tsx:149–188. `review-details.png` (Socratic pass) | different layout | medium | Move the pass trigger below the tabs and use a compact list with the pool picker last in ReviewDesk.tsx and SocraticPass.tsx. |
| R4-2 | R4 pass actions · quiet action rows integrated into the panel and a small trailing Close cue. | The app gives each action its own full outline, with a pronounced disabled treatment on Finish this note. The three Glyph choices match the mockup. SocraticPass.tsx:143–150,176–188 and review-icons.ts:64–69. `review-details.png` (Socratic pass) | spacing | low | Use separator rows in the open Socratic pass list in SocraticPass.tsx. |
| R4-3 | R4 note 2 · proposed scoring explanation is a tight card and applying fills the original controls. | Full score provenance and confidence can occupy their own block, and the rubric also renders an Overall scoring row. ReviewDesk.tsx:321–355 and MarginProposals.tsx:182–226. `review-details.png` (rubric) shows controls without a model proposal. | different layout | medium | Keep the score grid compact and put full proposal detail in a disclosure in ReviewDesk.tsx and MarginProposals.tsx. |
| R4-4 | R4 note 3 · the compact Rewrites tab shows one focused preview and links to side-by-side Model results. | The Margin delegates to the same candidate ledger renderer used by the full canvas. There is no dedicated side-by-side link in the Margin invocation. TrajectoryReviewWorkspace.tsx:220–240,463–491 and ReviewDesk.tsx:386–409. `review-details.png` (rubric) shows the adjacent tabs. | missing element | medium | Add the explicit Model results jump to the Rewrites tab in TrajectoryReviewWorkspace.tsx. |

**App is ahead**

Draw the applied-estimate provenance and editable Overall rating, the model pool editor and the empty/retry cases for rewrites in R4 (ReviewDesk.tsx:321–355,388–409 and pages/TrajectoryReview.tsx:387–423).

## R5 · Review on a phone

The compact top bar, three main tabs and thumb navigation are in place in both themes.  
The title has very little room, and per-turn commands compete with the bottom note action.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| R5-1 | R5 note 3 · a compact bottom sheet leaves useful transcript context in sight and shows both form actions. | The working sheet keeps the transcript behind it. The modal dims the source, repeats the title and wraps optional fields into big stacked controls, leaving Cancel and Add note below the visible sheet area even with no text entered. ReviewDesk.tsx:411–424, AnnotationEditor.tsx:120–128,245–290 and review.css:242. `review-phones.png` (note sheet) | phone layout | medium | Use one title, a compact optional-links row and a sticky form footer in AnnotationEditor.tsx and review.css. |
| R5-2 | R5 top bar · icon-only back and Save, with maximum room for the truncated title. | The phone keeps visible Reviews and Save review labels and adds a More action. The short title is cut very early even at 390px. TrajectoryReviewWorkspace.tsx:267–319, review.css:251–254. `review-phones.png` (light), `review-phones.png` (dark) | phone layout | medium | Make back and Save icon-only with accessible labels on mobile in TrajectoryReviewWorkspace.tsx and review.css. |
| R5-3 | R5 note 2 · one stable set of Transcript, Notes and Rubric tabs. | Opening Turns, Artifacts, Rewrites or Model results adds a fourth tab for the current view. TrajectoryReviewWorkspace.tsx:242–250,397–409. `review-phones.png` (light) shows the default three. | phone layout | low | Keep three stable tabs and expose the auxiliary view as a labeled mode under its entry point in TrajectoryReviewWorkspace.tsx. |
| R5-4 | R5 reading frame · the current tutor turn’s compact overflow control complements a single Add note button at the bottom. | The app repeats Note on this turn on the active turn as well as the bottom pen. TrajectoryCanvas.tsx:332–344 and TrajectoryReviewWorkspace.tsx:521–535. `review-phones.png` (light) | different layout | low | Place whole-turn note creation on the bottom bar and keep the tutor header compact in TrajectoryCanvas.tsx. |
| R5-5 | R5 mobile transcript · the tutor role stays on one line and the model has no neighboring label. | The active turn keeps the model ID and full Note on this turn control. The author label wraps at 390px in the capture. TrajectoryCanvas.tsx:332–343, review.css:132–137,158–162. `review-phones.png` (light) | phone layout | medium | Keep the author on one line and move the model detail to the overflow menu in TrajectoryCanvas.tsx and review.css. |

**App is ahead**

Draw phone navigation to Artifacts, Rewrites and Model results, and the note/turn switching flow in R5 (TrajectoryReviewWorkspace.tsx:242–250,318–364,521–535).

## O1 · Onboarding question

The fresh browser starts with Question and shows the four named stages, a stable exit and a field-shader hero.  
The desktop wrapper and controls still read as a panel within Chat, with several small visual differences.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| O1-1 | O1 frame · a single welcome header and two-column onboarding canvas. | The app keeps the ordinary Chat header with model, sources, materials and review above the welcome header. Chat.tsx:1055–1089 and ChatOnboarding.tsx:351–359. `onboarding-desktop.png` (Question) | different layout | medium | Suppress Chat chrome during this first-run panel in Chat.tsx. |
| O1-2 | O1 choice cards · round radios with a black outline and a short inner description. | The intake modes use aria-pressed buttons with a small square pseudo-element and a green selection fill. ChatOnboarding.tsx:370–379 and chat-onboarding.css:40–47. `onboarding-desktop.png` (Question) | different layout | low | Use a visually radio-like mark for intake mode in chat-onboarding.css. |
| O1-3 | O1 hero · the 92px companion reads as a large face motif over the left-column pointer field. | The app uses the 92px full-body sprite in the same region. It occupies less of its asset box visually, and the hero wraps the heading differently. ChatOnboarding.tsx:356–358 and chat-onboarding.css:26–33. `onboarding-desktop.png` (Question) | different layout | low | Keep pose changes and align the sprite framing and hero heading in ChatOnboarding.tsx and chat-onboarding.css. |

**App is ahead**

Draw the resumed-stage indicator and focus on the current step title in O1. The app persists onboarding position by step/access/mode and restores it (ChatOnboarding.tsx:68–96,238–263,351–362).

## O2 · Onboarding Model, You and Ready

The consolidated Model choice, teaching segments and Ready receipt exist and can be reached without completing hosted sign-in.  
The Ready question is presented as a text field, and the web model/setup and accessibility details are denser than the board.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| O2-1 | O2 note 4 · the Ready receipt shows the exact question in an illustrated composer with attach, mic and Send. | The receipt shows the selected starter in a labeled read-only textarea. It never shows the composer frame or controls. ChatOnboarding.tsx:417–429. `onboarding-desktop.png` (Ready) | missing element | high | Render a clearly labeled composer preview for saved goals in ChatOnboarding.tsx. |
| O2-2 | O2 Model · hosted choice shows sign-in status inline and always makes a way forward obvious. | Signed-out users can skip, but status is implicit unless a sign-in attempt is pending or fails. The skip link sits inside the selected hosted card. The sign-in action itself can open a separate account modal. ChatOnboarding.tsx:329–345,384–402. `onboarding-desktop.png` (Model) | different layout | medium | Make signed-out status explicit and place the skip affordance beside the Model step controls in ChatOnboarding.tsx. |
| O2-3 | O2 Model · offline row remains visible with a desktop qualification. | The web app omits the offline choice until its desktop bridge resolves true. ChatOnboarding.tsx:384–390. `onboarding-desktop.png` (Model) | state not handled | low | Add a capability-gated hint or draw the browser-specific two-choice state on O2. Change ChatOnboarding.tsx if the hint belongs in the web flow. |
| O2-4 | O2 notes 2, 3 · short teaching chips and one accessibility-switch cluster including Larger text. | QuickChoices adds a visible Not answered segment to each scale, spells out longer options and uses extra controls for text size and contrast. This grows the form and moves the accessibility controls below the initial choice row. ChatOnboarding.tsx:200–230 and chat-onboarding.css:51–54. `onboarding-desktop.png` (You) | different layout | medium | Keep unset values possible while shortening the segment labels and grouping accessibility controls in ChatOnboarding.tsx. |
| O2-5 | O2 Ready · 52px face beside status, with the two closing actions on one line. | The app keeps the left hero and generic Back action even on Ready. The right receipt starts with a bare heading and introduction. ChatOnboarding.tsx:351–362,417–440. `onboarding-desktop.png` (Ready) | different layout | low | Align the Ready portrait and action hierarchy in ChatOnboarding.tsx. |

**App is ahead**

Draw the hosted account modal, BYOK setup handoff, verified signed-in status, conversation fallback and interactive Anki import/proposal variants in O2 (ChatOnboarding.tsx:329–345,384–428).

## B1 · Model benchmark

The learning tabs, segmented evidence switch, lead verdict, seven columns and threshold scale are shipped.  
One unranked model was visible after switching to Both. The two-ranked overlap and leader-band behavior were checked in source.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| B1-1 | B1 note 3 · the outcome point has its exact score printed next to the interval on the shared scale. | The desktop prints the score on a new line below the plot. Range details live in native title and ARIA text. KeatingBench.tsx:488–503 and bench.css:34–41. `benchmark.png` (desktop) shows the unranked equivalent. | different layout | medium | Put the visible score beside the range, with an edge-clamped label, in KeatingBench.tsx and bench.css. |
| B1-2 | B1 note 4 · when showing a row’s evidence, its expanded region leads with the seven dimensions and essential details. | Rows default collapsed. The inline region adds model ID, evidence and quiz details, and the current click target is the model-name button alone. KeatingBench.tsx:506–541. `benchmark.png` (desktop) | different layout | low | Give the disclosure a clearer whole-row affordance while retaining keyboard semantics in KeatingBench.tsx. |
| B1-3 | B1 evidence split · three colored segments separated by fine gaps, with numbers accessible beside the plot. | The three segments touch. Counts per signal kind are available in the expanded row and native hover text. KeatingBench.tsx:524–536 and bench.css:42–43. `benchmark.png` (desktop) | colour | low | Restore the segment gaps in bench.css and keep the numeric split accessible in KeatingBench.tsx. |
| B1-4 | B1 note 3 · a row that touches the leader’s band is tied with the leader. Other tie labels should be legible against the shown evidence. | A lower row can be labeled tied with an earlier non-leader while every plot shades only the leader. That row’s tie partner’s interval is visible in another row only. KeatingBench.tsx:515–522,765–771 and bench-stats.ts:61–71. `benchmark.png` (desktop) is the unranked baseline. | accessibility | medium | Include the joint range or a text explanation for non-leader ties in KeatingBench.tsx. |

**App is ahead**

Draw the insufficient-evidence and empty verdict modes, unranked point without a confident interval, richer expanded metadata and the live/missing replay-stage explanation on B1 (KeatingBench.tsx:488–503,529–540,737–785 and bench-stats.ts:75–91).

## U1 · Learning activity

The four dashboard rows, three tiles, unified spend table, ranked topic bars and quiet data footer match the broad structure.  
The period and heatmap behavior, recent-row density and data legends show separable differences.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| U1-1 | U1 note 1 · selected period drives the dashboard, with scope exceptions clearly marked. | Daily activity reads all session metadata and selects a calendar year independently of the global period. Feedback, topic and improvement panels also receive all-time data. Labels make that explicit but changing the period still leaves the largest chart unchanged. Usage.tsx:233–245,296–306 and UsageCharts.tsx:83–92,205–236,694–737. `activity.png` (desktop) | state not handled | high | Feed in-range sessions to the primary heatmap or explicitly redefine the scope of the overview in Usage.tsx and UsageCharts.tsx. |
| U1-2 | U1 heatmap · compact, square cells and a header intensity legend with the active day’s sessions displayed immediately below. | The app renders a 52-week year grid, with a year button above it, a low-to-high legend below, and no visible selected-day list until a day is opened. UsageCharts.tsx:742–776,811–940. `activity.png` (desktop) | different layout | medium | Keep year navigation compact and initialize the day inspection from the latest in-range active day in UsageCharts.tsx. |
| U1-3 | U1 Recent learning · session title, one-line focus and right-aligned time/turns. | The app gives each row stacked title, preview and richer metadata, so fewer rows fit on the same screen. Usage.tsx:300–307,322–329 and learning.css:27–36. `activity.png` (desktop) | spacing | medium | Use the board’s inline metadata layout in learning.css and disclose extra fields on interaction. |
| U1-4 | U1 improvements chart · short legend above the graph and retained/rejected run tally underneath. | It renders the legend after the dates and shows independent counts for benchmark, policy, prompt and improvement attempts in the title area. UsageCharts.tsx:225–228,401–416,430–474 and Usage.tsx:308–311. `activity.png` (desktop) is the no-runs baseline. | different layout | low | Place the compact legend above the chart and surface run dispositions where available in UsageCharts.tsx. |
| U1-5 | U1 note 6 · one quiet footer row with the sandbox-history option shown as a compact checked chip. | The footer is a single utility area, but the sandbox option uses a plain checkbox and an additional all-time chip joins the row. Usage.tsx:165–180 and learning.css:60–65. `activity.png` (desktop) shows the upper dashboard. | different layout | low | Style the existing checkbox as a compact labeled chip in Usage.tsx and learning.css. |

**App is ahead**

Draw heatmap year/day drill-down, accessible tabular reads, exact evolution diff, token-based cost fallback, and hosted wallet signed-out and partial-failure states in U1 (UsageCharts.tsx:242–253,417–425,775–940, Usage.tsx:261–291 and HostedCreditsPanel.tsx:97–145).

## M1 · Onboarding, benchmark and activity on a phone

The layouts adapt at 390×844. The four-number stepper, benchmark cards with plots, three activity tiles and shared learning sections are present.  
Onboarding’s primary action drops below the first viewport. The learning pages keep desktop extras the phone frames omit.

| ID | Mockup requirement | App evidence | Kind | Severity | Suggested fix |
|---|---|---|---|---|---|
| M1-1 | M1 note 2 · Question shows four numbers and a full-width Continue within thumb reach. | The first-run view keeps the Chat header, uses Go straight to chat, then stacks the question description, starter chips and both mode cards. The primary control lies below the viewport in the capture. Chat.tsx:1055–1089, ChatOnboarding.tsx:351–381,434–440 and chat-onboarding.css:70–85. `app-onboarding-phone.png` | phone layout | high | Give onboarding a compact mobile header and a sticky action in Chat.tsx and chat-onboarding.css. |
| M1-2 | M1 benchmark · a short verdict card lets ranked models enter the first screen. | The desktop verdict chips, evidence totals and full caveat remain in the phone card. The status of an unranked model and its point were verified, while the ranked range is supported by the same plot markup. KeatingBench.tsx:488–503,735–754 and bench.css:77–101. `benchmark.png` (phone) | phone layout | medium | Keep the phone verdict to headline, explanation and a short caveat in KeatingBench.tsx and bench.css. |
| M1-3 | M1 benchmark header · back glyph, title and export glyph alone. | The shared phone AppBar retains a visible Chat label and a More button beside Export. LearningInsightsHeader.tsx:20–34 and KeatingBench.tsx:727–731. `benchmark.png` (phone) | phone layout | low | Match the phone action hierarchy in LearningInsightsHeader.tsx and bench.css. |
| M1-4 | M1 Activity · short period labels, three compact summaries and a compact day grid. | The app retains the desktop period names and full comparison sentences. The heatmap keeps a 17rem minimum and a full calendar-year grid, making the chart denser than the drawn short view. Usage.tsx:253–257,294–304 and learning.css:57,74–85. `activity.png` (phone) | phone layout | medium | Use the short labels and compact first-window heatmap in Usage.tsx, UsageCharts.tsx and learning.css. |

**App is ahead**

Draw the actual Coming up page in M1, with due cards, assignments, readiness and empty queue. It already uses the same linked tabs (ComingUp.tsx:551–579,630–662 and LearningInsightsHeader.tsx:26–34). Draw the phone benchmark card’s expand control and sparse-evidence state too (KeatingBench.tsx:503–541).

## Ten most valuable fixes

1. Place the C3-1 progress rail inside the thinking turn so the reading flow stays continuous.
2. Route C3-2 failures through one recovery card per turn, preserving the relevant auth, retry or credit action.
3. Keep the selected passage marked while the R3-1 editor opens alongside it.
4. Keep the M1-1 first-run Continue action within thumb reach and trim the mobile header.
5. Show the O2-1 question inside a recognizable composer preview.
6. Align U1-1’s primary heatmap with the chosen period and keep the scope of broader history explicit.
7. Make the C4-1 and R5-2 titles usable at phone width by reclaiming header space.
8. Add the C1-9 subject chips to the shared desktop/phone session experience and align the C4-2 empty states.
9. Keep the R5-1 note-sheet actions in reach and preserve visible transcript context.
10. Make B1-4’s non-leader ties readable against their actual partner range.

## States the boards did not draw

| State | Finish assessment |
|---|---|
| Chat startup and no model | The waiting view has a branded status and escape action. The first empty session can then surface model setup through its own entry points. Visually finished loading screen, with the ready-state chrome differences in C2. `onboarding-desktop.png` (Question) shows settled onboarding. Chat.tsx:935–943,1055–1109. |
| Chat failed searches, withheld reply, exhausted recovery and support reporting | Actionable and explicit in code. The composition needs consolidation when branches can share one turn, as in C3-2. TurnProgress.tsx:34–48, ReviewNoticeCard.tsx:78–97, AssistantChatPanel.tsx:4273–4295. |
| Chat long titles, long code, quote drafts and branch navigation | Desktop title truncation and quote interaction are deliberate. The phone title loses useful characters and mobile wrapping requires follow-up. `chat-phones.png` (light), `chat-phones.png` (sessions). ChatHeader.tsx:209–211, chat-surface.css:2–5, AssistantChatPanel.tsx:3663–3665. |
| Review index loading, unavailable storage, empty library and no search matches | Search reset and empty-library action are designed. The storage-read error makes the fallback to unreviewed explicit. TrajectoryReviewIndex.tsx:150–163. |
| Review missing/no-turn session, no notes, empty Rewrites and save/pass errors | No-note state has clear next steps in the captured Margin. No-turn and missing results are represented. Pass errors are dismissible, and save errors are inline. `review-desktop.png` (workspace light), `review-details.png` (Socratic pass). TrajectoryCanvas.tsx:985–1005, ReviewDesk.tsx:207–245,385–409. |
| Review long quoted note and long transcript | The quote block scrolls with a bounded height, and the transcript wraps prose. The title truncates heavily on the phone. `review-details.png` (note editor), `review-phones.png` (light). AnnotationEditor.tsx:132–134, review.css:131–142. |
| Onboarding signed-out, interrupted sign-in, no usable inference and no goal | Finish is possible without hosted sign-in. The form fallback is explicit and the app declines to keep uncertain inferences. The empty Ready receipt visually thins out. `onboarding-desktop.png` (Model), `onboarding-desktop.png` (Ready). ChatOnboarding.tsx:393–429. |
| Benchmark loading, empty, sparse evidence and read error | Loading and empty have shader states, insufficient evidence is explicit, and failure offers Retry. Sparse benchmark shows a hollow point and how many signals are needed. `benchmark.png` (desktop), `benchmark.png` (phone). KeatingBench.tsx:488–503,758–775,803–840. |
| Activity empty period, missing prices, no topic evidence, unavailable chart data and signed-out credits | No period offers Show all time. Cost switches to token share on absent prices. The Topics panel has a retry, while the adjacent feedback and improvement failures have only text. The wallet handles partial failures independently. `activity.png` (desktop), `activity.png` (phone). Usage.tsx:248–307, UsageCharts.tsx:211–237, HostedCreditsPanel.tsx:97–145. |
| Coming up empty queue, assignment discovery, load/error and readiness | Empty queue has clear copy and review action stays disabled. Ready, loading and assignment states reuse the learning navigation. Error has a live region at the foot of the queue, leaving room for more local recovery. `coming-up.png` (desktop), `coming-up.png` (phone). ComingUp.tsx:551–579,630–666. |

## Motion, shaders and companion

- **Chat entrances and transitions (C1–C3).** The mockup staggers rail, reply and chips, springs the composer in, scales the starter cards into view, and reveals the unread bar before the spring pill. It types study-chip text, lifts the outgoing bubble from the composer and follows it with the tutor dots. The app uses a small generic turn rise, title fade, immediate chip draft insertion and an immediate unread affordance. The mockup timing and choreography are absent. `src/ui-motion.js:20–36,200–224`, `chat-surface.css:68–82`, `AssistantChatPanel.tsx:3572–3576,3633–3642`.
- **Review list and workspace (R1–R3).** The mockup counts the reviewed total up and draws the final/draft bars in sequence, slides in the outline and Margin, and delays the number springs until after highlights ink in. The app staggers rows and animates saved mark fills and numbers, without the coordinated index count, sequential progress segments or outline/Margin entrance. The selection toolbar and draft editor appear directly, without the mockup’s selection wash, toolbar spring and later editor slide. The demo’s simulated typed text illustrates the desired sequence. `src/ui-motion.js:43–70`, `TrajectoryReviewIndex.tsx:125–139,162–179`, `review.css:148–156`, `TrajectoryCanvas.tsx:839–882`.
- **Review tab and proposal changes (R4).** The mockup retracts the old tab underline and springs in the new one from the travel direction, collapses dismissed proposal cards, and coordinates an accepted note’s mark, reference, count and outline indicator. The app animates note count and applied score cells and paints saved spans. Those animations are independent and the mockup’s directional underline and coordinated acceptance/dismissal sequence are absent. `src/ui-motion.js:117–128,136–166`, `ReviewDesk.tsx:129–150`, `review.css:148–156`.
- **Onboarding and activity (O1, O2, U1).** The app has a stage-level spring, active step motion and chart fills/draws. The mockup staggers the onboarding hero, controls and stepper, and independently springs the selected heatmap square. These leaf-level sequences are absent. `src/ui-motion.js:82–92,232–240`, `ChatOnboarding.tsx:356–359`, `chat-onboarding.css:65–69`, `learning.css:66–69`, `UsageCharts.tsx:811–940`.
- **Shaders.** The app already has paper/CRT, pointer lighting, theme power transition, onboarding/empty field and ink-surface primitives. The mockup’s small face shader samples a dedicated bot texture on each avatar at 24 fps, with eye/pointer response. The shared app shader mounts paper, glass, power, ink and field while KeatingBot uses a sprite/asset path. The small-avatar shader is the remaining distinct effect. `src/shaders.js:148–187`, `web/src/design-system/shaders/mount.ts:32–112`, `KeatingBot.tsx:87–107`.
- **Companion behavior.** The mockup’s held/fall/land cycle, target inspection, lesson hint and an editable quoted question have counterparts in the app. The keyboard-accessible selector and source revalidation are further app features. The standalone demo’s timed message and block choreography belongs to its simulated scene, while the app reacts to real chat events. `src/companion.js:67–105`, `ChatMascotMenu.tsx:60–93,163–189,334–409`, `web/src/components/companion/useCompanionDrag.ts`.

## Verification limits

The seeded review had no saved notes, model-generated proposals or cross-session pattern result. I opened the live selection toolbar, a docked note editor, Rubric and the Socratic pass menu without invoking a provider. Ranked two-model benchmark overlap, live streaming and failure recovery, populated review proposals and hosted-wallet charges were source comparisons. The phone capture sets viewport size and retains the harness’s fine-pointer emulation. Dark mode was forced through the root class for chat and review. I also captured the Terminal variants of C1, C4, R2 and R5. The mobile note sheet was opened programmatically after a development overlay intercepted the pointer. Comparing at a true 320px viewport and against OS touch selection is outside these captures. A development overlay appeared on some phone captures and was excluded from design findings.
