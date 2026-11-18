# Keating’s web classroom

Playwright typed a synthetic learner’s request for a stage-light control into Keating’s classroom. While the page waited, Jev chose a simulation and MiniMax generated two candidates. One keyboard step from 6 to 7 flashes per second changed the displayed 12-second count from **72 to 84**. Four further classroom runs exercised previously released replies from the study. [Browse the screenshots](index.html)

| Learner asked to | Generation and selection | What worked in the browser | Words around the activity |
| --- | --- | --- | ---: |
| Vary a stage light’s flash rate over 12 seconds | Live Jev 1.14.0 and MiniMax M2.7 Highspeed. Jev offered Simulation. The gate released draft 2 with an unverified notice. | The real simulation mounted. Moving the slider from 6 to 7 updated the total from 72 to 84 flashes. The rate readout also changed from 6 to 7 flashes/s. | 47 |
| Predict how many layers a twice-folded paper strip has | Recorded Jev 1.14.0 and Gemini 3.1 Flash-Lite. Jev offered Question and Simulation. Draft 1 passed review and was released. | The renderer showed a one-item question group. Selecting **4** and clicking **Finish check** created a completed `submit-question-group` receipt. Chat showed the saved answer. | 0 |
| Edit a buggy Python loop that sums three numbers | Recorded Jev 1.14.0 and Gemini 3.1 Flash-Lite. The plan requested editable Python. Draft 2 passed and was released. | **Edit** opened the Python source. The editor accepted an added comment. **Reset code** restored the original bytes. The separate OpenUI component list was empty. | 48 outside the editor, 71 outside OpenUI |
| Guess the most likely shape in a bag with three round tiles and one square | Final v2.3.5 study. Jev 1.14.0 reviewed MiniMax M2.7 Highspeed’s first draft; it passed, and neither prediction-specific selection rule applied. | Four choices rendered. Selecting **Round** and submitting created a completed action. The saved answer was **Round**, pending grading with no score. | 15 |
| Find the bug in a Python loop that collects multiples of three | Final v2.3.5 study. Jev 1.14.0 reviewed MiniMax M2.7 Highspeed’s first draft; it passed, and neither prediction-specific selection rule applied. | The learner changed `if i % 3 == 0:` to `if numbers[i] % 3 == 0:` in the actual editor. Reset restored the original bytes. The browser measured editing only. | 51 outside the editor, 73 outside OpenUI |

**Observed scope.** The five activities above contribute one live teaching turn and four public-message replays. Each replay submitted the original synthetic learner wording and used the recorded public Pi reply at the transport boundary. Chat submission, local storage, rendering and actions ran in the browser. The replay’s local decision mode is unknown. Reviewer and draft selection in the table come from the original study receipts. [Study register](../study/cohort.json)

### A typed answer to the displayed tile question

The original v2.3.5 browser left the four-option tile question awaiting when the learner typed “My guess is round, because three of the four tiles are round.” Its stored record had no graded or pending submission. A v2.3.7 classroom replayed the same sealed parent, then sent that typed answer live. The decision request carried the exact displayed document and node, with one awaiting record and zero pending submissions. Jev returned `continue`. MiniMax reached the 3,072-token limit in a partial interactive-page proposal on its first physical request. The study lease stopped the next two logical attempts locally. **The learner saw “Couldn't produce a reply.”** The app issued no grade and presented no new activity. Settings recorded a withheld turn and 36.044 seconds to the public notice. The local WebMCP and CLI agreed. [Original typed-answer state](final-prediction/typed-active-work.json) · [Live browser evidence](live-tile-confirm/evidence.json) · [What the learner saw](live-tile-confirm/classroom-desktop.png) · [Settings export](live-tile-confirm/settings-export.json) · [Sealed study receipt](../study/classroom-v2.3.7/receipts/classroom-tile-confirm--minimax--jev.json)

Jev marked the learner’s attempt present and another answer as no longer due. The v2.3.7 tutor instructions nevertheless said “The learner has not yet answered the open question-group guess for the current focus.” This conflicts with the measured turn and identifies a separate defect in how the harness described that decision. The incomplete generation does not establish what a completed reply would have said. [Planning and tutor receipt](../study/classroom-v2.3.7/receipts/classroom-tile-confirm--minimax--jev.json)

The mobile read-only viewer also displayed the same four options and the collapsed failure notice when scrolled to the end. It used the two original public messages and made zero POST requests. [Read-only phone view](live-tile-confirm/notice-mobile-replay.png) · [Viewer verification](live-tile-confirm/read-only-replay.json)

