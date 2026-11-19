# Keating web icon inventory

Lane A1 · source `feature/design-pass` at `/home/diogenes/.cache/keating-deploy/design-pass-20261119`.

**Snapshot.** Sections 1–5 record the requested 46-glyph baseline. Source extraction and screenshots predate the migration that arrived in the same checkout during the audit. Baseline line numbers can differ from the current checkout. The handoff check at the end records the wider catalog and the remaining package-backed candidates observed during that migration.

**865 foreign icon entries.** 465 can use an existing Keating glyph, 374 need a drawing, and 26 have a reason to stay. 95 distinct proposed glyphs. See section 5 for the count by surface.

Rows count source icon occurrences and separately selectable states. Shared selectors are listed at their defining entries, and a known consuming slot may also be listed when it gives the designer a concrete migration location. Repeated data-driven items do not multiply the count. Reicon’s two outline/filled layers count as one icon. Sizes come from props or CSS unless indicated as inherited or verified in the browser. For CSS-dependent rows with an unresolved computed size, the table gives the intrinsic or wrapper size. CSS layout, generated lesson content and standard text punctuation are outside the count unless used as an icon. Storybook-only, test, generated NodePod bundles, standalone static research reports and icons internal to dependencies are outside the React app source pass.

## 1. Glyph set as it stands

The source exports the brief’s `GLYPH_LABELS` as `LABELS` in `web/src/design-system/glyphs/data.ts:465`. The shapes in `data.ts:3–451` resolve naming ambiguities. `up` and `dn` are thumbs. `rise` and `down` are shafted arrows. `chev` points down and `chevr` points right. `send` shares the resting silhouette of `rise` and has its own launch motion. `shield` contains a question mark. `alert` is an octagon with an exclamation.

| Glyph | Intended meaning | Glyph | Intended meaning |
| --- | --- | --- | --- |
| `left` | back | `fork` | fork |
| `right` | forward | `bulb` | reasoning |
| `down` | jump down | `book` | sources |
| `rise` | move up | `layers` | materials |
| `send` | send | `panel` | sessions |
| `chev` | open | `panelr` | margin |
| `chevr` | next | `play` | run |
| `ext` | open elsewhere | `pen` | review |
| `plus` | add | `edit` | edit |
| `x` | close | `feather` | Socratic pass |
| `check` | done | `ruler` | rubric |
| `more` | more | `compass` | finish note |
| `menu` | menu | `pattern` | patterns |
| `search` | search | `route` | turns |
| `filter` | filter | `eye` | focus |
| `refresh` | retry | `lock` | private |
| `clip` | attach | `save` | save |
| `mic` | record | `export` | export |
| `wave` | live | `import` | bring in |
| `copy` | copy | `trash` | delete |
| `quote` | quote | `shield` | unverified |
| `up` | helpful | `alert` | problem |
| `dn` | not helpful | `kmark` | Keating |

## 2. Foreign icon inventory

The icon column uses Lucide names by default and identifies Reicon, React Icons, SVG and text explicitly. Source labels that depend on runtime values are abbreviated in the meaning column.

### Chat

The browser checks used the local three-session fixture, including its Python code block. The hosted code run was disabled in this deployment. The audit inspected the Run control and did not execute the code.

- [Seeded thread and session rail](shots/a1/chat-session.png). The reply action row contains a 13px Lucide `Quote` at stroke 2 alongside 13px Keating glyphs at stroke 2.1. The quote is rounder and reads differently at equal size. `web/src/components/chat/QuoteParts.tsx:221`, `web/src/components/AssistantChatPanel.tsx:4343`, `web/src/design-system/glyphs/KeatingGlyph.tsx:40`, C1 reply action row.
- [Code block and composer](shots/a1/chat-code-composer.png). Code Edit, Copy and Run are 11px Lucide at stroke 2. The transcript actions above or below use 13px glyphs at stroke 2.1. Preserve the smaller code-toolbar slot when replacing the icon family. `web/src/components/RunnableCodeBlock.tsx:240`, `:248`, `:259`, C1 code toolbar.
- Composer Attach is a 15px Keating `clip` at stroke 1.9, while Mic and Live are 16px Lucide at stroke 2. Send renders at about 21px in the primary button. Size the two quiet replacements with Attach and preserve Send’s larger slot. `web/src/components/AssistantChatPanel.tsx:3711`, `:3764`, `web/src/components/chat/SpeechComposerControl.tsx:330`, `:353`, C1 note 5.
- [Header More](shots/a1/chat-header-more.png), [Sources dialog](shots/a1/chat-header-sources.png) and [model picker](shots/a1/chat-header-model.png). More uses the 15px Keating glyph in the header. Settings uses a 15px Lucide cog and the theme row a 14px Lucide sun or moon. The other observed menu entries are text. Sources uses a Unicode × close. `web/src/pages/chat/ChatHeader.tsx:291`, `:486`, `web/src/components/ThemeToggle.tsx:75`, `web/src/components/settings/KnowledgeSources.tsx:77`.
- [Session row actions](shots/a1/chat-session-actions.png). The left rail’s New and Collapse SVG boxes measured 20px each versus 15px for the corresponding Keating header panel toggle. Reicon draws separate outline and filled layers, and the row’s pinned, archive and overflow states retain their own Reicon drawings. Align perceived weight after preserving control hit areas. `web/src/components/SessionBrowserDesktop.tsx:343`, `:390`, `web/src/components/SessionCard.tsx:207`, `:219`, `:240`, `web/src/components/KeatingIcon.tsx:40–51`, C1 note 6 and C4 note 3.

#### Header and menus

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/ModelPicker.tsx:70` | Search | Search available models | 18px | use `search` |
| `web/src/components/ModelPicker.tsx:74` | X | Close model picker | 18px | use `x` |
| `web/src/components/ModelPicker.tsx:95` | Check | Mark the selected model | 18px | use `check` |
| `web/src/components/NotOrganicAccountMenuItem.tsx:55` | LogIn | Sign out or sign in to the Not Organic account (sign in) | 16px | new glyph: `sign-in` — An arrow entering a doorframe for signing in or connecting an account. |
| `web/src/components/NotOrganicAccountMenuItem.tsx:55` | LogOut | Sign out or sign in to the Not Organic account (sign out) | 16px | new glyph: `sign-out` — An arrow leaving a doorframe for signing out or disconnecting an account. |
| `web/src/components/settings/KnowledgeSources.tsx:64` | unicode ↗ | Open Not Organic account connections | inherits link text | use `ext` |
| `web/src/components/settings/KnowledgeSources.tsx:77` | unicode × | Close source picker in chat header | inherits close button text | use `x` |
| `web/src/components/ThemeToggle.tsx:75` | Moon | Switch the application color theme in a menu (dark theme) | 14px | new glyph: `moon` — An angular crescent for switching to dark appearance. |
| `web/src/components/ThemeToggle.tsx:75` | Sun | Switch the application color theme in a menu (light theme) | 14px | new glyph: `sun` — A central square with radial strokes for switching to light appearance. |
| `web/src/components/ThemeToggle.tsx:89` | Moon | Switch the application color theme in a standalone button (dark theme) | 16px | new glyph: `moon` — An angular crescent for switching to dark appearance. |
| `web/src/components/ThemeToggle.tsx:89` | Sun | Switch the application color theme in a standalone button (light theme) | 16px | new glyph: `sun` — A central square with radial strokes for switching to light appearance. |
| `web/src/pages/chat/ChatHeader.tsx:200` | image asset | Desktop Keating wordmark in chat navigation | CSS brand slot, hidden on compact header | keep — Keating product identity |
| `web/src/pages/chat/ChatHeader.tsx:486` | Settings | Open Settings from the header More menu | 15px | new glyph: `settings` — An angular gear with a square hub for settings, options or tool configuration. |
| `web/src/components/ModelSelector.tsx:156` | native select indicator | Open provider filter | browser-drawn | use `chev` |
| `web/src/components/ModelSelector.tsx:157` | native select indicator | Open capability filter | browser-drawn | use `chev` |
| `web/src/components/ModelPicker.tsx:97` | native disclosure marker | Expand model details | browser-drawn | use `chevr` |
| `web/src/components/ModelPicker.tsx:101` | native disclosure marker | Expand model catalog and provider setup | browser-drawn | use `chevr` |
| `web/src/components/ModelPicker.tsx:102` | unicode ↑ | Identify the Up Arrow key | inherits hint text | keep — Keyboard key notation |
| `web/src/components/ModelPicker.tsx:102` | unicode ↓ | Identify the Down Arrow key | inherits hint text | keep — Keyboard key notation |

#### Session list

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/SessionBrowserDesktop.tsx:132` | Reicon BranchUp | Mark the group of forks of this session | 14px | use `fork` |
| `web/src/components/SessionBrowserDesktop.tsx:134` | Reicon ChevronDown | Expand or collapse forks of this session | 14px | use `chev` |
| `web/src/components/SessionBrowserDesktop.tsx:343` | Reicon PenLine | Start a new session | 20px | use `plus` |
| `web/src/components/SessionBrowserDesktop.tsx:360` | Reicon SidebarLeft | Expand session panel | 21px | use `panel` |
| `web/src/components/SessionBrowserDesktop.tsx:365` | Reicon Magnifier | Search sessions | 20px | use `search` |
| `web/src/components/SessionBrowserDesktop.tsx:390` | Reicon SidebarLeft | Collapse session panel | 20px | use `panel` |
| `web/src/components/SessionBrowserDesktop.tsx:397` | Reicon Magnifier | Sessions | 18px | use `search` |
| `web/src/components/SessionBrowserDesktop.tsx:414` | Reicon Xmark | Clear search | 16px | use `x` |
| `web/src/components/SessionBrowserDesktop.tsx:516` | Reicon ChevronDown | Session library | 14px | use `chev` |
| `web/src/components/SessionBrowserDesktop.tsx:543` | Reicon BranchUp | Empty result state for session search or empty session tree (no sessions) | 30px | use `fork` |
| `web/src/components/SessionBrowserDesktop.tsx:543` | Reicon Magnifier | Empty result state for session search or empty session tree (search) | 30px | use `search` |
| `web/src/components/SessionBrowserSheet.tsx:89` | Reicon BranchUp | Fork · Set Expanded | 15px | use `fork` |
| `web/src/components/SessionBrowserSheet.tsx:93` | Reicon ChevronDown | Open or expand · Set Expanded | 15px | use `chev` |
| `web/src/components/SessionBrowserSheet.tsx:201` | Reicon Xmark | Close sessions | 22px | use `x` |
| `web/src/components/SessionBrowserSheet.tsx:208` | Reicon Magnifier | Sessions | 18px | use `search` |
| `web/src/components/SessionBrowserSheet.tsx:228` | Reicon Plus | New session | 18px | use `plus` |
| `web/src/components/SessionBrowserSheet.tsx:306` | Reicon ChevronDown | Sessions | 15px | use `chev` |
| `web/src/components/SessionBrowserSheet.tsx:328` | Reicon Magnifier | Sessions | 28px | use `search` |
| `web/src/components/SessionCard.tsx:161` | Reicon Thumbtack | Pinned | 12px | new glyph: `pin` — A thumbtack for pin and unpin actions and pinned markers. |
| `web/src/components/SessionCard.tsx:188` | Reicon BranchUp | Mark a session with a parent branch | 12px | use `fork` |
| `web/src/components/SessionCard.tsx:207` | Reicon Thumbtack | Pin or unpin this session | 16px | new glyph: `pin` — A thumbtack for pin and unpin actions and pinned markers. |
| `web/src/components/SessionCard.tsx:219` | Reicon ArchiveDown | Move session to Earlier | 16px | new glyph: `archive` — A box with a directional tray arrow for moving sessions into or out of Earlier. |
| `web/src/components/SessionCard.tsx:219` | Reicon ArchiveUp | Move session back to Recent | 16px | new glyph: `archive` — A box with a directional tray arrow for moving sessions into or out of Earlier. |
| `web/src/components/SessionCard.tsx:240` | Reicon More | Open this session’s actions | 20px | use `more` |
| `web/src/components/SessionCard.tsx:240` | Reicon Xmark | Close this session’s actions | 18px | use `x` |
| `web/src/components/SessionCard.tsx:247` | Reicon Check | Fork created (completion or selection) | 14px | use `check` |
| `web/src/components/SessionCard.tsx:273` | Reicon BranchUp | Fork session | 16px | use `fork` |
| `web/src/components/SessionCard.tsx:287` | Reicon PenLine | Rename | 16px | use `edit` |
| `web/src/components/SessionCard.tsx:304` | Reicon Feather | Ask Keating to suggest a session title | 16px | new glyph: `suggest` — Two small sparks for a generated suggestion, enhancement or appearance preset. |
| `web/src/components/SessionCard.tsx:318` | Reicon Thumbtack | pinLabel | 16px | new glyph: `pin` — A thumbtack for pin and unpin actions and pinned markers. |
| `web/src/components/SessionCard.tsx:332` | Reicon ArchiveDown | Move session to Earlier from actions | 16px | new glyph: `archive` — A box with a directional tray arrow for moving sessions into or out of Earlier. |
| `web/src/components/SessionCard.tsx:332` | Reicon ArchiveUp | Move session back to Recent from actions | 16px | new glyph: `archive` — A box with a directional tray arrow for moving sessions into or out of Earlier. |
| `web/src/components/SessionCard.tsx:343` | Reicon Trash2 | Delete | 16px | use `trash` |
| `web/src/components/SessionCard.tsx:372` | Reicon Check | Save title | 16px | use `check` |
| `web/src/components/SessionCard.tsx:391` | Reicon Trash2 | Delete session | 16px | use `trash` |
| `web/src/components/SessionCard.tsx:148` | CSS dot | Indicate session subject by color | 6px (`session-library.css:285`) | keep — Subject color marker specified in C1 note 6 and rail drawing |

#### Message actions and transcript

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/AssistantChatPanel.tsx:838` | Paperclip | Attached file in a message | 13px | use `clip` |
| `web/src/components/AssistantChatPanel.tsx:992` | LibraryBig | Open session artifact of the named type | 12px | use `layers` |
| `web/src/components/AssistantChatPanel.tsx:3897` | User | Learner avatar fallback in their message | 1rem | new glyph: `person` — An angular head and shoulders for one learner, profile or account. |
| `web/src/components/AssistantChatPanel.tsx:4014` | X | Close | 14px | use `x` |
| `web/src/components/AssistantChatPanel.tsx:4323` | Server | Open model picker after a model error | 13px | new glyph: `host` — Two stacked rack units with small lights for model or server capacity. |
| `web/src/components/chat/HandsOnExplanation.tsx:38` | unicode ▸ | Reveal the hands-on explanation | inherits disclosure text | use `chevr` |
| `web/src/components/chat/QuoteParts.tsx:221` | Quote | Quote in your message | 13px | use `quote` |
| `web/src/components/ConstraintPlanChips.tsx:57` | CalendarClock | Plan around the quoted constraint | 14px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/ConstraintPlanChips.tsx:63` | X | Dismiss the quoted planning constraint | 14px | use `x` |
| `web/src/components/private-fork/ImportedPrivateForkContext.tsx:62` | BookOpen | label | 15px | use `book` |
| `web/src/components/private-fork/ImportedPrivateForkContext.tsx:84` | ArrowUpRight | label | 14px | use `ext` |
| `web/src/components/private-fork/LessonPrivateFork.tsx:56` | LockKeyhole | Continue privately | 14px | use `lock` |

#### Composer

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/AssistantChatPanel.tsx:884` | Paperclip | File attached to the draft message | 12px | use `clip` |
| `web/src/components/AssistantChatPanel.tsx:917` | X | Remove the selected draft attachment | 12px | use `x` |
| `web/src/components/AssistantChatPanel.tsx:3720` | native select indicator | Open reasoning-level choices | browser-drawn select indicator | use `chev` |
| `web/src/components/AssistantChatPanel.tsx:3743` | Square | Stop generating | 15px | new glyph: `stop` — A solid square to halt work or playback. |
| `web/src/components/ChatMascotMenu.tsx:287` | unicode + | Open the Study with Keating action menu | CSS mascot hint | use `more` |

#### Code blocks

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/RunnableCodeBlock.tsx:221` | Terminal | Code language and runtime header | 12px | new glyph: `terminal` — An angular prompt and cursor in a terminal frame. |
| `web/src/components/RunnableCodeBlock.tsx:226` | unicode ● | Code run is still active | inherits code status text | new glyph: `status-dot` — A square accent pixel for passive status, including progress and connection states. |
| `web/src/components/RunnableCodeBlock.tsx:240` | Pencil | Toggle editing the code sample | 11px | use `edit` |
| `web/src/components/RunnableCodeBlock.tsx:248` | Check | Copy the code sample or show copied confirmation (success) | 11px | use `check` |
| `web/src/components/RunnableCodeBlock.tsx:248` | Copy | Copy the code sample or show copied confirmation (copy action) | 11px | use `copy` |
| `web/src/components/RunnableCodeBlock.tsx:259` | Play | Run code, or check an already-running hosted job | 11px | use `play` |
| `web/src/components/RunnableCodeBlock.tsx:287` | RotateCcw | Reset code | 11px | new glyph: `reset` — A counterclockwise return arrow for restoring an earlier or initial state. |
| `web/src/components/RunnableCodeBlock.tsx:310` | AlertCircle | Label code output as failed, pending or successful (problem) | 12px | use `alert` |
| `web/src/components/RunnableCodeBlock.tsx:310` | Check | Label code output as failed, pending or successful (success) | 12px | use `check` |
| `web/src/components/RunnableCodeBlock.tsx:310` | Terminal | Label code output as failed, pending or successful (pending runtime) | 12px | new glyph: `terminal` — An angular prompt and cursor in a terminal frame. |

#### Web search

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/WebSearchPart.tsx:47` | CircleAlert | Web search summary for running, failed or finished search (problem) | 14px | use `alert` |
| `web/src/components/WebSearchPart.tsx:47` | Globe | Web search summary for running, failed or finished search (web result) | 14px | new glyph: `globe` — An angular globe with meridian and latitude strokes for web or public scope. |
| `web/src/components/WebSearchPart.tsx:47` | LoaderCircle | Web search summary for running, failed or finished search (running) | 14px | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/components/WebSearchPart.tsx:55` | ChevronDown | Web search | 14px | use `chev` |
| `web/src/components/WebSearchPart.tsx:62` | Check | Web search call status for running, failed or successful search (success) | 12px | use `check` |
| `web/src/components/WebSearchPart.tsx:62` | CircleAlert | Web search call status for running, failed or successful search (problem) | 12px | use `alert` |
| `web/src/components/WebSearchPart.tsx:62` | LoaderCircle | Web search call status for running, failed or successful search (running) | 12px | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/components/WebSearchPart.tsx:100` | ExternalLink | site.snippet | 12px | use `ext` |
| `web/src/components/WebSearchPart.tsx:108` | ChevronDown | Sources | 12px | use `chev` |

#### Turn progress and diagnostics

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/AssistantChatPanel.tsx:746` | ChevronRight | Raw tool details disclosure | 13px | use `chevr` |
| `web/src/components/AssistantChatPanel.tsx:1538` | Loader2 via Spinner | Animation frame is being generated | 12px | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/components/AssistantChatPanel.tsx:1622` | Loader2 via Spinner | Assistant content is loading | 12px | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/components/AssistantChatPanel.tsx:2075` | ChevronRight | Toggle assistant reasoning disclosure | 13px | use `chevr` |
| `web/src/components/AssistantChatPanel.tsx:2204` | CircleAlert | Tool call failed | 14px | use `alert` |
| `web/src/components/AssistantChatPanel.tsx:2207` | CircleCheck | Tool call succeeded | 14px | use `check` |
| `web/src/components/AssistantChatPanel.tsx:2233` | Loader2 via Spinner | Tool is running | 14px | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/components/AssistantChatPanel.tsx:2234` | Wrench | Show a tool call | 13px | new glyph: `settings` — An angular gear with a square hub for settings, options or tool configuration. |
| `web/src/components/AssistantChatPanel.tsx:2297` | ChevronRight | Toggle raw tool argument disclosure | 13px | use `chevr` |
| `web/src/components/DiagnosticHelp.tsx:89` | CircleHelp | Explain the named diagnostic term | 14px | new glyph: `question` — An angular speech or circle frame with a visible question mark for help or a question. |
| `web/src/components/DraftProgress.tsx:19` | Lightbulb | Plan draft stage | 13px compact / 15px | use `bulb` |
| `web/src/components/DraftProgress.tsx:19` | ListChecks | Choose draft stage | 13px compact / 15px | new glyph: `checklist` — A ruled page with checkboxes for a plan, task list or checklist. |
| `web/src/components/DraftProgress.tsx:19` | PenLine | Write draft stage | 13px compact / 15px | use `edit` |
| `web/src/components/DraftProgress.tsx:19` | ShieldCheck | Check draft stage | 13px compact / 15px | new glyph: `verify` — A shield enclosing a tick for verified or protected outcomes. |
| `web/src/components/DraftProgress.tsx:50` | Check | Completed or stopped draft stage (success) | 13px compact / 15px | use `check` |
| `web/src/components/DraftProgress.tsx:50` | X | Completed or stopped draft stage (stopped) | 13px compact / 15px | use `x` |
| `web/src/components/DraftProgress.tsx:115` | TriangleAlert | Warning in active draft progress | 14px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/components/DraftProgress.tsx:122` | CircleAlert | Draft evidence status for success, caution or error (problem) | 16px | use `alert` |
| `web/src/components/DraftProgress.tsx:122` | CircleCheck | Draft evidence status for success, caution or error (success) | 16px | use `check` |
| `web/src/components/DraftProgress.tsx:122` | TriangleAlert | Draft evidence status for success, caution or error (caution) | 16px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/components/DraftProgress.tsx:137` | unicode → | Open the linked support resource | 0.75rem text | use `ext` |
| `web/src/components/DraftProgress.tsx:187` | unicode ✓ | Draft comparison cell passed | inherits evidence cell text | use `check` |
| `web/src/components/DraftProgress.tsx:187` | unicode ✕ | Draft comparison cell failed | inherits evidence cell text | use `x` |
| `web/src/components/JudgementDiagnostics.tsx:227` | AlertCircle | Judge trouble, flagged result, running operation or released result (problem) | 15px | use `alert` |
| `web/src/components/JudgementDiagnostics.tsx:227` | AlertCircle | Judge trouble, flagged result, running operation or released result (problem) | 15px | use `alert` |
| `web/src/components/JudgementDiagnostics.tsx:227` | Check | Judge trouble, flagged result, running operation or released result (success) | 15px | use `check` |
| `web/src/components/JudgementDiagnostics.tsx:227` | Clock3 | Judge trouble, flagged result, running operation or released result (running) | 15px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/JudgementDiagnostics.tsx:228` | CircleMinus | Judge abstained on all operations, or completed inspection (abstained) | 15px | new glyph: `partial` — A short minus bar in an angular badge for partial or abstained outcomes. |
| `web/src/components/JudgementDiagnostics.tsx:228` | ScanLine | Judge abstained on all operations, or completed inspection (inspection) | 15px | new glyph: `scan` — Four crop corners and a scanning bar for an inspection or review pass. |
| `web/src/components/JudgementDiagnostics.tsx:248` | ChevronDown | Diagnostics | 15px | use `chev` |
| `web/src/components/MessageDecisionVisuals.tsx:95` | unicode ✓ | Judge check passed | inherits legend / matrix text | use `check` |
| `web/src/components/MessageDecisionVisuals.tsx:96` | unicode × | Judge check failed | inherits legend / matrix text | use `x` |
| `web/src/components/MessageDecisionVisuals.tsx:159` | ArrowLeft | Draft risk decreased, increased or stayed equal (decrease) | 12px | use `left` |
| `web/src/components/MessageDecisionVisuals.tsx:159` | ArrowRight | Draft risk decreased, increased or stayed equal (increase) | 12px | use `right` |
| `web/src/components/MessageDecisionVisuals.tsx:159` | Minus | Draft risk decreased, increased or stayed equal (no change) | 12px | new glyph: `line` — A short neutral horizontal bar to indicate zero change. |
| `web/src/components/MessageDraftDecision.tsx:18` | unicode × | Draft attempt failed | inherits draft trace text | use `x` |
| `web/src/components/MessageDraftDecision.tsx:18` | unicode × | Draft generation errored | inherits draft trace text | use `alert` |
| `web/src/components/MessageDraftDecision.tsx:18` | unicode ✓ | Draft attempt passed | inherits draft trace text | use `check` |
| `web/src/components/turn-progress.css:48` | unicode ↳ | Nested query marker in turn timeline | inherits query row text | new glyph: `reply` — A bent return arrow for replying to a particular message. |
| `web/src/components/TurnProgress.tsx:85` | TriangleAlert | Reply in progress | 13px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/components/TurnProgress.tsx:89` | ChevronDown | Reply in progress | 13px | use `chev` |
| `web/src/components/TurnProgress.tsx:116` | Check | Checked (completion or selection) | 12px | use `check` |
| `web/src/components/TurnProgress.tsx:117` | X | Not checked (dismiss, remove, or mark failure) | 12px | use `x` |
| `web/src/components/TurnProgress.tsx:138` | ChevronDown | How this reply was made | 13px | use `chev` |
| `web/src/keating/judgement/turn-progress.ts:32` | unicode × | A draft-write stage stopped | inherits status text | use `x` |

#### Banners and recovery

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/chat/error-classification.ts:85` | KeyRound | Authentication failed | 13px | new glyph: `key` — A key with a squared bow and teeth for API credentials and authorization. |
| `web/src/components/chat/error-classification.ts:85` | Wifi | Network, timeout or rate-limit recovery state | 13px | new glyph: `network` — A fan of radio arcs and one square pixel for connectivity and network failures. |
| `web/src/components/chat/error-classification.ts:92` | KeyRound | Authentication failed | 13px | new glyph: `key` — A key with a squared bow and teeth for API credentials and authorization. |
| `web/src/components/chat/error-classification.ts:94` | CircleDollarSign | Billing issue | 13px | new glyph: `credits` — A card or coin with a simple denomination mark for payment and account credit. |
| `web/src/components/chat/error-classification.ts:96` | ShieldAlert | Permission or safety issue | 13px | use `alert` |
| `web/src/components/chat/error-classification.ts:99` | Server | Server or model failed | 13px | new glyph: `host` — Two stacked rack units with small lights for model or server capacity. |
| `web/src/components/chat/error-classification.ts:103` | Wifi | Network, timeout or rate-limit recovery state | 13px | new glyph: `network` — A fan of radio arcs and one square pixel for connectivity and network failures. |
| `web/src/components/chat/error-classification.ts:105` | Square | Generation was aborted | 13px | new glyph: `stop` — A solid square to halt work or playback. |
| `web/src/components/chat/error-classification.ts:106` | CircleAlert | Reply failed | 13px | use `alert` |
| `web/src/components/FailedResponseRecovery.tsx:31` | CircleAlert | This response did not finish | 17px | use `alert` |
| `web/src/components/ForkBanner.tsx:67` | GitBranch | Forked from “ ” | 13px | use `fork` |
| `web/src/components/NotOrganicCreditRecovery.tsx:62` | RefreshCw | Retry · On Refresh | 14px | use `refresh` |
| `web/src/components/NotOrganicCreditRecovery.tsx:79` | ArrowUpRight | Open secure checkout | 14px | use `ext` |
| `web/src/components/ProviderAuthRecovery.tsx:24` | KeyRound | Sign in to account or fix a provider key (provider key) | 16px | new glyph: `key` — A key with a squared bow and teeth for API credentials and authorization. |
| `web/src/components/ProviderAuthRecovery.tsx:24` | LogIn | Sign in to account or fix a provider key (sign in) | 16px | new glyph: `sign-in` — An arrow entering a doorframe for signing in or connecting an account. |
| `web/src/components/RetryResponseButton.tsx:71` | RotateCcw | label | 13px | use `refresh` |
| `web/src/components/WithheldReplyRecovery.tsx:49` | RotateCcw | Try again | 13px | use `refresh` |
| `web/src/components/WithheldReplyRecovery.tsx:53` | RefreshCw | Reload Keating | 13px | use `refresh` |
| `web/src/pages/chat/ChatBanners.tsx:62` | BookOpen | Course context link in chat | 16px | new glyph: `course` — A bound volume with a small lesson tab for courses and lessons. |
| `web/src/pages/chat/ChatBanners.tsx:125` | unicode ● | Storage persistence warning indicator | inherits rail text | new glyph: `status-dot` — A square accent pixel for passive status, including progress and connection states. |
| `web/src/pages/chat/ChatBanners.tsx:127` | X | Dismiss persistence warning | 12px | use `x` |

#### Quotes

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/chat/QuoteParts.tsx:183` | Quote | Quote | 14px | use `quote` |
| `web/src/components/chat/QuoteParts.tsx:261` | Quote | Quoted passages for your message | 13px | use `quote` |
| `web/src/components/chat/QuoteParts.tsx:278` | X | Remove the selected quoted passage | 13px | use `x` |
| `web/src/components/chat/QuoteParts.tsx:364` | unicode ⚠ | Quoted passage is stale | inherits quote status text | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/components/chat/QuoteParts.tsx:368` | ArrowUpRight | Jump within the conversation to the source passage | 12px | use `right` |

#### Speech

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/chat/SpeechComposerControl.tsx:290` | CircleAlert | Audio capture or transcription error | 16px | use `alert` |
| `web/src/components/chat/SpeechComposerControl.tsx:293` | X | Dismiss notification | 16px | use `x` |
| `web/src/components/chat/SpeechComposerControl.tsx:330` | Mic | Record an audio message | 16px | use `mic` |
| `web/src/components/chat/SpeechComposerControl.tsx:353` | AudioLines | Start a live conversation | 16px | use `wave` |
| `web/src/components/chat/SpeechComposerControl.tsx:426` | Mic | Hold to speak (record) | 16px | use `mic` |
| `web/src/components/chat/SpeechComposerControl.tsx:444` | Keyboard | Switch to keyboard | 16px | new glyph: `keyboard` — A compact rowed keyboard for typed input and shortcuts. |

#### Materials panel

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/ArtifactBrowserOverlay.tsx:105` | X | props.sessionId ? "Close materials" : "Close artifact browser | 16px | use `x` |
| `web/src/components/ArtifactViewer.tsx:58` | BookOpen | Library study plan type | 14px | new glyph: `checklist` — A ruled page with checkboxes for a plan, task list or checklist. |
| `web/src/components/ArtifactViewer.tsx:59` | Map | Patterns | 14px | use `pattern` |
| `web/src/components/ArtifactViewer.tsx:60` | Play | Start or resume | 14px | use `play` |
| `web/src/components/ArtifactViewer.tsx:61` | Layers | Cards | 14px | new glyph: `cards` — Two staggered cards with a corner index for a flashcard deck. |
| `web/src/components/ArtifactViewer.tsx:62` | ChevronRight | Library verification type | 14px | new glyph: `verify` — A shield enclosing a tick for verified or protected outcomes. |
| `web/src/components/ArtifactViewer.tsx:63` | Sparkles | Library benchmark type | 14px | new glyph: `chart` — An ascending line or bars for scores, trends or benchmarks. |
| `web/src/components/ArtifactViewer.tsx:64` | Settings2 | Library evolution type | 14px | new glyph: `compare` — Two opposing arrows or panes for contrasting versions and outputs. |
| `web/src/components/ArtifactViewer.tsx:65` | Sparkles | Library prompt-evolution type | 14px | new glyph: `compare` — Two opposing arrows or panes for contrasting versions and outputs. |
| `web/src/components/ArtifactViewer.tsx:66` | Wrench | Settings | 14px | new glyph: `settings` — An angular gear with a square hub for settings, options or tool configuration. |
| `web/src/components/ArtifactViewer.tsx:370` | unicode ← | Return to material list | 14px text | use `left` |
| `web/src/components/ArtifactViewer.tsx:393` | Download | Download | 14px | use `export` |
| `web/src/components/ArtifactViewer.tsx:396` | PanelRightClose | Close artifact panel | 18px | use `panelr` |
| `web/src/components/ArtifactViewer.tsx:433` | PanelRightClose | Close artifact panel | 18px | use `panelr` |
| `web/src/components/ArtifactViewer.tsx:435` | Search | Learning materials | 18px | use `search` |
| `web/src/components/ArtifactViewer.tsx:443` | BookOpen | Learning materials | 24px | use `book` |
| `web/src/components/ArtifactViewer.tsx:448` | ChevronRight | Advance or disclose | 16px | use `chevr` |
| `web/src/components/PlanRevisionCard.tsx:60` | ListTree | Proposed plan change | 16px | new glyph: `outline` — A stacked hierarchy of rows with an indentation or branch for an outline. |
| `web/src/components/PlanRevisionCard.tsx:73` | Check | Accept | 14px | use `check` |
| `web/src/components/PlanRevisionCard.tsx:76` | X | Decline | 14px | use `x` |
| `web/src/components/workspace/ArtifactSurfaceBody.tsx:51` | ArrowLeft | Back to this session's materials | 14px | use `left` |
| `web/src/components/workspace/MaterialsBySession.tsx:64` | ChevronRight | Advance or disclose · On Open Session | 16px | use `chevr` |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:86` | ListChecks | Study plan | 16px default / 14px compact | new glyph: `checklist` — A ruled page with checkboxes for a plan, task list or checklist. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:87` | Network | Concept map | 16px default / 14px compact | use `pattern` |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:88` | CircleHelp | Quiz material | 16px default / 14px compact | new glyph: `quiz` — A page with a question mark and selectable marks for a quiz or exam. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:89` | Layers | Flashcard deck | 16px default / 14px compact | new glyph: `cards` — Two staggered cards with a corner index for a flashcard deck. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:90` | ClipboardList | Task or assignment | 16px default / 14px compact | new glyph: `assignment` — A clipped sheet with one empty response line for an assignment. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:91` | NotebookPen | Notes material | 16px default / 14px compact | new glyph: `notes` — A page with a short writing stroke for a note or written reflection. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:92` | Target | Learning goal | 16px default / 14px compact | new glyph: `goal` — A marked target or flag on a short pole for a learning objective. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:93` | SlidersHorizontal | Simulation material | 16px default / 14px compact | new glyph: `controls` — Two adjustable rails for tuning parameters and filters. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:94` | Code2 | Coding challenge | 16px default / 14px compact | new glyph: `code` — Angle brackets with an accented slash for code and source views. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:95` | Languages | Language practice | 16px default / 14px compact | new glyph: `language` — Two overlapping tiles showing distinct language characters. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:96` | Music | Music lab | 16px default / 14px compact | new glyph: `music` — An angular musical note for the music lab. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:97` | Image | Image material | 16px default / 14px compact | new glyph: `image` — A framed angular landscape with a small accent sun for images. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:98` | AudioLines | Material type for audio, video or other media (audio) | 16px default / 14px compact | use `wave` |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:98` | Film | Material type for audio, video or other media (media) | 16px default / 14px compact | new glyph: `film` — A small film frame with edge perforations for video or film materials. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:98` | Video | Material type for audio, video or other media (video) | 16px default / 14px compact | new glyph: `video` — An angular camcorder for video calls or recording. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:100` | BookOpen | Saved material with no legacy subtype | 16px default / 14px compact | use `layers` |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:102` | Map | Saved concept-map material | 16px default / 14px compact | use `pattern` |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:103` | Play | Saved animation material | 16px default / 14px compact | use `play` |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:104` | Layers | Saved flashcard deck | 16px default / 14px compact | new glyph: `cards` — Two staggered cards with a corner index for a flashcard deck. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:105` | ListChecks | Saved verification material | 16px default / 14px compact | new glyph: `verify` — A shield enclosing a tick for verified or protected outcomes. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:106` | BookOpen | Other saved material type | 16px default / 14px compact | use `layers` |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:169` | MessageSquareText | Show in conversation | 14px | new glyph: `chat` — An angular speech bubble, with a short line inside, for chat and discussion. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:211` | Sparkles | Ask Keating for a session material | 14px | use `kmark` |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:322` | AlertTriangle | Couldn't load this session's materials | 16px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:324` | RefreshCw | Try again | 14px | use `refresh` |
| `web/src/components/workspace/SessionMaterialsPanel.tsx:340` | ArrowLeft | All materials in this session | 14px | use `left` |
| `web/src/components/workspace/SessionWorkspaceView.tsx:78` | AlertTriangle | Plan change not saved | 16px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/components/workspace/SessionWorkspaceView.tsx:83` | RefreshCw | Retry save | 14px | use `refresh` |
| `web/src/components/workspace/SessionWorkspaceView.tsx:84` | X | Discard change | 14px | use `x` |
| `web/src/components/workspace/SessionWorkspaceView.tsx:93` | ListTree | Proposed plan changes | 16px | new glyph: `outline` — A stacked hierarchy of rows with an indentation or branch for an outline. |
| `web/src/components/workspace/SessionWorkspaceView.tsx:101` | Check | Accept | 14px | use `check` |
| `web/src/components/workspace/SessionWorkspaceView.tsx:102` | X | Decline | 14px | use `x` |
| `web/src/components/workspace/SessionWorkspaceView.tsx:163` | Library | All materials | 14px | use `layers` |
| `web/src/components/workspace/SessionWorkspaceView.tsx:176` | AlertTriangle | Couldn't load this session's materials | 16px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/components/workspace/SessionWorkspaceView.tsx:178` | RefreshCw | Try again | 14px | use `refresh` |
| `web/src/components/workspace/SessionWorkspaceView.tsx:233` | Sparkles | Plan updated to a revision | 16px | use `check` |
| `web/src/components/workspace/SessionWorkspaceView.tsx:236` | History | See what changed | 14px | new glyph: `history` — A clock face with an angular return arrow for history. |
| `web/src/components/workspace/SessionWorkspaceView.tsx:241` | AlertTriangle | Older plan | 16px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/components/workspace/SessionWorkspaceView.tsx:251` | History | History · On Toggle Compare | 14px | new glyph: `history` — A clock face with an angular return arrow for history. |
| `web/src/pages/Chat.tsx:128` | BookOpen | Older study-plan card type | 14px | new glyph: `checklist` — A ruled page with checkboxes for a plan, task list or checklist. |
| `web/src/pages/Chat.tsx:129` | Map | Older concept-map card type | 14px | use `pattern` |
| `web/src/pages/Chat.tsx:130` | Play | Older animation card type | 14px | use `play` |
| `web/src/pages/Chat.tsx:131` | LibraryBig | Older flashcard deck card type | 14px | new glyph: `cards` — Two staggered cards with a corner index for a flashcard deck. |
| `web/src/pages/Chat.tsx:132` | ChevronRight | Older verification card type | 14px | new glyph: `verify` — A shield enclosing a tick for verified or protected outcomes. |
| `web/src/pages/Chat.tsx:133` | Sparkles | Older benchmark card type | 14px | new glyph: `chart` — An ascending line or bars for scores, trends or benchmarks. |
| `web/src/pages/Chat.tsx:134` | Sparkles | Older evolution card type | 14px | new glyph: `compare` — Two opposing arrows or panes for contrasting versions and outputs. |
| `web/src/pages/Chat.tsx:135` | Sparkles | Older prompt-evolution card type | 14px | new glyph: `compare` — Two opposing arrows or panes for contrasting versions and outputs. |
| `web/src/pages/Chat.tsx:136` | Wrench | Older improvement card type | 14px | new glyph: `settings` — An angular gear with a square hub for settings, options or tool configuration. |
| `web/src/pages/Chat.tsx:293` | ChevronDown | expanded ? "Collapse artifact" : "Expand artifact | 14px | use `chev` |
| `web/src/pages/Chat.tsx:293` | ChevronRight | expanded ? "Collapse artifact" : "Expand artifact | 14px | use `chevr` |
| `web/src/pages/Chat.tsx:375` | X | Dismiss artifact | 14px | use `x` |