The **v2.3.8 retest** kept the original question, typed answer, tutor, decision model and 3,072-token limit. The corrected instruction told MiniMax to acknowledge the learner’s attempt and stop after giving feedback. Jev’s fresh plan and the private tutor inputs contain that wording. All three drafts completed. Draft 1 opened another question group. Draft 2 gave 266 words. Draft 3 used 37 words to confirm that round has probability 3/4, square 1/4, and round is three times as likely. Jev left a critical mastery-overclaim check unresolved at 0.50 on that final draft. The gate withheld it. The learner again saw **“Couldn't produce a reply”**, after 28.807 seconds. The screen showed no grade, and the original card remained awaiting with zero pending submissions. Settings, WebMCP and the CLI identified one guided withheld follow-up with a privately compiled question group and zero selected or rendered components. Seven provider requests comprised one plan, three generations and three reviews. [Visible classroom](linked-tile-confirm/classroom-desktop.png) · [Phone](linked-tile-confirm/classroom-mobile.png) · [Browser evidence and exact notice](linked-tile-confirm/evidence.json) · [Settings export](linked-tile-confirm/settings-export.json) · [Matched machine query](linked-tile-confirm/webmcp-and-cli.json) · [Sealed receipt](../study/classroom-v2.3.8/receipts/classroom-tile-linked-feedback--minimax--jev.json) · [Same-input instruction comparison](../study/classroom-v2.3.8/old-plan.json)

In its review of the final candidate, Jev assigned 0.95 to the learner having answered and 0.97 to the tutor giving a grounded confirmation. The independent mastery-overclaim finding remained unresolved. The system recorded that distinction even though the desktop and phone both showed the same failure notice. [Final review and private candidates](../study/classroom-v2.3.8/receipts/classroom-tile-linked-feedback--minimax--jev.json)

### What the traces show

- **Stage light.** From 18:20:46 to 18:21:11 UTC on November 18, Jev answered the plan and both review requests. MiniMax answered two draft requests. The app recorded 24.123 seconds to public release. Draft 1 had a failing review and draft 2 had an unknown review. The gate used its best-effort release. For the first learner turn, the independent browser cue, delivered recommendation, compiled draft, selected reply and mounted component all identify Simulation. [Browser evidence](live-stage-light/evidence.json) · [Saved gate snapshot](live-stage-light/browser-gate.json) · [Source receipt](../study/receipts/classroom-stage-light--minimax--jev.json)
- **Paper fold.** The first turn’s independent cue targets were Question or Quiz. The selected and mounted component was `question-group`. The real classroom stored the answer as a second learner turn. Its subsequent model request was cancelled before dispatch under the replay boundary. The UI displayed “Check complete” and the learner’s answer. A subsequent tutor grade was outside this demonstration. [Browser evidence](recorded-question/evidence.json) · [Saved answer](recorded-question/classroom-after-action.png) · [Source receipt](../study/receipts/paper-fold--flash--jev.json)
- **Python.** The preregistration identifies an editable-code opportunity. The frozen browser’s wording-based classifier labeled this prompt `none`. The source plan explicitly offered Python in its code-practice field, and the browser identified the language as Python. The selected example indexes one element past the end of the list. By inspection it would raise an index error before its print statement, although the reply says it will produce an incorrect result. This was an editor interaction with a reset. No notebook, model follow-up or code execution was requested. [Browser evidence](recorded-python/evidence.json) · [Editor after the change](recorded-python/classroom-edit.png) · [Source receipt](../study/receipts/python-sum--flash--jev.json)

### Inspect a saved turn

Each Settings export contains the content-free learner-turn key and component evidence. Load one file using **Settings → Interface use → Import JSON**. The classroom host ran the tool registered under `keating.openui_diagnostics` in the browser’s WebMCP registry and compared its result with the CLI on the exported bytes. All five matched. The tool callback ran locally. [Stage light](live-stage-light/settings-export.json) · [Paper fold](recorded-question/settings-export.json) · [Python sum](recorded-python/settings-export.json) · [Tile prediction](final-prediction/settings-export.json) · [Multiples of three](final-python/settings-export.json)

The original v2.3.5 traces marked the independent learner cue `none` in both final cases. The same trace recorded a mounted QuestionGroup for the tile learner and editable Python with an empty fenced-OpenUI component list for the debugging learner. Each replay’s `released-drafts` query returned one release with unobserved selection. The original receipts establish the prior selection. Their SHA-256 hashes are checked before replay. [Prediction evidence](final-prediction/evidence.json) · [Prediction receipt](../study/supplement/prediction/receipts/tile-bag--minimax--jev.json) · [Python evidence](final-python/evidence.json) · [Python receipt](../study/supplement/addendum/receipts/multiples-loop--minimax--jev.json)