### Inline lesson components

#### Quiz and exams

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/ExamRenderer.tsx:249` | Clock3 | Exam questions · Move between questions. Review before you submit. | 28px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/ExamRenderer.tsx:273` | ArrowRight | Start exam | 18px | use `right` |
| `web/src/components/ExamRenderer.tsx:300` | Clock3 | Exam time remaining | 17px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/ExamRenderer.tsx:321` | ChevronDown | navigatorOpen ? "Hide question navigator" : "Show question navigator | 15px | use `chev` |
| `web/src/components/ExamRenderer.tsx:328` | Flag | flagged | 13px | new glyph: `flag` — A small flagged bookmark for reporting or marking an item for later review. |
| `web/src/components/ExamRenderer.tsx:349` | Flag | Flag | 10px | new glyph: `flag` — A small flagged bookmark for reporting or marking an item for later review. |
| `web/src/components/ExamRenderer.tsx:351` | Check | Completion or selection | 11px | use `check` |
| `web/src/components/ExamRenderer.tsx:396` | Flag | Flagged | 15px | new glyph: `flag` — A small flagged bookmark for reporting or marking an item for later review. |
| `web/src/components/ExamRenderer.tsx:398` | ArrowRight | Exam Questions / answered | 15px | use `right` |
| `web/src/components/ExamRenderer.tsx:420` | Send | Exam Questions / answered | 17px | use `send` |
| `web/src/components/ExamRenderer.tsx:442` | Flag | Question of | 15px | new glyph: `flag` — A small flagged bookmark for reporting or marking an item for later review. |
| `web/src/components/ExamRenderer.tsx:461` | ArrowLeft | Back | 17px | use `left` |
| `web/src/components/ExamRenderer.tsx:475` | ArrowRight | Back | 17px | use `right` |
| `web/src/components/ExamRenderer.tsx:556` | Check | Exam submitted | 24px | use `check` |
| `web/src/components/ExamRenderer.tsx:569` | Clock3 | total | 15px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/quiz/activity-game.css:46` | unicode + | Expand activity review | 20px text | use `plus` |
| `web/src/components/quiz/activity-game.css:47` | unicode − | Collapse activity review | 20px text | new glyph: `remove` — A horizontal minus for remove, collapse or subtraction controls. |
| `web/src/components/quiz/ActivityGame.tsx:19` | Check | Completion or selection · On Click | 18px | use `check` |
| `web/src/components/quiz/ActivityGame.tsx:19` | X | Dismiss, remove, or mark failure · On Click | 18px | use `x` |
| `web/src/components/quiz/ActivityGame.tsx:47` | Check | Completion or selection · On Mark | 27px | use `check` |
| `web/src/components/quiz/MultiBlankFillIn.tsx:69` | unicode ✓ | Blank answered correctly | 10px text | use `check` |
| `web/src/components/quiz/MultiBlankFillIn.tsx:69` | unicode ✗ | Blank answered incorrectly | 10px text | use `x` |
| `web/src/components/quiz/QuestionAnswerInputs.tsx:98` | Lightbulb | Reasoning · Revealed Answer Note | 14px | use `bulb` |
| `web/src/components/quiz/QuestionCard.tsx:83` | Volume2 | Read question aloud | 14px | new glyph: `audio` — A speaker with radiating bars for audio playback or spoken output. |
| `web/src/components/quiz/QuestionCard.tsx:95` | Bookmark | bookmarked ? "Remove bookmark" : "Bookmark question | 14px | new glyph: `bookmark` — A notched ribbon marking a saved item or saved destination. |
| `web/src/components/quiz/QuestionCard.tsx:101` | Clock | Time · On Actions | 11px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/quiz/QuestionCard.tsx:227` | AlertTriangle | Partial credit: % | 12px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/components/quiz/QuizCountdown.tsx:10` | AlertTriangle | Caution | 20px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/components/quiz/QuizCountdown.tsx:10` | Clock | Time | 20px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/quiz/QuizFeedbackPanels.tsx:42` | GraduationCap | Review these | 14px | new glyph: `course` — A bound volume with a small lesson tab for courses and lessons. |
| `web/src/components/quiz/QuizFeedbackPanels.tsx:103` | TrendingUp | vs past sessions | 14px | new glyph: `chart` — An ascending line or bars for scores, trends or benchmarks. |
| `web/src/components/quiz/QuizHeader.tsx:81` | AlertTriangle | Caution | 20px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/components/quiz/QuizHeader.tsx:81` | Clock | Time | 20px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/quiz/QuizHeader.tsx:91` | Clock | Appearance | 12px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/quiz/QuizHeader.tsx:94` | Sparkles | Quiz appearance | 16px | new glyph: `suggest` — Two small sparks for a generated suggestion, enhancement or appearance preset. |
| `web/src/components/quiz/QuizNavigation.tsx:38` | ChevronLeft | Back | 14px | use `left` |
| `web/src/components/quiz/QuizNavigation.tsx:47` | ChevronRight | Quiz questions | 16px | use `chevr` |
| `web/src/components/quiz/QuizNavigation.tsx:57` | Send | Submit all quiz answers | 14px | use `send` |
| `web/src/components/quiz/QuizResultBadge.tsx:34` | CheckCircle2 | Done | 12px | use `check` |
| `web/src/components/quiz/QuizResultBadge.tsx:34` | XCircle | Close | 12px | use `x` |
| `web/src/components/quiz/QuizResultsView.tsx:96` | RotateCcw | Retake | 14px | use `refresh` |
| `web/src/components/QuizResultCard.tsx:245` | GraduationCap | Quiz Result % | 18px | new glyph: `course` — A bound volume with a small lesson tab for courses and lessons. |
| `web/src/components/QuizResultCard.tsx:266` | Clock | Total time taken for this quiz | 12px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/QuizResultCard.tsx:283` | CheckCircle2 | correct | 12px | use `check` |
| `web/src/components/QuizResultCard.tsx:287` | XCircle | incorrect | 12px | use `x` |
| `web/src/components/QuizResultCard.tsx:292` | HelpCircle | pending review | 12px | new glyph: `question` — An angular speech or circle frame with a visible question mark for help or a question. |
| `web/src/components/QuizResultCard.tsx:298` | Bookmark | flagged | 12px | new glyph: `bookmark` — A notched ribbon marking a saved item or saved destination. |
| `web/src/components/QuizResultCard.tsx:315` | ChevronUp | Quiz Result % correct incorrect | 12px | new glyph: `chev-up` — An upward chevron for collapse or upward scroll. |
| `web/src/components/QuizResultCard.tsx:319` | ChevronDown | Quiz Result % correct incorrect | 12px | use `chev` |
| `web/src/components/QuizResultCard.tsx:348` | HelpCircle | Quiz Result % correct incorrect | 12px | new glyph: `question` — An angular speech or circle frame with a visible question mark for help or a question. |
| `web/src/components/QuizResultCard.tsx:350` | CheckCircle2 | Quiz Result % correct incorrect (done) | 12px | use `check` |
| `web/src/components/QuizResultCard.tsx:352` | MinusCircle | Quiz Result % correct incorrect | 12px | new glyph: `partial` — A short minus bar in an angular badge for partial or abstained outcomes. |
| `web/src/components/QuizResultCard.tsx:353` | XCircle | Quiz Result % correct incorrect (close) | 12px | use `x` |
| `web/src/components/QuizResultCard.tsx:389` | ChevronDown | Open or expand | 12px | use `chev` |
| `web/src/components/QuizResultCard.tsx:389` | ChevronUp | Collapse or scroll up | 12px | new glyph: `chev-up` — An upward chevron for collapse or upward scroll. |
| `web/src/components/QuizResultCard.tsx:419` | GraduationCap | You: | 10px | new glyph: `course` — A bound volume with a small lesson tab for courses and lessons. |
| `web/src/components/QuizResultCard.tsx:425` | Lightbulb | You: | 10px | use `bulb` |
| `web/src/components/QuizResultCard.tsx:459` | TrendingUp | Review topic | 12px | new glyph: `chart` — An ascending line or bars for scores, trends or benchmarks. |
| `web/src/components/QuizSessionPanel.tsx:185` | Clock | Total quiz time allowance | 18px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/QuizSessionPanel.tsx:195` | Play | Start the ready quiz | 14px | use `play` |
| `web/src/components/QuizSessionPanel.tsx:200` | X | Dismiss quiz | 16px | use `x` |

#### Questions

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/question/QuestionCompletionReview.tsx:38` | MessageSquare | Review answers | 14px | new glyph: `chat` — An angular speech bubble, with a short line inside, for chat and discussion. |
| `web/src/components/question/QuestionCompletionReview.tsx:85` | MessageSquare | Review answers | 14px | new glyph: `chat` — An angular speech bubble, with a short line inside, for chat and discussion. |
| `web/src/components/question/QuestionNavigation.tsx:35` | ChevronLeft | Back | 14px | use `left` |
| `web/src/components/question/QuestionNavigation.tsx:47` | ChevronRight | Back | 14px | use `chevr` |
| `web/src/components/question/QuestionNavigation.tsx:56` | ArrowRight | Back | 16px | use `right` |
| `web/src/components/QuestionRenderer.tsx:293` | ChevronDown | collapsed ? "Show questions" : "Hide questions | 18px | use `chev` |
| `web/src/components/QuestionRenderer.tsx:293` | ChevronUp | collapsed ? "Show questions" : "Hide questions | 18px | new glyph: `chev-up` — An upward chevron for collapse or upward scroll. |

#### Flashcards

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/FlashcardRenderer.tsx:677` | Sun | Sun · Reset Icon | 13px | new glyph: `sun` — A central square with radial strokes for switching to light appearance. |
| `web/src/components/FlashcardRenderer.tsx:678` | CircleDot | Status dot · Reset Icon | 13px | new glyph: `status-dot` — A square accent pixel for passive status, including progress and connection states. |
| `web/src/components/FlashcardRenderer.tsx:679` | Sparkles | Suggest · Reset Icon | 13px | new glyph: `suggest` — Two small sparks for a generated suggestion, enhancement or appearance preset. |
| `web/src/components/FlashcardRenderer.tsx:680` | Zap | Suggest · Reset Icon | 13px | new glyph: `suggest` — Two small sparks for a generated suggestion, enhancement or appearance preset. |
| `web/src/components/FlashcardRenderer.tsx:681` | Star | Strength · Reset Icon | 13px | new glyph: `strength` — A plain accented octagon for the review strength category. |
| `web/src/components/FlashcardRenderer.tsx:682` | Pause | Pause playback or timing · Reset Icon | 13px | new glyph: `pause` — Two vertical bars to suspend work or playback. |
| `web/src/components/FlashcardRenderer.tsx:683` | ScanLine | Scan · Reset Icon | 13px | new glyph: `scan` — Four crop corners and a scanning bar for an inspection or review pass. |
| `web/src/components/FlashcardRenderer.tsx:727` | unicode ← | Swipe left to give the first rating | inherits swipe cue text | use `left` |
| `web/src/components/FlashcardRenderer.tsx:727` | unicode → | Swipe right to give the third rating | inherits swipe cue text | use `right` |
| `web/src/components/FlashcardRenderer.tsx:727` | unicode ↑ | Swipe up to give the fourth rating | inherits swipe cue text | use `rise` |
| `web/src/components/FlashcardRenderer.tsx:727` | unicode ↓ | Swipe down to give the second rating | inherits swipe cue text | use `down` |
| `web/src/components/FlashcardRenderer.tsx:1020` | Flame | best combo | 16px | new glyph: `flame` — An angular flame for heat or intensity. |
| `web/src/components/FlashcardRenderer.tsx:1020` | Zap | points | 16px | new glyph: `suggest` — Two small sparks for a generated suggestion, enhancement or appearance preset. |
| `web/src/components/FlashcardRenderer.tsx:1094` | Flame | Streak of Good or Easy recalls | 13px | new glyph: `flame` — An angular flame for heat or intensity. |
| `web/src/components/FlashcardRenderer.tsx:1104` | Volume2 | soundOn ? "Mute flashcard sounds" : "Enable flashcard sounds | 16px | new glyph: `audio` — A speaker with radiating bars for audio playback or spoken output. |
| `web/src/components/FlashcardRenderer.tsx:1104` | VolumeX | soundOn ? "Mute flashcard sounds" : "Enable flashcard sounds | 16px | new glyph: `audio-off` — A speaker with a diagonal slash for muted audio playback. |
| `web/src/components/FlashcardRenderer.tsx:1114` | Zap | Flashcard recall run heading | 14px | new glyph: `suggest` — Two small sparks for a generated suggestion, enhancement or appearance preset. |
| `web/src/components/FlashcardRenderer.tsx:1216` | ChevronLeft | Back | 15px | use `left` |
| `web/src/components/FlashcardRenderer.tsx:1219` | Lightbulb | Reveal answer | 16px | use `bulb` |
| `web/src/components/FlashcardRenderer.tsx:1222` | ChevronRight | Skip | 15px | use `chevr` |
| `web/src/components/FlashcardRenderer.tsx:1257` | Bookmark | bookmarkIds.has(current.id) ? "Remove bookmark" : "Bookmark card | 16px | new glyph: `bookmark` — A notched ribbon marking a saved item or saved destination. |
| `web/src/components/FlashcardRenderer.tsx:1303` | Star | cards // due // mature | 14px | new glyph: `strength` — A plain accented octagon for the review strength category. |
| `web/src/components/flashcards/FlashcardTimer.tsx:13` | Timer | Reveal | 15px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/flashcards/FlashcardTimer.tsx:24` | Pause | timer.paused ? "Resume reveal timer" : "Pause reveal timer (pause playback or timing) | 14px | new glyph: `pause` — Two vertical bars to suspend work or playback. |
| `web/src/components/flashcards/FlashcardTimer.tsx:24` | Play | timer.paused ? "Resume reveal timer" : "Pause reveal timer (start or resume) | 14px | use `play` |

#### Homework and submissions

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/homework/OpenAssignmentsSection.tsx:66` | CalendarClock | Time · Assignment Row | 13px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/homework/OpenAssignmentsSection.tsx:70` | CheckCircle2 | Done · Assignment Row | 13px | use `check` |
| `web/src/components/homework/OpenAssignmentsSection.tsx:70` | ClipboardList | Checklist · Assignment Row | 13px | new glyph: `checklist` — A ruled page with checkboxes for a plan, task list or checklist. |
| `web/src/components/homework/OpenAssignmentsSection.tsx:70` | MessageSquareText | Chat · Assignment Row | 13px | new glyph: `chat` — An angular speech bubble, with a short line inside, for chat and discussion. |
| `web/src/components/homework/OpenAssignmentsSection.tsx:79` | ArrowRight | Open the assignment’s next step | 15px | use `right` |
| `web/src/components/homework/OpenAssignmentsSection.tsx:101` | ClipboardList | Open assignments | 18px | new glyph: `checklist` — A ruled page with checkboxes for a plan, task list or checklist. |
| `web/src/components/homework/PrintAssignmentButton.tsx:55` | Printer | Print the assignment, or print a blank copy when answers exist | 16px CSS | new glyph: `printer` — A paper sheet feeding through a square printer for print actions. |
| `web/src/components/homework/PrintAssignmentButton.tsx:58` | Printer | Print with my answers | 16px CSS | new glyph: `printer` — A paper sheet feeding through a square printer for print actions. |
| `web/src/components/homework/PrintAssignmentButton.tsx:61` | FileDown | Download as Markdown | 16px CSS | use `export` |
| `web/src/components/ResponseCapture.tsx:126` | Mic | Audio response section indicator | 18px CSS | use `mic` |
| `web/src/components/ResponseCapture.tsx:126` | Video | Video response section indicator | 18px CSS | new glyph: `video` — An angular camcorder for video calls or recording. |
| `web/src/components/ResponseCapture.tsx:136` | Mic | Start recording an audio response | 18px CSS | use `mic` |
| `web/src/components/ResponseCapture.tsx:136` | RotateCcw | Record another learner response | 18px CSS | new glyph: `reset` — A counterclockwise return arrow for restoring an earlier or initial state. |
| `web/src/components/ResponseCapture.tsx:136` | Square | Stop recording | 18px CSS | new glyph: `stop` — A solid square to halt work or playback. |
| `web/src/components/ResponseCapture.tsx:136` | Video | Start recording a video response | 18px CSS | new glyph: `video` — An angular camcorder for video calls or recording. |
| `web/src/components/ResponseCapture.tsx:138` | Paperclip | Attach the captured learner response | 18px CSS | use `clip` |
| `web/src/components/SubmissionAttachments.tsx:60` | Paperclip | Attached file | 17px CSS | use `clip` |
| `web/src/components/SubmissionAttachments.tsx:70` | File | Attached files | 18px CSS | new glyph: `document` — A folded-corner page and ruled lines for documents and file records. |
| `web/src/components/SubmissionAttachments.tsx:71` | Check | Attached files | 12px CSS | use `check` |
| `web/src/components/SubmissionAttachments.tsx:72` | X | Remove the selected submission file | 24px intrinsic | use `x` |
| `web/src/components/SubmissionAttachments.tsx:75` | RotateCcw | Retry | 17px CSS | use `refresh` |

#### Interactive lessons and media

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/AnimatedScene.tsx:35` | Sparkles | Animation | 12px | new glyph: `suggest` — Two small sparks for a generated suggestion, enhancement or appearance preset. |
| `web/src/components/AnimationPlayer.tsx:168` | ChevronLeft | Previous scene | 15px | use `left` |
| `web/src/components/AnimationPlayer.tsx:171` | Pause | scenes // s (pause playback or timing) | 14px | new glyph: `pause` — Two vertical bars to suspend work or playback. |
| `web/src/components/AnimationPlayer.tsx:171` | Play | scenes // s (start or resume) | 14px | use `play` |
| `web/src/components/AnimationPlayer.tsx:175` | RotateCcw | Restart scene | 14px | use `refresh` |
| `web/src/components/AnimationPlayer.tsx:178` | ChevronRight | Next scene | 15px | use `chevr` |
| `web/src/components/CodingChallenge.tsx:66` | Code2 | Code · Coding Exercise | 18px | new glyph: `code` — Angle brackets with an accented slash for code and source views. |
| `web/src/components/CodingChallenge.tsx:70` | Timer | Work time | 18px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/CodingChallenge.tsx:75` | Pause | timer.paused ? "Resume work timer" : "Pause work timer (pause playback or timing) | 14px | new glyph: `pause` — Two vertical bars to suspend work or playback. |
| `web/src/components/CodingChallenge.tsx:75` | Play | timer.paused ? "Resume work timer" : "Pause work timer (start or resume) | 14px | use `play` |
| `web/src/components/CodingChallenge.tsx:84` | Play | Reset code (start or resume) | 15px | use `play` |
| `web/src/components/CodingChallenge.tsx:84` | Square | Reset code (stop the active operation) | 15px | new glyph: `stop` — A solid square to halt work or playback. |
| `web/src/components/CodingChallenge.tsx:85` | RotateCcw | Reset code | 14px | new glyph: `reset` — A counterclockwise return arrow for restoring an earlier or initial state. |
| `web/src/components/CodingChallenge.tsx:92` | Check | Input Expected (completion or selection) | 15px | use `check` |
| `web/src/components/CodingChallenge.tsx:92` | X | Input Expected (dismiss, remove, or mark failure) | 15px | use `x` |
| `web/src/components/GoalRenderer.tsx:76` | Target | Goal | 18px | new glyph: `goal` — A marked target or flag on a short pole for a learning objective. |
| `web/src/components/GoalRenderer.tsx:168` | Check | Mark a completed goal step | 15px | use `check` |
| `web/src/components/GoalRenderer.tsx:172` | Flag | Mark a milestone goal step | 13px | new glyph: `goal` — A marked target or flag on a short pole for a learning objective. |
| `web/src/components/GoalRenderer.tsx:174` | Circle | Mark an ordinary goal step | 12px | new glyph: `status-dot` — A square accent pixel for passive status, including progress and connection states. |
| `web/src/components/HyperframesPlayer.tsx:140` | CircleAlert | Animation failed to render: | 14px | use `alert` |
| `web/src/components/HyperframesPlayer.tsx:158` | CircleAlert | The animation loaded without a controllable timeline. Its script may be blocked or still loading. | 14px | use `alert` |
| `web/src/components/HyperframesPlayer.tsx:174` | Pause | controlLabel (pause playback or timing) | 14px | new glyph: `pause` — Two vertical bars to suspend work or playback. |
| `web/src/components/HyperframesPlayer.tsx:174` | Play | controlLabel (start or resume) | 14px | use `play` |
| `web/src/components/HyperframesPlayer.tsx:186` | RotateCcw | Replay | 14px | use `refresh` |
| `web/src/components/HyperframesPlayer.tsx:211` | Repeat | Loop | 14px | new glyph: `repeat` — Two arrows forming a loop for replay or repetition. |
| `web/src/components/ImageGenerationRetryButton.tsx:23` | RefreshCw | Choose model and retry | 12px | use `refresh` |
| `web/src/components/interactive/InteractivePage.tsx:77` | CircleAlert | : Reload | 14px | use `alert` |
| `web/src/components/interactive/InteractivePage.tsx:81` | RotateCcw | Reload | 14px | use `refresh` |
| `web/src/components/interactive/InteractivePage.tsx:237` | Maximize2 | Maximize · Set Fullscreen | 14px | new glyph: `maximize` — Two opposing expanding corners for enlarge or full screen. |
| `web/src/components/interactive/InteractivePage.tsx:237` | Minimize2 | Minimize · Set Fullscreen | 14px | new glyph: `minimize` — Two corners drawing inward for restore or exit full screen. |
| `web/src/components/interactive/InteractivePage.tsx:240` | RotateCcw | Reload | 14px | use `refresh` |
| `web/src/components/interactive/TutorInteractivePage.tsx:37` | ChevronDown | Open or expand · Set Show Source | 14px | use `chev` |
| `web/src/components/interactive/TutorInteractivePage.tsx:37` | Code2 | Code · Set Show Source | 14px | new glyph: `code` — Angle brackets with an accented slash for code and source views. |
| `web/src/components/JsonCrackBlock.tsx:36` | FileJson | Copy | 13px | new glyph: `code` — Angle brackets with an accented slash for code and source views. |
| `web/src/components/JsonCrackBlock.tsx:64` | Eye | Copy | 11px | use `eye` |
| `web/src/components/JsonCrackBlock.tsx:73` | Copy | Copy | 11px | use `copy` |
| `web/src/components/JsonCrackBlock.tsx:134` | ChevronRight | Advance or disclose | 12px | use `chevr` |
| `web/src/components/LanguagePractice.tsx:62` | Languages | Language · Language Run | 15px | new glyph: `language` — Two overlapping tiles showing distinct language characters. |
| `web/src/components/LanguagePractice.tsx:63` | Check | Completion or selection · Language Run | 26px | use `check` |
| `web/src/components/LanguagePractice.tsx:78` | Send | Retry save practice | 17px | use `send` |
| `web/src/components/LanguagePractice.tsx:140` | Square | playing ? "Stop reference audio" : "Listen to reference (stop the active operation) | 24px | new glyph: `stop` — A solid square to halt work or playback. |
| `web/src/components/LanguagePractice.tsx:140` | Volume2 | playing ? "Stop reference audio" : "Listen to reference | 28px | new glyph: `audio` — A speaker with radiating bars for audio playback or spoken output. |
| `web/src/components/LanguagePractice.tsx:156` | Mic | Your recording stays here. (record) | 19px | use `mic` |
| `web/src/components/LanguagePractice.tsx:156` | Square | Your recording stays here. (stop the active operation) | 19px | new glyph: `stop` — A solid square to halt work or playback. |
| `web/src/components/LanguagePractice.tsx:159` | Headphones | Your recording | 15px | new glyph: `headphones` — An angular headband and ear cups for listening or audio monitoring. |
| `web/src/components/LanguagePractice.tsx:164` | Check | Completion or selection · Language Round | 19px | use `check` |
| `web/src/components/LanguagePractice.tsx:167` | RotateCcw | Try again | 16px | use `refresh` |
| `web/src/components/LanguagePractice.tsx:168` | ArrowRight | Advance or open the linked destination | 17px | use `right` |
| `web/src/components/LanguagePractice.tsx:171` | SkipForward | Skip | 15px | new glyph: `skip` — A triangle and end bar for skipping an item or scene. |
| `web/src/components/LanguagePractice.tsx:172` | Check | Skip (completion or selection) | 17px | use `check` |
| `web/src/components/MermaidRenderer.tsx:367` | Maximize2 | Expand diagram | 16px | new glyph: `maximize` — Two opposing expanding corners for enlarge or full screen. |
| `web/src/components/MermaidRenderer.tsx:393` | X | Close expanded diagram | 18px | use `x` |
| `web/src/components/MusicLab.tsx:31` | AudioLines | Strudel | 18px | use `wave` |
| `web/src/components/SceneRenderer.tsx:75` | BookOpen | Lesson reading scene | 18px | use `book` |
| `web/src/components/SceneRenderer.tsx:76` | Lightbulb | Reasoning · Scene Icon | 18px | use `bulb` |
| `web/src/components/SceneRenderer.tsx:77` | AlertTriangle | Caution · Scene Icon | 18px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/components/SceneRenderer.tsx:78` | ArrowRight | Advance or open the linked destination · Scene Icon | 18px | use `right` |
| `web/src/components/SceneRenderer.tsx:79` | Eye | See or inspect · Scene Icon | 18px | use `eye` |
| `web/src/components/SceneRenderer.tsx:80` | BookOpen | Sources · Scene Icon | 18px | use `book` |
| `web/src/components/SceneRenderer.tsx:81` | Eye | See or inspect · Scene Icon | 18px | use `eye` |
| `web/src/components/SceneRenderer.tsx:126` | Clock | Time · Scene Card | 12px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/components/SceneRenderer.tsx:144` | Eye | See or inspect · Scene Card | 14px | use `eye` |
| `web/src/components/SceneRenderer.tsx:153` | Volume2 | Audio · Scene Card | 12px | new glyph: `audio` — A speaker with radiating bars for audio playback or spoken output. |
| `web/src/components/SceneRenderer.tsx:159` | ArrowRight | Advance or open the linked destination · Scene Card | 12px | use `right` |
| `web/src/components/SceneRenderer.tsx:165` | Lightbulb | Reasoning · Scene Card | 12px | use `bulb` |
| `web/src/components/SceneRenderer.tsx:217` | ChevronLeft | Previous or back · Set Active Idx | 16px | use `left` |
| `web/src/components/SceneRenderer.tsx:239` | ChevronRight | Advance or disclose · Set Active Idx | 16px | use `chevr` |
| `web/src/components/SimulationRenderer.tsx:163` | Activity | Reset | 18px | new glyph: `activity` — A short zigzag trace for runtime or recorded activity. |
| `web/src/components/SimulationRenderer.tsx:166` | RotateCcw | Reset simulation | 16px | new glyph: `reset` — A counterclockwise return arrow for restoring an earlier or initial state. |
| `web/src/components/SimulationRenderer.tsx:234` | Check | Reset Vary Watch Now View sampled values (completion or selection) | 16px | use `check` |
| `web/src/components/SimulationRenderer.tsx:234` | Send | Reset Vary Watch Now View sampled values | 16px | use `send` |
| `web/src/components/SystemDesignWorkbench.tsx:186` | unicode → | Direction of a diagram connection | inherits connection list text | use `right` |

#### OpenUI

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/OpenUIPreview.tsx:7` | ListChecks | Study plan item type | 14px | new glyph: `checklist` — A ruled page with checkboxes for a plan, task list or checklist. |
| `web/src/components/OpenUIPreview.tsx:8` | Network | Concept map item type | 14px | use `pattern` |
| `web/src/components/OpenUIPreview.tsx:9` | CircleHelp | Question item type | 14px | new glyph: `question` — An angular speech or circle frame with a visible question mark for help or a question. |
| `web/src/components/OpenUIPreview.tsx:10` | FileQuestion | Quiz item type | 14px | new glyph: `quiz` — A page with a question mark and selectable marks for a quiz or exam. |
| `web/src/components/OpenUIPreview.tsx:11` | Layers | Deck item type | 14px | new glyph: `cards` — Two staggered cards with a corner index for a flashcard deck. |
| `web/src/components/OpenUIPreview.tsx:12` | Flag | Goal item type | 14px | new glyph: `goal` — A marked target or flag on a short pole for a learning objective. |
| `web/src/components/OpenUIPreview.tsx:13` | NotebookPen | Notes item type | 14px | new glyph: `notes` — A page with a short writing stroke for a note or written reflection. |
| `web/src/components/OpenUIPreview.tsx:14` | Image | Image item type | 14px | new glyph: `image` — A framed angular landscape with a small accent sun for images. |
| `web/src/components/OpenUIPreview.tsx:15` | Play | Media item type | 14px | use `play` |
| `web/src/components/OpenUIPreview.tsx:16` | Paperclip | Artifact item type | 14px | use `layers` |
| `web/src/components/OpenUIPreview.tsx:17` | GitFork | Handoff item type | 14px | new glyph: `hand` — A raised angular palm for asking to speak, intervene or hand off. |
| `web/src/components/OpenUIPreview.tsx:18` | ClipboardList | Task item type | 14px | new glyph: `assignment` — A clipped sheet with one empty response line for an assignment. |
| `web/src/components/OpenUIPreview.tsx:19` | SlidersHorizontal | Simulation item type | 14px | new glyph: `controls` — Two adjustable rails for tuning parameters and filters. |
| `web/src/components/OpenUIPreview.tsx:20` | Code2 | Coding item type | 14px | new glyph: `code` — Angle brackets with an accented slash for code and source views. |
| `web/src/components/OpenUIPreview.tsx:21` | Music | Music item type | 14px | new glyph: `music` — An angular musical note for the music lab. |
| `web/src/components/OpenUIPreview.tsx:22` | Languages | Language item type | 14px | new glyph: `language` — Two overlapping tiles showing distinct language characters. |
| `web/src/components/OpenUIPreview.tsx:23` | BookMarked | Unavailable material type | 14px | use `alert` |
| `web/src/keating/openui/library.tsx:72` | Info | Icon callout | 17px | new glyph: `info` — A small angular badge around a lowercase i for neutral information. |
| `web/src/keating/openui/library.tsx:73` | Lightbulb | Icon callout | 17px | use `bulb` |
| `web/src/keating/openui/library.tsx:74` | CircleCheck | Icon callout | 17px | use `check` |
| `web/src/keating/openui/library.tsx:75` | CircleAlert | Icon callout | 17px | use `alert` |
| `web/src/keating/openui/library.tsx:442` | NotebookPen | Notes · Open UIShared Notes | 16px | new glyph: `notes` — A page with a short writing stroke for a note or written reflection. |
| `web/src/keating/openui/renderer.tsx:126` | Loader2 | Loading or pending work · Building interaction | 12px | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/keating/openui/renderer.tsx:347` | Loader2 | Loading or pending work | 15px | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/keating/openui/renderer.tsx:348` | CircleAlert | Problem state · Inert Open UISource Recovery | 15px | use `alert` |
| `web/src/keating/openui/shared-renderer.tsx:204` | Check | Completion or selection · Question | 18px | use `check` |
| `web/src/keating/openui/shared-renderer.tsx:207` | Lightbulb | Hint | 15px | use `bulb` |
| `web/src/keating/openui/shared-renderer.tsx:208` | ArrowRight | Send answer | 17px | use `send` |
| `web/src/keating/openui/shared-renderer.tsx:263` | GripVertical | ↑ ↓ | 13px | new glyph: `drag` — A small matrix of square dots for grabbing and reordering. |
| `web/src/keating/openui/shared-renderer.tsx:266` | unicode ↑ | Move an ordering item up | inherits control text | use `rise` |
| `web/src/keating/openui/shared-renderer.tsx:267` | unicode ↓ | Move an ordering item down | inherits control text | use `down` |
| `web/src/keating/openui/shared-renderer.tsx:329` | GripVertical | Unassigned | 13px | new glyph: `drag` — A small matrix of square dots for grabbing and reordering. |
| `web/src/keating/openui/shared-renderer.tsx:438` | ArrowLeft | Previous question | 18px | use `left` |
| `web/src/keating/openui/shared-renderer.tsx:439` | ArrowRight | Next | 18px | use `right` |
| `web/src/keating/openui/shared-renderer.tsx:442` | Check | Completion or selection | 18px | use `check` |
| `web/src/keating/openui/shared-renderer.tsx:633` | ArrowLeft | Previous question | 18px | use `left` |
| `web/src/keating/openui/shared-renderer.tsx:634` | Flag | flagged.includes(current.id) ? "Unflag" : "Flag for review | 17px | new glyph: `flag` — A small flagged bookmark for reporting or marking an item for later review. |
| `web/src/keating/openui/shared-renderer.tsx:636` | ArrowRight | Skip | 18px | use `right` |
| `web/src/keating/openui/shared-renderer.tsx:688` | Clock | Time spent on this quiz | 13px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/keating/openui/shared-renderer.tsx:689` | Zap | Answered within the first quarter of the question's time limit. | 13px | new glyph: `suggest` — Two small sparks for a generated suggestion, enhancement or appearance preset. |
| `web/src/keating/openui/shared-renderer.tsx:726` | unicode ✓ | Ordering answer correct | inherits outcome text | use `check` |
| `web/src/keating/openui/shared-renderer.tsx:726` | unicode ✗ | Ordering answer incorrect | inherits outcome text | use `x` |
| `web/src/keating/openui/shared-renderer.tsx:727` | unicode ✓ | MCQ answer correct | inherits outcome text | use `check` |
| `web/src/keating/openui/shared-renderer.tsx:727` | unicode ✗ | MCQ answer incorrect | inherits outcome text | use `x` |
| `web/src/keating/openui/shared-renderer.tsx:1006` | Lightbulb | Flashcard rating Hard | rating button CSS | use `bulb` |
| `web/src/keating/openui/shared-renderer.tsx:1006` | RotateCcw | Flashcard rating Again | rating button CSS | new glyph: `reset` — A counterclockwise return arrow for restoring an earlier or initial state. |
| `web/src/keating/openui/shared-renderer.tsx:1006` | ThumbsUp | Flashcard rating Good | rating button CSS | use `up` |
| `web/src/keating/openui/shared-renderer.tsx:1006` | Zap | Flashcard rating Easy | rating button CSS | new glyph: `suggest` — Two small sparks for a generated suggestion, enhancement or appearance preset. |
| `web/src/keating/openui/shared-renderer.tsx:1021` | RotateCcw | revealed ? "Hide answer" : "Reveal answer | 14px | use `eye` |
| `web/src/keating/openui/study-plan.tsx:334` | Clock3 | min | 11px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/keating/openui/study-plan.tsx:351` | ChevronRight | Advance or disclose | 15px | use `chevr` |
| `web/src/keating/openui/study-plan.tsx:362` | Clock3 | Time | 11px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/keating/openui/study-plan.tsx:423` | Route | / steps | 16px | use `route` |
| `web/src/keating/openui/study-plan.tsx:436` | BookOpenCheck | / steps | 13px | new glyph: `course` — A bound volume with a small lesson tab for courses and lessons. |
| `web/src/keating/openui/study-plan.tsx:436` | Loader2 | Loading or pending work · / steps | 13px | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/keating/openui/study-plan.tsx:463` | Network | Dependency graph link | 14px | use `pattern` |
| `web/src/keating/openui/study-plan.tsx:477` | Link2 | Show links to related study plans | 14px | new glyph: `link` — Two interlocking angular links for URL actions or link materials. |
| `web/src/keating/openui/study-plan.tsx:495` | ChevronRight | Advance or disclose | 15px | use `chevr` |

### Review

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/CommitReviewArticle.tsx:122` | Sparkles | Suggest · Set Revealed | 14px | new glyph: `suggest` — Two small sparks for a generated suggestion, enhancement or appearance preset. |
| `web/src/components/CommitReviewArticle.tsx:171` | ArrowRight | Share this route | 14px | use `right` |
| `web/src/components/CommitReviewArticle.tsx:175` | ArrowRight | Jump to retrieval | 14px | use `right` |
| `web/src/components/CommitReviewArticle.tsx:182` | Network | Main idea | 16px | use `pattern` |
| `web/src/components/CommitReviewArticle.tsx:190` | Shield | Misconception | 16px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/components/CommitReviewArticle.tsx:194` | LockKeyhole | Security gate | 16px | use `lock` |
| `web/src/components/CommitReviewArticle.tsx:222` | FileCode2 | File-by-file walkthrough | 14px | keep — Code-file type marker in repository walkthrough |
| `web/src/components/CommitReviewArticle.tsx:259` | CheckCircle2 | Tests and evidence Also in the commit: | 16px | use `check` |
| `web/src/components/LearnerResponseReview.tsx:30` | CheckCircle2 | review.title | 17px | use `check` |
| `web/src/components/ResponseComparisonPanel.tsx:87` | GitCompareArrows | Another explanation is ready Compare it when you have a moment Compare | 16px | new glyph: `compare` — Two opposing arrows or panes for contrasting versions and outputs. |
| `web/src/components/ResponseComparisonPanel.tsx:137` | GitCompareArrows | Compare | 18px | new glyph: `compare` — Two opposing arrows or panes for contrasting versions and outputs. |
| `web/src/components/ResponseComparisonPanel.tsx:147` | X | Close comparison | 16px | use `x` |
| `web/src/components/ResponseComparisonPanel.tsx:173` | SkipForward | Skip | 13px | new glyph: `skip` — A triangle and end bar for skipping an item or scene. |
| `web/src/components/ResponseComparisonPanel.tsx:228` | Check | Choose (completion or selection) | 14px | use `check` |
| `web/src/components/trajectory/ModelPoolEditor.tsx:58` | Plus | New | 12px | use `plus` |
| `web/src/components/trajectory/ModelPoolEditor.tsx:68` | Trash2 | Delete the named model pool | 14px | use `trash` |
| `web/src/components/trajectory/ModelPoolEditor.tsx:116` | Trash2 | Remove the selected model from the pool | 13px | use `trash` |
| `web/src/components/trajectory/ModelPoolEditor.tsx:136` | Plus | Add model | 12px | use `plus` |
| `web/src/components/trajectory/review-icons.ts:34` | Reicon Chalkboard | Teacher role (shared selector) | consumer sets size | new glyph: `teacher` — A person and small board for the teacher role. |
| `web/src/components/trajectory/review-icons.ts:35` | Reicon User | Learner role (shared selector) | consumer sets size | new glyph: `person` — An angular head and shoulders for one learner, profile or account. |
| `web/src/components/trajectory/review-icons.ts:36` | Reicon Gear | Tool-call role (shared selector) | consumer sets size | new glyph: `settings` — An angular gear with a square hub for settings, options or tool configuration. |
| `web/src/components/trajectory/review-icons.ts:37` | Reicon ChatRoundLine | Message or turn role (shared selector) | consumer sets size | new glyph: `chat` — An angular speech bubble, with a short line inside, for chat and discussion. |
| `web/src/components/trajectory/review-icons.ts:42` | Reicon Star | Rubric (shared selector) | consumer sets size | use `ruler` |
| `web/src/components/trajectory/review-icons.ts:43` | Reicon Tags | Category label (shared selector) | consumer sets size | new glyph: `tag` — A clipped label with a small punched hole for categories or tags. |
| `web/src/components/trajectory/review-icons.ts:55` | Reicon Sliders | Review settings (shared selector) | consumer sets size | new glyph: `settings` — An angular gear with a square hub for settings, options or tool configuration. |
| `web/src/components/trajectory/review.css:204` | CSS triangle | Review problem indicator | 0.43rem CSS `.rv-kind` | keep — Approved triangle for problems |
| `web/src/components/trajectory/review.css:205` | CSS octagon | Review strength indicator | CSS `.rv-kind` | keep — Approved octagon for strengths |
| `web/src/components/trajectory/review.css:206` | CSS diamond | Review suggestion indicator | CSS `.rv-kind` | keep — Approved diamond for suggestions |
| `web/src/components/trajectory/SharedTrajectoryWorkspace.tsx:185` | Reicon ChatRoundLine | Turn count in shared review | 12px | new glyph: `chat` — An angular speech bubble, with a short line inside, for chat and discussion. |
| `web/src/components/trajectory/TrajectoryCanvas.tsx:372` | Reicon Gear | Tool call in transcript, from reviewIcon.tool | 14px | new glyph: `settings` — An angular gear with a square hub for settings, options or tool configuration. |
| `web/src/components/trajectory/TrajectoryReviewWorkspace.tsx:508` | unicode ✓ | Accepted review verdict | inherits rail text | use `check` |
| `web/src/components/trajectory/TrajectoryReviewWorkspace.tsx:510` | unicode × | Rejected review verdict | inherits rail text | use `x` |
| `web/src/components/trajectory/TrajectoryReviewWorkspace.tsx:516` | unicode ◇ | Rewrites in the collapsed Review Desk | inherits rail text | new glyph: `suggestion` — An outlined diamond for suggestions or rewrites in review. |
| `web/src/components/trajectory/TrajectoryReviewWorkspace.tsx:517` | unicode ● | A rubric proposal is waiting | inherits rail text | new glyph: `status-dot` — A square accent pixel for passive status, including progress and connection states. |
| `web/src/pages/TrajectoryReview.tsx:173` | ArrowLeft | Reviews | 15px | use `left` |
| `web/src/pages/TrajectoryReview.tsx:309` | LoaderCircle | Loading or pending work · Loading review workspace… | 17px | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/components/trajectory/review.css:52` | CSS triangle | Problem in review list | 0.44rem | keep — Approved problem shape |
| `web/src/components/trajectory/review.css:53` | CSS octagon | Strength in review list | 0.44rem | keep — Approved strength shape |
| `web/src/components/trajectory/review.css:54` | CSS diamond | Suggestion in review list | 0.44rem | keep — Approved suggestion shape |