The revised passive classifier recognizes both original requests. It reads the learner’s wish to guess a named attribute before explanation, or a named study language and a nearby request to work on a flawed code artifact. These two cases informed the change. Of 42 registered or recorded historical prompts (35 distinct wordings), the two final cases were the only changed labels compared with v2.3.5. A separate check preserved all 139 previously archived message labels (126 distinct wordings). Both original classroom exports retain their observed `none` values. [Historical comparison](cue-history.ts) · [Original archive check](../../verify-archived-cues.mjs)

A separate check compares the four model-reviewed typed confirmations with a real classroom answer submission. It reproduces the grading authorizations on the original provider inputs and follows one saved answer through the local grading operation. [Follow-up diagnosis](FOLLOWUP.md)

The original live stage-light gate recorded **attempt 2, best effort**. Its receipt predates prediction-rule telemetry, so the rule remains unknown. An offline replay of two saved paper-fold turns through the instrumented gate records **attempt 1, best effort** for MiniMax with Jev (the Question survived a presentation-only review finding), and **attempt 2, passed review** for Flash with Google (the requested answer field displaced an approved prose question). The control in which the competing prose was judged to be an ordinary reply recorded **attempt 1, passed review, neither rule**. These are release decisions on saved inputs. [Read the verification script](selection-proof.ts)

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/selection-proof.ts
```

The isolated host used Keating’s web composer, the Flue browser/NodePod conversation runtime, ordinary web tool schemas and OpenUI prompt, browser teaching gate, real OpenUI and Markdown renderers, action handling, session storage and Settings. It used a fresh, account-free browser profile per example. Outbound browser requests were blocked. Each authorized live turn used a separate one-turn loopback decision and tutor bridge. An optional CDN probe was blocked in each session. The pages fit the 390 × 844 viewport and recorded no JavaScript page errors. These observations establish local behavior for synthetic turns. Production frequency, remote device compatibility and human learning require other evidence.

### Repeat without provider calls

From the repository root, restore the archived v2.3.3 product into a temporary checkout. The restore checks the archive and each extracted source file and reuses installed package dependencies.

```sh
rtk proxy python docs/benchmarks/openui-audit-2026-11-18/final-review/study/source.py restore
```

Pass the printed checkout path to the read-only viewer. It serves the genuine saved reply in Keating’s renderer. Its **Inspect recorded turn** link imports the original Settings export. Other permitted samples are `recorded-question` and `recorded-python`.

```sh
rtk proxy bun docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/inspect.mjs --product /path/to/restored-checkout --sample live-stage-light
```

To repeat the browser interaction, specify a fresh output directory. This invocation uses only the retained public message. The source gate and live duration stay in the original receipt. The new browser run gets its own session ID and timing.

```sh
rtk proxy bun docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/run.mjs --product /path/to/restored-checkout --id paper-fold--flash--jev --out /tmp/keating-paper-fold-replay
rtk proxy bun src/cli/main.ts openui-diagnostics docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/live-stage-light/settings-export.json
```

The two final cases use the independently verified v2.3.5 source delta. Run the restore first and use its printed path for `/path/to/v2.3.5`. For a read-only HTTP view use `inspect.mjs` with the same restored checkout and sample `final-prediction` or `final-python`.

```sh
rtk proxy python3 -I docs/benchmarks/openui-audit-2026-11-18/final-review/study/supplement/source-delta.py restore prediction
rtk proxy bun docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/run.mjs --product /path/to/v2.3.5 --phase prediction --id tile-bag--minimax--jev --out /tmp/keating-final-prediction
rtk proxy bun docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/run.mjs --product /path/to/v2.3.5 --phase addendum --id multiples-loop--minimax--jev --out /tmp/keating-final-python
rtk proxy bun docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/cue-history.ts /path/to/v2.3.5
```

The read-only continuation viewer restores both exact public messages and imports the original two-row Settings export. Open its printed HTTP address and scroll below the tile question for the learner’s typed answer and the public notice.

```sh
rtk proxy node docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/verify-live-followup.mjs live-tile-confirm
rtk proxy python3 -I docs/benchmarks/openui-audit-2026-11-18/final-review/study/classroom-v2.3.7/source.py restore
rtk proxy bun docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/inspect.mjs --product /path/to/v2.3.7 --sample live-tile-confirm
```

For the post-correction comparison, restore the matching product and inspect `linked-tile-confirm`.

```sh
rtk proxy node docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/verify-live-followup.mjs linked-tile-confirm
rtk proxy python3 -I docs/benchmarks/openui-audit-2026-11-18/final-review/study/classroom-v2.3.8/source.py restore
rtk proxy bun docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/inspect.mjs --product /path/to/v2.3.8 --sample linked-tile-confirm
```