### Onboarding

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/ChatIntro.tsx:99` | unicode ▸ | Terminal-style prompt for a boot line | 0.875rem base, responsive | keep — Terminal transcript punctuation |

### Learning

The activity SVGs are plots (`web/src/components/UsageCharts.tsx:351`, `:619`, `:800`). Benchmark and training data primarily use the redesign’s glyphs. The remaining training data link mark appears below.

#### Activity

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/LearningInsightsHeader.tsx:23` | image asset | Keating brand lockup in Learning header | CSS .lr-logo | keep — Keating wordmark and logo |
| `web/src/components/UsageCharts.tsx:497` | unicode › | Navigate the topic hierarchy breadcrumb | inherits breadcrumb text | use `chevr` |
| `web/src/pages/EvolutionDetail.tsx:92` | AlertTriangle | Back to usage | 32px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/pages/EvolutionDetail.tsx:97` | ArrowLeft | Back to usage | 16px | use `left` |
| `web/src/pages/EvolutionDetail.tsx:174` | ArrowLeft | Back to usage | 16px | use `left` |
| `web/src/pages/EvolutionDetail.tsx:186` | ExternalLink | Open source session | 12px | use `ext` |
| `web/src/pages/EvolutionDetail.tsx:193` | GitCompareArrows | Final policy diff | 16px | new glyph: `compare` — Two opposing arrows or panes for contrasting versions and outputs. |
| `web/src/pages/EvolutionDetail.tsx:201` | CheckCircle2 | Accepted candidate steps | 16px | use `check` |
| `web/src/pages/EvolutionDetail.tsx:220` | CircleDot | Full evolution report Raw saved evidence | 16px | new glyph: `status-dot` — A square accent pixel for passive status, including progress and connection states. |

#### Coming up

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/pages/ComingUp.tsx:177` | GripVertical | ~ min Learning priority | 16px | new glyph: `drag` — A small matrix of square dots for grabbing and reordering. |
| `web/src/pages/ComingUp.tsx:184` | Layers3 | ~ min | 11px | new glyph: `cards` — Two staggered cards with a corner index for a flashcard deck. |
| `web/src/pages/ComingUp.tsx:185` | AlertTriangle | overdue | 11px | new glyph: `warning` — A triangle with an exclamation for caution beside distinct problem or strength statuses. |
| `web/src/pages/ComingUp.tsx:186` | Clock3 | ~ min | 11px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/pages/ComingUp.tsx:552` | RefreshCw | Review queue is loading | 16px | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/pages/ComingUp.tsx:561` | Brain | Number of cards due now | 18px | new glyph: `cards` — Two staggered cards with a corner index for a flashcard deck. |
| `web/src/pages/ComingUp.tsx:562` | Clock3 | Review time | 18px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/pages/ComingUp.tsx:563` | Layers3 | Learning items | 18px | use `layers` |
| `web/src/pages/ComingUp.tsx:568` | CheckCircle2 | Start due review | 18px | use `check` |
| `web/src/pages/ComingUp.tsx:571` | Play | Start due review | 15px | use `play` |
| `web/src/pages/ComingUp.tsx:603` | Upload | Import an Anki deck | 15px | use `import` |
| `web/src/pages/ComingUp.tsx:606` | Download | Export .apkg | 15px | use `export` |
| `web/src/pages/ComingUp.tsx:664` | ArrowRight | Open the Anki import help | 13px | use `right` |

#### Benchmark

No foreign icon entry in the benchmark route. The expandable model row is an existing-glyph finding in section 3 (`web/src/pages/KeatingBench.tsx:521`).

#### Training data

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/pages/TrainingData.tsx:317` | unicode ↗ | Open the session in Review | inherits link text | use `ext` |

### Profile

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/pages/PublicProfile.tsx:132` | Flag | Report an inappropriate profile | 14px | new glyph: `flag` — A small flagged bookmark for reporting or marking an item for later review. |

### Rooms

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/rooms/CourseRooms.tsx:96` | Plus | Study rooms | 13px | use `plus` |
| `web/src/components/rooms/CourseRooms.tsx:96` | X | Study rooms (dismiss, remove, or mark failure) | 13px | use `x` |
| `web/src/components/rooms/CourseRooms.tsx:147` | Users | People | 11px | new glyph: `people` — Two silhouettes for a group, participants or membership. |
| `web/src/components/rooms/CourseRooms.tsx:169` | ArrowRight | Advance or open the linked destination | 13px | use `right` |
| `web/src/components/rooms/RoomInvitesPanel.tsx:57` | Check | New link. Copy it now; it is shown only once. Invitation link (completion or selection) | 13px | use `check` |
| `web/src/components/rooms/RoomInvitesPanel.tsx:57` | Copy | New link. Copy it now; it is shown only once. Invitation link (copy to clipboard) | 13px | use `copy` |
| `web/src/components/rooms/RoomInvitesPanel.tsx:147` | QrCode | Invite people | 15px | new glyph: `qr` — Three square registration marks and an offset pixel cluster for QR actions. |
| `web/src/components/rooms/RoomKeatingPanel.tsx:156` | Power | Turn off Keating for the room | 13px | new glyph: `power` — A broken ring with a vertical line for turning a runtime or assistant off. |
| `web/src/components/rooms/RoomKeatingPanel.tsx:171` | Pause | Pause Keating in this room | 13px | new glyph: `pause` — Two vertical bars to suspend work or playback. |
| `web/src/components/rooms/RoomKeatingPanel.tsx:179` | Hand | Ask Keating to step in | 13px | new glyph: `hand` — A raised angular palm for asking to speak, intervene or hand off. |
| `web/src/components/rooms/RoomSettingsPanel.tsx:14` | Download | Export transcript | 13px | use `export` |
| `web/src/components/rooms/RoomTranscript.tsx:85` | EyeOff | Indicate a hidden room message | 10px | new glyph: `hidden` — An angular eye with a diagonal slash for hidden content. |
| `web/src/components/rooms/RoomTranscript.tsx:98` | CornerDownRight | Replying to : | 12px | new glyph: `reply` — A bent return arrow for replying to a particular message. |
| `web/src/components/rooms/RoomTranscript.tsx:114` | Reply | Reply to this room message | 12px | new glyph: `reply` — A bent return arrow for replying to a particular message. |
| `web/src/components/rooms/RoomTranscript.tsx:122` | EyeOff | Hide this room message | 12px | new glyph: `hidden` — An angular eye with a diagonal slash for hidden content. |

### Courses

#### Library

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/courses/CourseArtifactCard.tsx:145` | Box | Package | 16px | new glyph: `package` — An angular box with one open or accented face for a bundled artifact. |
| `web/src/components/courses/CourseArtifactCard.tsx:145` | Image | Image | 16px | new glyph: `image` — A framed angular landscape with a small accent sun for images. |
| `web/src/components/courses/CoursesAccessGate.tsx:47` | KeyRound | Provider or account credentials | 14px | new glyph: `key` — A key with a squared bow and teeth for API credentials and authorization. |
| `web/src/components/courses/CoursesAccessGate.tsx:56` | ArrowRight | Check account | 16px | use `right` |
| `web/src/components/courses/CoursesAccessGate.tsx:60` | ArrowRight | Retry course access | 16px | use `right` |
| `web/src/components/courses/SaveTaskToCourse.tsx:65` | Check | Saved to | 19px CSS | use `check` |
| `web/src/components/courses/SaveTaskToCourse.tsx:69` | BookPlus | Add to a course | 17px CSS | new glyph: `course` — A bound volume with a small lesson tab for courses and lessons. |
| `web/src/components/courses/SaveTaskToCourse.tsx:69` | RotateCcw | No courses you can edit yet. | 17px CSS | new glyph: `reset` — A counterclockwise return arrow for restoring an earlier or initial state. |
| `web/src/components/courses/SaveTaskToCourse.tsx:79` | FolderOpen | Folder | 17px CSS | new glyph: `folder` — A tabbed folder outline for directories and file browsing. |
| `web/src/components/courses/SaveTaskToCourse.tsx:80` | BookPlus | Add to a course | 17px CSS | new glyph: `course` — A bound volume with a small lesson tab for courses and lessons. |
| `web/src/components/courses/SaveTaskToCourse.tsx:82` | RotateCcw | Retry destinations | 17px CSS | use `refresh` |
| `web/src/pages/self-paced.css:83` | unicode → | Open this self-paced course | 16px text | use `right` |
| `web/src/pages/SelfPaced.tsx:232` | ChevronDown | Start another course | 14px | use `chev` |
| `web/src/pages/SelfPaced.tsx:232` | Plus | Start another course | 14px | use `plus` |
| `web/src/pages/SelfPaced.tsx:282` | Check | All activities are prepared. | 14px | use `check` |
| `web/src/pages/SelfPaced.tsx:305` | RefreshCw | Try again | 14px | use `refresh` |
| `web/src/pages/SelfPaced.tsx:308` | Play | Resume | 14px | use `play` |
| `web/src/pages/SelfPaced.tsx:309` | Pause | Pause | 14px | new glyph: `pause` — Two vertical bars to suspend work or playback. |
| `web/src/pages/SelfPaced.tsx:371` | Check | Mark as read | 14px | use `check` |
| `web/src/pages/SelfPaced.tsx:394` | Check | Your attempts | 12px | use `check` |
| `web/src/pages/SelfPaced.tsx:407` | ArrowRight | Next: | 14px | use `right` |
| `web/src/pages/SelfPaced.tsx:471` | ArrowLeft | All courses | 14px | use `left` |
| `web/src/pages/SelfPaced.tsx:480` | ExternalLink | (opens in a new tab) | 12px | use `ext` |
| `web/src/pages/SelfPaced.tsx:484` | Download | Download as Markdown | 14px | use `export` |
| `web/src/pages/SelfPaced.tsx:536` | Check | Why: From: (completion or selection) | 14px | use `check` |
| `web/src/pages/SelfPaced.tsx:542` | Check | Why: From: (completion or selection) | 14px | use `check` |
| `web/src/pages/SelfPaced.tsx:542` | Lock | Why: From: | 14px | use `lock` |
| `web/src/pages/SelfPaced.tsx:542` | Timer | Why: From: | 14px | new glyph: `time` — A clock or timer face with one accented hand for elapsed time or deadlines. |
| `web/src/pages/SelfPaced.tsx:547` | ChevronDown | Why: From: | 14px | use `chev` |

#### Workspace

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/courses/CourseCommandPalette.tsx:27` | BookOpen | Lesson item type | 15px | use `book` |
| `web/src/components/courses/CourseCommandPalette.tsx:28` | Layers3 | Module item type | 15px | use `layers` |
| `web/src/components/courses/CourseCommandPalette.tsx:29` | FileText | Document item type | 15px | new glyph: `document` — A folded-corner page and ruled lines for documents and file records. |
| `web/src/components/courses/CourseCommandPalette.tsx:30` | Shapes | Artifact item type | 15px | new glyph: `artifact` — Simple grouped shapes indicating a mixed-media or interactive artifact. |
| `web/src/components/courses/CourseCommandPalette.tsx:31` | BookUp | Assignment item type | 15px | new glyph: `assignment` — A clipped sheet with one empty response line for an assignment. |
| `web/src/components/courses/CourseCommandPalette.tsx:32` | CreditCard | Flashcard search result type | 15px | new glyph: `cards` — Two staggered cards with a corner index for a flashcard deck. |
| `web/src/components/courses/CourseCommandPalette.tsx:33` | MessageSquareText | Comment item type | 15px | new glyph: `chat` — An angular speech bubble, with a short line inside, for chat and discussion. |
| `web/src/components/courses/CourseCommandPalette.tsx:34` | StickyNote | Note item type | 15px | new glyph: `notes` — A page with a short writing stroke for a note or written reflection. |
| `web/src/components/courses/CourseCommandPalette.tsx:35` | Users | Member item type | 15px | new glyph: `people` — Two silhouettes for a group, participants or membership. |
| `web/src/components/courses/CourseCommandPalette.tsx:166` | Search | Search this course | 17px | use `search` |
| `web/src/components/courses/CourseCommandPalette.tsx:303` | Sparkles | Ask Keating to search the course | 15px | use `kmark` |
| `web/src/components/courses/CourseDiscussion.tsx:227` | CornerDownRight | Reply | 12px | new glyph: `reply` — A bent return arrow for replying to a particular message. |
| `web/src/components/courses/CourseInviteDialog.tsx:48` | QrCode | Invite to this course | 18px | new glyph: `qr` — Three square registration marks and an offset pixel cluster for QR actions. |
| `web/src/components/courses/CourseInviteDialog.tsx:49` | X | Close invitation | 18px | use `x` |
| `web/src/components/courses/CourseInviteDialog.tsx:61` | Check | invite Expires in 7 days · up to 25 uses (completion or selection) | 15px | use `check` |
| `web/src/components/courses/CourseInviteDialog.tsx:61` | Copy | invite Expires in 7 days · up to 25 uses (copy to clipboard) | 15px | use `copy` |
| `web/src/components/courses/CourseInviteDialog.tsx:61` | Link2 | invite | 13px | new glyph: `link` — Two interlocking angular links for URL actions or link materials. |
| `web/src/components/courses/CourseKeatingPanel.tsx:77` | Sparkles | Work with Keating, course assistant heading | 14px | use `kmark` |
| `web/src/components/courses/CourseReactionBar.tsx:136` | SmilePlus | Add a reaction | 13px | new glyph: `reaction` — An outlined smile with a small plus for adding a reaction. |
| `web/src/components/courses/CourseReviewPanel.tsx:101` | Users | Roster · | 13px | new glyph: `people` — Two silhouettes for a group, participants or membership. |
| `web/src/components/courses/CourseReviewPanel.tsx:167` | ClipboardCheck | Lesson work · | 13px | new glyph: `checklist` — A ruled page with checkboxes for a plan, task list or checklist. |
| `web/src/components/courses/CourseSwitcher.tsx:194` | LibraryBig | Course library | 14px | use `layers` |
| `web/src/courses/course-comments.ts:8` | emoji ❓ | Question reaction | inherits reaction text | keep — Course reaction identity |
| `web/src/courses/course-comments.ts:8` | emoji 🎯 | On-target reaction | inherits reaction text | keep — Course reaction identity |
| `web/src/courses/course-comments.ts:8` | emoji 👍 | Thumbs up reaction | inherits reaction text | keep — Course reaction identity |
| `web/src/courses/course-comments.ts:8` | emoji 💡 | Idea reaction | inherits reaction text | keep — Course reaction identity |
| `web/src/courses/course-comments.ts:8` | emoji 🔥 | Fire reaction | inherits reaction text | keep — Course reaction identity |
| `web/src/courses/course-comments.ts:8` | emoji 🙌 | Celebration reaction | inherits reaction text | keep — Course reaction identity |
| `web/src/pages/course-workspace/DeskCards.tsx:121` | FileText | Document · Course Source Card | 15px | new glyph: `document` — A folded-corner page and ruled lines for documents and file records. |
| `web/src/pages/course-workspace/DeskView.tsx:459` | StickyNote | Shared notes · version The margin everyone can write in. | 22px | new glyph: `notes` — A page with a short writing stroke for a note or written reflection. |
| `web/src/pages/course-workspace/model.ts:40` | FileText | Course document or material section | workspace consumer sets size | new glyph: `document` — A folded-corner page and ruled lines for documents and file records. |
| `web/src/pages/course-workspace/model.ts:41` | MessageSquareText | Course discussion section | workspace consumer sets size | new glyph: `chat` — An angular speech bubble, with a short line inside, for chat and discussion. |
| `web/src/pages/course-workspace/model.ts:43` | ClipboardCheck | Course review section | workspace consumer sets size | new glyph: `checklist` — A ruled page with checkboxes for a plan, task list or checklist. |
| `web/src/pages/course-workspace/model.ts:46` | Hammer | Course builder section | workspace consumer sets size | new glyph: `settings` — An angular gear with a square hub for settings, options or tool configuration. |
| `web/src/pages/course-workspace/WorkspaceBanners.tsx:37` | X | Dismiss | 16px | use `x` |
| `web/src/pages/course-workspace/WorkspaceStatus.tsx:51` | ArrowLeft | Course library | 15px | use `left` |

#### Builder

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/courses/assembler/ArtifactsSection.tsx:41` | Shapes | Artifact tray | 17px | new glyph: `artifact` — Simple grouped shapes indicating a mixed-media or interactive artifact. |
| `web/src/components/courses/assembler/AssemblerHeader.tsx:63` | X | Close course assembler | 19px | use `x` |
| `web/src/components/courses/assembler/CreateFooter.tsx:46` | Loader2 | Loading or pending work | 17px | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/components/courses/assembler/CreateFooter.tsx:51` | Plus | Add · On Create | 17px | use `plus` |
| `web/src/components/courses/assembler/DecksSection.tsx:62` | Layers3 | Flashcard decks | 17px | new glyph: `cards` — Two staggered cards with a corner index for a flashcard deck. |
| `web/src/components/courses/assembler/DecksSection.tsx:105` | Upload | Flashcard decks | 12px | use `import` |
| `web/src/components/courses/assembler/PlansSection.tsx:39` | BookOpen | Plans from your chats | 17px | use `book` |
| `web/src/components/courses/assembler/SelectionSummary.tsx:33` | Check | Completion or selection · On Summary | 16px | use `check` |
| `web/src/components/courses/assembler/SelectionSummary.tsx:33` | Rows3 | Rows · On Summary | 16px | new glyph: `rows` — Three separate horizontal rows for list or layout options. |
| `web/src/components/courses/assembler/SourceStatus.tsx:24` | Loader2 | Loading or pending work · Looking through your saved work… | 16px | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/components/courses/CourseAddMenu.tsx:91` | FilePlus2 | Document add | 14px | new glyph: `document-add` — A folded page with a small plus for creating a document. |
| `web/src/components/courses/CourseAddMenu.tsx:250` | Link2 | Add a link An article, video, dataset, or reference | 14px | new glyph: `link` — Two interlocking angular links for URL actions or link materials. |
| `web/src/components/courses/CourseAddMenu.tsx:315` | BookUp | Assignment | 14px | new glyph: `assignment` — A clipped sheet with one empty response line for an assignment. |
| `web/src/components/courses/CourseAddMenu.tsx:325` | FileQuestion | Quiz or artifact | 14px | new glyph: `quiz` — A page with a question mark and selectable marks for a quiz or exam. |
| `web/src/components/courses/CourseAddMenu.tsx:338` | CreditCard | Flashcard | 14px | new glyph: `credits` — A card or coin with a simple denomination mark for payment and account credit. |
| `web/src/components/courses/CourseAddMenu.tsx:353` | Shapes | Open the full builder | 14px | new glyph: `artifact` — Simple grouped shapes indicating a mixed-media or interactive artifact. |
| `web/src/components/courses/CourseBuilder.tsx:341` | Settings2 | Edit module details | 12px | use `edit` |
| `web/src/components/courses/CourseBuilder.tsx:836` | FileQuestion | Practice question | 14px | new glyph: `quiz` — A page with a question mark and selectable marks for a quiz or exam. |
| `web/src/components/courses/CourseBuilder.tsx:903` | FileText | documents | 12px | new glyph: `document` — A folded-corner page and ruled lines for documents and file records. |
| `web/src/components/courses/CourseBuilder.tsx:910` | Shapes | artifacts | 12px | new glyph: `artifact` — Simple grouped shapes indicating a mixed-media or interactive artifact. |
| `web/src/components/courses/CourseBuilder.tsx:917` | BookUp | assignments | 12px | new glyph: `assignment` — A clipped sheet with one empty response line for an assignment. |
| `web/src/components/courses/CourseBuilder.tsx:924` | CreditCard | cards | 12px | new glyph: `credits` — A card or coin with a simple denomination mark for payment and account credit. |
| `web/src/components/courses/CourseBuilder.tsx:971` | Image | Image · Document Row | 15px | new glyph: `image` — A framed angular landscape with a small accent sun for images. |
| `web/src/components/courses/CourseBuilder.tsx:973` | Link2 | Link · Document Row | 15px | new glyph: `link` — Two interlocking angular links for URL actions or link materials. |
| `web/src/components/courses/CourseBuilder.tsx:974` | FileText | Document · Document Row | 15px | new glyph: `document` — A folded-corner page and ruled lines for documents and file records. |
| `web/src/components/courses/CourseBuilder.tsx:1036` | Settings2 | Toggle material details and editing | 12px | use `edit` |
| `web/src/components/courses/CourseBuilder.tsx:1316` | Link2 | Add link | 13px | new glyph: `link` — Two interlocking angular links for URL actions or link materials. |
| `web/src/components/courses/CourseBuilder.tsx:2091` | Share2 | Invite | 13px | new glyph: `share` — Three connected nodes with an outward branch for sharing. |
| `web/src/components/courses/CourseContentManagers.tsx:598` | FileQuestion | Quiz | 12px | new glyph: `quiz` — A page with a question mark and selectable marks for a quiz or exam. |
| `web/src/components/courses/CourseContentManagers.tsx:899` | BookUp | Add assignment | 12px | new glyph: `assignment` — A clipped sheet with one empty response line for an assignment. |

### Settings

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/KeatingApiKeyPromptDialog.tsx:137` | KeyRound | API key required | 16px | new glyph: `key` — A key with a squared bow and teeth for API credentials and authorization. |
| `web/src/components/KeatingApiKeyPromptDialog.tsx:146` | X | Close | 16px | use `x` |
| `web/src/components/NotOrganicAccessPromptDialog.tsx:152` | KeyRound | Provider or account credentials · Not Organic Access Panel | 20px | new glyph: `key` — A key with a squared bow and teeth for API credentials and authorization. |
| `web/src/components/NotOrganicAccessPromptDialog.tsx:155` | X | consent ? "Close model access" : "Close account sign-in | 18px | use `x` |
| `web/src/components/ProxyTab.tsx:21` | ShieldCheck | Automatic browser bridge is available | 19px | new glyph: `verify` — A shield enclosing a tick for verified or protected outcomes. |
| `web/src/components/ProxyTab.tsx:40` | ArrowRight | 1. Browser Builds the provider request. 2. Keating server /api/chat-proxy validates and forwards it. | 14px | use `right` |
| `web/src/components/ProxyTab.tsx:45` | ArrowRight | 1. Browser Builds the provider request. 2. Keating server /api/chat-proxy validates and forwards it. | 14px | use `right` |
| `web/src/components/ProxyTab.tsx:56` | CheckCircle2 | Done | 14px | use `check` |
| `web/src/components/ProxyTab.tsx:60` | CheckCircle2 | Model discovery, chat streaming, speech transcription, and browser media tools use the same route. | 14px | use `check` |
| `web/src/components/settings/CopyDiagnosticButton.tsx:28` | Check | label (completion or selection) | 14px | use `check` |
| `web/src/components/settings/CopyDiagnosticButton.tsx:28` | Copy | label (copy to clipboard) | 14px | use `copy` |
| `web/src/components/settings/CustomProvidersSection.tsx:182` | ChevronDown | Add Provider | 12px | use `chev` |
| `web/src/components/settings/CustomProvidersSection.tsx:280` | X | dialog.provider ? "Edit Provider" : "Add Provider | 14px | use `x` |
| `web/src/components/settings/CustomProvidersSection.tsx:435` | inline svg | Edit provider pencil | 14px | use `edit` |
| `web/src/components/settings/CustomProvidersSection.tsx:442` | Trash2 | Delete provider | 14px | use `trash` |
| `web/src/components/settings/DiagnosticsTab.tsx:267` | unicode ✓ | Diagnostic checks passed | inherits diagnostic row text | use `check` |
| `web/src/components/settings/DiagnosticsTab.tsx:267` | unicode ✕ | Diagnostic problem | inherits diagnostic row text | use `alert` |
| `web/src/components/settings/ModelRolesPanel.tsx:87` | MessageSquare | Chat | 15px | new glyph: `chat` — An angular speech bubble, with a short line inside, for chat and discussion. |
| `web/src/components/settings/ModelRolesPanel.tsx:106` | Brain | Judgement and decision model role | 15px | use `bulb` |
| `web/src/components/settings/ModelRolesPanel.tsx:118` | Mic | Voice model role | 15px | use `wave` |
| `web/src/components/settings/ModelRolesPanel.tsx:133` | Image | Images | 15px | new glyph: `image` — A framed angular landscape with a small accent sun for images. |
| `web/src/components/settings/NotOrganicAccountCard.tsx:90` | ExternalLink | Credits &amp; account details | 12px | use `ext` |
| `web/src/components/settings/ProviderConnectPanel.tsx:175` | Search | Search | 14px | use `search` |
| `web/src/components/settings/ProviderConnectPanel.tsx:198` | Check | Connected | 14px | use `check` |
| `web/src/components/settings/StartTab.tsx:30` | Cpu | Choose a model setup step | 18px | new glyph: `chip` — An angular chip with contacts for local model and compute controls. |
| `web/src/components/settings/StartTab.tsx:31` | Brain | Configure learning preferences setup step | 18px | use `bulb` |
| `web/src/components/settings/StartTab.tsx:32` | Settings2 | Inspect app settings setup step | 18px | new glyph: `settings` — An angular gear with a square hub for settings, options or tool configuration. |
| `web/src/components/settings/StartTab.tsx:54` | ArrowRight | Advance or open the linked destination | 16px | use `right` |
| `web/src/components/settings/StartTab.tsx:58` | BookOpen | Read the documentation Guides for choosing a model, learning workflows and troubleshooting. | 18px | use `book` |
| `web/src/components/settings/StartTab.tsx:63` | ArrowRight | Read the documentation Guides for choosing a model, learning workflows and troubleshooting. | 16px | use `right` |
| `web/src/components/SettingsDialog.tsx:285` | Rocket | Start settings tab | 15px | new glyph: `launch` — A small launch arrow with an accent trail for starting setup or an experience. |
| `web/src/components/SettingsDialog.tsx:286` | Cpu | Models settings tab | 15px | new glyph: `chip` — An angular chip with contacts for local model and compute controls. |
| `web/src/components/SettingsDialog.tsx:287` | Brain | Learning settings tab | 15px | use `bulb` |
| `web/src/components/SettingsDialog.tsx:288` | Settings2 | App settings tab | 15px | new glyph: `settings` — An angular gear with a square hub for settings, options or tool configuration. |
| `web/src/components/SettingsDialog.tsx:289` | Bug | Diagnostics settings tab | 15px | new glyph: `bug` — A compact angular bug for troubleshooting and diagnostics. |
| `web/src/components/SettingsDialog.tsx:290` | BookOpen | Documentation tab | 15px | use `book` |
| `web/src/components/SettingsDialog.tsx:329` | BookOpen | Documentation | 14px | use `book` |
| `web/src/components/SettingsDialog.tsx:331` | ExternalLink | Documentation | 12px | use `ext` |
| `web/src/components/SettingsDialog.tsx:404` | X | Close | 16px | use `x` |
| `web/src/components/SpeechSettingsTab.tsx:324` | Trash2 | Remove the selected speech model | 14px | use `trash` |
| `web/src/components/TeacherPersonaTab.tsx:95` | Check | Reset to John Keating (completion or selection) | 15px | use `check` |
| `web/src/components/TeacherPersonaTab.tsx:95` | Save | Reset to John Keating | 15px | use `save` |
| `web/src/components/TeacherPersonaTab.tsx:104` | RotateCcw | Reset to John Keating | 14px | new glyph: `reset` — A counterclockwise return arrow for restoring an earlier or initial state. |

### Landing and marketing

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/CreditWaitlistDialog.tsx:67` | unicode × | Close the credit waitlist | inherits button text | use `x` |
| `web/src/components/DownloadPdfButton.tsx:18` | FileDown | Download the current item as PDF | 14px | use `export` |
| `web/src/components/Footer.tsx:15` | image asset | Keating brand lockup in marketing footer | CSS .foot branding slot | keep — Keating wordmark and logo |
| `web/src/components/LandingClosing.tsx:23` | ArrowUpRight | A question is enough. Start a session | 24px | use `right` |
| `web/src/components/LandingClosing.tsx:27` | ArrowDown | Take it with you. Download Keating | 24px | use `export` |
| `web/src/components/LandingIntro.tsx:38` | Play | so we made keating Scroll (start or resume) | 16px | use `play` |
| `web/src/components/LandingIntro.tsx:38` | X | so we made keating Scroll (dismiss, remove, or mark failure) | 16px | use `x` |
| `web/src/components/LandingIntro.tsx:42` | ArrowDown | Continue to the interactive lesson | 19px | use `down` |
| `web/src/components/LandingLearning.tsx:46` | ArrowRight | Shape this plan with Keating | 18px | use `right` |
| `web/src/components/LandingLearning.tsx:55` | ArrowUp | Your possible path | 16px | use `rise` |
| `web/src/components/LandingLearning.tsx:70` | ArrowRight | See how to make it yours | 18px | use `right` |
| `web/src/components/LandingLearning.tsx:101` | Check | Start with a sound Listen, change the oscillator, compare. (completion or selection) | 18px | use `check` |
| `web/src/components/LandingLearning.tsx:101` | MessageSquare | Chat · Landing Shared Learning | 24px | new glyph: `chat` — An angular speech bubble, with a short line inside, for chat and discussion. |
| `web/src/components/LandingLearning.tsx:103` | ArrowRight | Build a course | 18px | use `right` |
| `web/src/components/LandingLearning.tsx:103` | ArrowRight | Open your courses | 18px | use `right` |
| `web/src/components/LandingOverload.tsx:24` | unicode ↗ | Bring this example window forward | inherits window mark text | new glyph: `maximize` — Two opposing expanding corners for enlarge or full screen. |
| `web/src/components/LandingWonder.tsx:415` | unicode ← | Previous learning stage | inherits button text | use `left` |
| `web/src/components/LandingWonder.tsx:426` | unicode → | Next learning stage | inherits button text | use `right` |
| `web/src/components/platform-logos.tsx:12` | React Icons SiApple | Apple platform mark | 24px default / caller override | keep — Platform brand mark |
| `web/src/components/platform-logos.tsx:13` | React Icons SiApple | Mac platform mark | 24px default / caller override | keep — Platform brand mark |
| `web/src/components/platform-logos.tsx:14` | React Icons FaWindows | Windows platform mark | 24px default / caller override | keep — Platform brand mark |
| `web/src/components/platform-logos.tsx:15` | React Icons SiLinux | Linux platform mark | 24px default / caller override | keep — Platform brand mark |
| `web/src/components/platform-logos.tsx:16` | React Icons SiAndroid | Android platform mark | 24px default / caller override | keep — Platform brand mark |
| `web/src/components/platform-logos.tsx:17` | React Icons SiApple | Ios platform mark | 24px default / caller override | keep — Platform brand mark |
| `web/src/components/SurfaceScreencasts.tsx:760` | unicode → | Open the corresponding app surface | 0.7rem text | use `right` |
| `web/src/components/TutorialShot.tsx:94` | Reicon Eye | Placeholder for an upcoming tutorial screenshot | 22px | use `eye` |
| `web/src/pages/AtprotoBlog.tsx:110` | RefreshCw | Retry loading posts | 14px | use `refresh` |
| `web/src/pages/AtprotoBlog.tsx:161` | BookOpen | STANDARD.SITE | 14px | use `book` |
| `web/src/pages/AtprotoBlog.tsx:171` | Search | Search posts | 17px | use `search` |
| `web/src/pages/AtprotoBlog.tsx:195` | ArrowUpRight | STANDARD.SITE Published from | 18px | use `ext` |
| `web/src/pages/AtprotoBlog.tsx:231` | ArrowLeft | All posts | 14px | use `left` |
| `web/src/pages/AtprotoBlog.tsx:255` | ArrowUpRight | Discuss on Bluesky | 13px | use `ext` |
| `web/src/pages/Blog.tsx:3211` | Hash | Contents | 12px | new glyph: `hash` — A compact crosshatch for headings or contents. |
| `web/src/pages/Blog.tsx:3236` | ChevronUp | Collapse or scroll up · On Toggle | 14px | new glyph: `chev-up` — An upward chevron for collapse or upward scroll. |
| `web/src/pages/Blog.tsx:3240` | ChevronDown | Open or expand · On Toggle | 14px | use `chev` |
| `web/src/pages/Blog.tsx:3277` | Search | SEARCH_UPDATES | 16px | use `search` |
| `web/src/pages/Download.tsx:41` | Globe | Globe | platform mark CSS slot | new glyph: `globe` — An angular globe with meridian and latitude strokes for web or public scope. |
| `web/src/pages/Download.tsx:82` | ArrowDownToLine | Take Keating with you | 15px | use `export` |
| `web/src/pages/Download.tsx:124` | ArrowDownToLine | Export | 18px | use `export` |
| `web/src/pages/Download.tsx:134` | ArrowRight | Open Keating in your browser | 18px | use `right` |
| `web/src/pages/Download.tsx:134` | Globe | Open Keating in your browser | 20px | new glyph: `globe` — An angular globe with meridian and latitude strokes for web or public scope. |
| `web/src/pages/Download.tsx:140` | ArrowDownToLine | Install sandboxed Flatpak | 18px | use `export` |
| `web/src/pages/Download.tsx:144` | ArrowRight | Or start in your browser | 15px | use `right` |
| `web/src/pages/Download.tsx:144` | Globe | Or start in your browser | 16px | new glyph: `globe` — An angular globe with meridian and latitude strokes for web or public scope. |
| `web/src/pages/Download.tsx:146` | ArrowDown | See all downloads | 15px | use `down` |
| `web/src/pages/Download.tsx:170` | ArrowRight | release notes | 16px | use `right` |
| `web/src/pages/Download.tsx:181` | ArrowDownToLine | Export | 18px | use `export` |
| `web/src/pages/Download.tsx:183` | ArrowRight | Use the browser app | 15px | use `right` |
| `web/src/pages/Download.tsx:190` | Terminal | Installing the terminal app | 18px | new glyph: `terminal` — An angular prompt and cursor in a terminal frame. |
| `web/src/pages/Download.tsx:193` | ArrowRight | Start learning | 18px | use `right` |
| `web/src/pages/Download.tsx:193` | Globe | A browser is all you need. Start with a question. No installation required. | 28px | new glyph: `globe` — An angular globe with meridian and latitude strokes for web or public scope. |
| `web/src/pages/Landing.tsx:39` | unicode → | Start a browser session | inherits CTA text | use `right` |
| `web/src/pages/Paper.tsx:54` | Download | DOWNLOAD PDF | 20px | use `export` |
| `web/src/pages/Paper.tsx:62` | FileText | ABSTRACT | 16px | new glyph: `document` — A folded-corner page and ruled lines for documents and file records. |
| `web/src/pages/Pricing.tsx:284` | ArrowRight | Start learning | 17px | use `right` |
| `web/src/pages/Pricing.tsx:290` | ArrowRight | Join the Personal waitlist | 17px | use `right` |
| `web/src/pages/Pricing.tsx:290` | ArrowRight | Advance or open the linked destination | 17px | use `right` |
| `web/src/pages/Pricing.tsx:304` | RefreshCw | Your credit balance | 15px | use `refresh` |
| `web/src/pages/Pricing.tsx:314` | ArrowRight | Join waitlist for $ credit | 17px | use `right` |
| `web/src/pages/Pricing.tsx:314` | ArrowRight | $ $ in AI credits | 17px | use `right` |
| `web/src/pages/Pricing.tsx:317` | Check | One-time payment, no subscription | 15px | use `check` |
| `web/src/pages/Pricing.tsx:317` | Check | Same teaching tools | 15px | use `check` |

### Everything else

| File:line | Foreign icon | What it does or means | Visible size | Recommendation |
| --- | --- | --- | --- | --- |
| `web/src/components/DesktopWorkspacePanel.tsx:161` | unicode × | Dismiss runtime error | inherits button text | use `x` |
| `web/src/components/DesktopWorkspacePanel.tsx:170` | unicode · | File entry in native workspace | inherits filename text | new glyph: `document` — A folded-corner page and ruled lines for documents and file records. |
| `web/src/components/DesktopWorkspacePanel.tsx:170` | unicode ▸ | Directory entry in native workspace | inherits filename text | new glyph: `folder` — A tabbed folder outline for directories and file browsing. |
| `web/src/components/FrustrationClip.tsx:54` | Pause | wantsPlay ? "Pause animation" : "Play animation (pause playback or timing) | 15px | new glyph: `pause` — Two vertical bars to suspend work or playback. |
| `web/src/components/FrustrationClip.tsx:54` | Play | wantsPlay ? "Pause animation" : "Play animation (start or resume) | 15px | use `play` |
| `web/src/components/FrustrationClip.tsx:55` | SkipForward | Show next reaction | 15px | new glyph: `skip` — A triangle and end bar for skipping an item or scene. |
| `web/src/components/live/LiveConversation.tsx:220` | X | Dismiss | 16px | use `x` |
| `web/src/components/live/LiveConversation.tsx:228` | RefreshCw | Try again | 14px | use `refresh` |
| `web/src/components/live/LiveConversation.tsx:246` | Settings2 | Open options or settings · On Open Settings | 14px | new glyph: `settings` — An angular gear with a square hub for settings, options or tool configuration. |
| `web/src/components/live/LiveConversation.tsx:251` | Mic | Type or dictate instead | 14px | use `mic` |
| `web/src/components/live/LiveConversation.tsx:454` | X | Close live conversation | 18px | use `x` |
| `web/src/components/live/LiveConversation.tsx:649` | Mic | tavusControls?.microphoneOn === false ? "Unmute" : "Mute (record) | 22px | use `mic` |
| `web/src/components/live/LiveConversation.tsx:649` | MicOff | tavusControls?.microphoneOn === false ? "Unmute" : "Mute (mic off) | 22px | new glyph: `mic-off` — The microphone outline with an unmistakable diagonal slash. |
| `web/src/components/live/LiveConversation.tsx:656` | Camera | tavusControls?.cameraOn === false ? "Camera" : "Camera off | 22px | new glyph: `camera` — A camera body and small lens or viewfinder for camera input. |
| `web/src/components/live/LiveConversation.tsx:656` | CameraOff | tavusControls?.cameraOn === false ? "Camera" : "Camera off | 22px | new glyph: `camera-off` — A camera silhouette with a diagonal slash for disabled camera input. |
| `web/src/components/live/LiveConversation.tsx:663` | MonitorUp | Screen share | 22px | new glyph: `screen-share` — A monitor with an upward arrow to share or capture the display. |
| `web/src/components/live/LiveConversation.tsx:671` | SwitchCamera | Flip | 22px | new glyph: `camera-flip` — An angular camera with two circling arrows for changing camera direction. |
| `web/src/components/live/LiveConversation.tsx:679` | Mic | session.micMuted ? "Unmute" : "Mute (record) | 22px | use `mic` |
| `web/src/components/live/LiveConversation.tsx:679` | MicOff | session.micMuted ? "Unmute" : "Mute (mic off) | 22px | new glyph: `mic-off` — The microphone outline with an unmistakable diagonal slash. |
| `web/src/components/live/LiveConversation.tsx:689` | Camera | session.videoSource === "camera" ? "Camera off" : "Camera | 22px | new glyph: `camera` — A camera body and small lens or viewfinder for camera input. |
| `web/src/components/live/LiveConversation.tsx:689` | CameraOff | session.videoSource === "camera" ? "Camera off" : "Camera | 22px | new glyph: `camera-off` — A camera silhouette with a diagonal slash for disabled camera input. |
| `web/src/components/live/LiveConversation.tsx:696` | MonitorUp | session.videoSource === "screen" ? "Stop sharing" : "Share screen | 22px | new glyph: `screen-share` — A monitor with an upward arrow to share or capture the display. |
| `web/src/components/live/LiveConversation.tsx:707` | ImagePlus | Add a still image to this conversation | 22px | new glyph: `image-add` — An image frame with a plus in one corner for adding a picture. |
| `web/src/components/live/LiveConversation.tsx:729` | SwitchCamera | Flip | 22px | new glyph: `camera-flip` — An angular camera with two circling arrows for changing camera direction. |
| `web/src/components/live/LiveConversation.tsx:736` | PhoneOff | End | 22px | new glyph: `hang-up` — A turned handset for ending a call. |
| `web/src/components/MultiSelectDropdown.tsx:80` | ChevronDown | label | 14px | use `chev` |
| `web/src/components/MultiSelectDropdown.tsx:105` | Check | Completion or selection · On Change | 13px | use `check` |
| `web/src/components/sandbox-view.css:94` | unicode + | Expand runtime details | 16px text | use `plus` |
| `web/src/components/sandbox-view.css:95` | unicode − | Collapse runtime details | 16px text | new glyph: `remove` — A horizontal minus for remove, collapse or subtraction controls. |
| `web/src/components/sandbox/sandbox-shared.tsx:32` | Reicon Refresh | Retry · Runtime Spinner | caller size prop | use `refresh` |
| `web/src/components/sandbox/SandboxActivityPanel.tsx:20` | Reicon Activity | No activity yet Run a command or edit a file. Its result will appear here. | 30px | new glyph: `activity` — A short zigzag trace for runtime or recorded activity. |
| `web/src/components/sandbox/SandboxActivityPanel.tsx:22` | Reicon Bug | Bug | 12px | new glyph: `bug` — A compact angular bug for troubleshooting and diagnostics. |
| `web/src/components/sandbox/SandboxActivityPanel.tsx:22` | Reicon CheckCircle | Done | 12px | use `check` |
| `web/src/components/sandbox/SandboxFilesPanel.tsx:55` | Reicon Home | Go to workspace | 13px | new glyph: `home` — A small roof over an open frame for a workspace root. |
| `web/src/components/sandbox/SandboxFilesPanel.tsx:56` | Reicon ChevronLeft | Go to parent folder | 13px | use `left` |
| `web/src/components/sandbox/SandboxFilesPanel.tsx:69` | Reicon CodeFile | File Folder Add | 14px | new glyph: `code` — Angle brackets with an accented slash for code and source views. |
| `web/src/components/sandbox/SandboxFilesPanel.tsx:69` | Reicon FolderOpen | File Folder Add | 14px | new glyph: `folder` — A tabbed folder outline for directories and file browsing. |
| `web/src/components/sandbox/SandboxFilesPanel.tsx:78` | Reicon Trash2 | Delete the selected workspace file | 12px | use `trash` |
| `web/src/components/sandbox/SandboxFilesPanel.tsx:99` | Reicon Plus | Add | 12px | use `plus` |
| `web/src/components/sandbox/SandboxFilesPanel.tsx:119` | Reicon Code2 | Save | 12px | new glyph: `compare` — Two opposing arrows or panes for contrasting versions and outputs. |
| `web/src/components/sandbox/SandboxFilesPanel.tsx:121` | Reicon Save | Save | 12px | use `save` |
| `web/src/components/sandbox/SandboxHistoryPanel.tsx:74` | Reicon Download | Export | 12px | use `export` |
| `web/src/components/sandbox/SandboxHistoryPanel.tsx:82` | Reicon Upload | Import | 12px | use `import` |
| `web/src/components/sandbox/SandboxHistoryPanel.tsx:89` | Reicon Refresh | Refresh | 12px | use `refresh` |
| `web/src/components/sandbox/SandboxHistoryPanel.tsx:108` | Reicon BranchUp | Branch | 13px | use `fork` |
| `web/src/components/sandbox/SandboxHistoryPanel.tsx:126` | Reicon Save | Commit | 13px | new glyph: `save-commit` — A square node with a line entering and leaving for a repository commit. |
| `web/src/components/sandbox/SandboxHistoryPanel.tsx:144` | Reicon RotateLeft | Switch | 10px | new glyph: `reset` — A counterclockwise return arrow for restoring an earlier or initial state. |
| `web/src/components/sandbox/SandboxHistoryPanel.tsx:171` | Reicon Code2 | Diff with next | 10px | new glyph: `compare` — Two opposing arrows or panes for contrasting versions and outputs. |
| `web/src/components/sandbox/SandboxHistoryPanel.tsx:181` | Reicon RotateLeft | Write this commit's files back into the sandbox | 10px | new glyph: `reset` — A counterclockwise return arrow for restoring an earlier or initial state. |
| `web/src/components/sandbox/SandboxProbesPanel.tsx:46` | Reicon Play | Run check (start or resume) | 15px | use `play` |
| `web/src/components/sandbox/SandboxProbesPanel.tsx:51` | Reicon Copy | Run check | 14px | use `copy` |
| `web/src/components/sandbox/SandboxShellPanel.tsx:39` | Reicon RotateLeft | Clear | 12px | new glyph: `reset` — A counterclockwise return arrow for restoring an earlier or initial state. |
| `web/src/components/sandbox/SandboxShellPanel.tsx:47` | Reicon Maximize2 | Fit | 12px | new glyph: `maximize` — Two opposing expanding corners for enlarge or full screen. |
| `web/src/components/sandbox/SandboxSnapshotsPanel.tsx:24` | Reicon RotateLeft | Restore | 12px | new glyph: `reset` — A counterclockwise return arrow for restoring an earlier or initial state. |
| `web/src/components/sandbox/SandboxSnapshotsPanel.tsx:84` | Reicon Refresh | Refresh | 12px | use `refresh` |
| `web/src/components/sandbox/SandboxSnapshotsPanel.tsx:93` | Reicon Plus | Create | 12px | use `plus` |
| `web/src/components/sandbox/SandboxStatusPanel.tsx:48` | Reicon Bug | Recent activity Environment details Environment Endpoint Choose an environment | 18px | new glyph: `bug` — A compact angular bug for troubleshooting and diagnostics. |
| `web/src/components/sandbox/SandboxStatusPanel.tsx:62` | Reicon ChevronLeft | Browse files Open your workspace | 16px | use `chevr` |
| `web/src/components/sandbox/SandboxStatusPanel.tsx:62` | Reicon FolderOpen | Browse files Open your workspace | 22px | new glyph: `folder` — A tabbed folder outline for directories and file browsing. |
| `web/src/components/sandbox/SandboxStatusPanel.tsx:63` | Reicon ChevronLeft | Open terminal Run a command | 16px | use `chevr` |
| `web/src/components/sandbox/SandboxStatusPanel.tsx:63` | Reicon TerminalSquare | Open terminal Run a command | 22px | new glyph: `terminal` — An angular prompt and cursor in a terminal frame. |
| `web/src/components/sandbox/SandboxStatusPanel.tsx:71` | Reicon Bug | Recent activity | 12px | new glyph: `bug` — A compact angular bug for troubleshooting and diagnostics. |
| `web/src/components/sandbox/SandboxStatusPanel.tsx:71` | Reicon CheckCircle | Recent activity (done) | 12px | use `check` |
| `web/src/components/sandbox/SandboxStatusPanel.tsx:79` | Reicon Cpu | Environment details | 18px | new glyph: `chip` — An angular chip with contacts for local model and compute controls. |
| `web/src/components/sandbox/SandboxStatusPanel.tsx:91` | Reicon CheckCircle | Done | 12px | use `check` |
| `web/src/components/sandbox/SandboxStatusPanel.tsx:91` | Reicon X | Dismiss, remove, or mark failure | 12px | use `x` |
| `web/src/components/sandbox/SandboxStatusPanel.tsx:95` | Reicon HelpCircle | Choose an environment | 18px | new glyph: `question` — An angular speech or circle frame with a visible question mark for help or a question. |
| `web/src/components/SandboxView.tsx:77` | Reicon Cpu | Chip | 17px | new glyph: `chip` — An angular chip with contacts for local model and compute controls. |
| `web/src/components/SandboxView.tsx:78` | Reicon FolderOpen | Folder | 17px | new glyph: `folder` — A tabbed folder outline for directories and file browsing. |
| `web/src/components/SandboxView.tsx:79` | Reicon TerminalSquare | Terminal | 17px | new glyph: `terminal` — An angular prompt and cursor in a terminal frame. |
| `web/src/components/SandboxView.tsx:80` | Reicon Activity | Activity | 17px | new glyph: `activity` — A short zigzag trace for runtime or recorded activity. |
| `web/src/components/SandboxView.tsx:153` | Reicon Cpu | Chip | 24px | new glyph: `chip` — An angular chip with contacts for local model and compute controls. |
| `web/src/components/SandboxView.tsx:159` | Reicon X | Close runtime | 20px | use `x` |
| `web/src/components/SandboxView.tsx:167` | Reicon Refresh | Refresh runtime | 18px | use `refresh` |
| `web/src/components/SandboxView.tsx:169` | Reicon PowerOff | Stop | 17px | new glyph: `power` — A broken ring with a vertical line for turning a runtime or assistant off. |
| `web/src/components/SandboxView.tsx:172` | Reicon Play | booting ? "Starting NodePod" : "Start NodePod (start or resume) | 17px | use `play` |
| `web/src/components/Select.tsx:70` | Reicon Check | Completion or selection | 17px | use `check` |
| `web/src/components/Select.tsx:77` | Reicon ChevronDown | Open or expand | 17px | use `chev` |
| `web/src/components/Select.tsx:81` | Reicon ChevronUp | Collapse or scroll up | 16px | new glyph: `chev-up` — An upward chevron for collapse or upward scroll. |
| `web/src/components/Select.tsx:88` | Reicon ChevronDown | Open or expand | 16px | use `chev` |
| `web/src/components/Spinner.tsx:24` | Loader2 | Loading or pending work | 14px default / caller override | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/design-system/Recipes.tsx:48` | Moon | Demonstrate button size and tone | 12 / 14 / 16px | new glyph: `moon` — An angular crescent for switching to dark appearance. |
| `web/src/pages/Live.tsx:199` | Settings2 | Open options or settings | 14px | new glyph: `settings` — An angular gear with a square hub for settings, options or tool configuration. |
| `web/src/pages/Live.tsx:286` | Mic | Voice | 15px | use `mic` |
| `web/src/pages/Live.tsx:294` | Camera | Video PAL and Magic Canvas | 15px | new glyph: `camera` — A camera body and small lens or viewfinder for camera input. |
| `web/src/pages/Live.tsx:299` | Camera | Camera | 15px | new glyph: `camera` — A camera body and small lens or viewfinder for camera input. |
| `web/src/pages/Live.tsx:309` | MonitorUp | Screen | 15px | new glyph: `screen-share` — A monitor with an upward arrow to share or capture the display. |
| `web/src/pages/Live.tsx:321` | ImagePlus | Add an image once the conversation starts | 15px | new glyph: `image-add` — An image frame with a plus in one corner for adding a picture. |
| `web/src/pages/Live.tsx:365` | Mic | Record | 18px | use `mic` |
| `web/src/pages/Live.tsx:380` | ArrowLeft | Back to the conversation | 14px | use `left` |
| `web/src/pages/NotOrganicCallback.tsx:51` | CircleAlert | Problem state | 28px | use `alert` |
| `web/src/pages/NotOrganicCallback.tsx:51` | LoaderCircle | Loading or pending work | 28px | new glyph: `loading` — An open segmented ring for pending work, with a static reduced-motion frame. |
| `web/src/pages/OAuthCallback.tsx:61` | inline svg | Authorization success check | 24px CSS styles.svg | use `check` |
| `web/src/pages/OAuthCallback.tsx:73` | inline svg | Authorization failure cross | 24px CSS styles.svg | use `x` |
| `web/src/pages/SharedSession.tsx:208` | MessageSquareText | Shared session not found Back to chat | 32px | new glyph: `chat` — An angular speech bubble, with a short line inside, for chat and discussion. |
| `web/src/pages/SharedSession.tsx:217` | ArrowLeft | Back to chat | 16px | use `left` |
| `web/src/pages/SharedSession.tsx:238` | Bot | Shared from \| | 13px | use `kmark` |
| `web/src/pages/SharedSession.tsx:248` | Copy | Shared Keating session Shared from \| | 16px | use `copy` |
| `web/src/pages/SharedSession.tsx:257` | GitFork | Starts a new chat from the shared conversation | 16px | use `fork` |
| `web/src/pages/SharedSession.tsx:282` | Bot | Shared Keating session Shared from \| | 14px | use `kmark` |
| `web/src/pages/SharedSession.tsx:282` | User | Shared Keating session Shared from \| | 14px | new glyph: `person` — An angular head and shoulders for one learner, profile or account. |

## 3. Wrong or doubtful existing-glyph uses

2 high, 11 medium and 6 low findings. High flags conflicting visible chat affordances. Medium flags different semantics or an incorrect active state. Low flags ambiguous metaphors or scope.

| Severity | File:line | Current meaning | Use instead |
| --- | --- | --- | --- |
| High | web/src/pages/chat/ChatHeader.tsx:252 | `layers` appears on the compact Sources button even though the adjacent Materials control also uses `layers`. | Use `book`. C1 note 4 and the C1 header draw Sources as a book. `web/src/pages/chat/chat-surface.css:84` and `:95` govern the compact variant. |
| High | web/src/pages/chat/ChatHeader.tsx:280 | `book` opens session review. It also reads as Sources in the approved header vocabulary. | Use `pen` for Review. C1 note 7 and the header drawing distinguish Review, Materials and Sources. |
| Medium | web/src/pages/course-workspace/DeskView.tsx:252 | `quote` opens the lesson discussion. It neither quotes nor inserts a passage. | Use `chat`. |
| Medium | web/src/pages/course-workspace/WorkspaceHeader.tsx:104 | The `discuss` tab uses quotation marks for course discussion. | Use `chat`. |
| Medium | web/src/components/courses/CourseKeatingPanel.tsx:138 | `quote` opens a course conversation with Keating. | Use `chat`. |
| Medium | web/src/components/courses/CourseDiscussion.tsx:379 | `quote` labels the course discussion area. | Use `chat`. |
| Medium | web/src/pages/CourseJoin.tsx:169 | The error state uses `book`, which reads as course content; the consent branch uses a question-mark shield for granting access. | Use `alert` on error and `lock` for access consent, or `verify` once access is approved. |
| Medium | web/src/components/trajectory/TrajectoryCanvas.tsx:375 | `refresh` on the pending branch reads as retry while the tool is merely pending. | Use `loading` on the pending branch. |
| Medium | web/src/components/trajectory/PatternDigestPanel.tsx:56 | The running branch uses `refresh` on a button that stops the digest. | Use `stop` while cancel is available. The completed rerun branch fits `refresh`. |
| Medium | web/src/components/trajectory/CandidateLedger.tsx:182 | Rotating `refresh` reports generation in flight. | Use `loading` during generation. |
| Medium | web/src/components/courses/CourseBuilder.tsx:1250, :1686, :1825 | Three `refresh` variants indicate active file selection processing, reading or import. | Use `loading` for the busy branches. |
| Medium | web/src/components/courses/CourseAddMenu.tsx:91, :207 | `refresh` indicates an upload in progress. | Use `loading` for the busy branches. |
| Medium | web/src/components/courses/CourseSwitcher.tsx:129 | `refresh` is a loading indicator for fetching courses. | Use `loading`. |
| Low | web/src/components/trajectory/TurnRail.tsx:47 | `panel` draws the left rail, while the label describes turns rather than sessions. | Keep the left-rail affordance if collapse is the primary meaning. Use `route` for a turns heading. |
| Low | web/src/pages/KeatingBench.tsx:521 | Expanded model details show a full down arrow beside a collapsed state chevron. | Use paired chevrons. `chev` for expansion and `chev-up` if the expanded button means collapse. |
| Low | web/src/pages/TrainingData.tsx:295 | `chevr` signals next although this opens a model picker in place. | Use `chev` if styled as a chooser. |
| Low | web/src/components/LearnerProfileTab.tsx:235, :242 | `refresh` represents clearing a learner profile, including at confirmation. | Use `trash` if the control is presented as removal, or `reset` if the copy presents restoring defaults. |
| Low | web/src/pages/Courses.tsx:142 | `feather` is the Socratic review pass glyph. The CTA starts planning with Keating. | Use `kmark` for the Keating handoff. |
| Low | web/src/components/settings/LearningTab.tsx:44 | `compass` means finish note in the glyph legend but opens an onboarding tour. | The compass drawing fits wayfinding. Confirm it is a deliberately shared metaphor or use `play` for starting the tour. |

The reorder controls already use the drawn arrows `rise` and `down` in the audited checkout (`web/src/pages/LearningProfile.tsx:278–279`, `:397–398`, `web/src/components/courses/CourseBuilder.tsx:456`, `:468`). The `up`/`dn` occurrences are chat helpful/not-helpful thumbs (`web/src/components/AssistantChatPanel.tsx:4343`, `:4361`). A downward disclosure chevron and a downward movement arrow should remain distinct.

## 4. New glyphs needed

Counts come from section 2. Section 3 may add migration targets. Reuse `settings` for generic cogs, wrenches and the review Settings selector; reserve `controls` for simulation or explicit parameter tuning. `time` merges timer, clock and calendar-clock variants. `loading` merges loader rings and spinners currently drawn as refresh. `archive` is one reversible drawing, with the arrow oriented to the destination. `status-dot` also covers passive indicator states. Use one `cards` drawing across flashcard and deck marks. `warning` keeps caution distinct from the octagonal `alert`, which carries the problem meaning.

| Proposed glyph | Drawing and meaning | Places | Nearest existing glyph |
| --- | --- | --- | --- |
| `time` | A clock or timer face with one accented hand for elapsed time or deadlines. | 21 | `ruler` |
| `warning` | A triangle with an exclamation for caution beside distinct problem or strength statuses. | 15 | `alert` |
| `loading` | An open segmented ring for pending work, with a static reduced-motion frame. | 14 | `refresh` |
| `settings` | An angular gear with a square hub for settings, options or tool configuration. | 12 | `filter` |
| `chat` | An angular speech bubble, with a short line inside, for chat and discussion. | 11 | `quote` |
| `reset` | A counterclockwise return arrow for restoring an earlier or initial state. | 11 | `refresh` |
| `suggest` | Two small sparks for a generated suggestion, enhancement or appearance preset. | 10 | `kmark` |
| `cards` | Two staggered cards with a corner index for a flashcard deck. | 9 | `layers` |
| `checklist` | A ruled page with checkboxes for a plan, task list or checklist. | 9 | `ruler` |
| `compare` | Two opposing arrows or panes for contrasting versions and outputs. | 9 | `layers` |
| `document` | A folded-corner page and ruled lines for documents and file records. | 8 | `copy` |
| `pause` | Two vertical bars to suspend work or playback. | 8 | `play` |
| `course` | A bound volume with a small lesson tab for courses and lessons. | 7 | `book` |
| `assignment` | A clipped sheet with one empty response line for an assignment. | 6 | `ruler` |
| `code` | Angle brackets with an accented slash for code and source views. | 6 | `edit` |
| `flag` | A small flagged bookmark for reporting or marking an item for later review. | 6 | `book` |
| `key` | A key with a squared bow and teeth for API credentials and authorization. | 6 | `lock` |
| `status-dot` | A square accent pixel for passive status, including progress and connection states. | 6 | `kmark` |
| `stop` | A solid square to halt work or playback. | 6 | `play` |
| `chev-up` | An upward chevron for collapse or upward scroll. | 5 | `chev` |
| `chip` | An angular chip with contacts for local model and compute controls. | 5 | `panel` |
| `folder` | A tabbed folder outline for directories and file browsing. | 5 | `layers` |
| `globe` | An angular globe with meridian and latitude strokes for web or public scope. | 5 | `compass` |
| `image` | A framed angular landscape with a small accent sun for images. | 5 | `panel` |
| `link` | Two interlocking angular links for URL actions or link materials. | 5 | `clip` |
| `notes` | A page with a short writing stroke for a note or written reflection. | 5 | `edit` |
| `question` | An angular speech or circle frame with a visible question mark for help or a question. | 5 | `shield` |
| `quiz` | A page with a question mark and selectable marks for a quiz or exam. | 5 | `ruler` |
| `terminal` | An angular prompt and cursor in a terminal frame. | 5 | `kmark` |
| `verify` | A shield enclosing a tick for verified or protected outcomes. | 5 | `shield` |
| `archive` | A box with a directional tray arrow for moving sessions into or out of Earlier. | 4 | `import` |
| `artifact` | Simple grouped shapes indicating a mixed-media or interactive artifact. | 4 | `layers` |
| `audio` | A speaker with radiating bars for audio playback or spoken output. | 4 | `wave` |
| `bug` | A compact angular bug for troubleshooting and diagnostics. | 4 | `search` |
| `camera` | A camera body and small lens or viewfinder for camera input. | 4 | `eye` |
| `chart` | An ascending line or bars for scores, trends or benchmarks. | 4 | `ruler` |
| `goal` | A marked target or flag on a short pole for a learning objective. | 4 | `compass` |
| `maximize` | Two opposing expanding corners for enlarge or full screen. | 4 | `ext` |
| `reply` | A bent return arrow for replying to a particular message. | 4 | `left` |
| `activity` | A short zigzag trace for runtime or recorded activity. | 3 | `wave` |
| `bookmark` | A notched ribbon marking a saved item or saved destination. | 3 | `book` |
| `credits` | A card or coin with a simple denomination mark for payment and account credit. | 3 | `save` |
| `drag` | A small matrix of square dots for grabbing and reordering. | 3 | `more` |
| `language` | Two overlapping tiles showing distinct language characters. | 3 | `layers` |
| `moon` | An angular crescent for switching to dark appearance. | 3 | `eye` |
| `people` | Two silhouettes for a group, participants or membership. | 3 | `eye` |
| `person` | An angular head and shoulders for one learner, profile or account. | 3 | `eye` |
| `pin` | A thumbtack for pin and unpin actions and pinned markers. | 3 | `clip` |
| `screen-share` | A monitor with an upward arrow to share or capture the display. | 3 | `panel` |
| `skip` | A triangle and end bar for skipping an item or scene. | 3 | `play` |
| `sun` | A central square with radial strokes for switching to light appearance. | 3 | `bulb` |
| `video` | An angular camcorder for video calls or recording. | 3 | `play` |
| `camera-flip` | An angular camera with two circling arrows for changing camera direction. | 2 | `refresh` |
| `camera-off` | A camera silhouette with a diagonal slash for disabled camera input. | 2 | `eye` |
| `controls` | Two adjustable rails for tuning parameters and filters. | 2 | `filter` |
| `flame` | An angular flame for heat or intensity. | 2 | `bulb` |
| `hand` | A raised angular palm for asking to speak, intervene or hand off. | 2 | `up` |
| `hidden` | An angular eye with a diagonal slash for hidden content. | 2 | `eye` |
| `history` | A clock face with an angular return arrow for history. | 2 | `refresh` |
| `host` | Two stacked rack units with small lights for model or server capacity. | 2 | `layers` |
| `image-add` | An image frame with a plus in one corner for adding a picture. | 2 | `plus` |
| `mic-off` | The microphone outline with an unmistakable diagonal slash. | 2 | `mic` |
| `music` | An angular musical note for the music lab. | 2 | `wave` |
| `network` | A fan of radio arcs and one square pixel for connectivity and network failures. | 2 | `wave` |
| `outline` | A stacked hierarchy of rows with an indentation or branch for an outline. | 2 | `route` |
| `partial` | A short minus bar in an angular badge for partial or abstained outcomes. | 2 | `check` |
| `power` | A broken ring with a vertical line for turning a runtime or assistant off. | 2 | `play` |
| `printer` | A paper sheet feeding through a square printer for print actions. | 2 | `export` |
| `qr` | Three square registration marks and an offset pixel cluster for QR actions. | 2 | `pattern` |
| `remove` | A horizontal minus for remove, collapse or subtraction controls. | 2 | `plus` |
| `scan` | Four crop corners and a scanning bar for an inspection or review pass. | 2 | `eye` |
| `sign-in` | An arrow entering a doorframe for signing in or connecting an account. | 2 | `import` |
| `strength` | A plain accented octagon for the review strength category. | 2 | `alert` |
| `audio-off` | A speaker with a diagonal slash for muted audio playback. | 1 | `wave` |
| `document-add` | A folded page with a small plus for creating a document. | 1 | `copy` |
| `film` | A small film frame with edge perforations for video or film materials. | 1 | `panel` |
| `hang-up` | A turned handset for ending a call. | 1 | `play` |
| `hash` | A compact crosshatch for headings or contents. | 1 | `ruler` |
| `headphones` | An angular headband and ear cups for listening or audio monitoring. | 1 | `wave` |
| `home` | A small roof over an open frame for a workspace root. | 1 | `panel` |
| `info` | A small angular badge around a lowercase i for neutral information. | 1 | `alert` |
| `keyboard` | A compact rowed keyboard for typed input and shortcuts. | 1 | `panel` |
| `launch` | A small launch arrow with an accent trail for starting setup or an experience. | 1 | `send` |
| `line` | A short neutral horizontal bar to indicate zero change. | 1 | `check` |
| `minimize` | Two corners drawing inward for restore or exit full screen. | 1 | `panel` |
| `package` | An angular box with one open or accented face for a bundled artifact. | 1 | `layers` |
| `reaction` | An outlined smile with a small plus for adding a reaction. | 1 | `plus` |
| `repeat` | Two arrows forming a loop for replay or repetition. | 1 | `refresh` |
| `rows` | Three separate horizontal rows for list or layout options. | 1 | `menu` |
| `save-commit` | A square node with a line entering and leaving for a repository commit. | 1 | `fork` |
| `share` | Three connected nodes with an outward branch for sharing. | 1 | `fork` |
| `sign-out` | An arrow leaving a doorframe for signing out or disconnecting an account. | 1 | `ext` |
| `suggestion` | An outlined diamond for suggestions or rewrites in review. | 1 | `alert` |
| `tag` | A clipped label with a small punched hole for categories or tags. | 1 | `clip` |
| `teacher` | A person and small board for the teacher role. | 1 | `pen` |

## 5. Totals

Each screen-level total counts the rows listed in section 2.

| Surface | Replaceable now | Needs a new glyph | Keep | Total |
| --- | --- | --- | --- | --- |
| Chat | 145 | 92 | 4 | 241 |
| Inline lesson components | 125 | 119 | 0 | 244 |
| Review | 16 | 16 | 7 | 39 |
| Onboarding | 0 | 0 | 1 | 1 |
| Learning | 12 | 10 | 1 | 23 |
| Profile | 0 | 1 | 0 | 1 |
| Rooms | 6 | 9 | 0 | 15 |
| Courses | 38 | 51 | 6 | 95 |
| Settings | 31 | 12 | 0 | 43 |
| Landing and marketing | 45 | 10 | 7 | 62 |
| Everything else | 47 | 54 | 0 | 101 |
| **Total** | 465 | 374 | 26 | 865 |

### Handoff check during the migration

On November 19, 2026 around 05:29 Toronto time, the same checkout exported **119 glyphs** in `web/src/design-system/glyphs/data.ts` (`LABELS`). The 73 additions include `gear`, `spin`, `clock`, `stop`, `doc`, `message` and `verified`. Reconcile the proposals in section 4 with these drawings before commissioning art. Those proposals and the screenshots describe the baseline.

The same AST scan returned **356 package-backed icon candidates**, down from 779 baseline candidates across 81 files with changed candidate counts. This comparison includes named variants and Reicon wrapper arguments. The scope of the comparison is limited to imported component references, so the numbers differ from the broader inventory above.

| Surface | Baseline package candidates | At handoff check |
| --- | --- | --- |
| Chat | 198 | 33 |
| Inline lesson components | 237 | 0 |
| Review | 27 | 21 |
| Onboarding | 0 | 0 |
| Learning | 20 | 20 |
| Profile | 1 | 1 |
| Rooms | 15 | 15 |
| Courses | 88 | 88 |
| Settings | 44 | 36 |
| Landing and marketing | 55 | 54 |
| Everything else | 94 | 88 |

The Chat package candidates at that check came from Reicon in `web/src/components/SessionCard.tsx:2`, `web/src/components/SessionBrowserSheet.tsx:2` and `web/src/components/SessionBrowserDesktop.tsx:13`. The new chat source already draws `quote` (`web/src/components/chat/QuoteParts.tsx:221`), `mic` and `wave` (`web/src/components/chat/SpeechComposerControl.tsx:330`, `:353`), and the More menu’s `gear` (`web/src/pages/chat/ChatHeader.tsx:484`). The two header meaning conflicts were still present at `web/src/pages/chat/ChatHeader.tsx:250` and `:278`. The newer state was checked in source only. Package and line counts can continue to change while the migration is active.
