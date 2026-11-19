# OpenUI diagnostics

Keating records learner cues, tutoring decisions and interface observations as separate fields on one turn. The shared API and CLI return JSON from the same aggregation. Analysis runs locally and requires no model calls.

Follow a learner’s request from the tutor’s first draft through selection and classroom use. The standalone inspector also accepts a recording of your own. [Read Fable’s classroom field guide](benchmarks/jev-paired-feedback-2026-11-18/index.html) · [Open the inspector](benchmarks/openui-audit-2026-11-18/diagnostics.html) · [Try the original replies](benchmarks/openui-audit-2026-11-18/final-review/index.html)

## Inspect an incident

The tutor writes the reply. The decision model plans the turn and reviews drafts. In web Settings, choose **Gemini Decision 1 (Google API key)** to send those checks directly to Google with the key saved for teaching decisions. Choose **Off** for an unguided tutor reply. In Diagnostics, filter by tutor and decision model independently so that changing the reviewer does not accidentally change the comparison group.

For reviewer attribution, use the diagnostic turn’s `decisionModel` or the draft receipt’s `judgeModel`. The internal check category `source: "jev"` predates the Google integration and identifies a model-evaluated rule. A Google decision can carry that category. The provider receipt distinguishes the requested model from any model identifier returned by the service.

If a learner saw no reply, open **Inspect turns → Show turns**. **Reply ended with an error** shows interrupted generations, including streams that ended early. **Reply withheld** shows review decisions. A fresh `decisionFailure` record identifies a planning request that stopped before the tutor could write. Its `configuredModel` names the intended reviewer. `decisionModel` records a reviewer that actually returned a decision. The first-party detail `relay-origin-denied` identifies Keating’s own origin check.

On 4.2.5 and later an unguided generation records `requestedModel` when the tutor is called. A separately available provider identity appears under `model`. Filter Settings by tutor or query an export with `--view error`. Older exports retain their original evidence. [Inspect the interrupted production turn](https://chat.keating.help/chat?settings=diagnostics&source=hosted-guidance&view=error)

Machines can use `{"view":"withheld","decisionModel":"jev-1.14.0"}` in WebMCP or `rtk bun src/cli/main.ts openui-diagnostics classroom.json --view withheld --decision-model jev-1.14.0`. The summary groups observed planning failures by configured model, reason and detail. A failed planning turn counts toward the learner’s end-to-end wait. With zero tutor generations it supplies no evidence about a tutor’s choice of interface. [See the hosted incident](benchmarks/jev-paired-feedback-2026-11-18/index.html#production-relay)

To check a running classroom from its first message through a reload, run this command with its URL and the repository’s Playwright Chromium installation.

```sh
rtk bun scripts/openui-diagnostics/probe-classroom-observer.mjs http://localhost:5173
```

The command opens a fresh anonymous browser, saves dummy keys, and injects a planning denial for one synthetic learner message. It checks the classroom notice, the withheld turn in WebMCP after reload, and the matching Settings export. It blocks provider requests, including background model calls. A pass verifies the classroom observer and local persistence. Run the decision relay probe separately to check the actual server origin policy.

Choose **Jev pair reviews** to see which replies advanced from drafts 1–2 and 3–4. A pair can prefer a reply that failed an individual check. A pair with no eligible reply has no finalist. The inspector shows how long both comparisons were in progress at the same time. A feedback-only flag identifies a draft asked to answer the learner’s current item without tools. **Grading tool only** identifies a completed draft offered just `grade_question_checks` for a saved answer. The CLI and WebMCP expose its draft number in `pairReviews[].gradeOnlyAttempts`. Older records can omit the field. A grade proposal takes effect only when that draft is released and the tool succeeds. [Inspect the first classroom check](benchmarks/openui-audit-2026-11-18/diagnostics.html?source=jev-pairs-first&view=pair-reviews) · [Inspect a saved answer and its withheld feedback](benchmarks/openui-audit-2026-11-18/diagnostics.html?source=hosted-submission&view=pair-reviews)

Expand a pair to see each completed draft’s review findings beside its release eligibility. Two drafts can share a finding and receive different eligibility decisions. **Review issues across all drafts** collects findings from the whole turn, including drafts the learner never saw. Where two finalists received a valid final comparison, the record includes both choice probabilities, the preferred draft and the reviewer’s reported confidence. **Released draft** identifies the actual published reply. [Inspect the reconstructed paper and sock reviews](benchmarks/openui-audit-2026-11-18/diagnostics.html?source=jev-pairs-review&view=pair-reviews)

A tool can run between the learner’s answer and the tutor’s final reply. Expand that learner turn to inspect each recorded pair review in order. The final round stays in `pairReviews`. The preceding rounds are in `earlierPairReviewRounds`, with their original round numbers, observed tutor, and winning draft when known. The most recent 32 preceding pair-review rounds can be retained per turn. An older export may have only the final round. The pair totals include every retained round. The frequency and delay denominators still count each physical learner turn once. [Inspect a successful grade followed by four withheld explanations](benchmarks/openui-audit-2026-11-18/diagnostics.html?source=grade-only-replay&view=pair-reviews)

In the CLI or WebMCP `pair-reviews` view, `turns[].pairReviews[].candidateAttempts` lists the completed drafts. When the pair records `eligibleAttempts`, Keating allowed the listed drafts into selection and held the other completed drafts. An omitted list means eligibility is unknown. Read `candidateIssueIds` separately. A member with an empty `issues` list had no observed findings. A missing member has no findings record. To investigate why Keating held a draft, inspect its detailed checks when available.

To reproduce a report, include the recording and turn filter in the URL. Open `/chat?settings=diagnostics&source=final&view=action-unmet` to inspect the four final study turns. In the standalone inspector, the same query opens directly from the field guide. It reports zero missed actions across three known outcomes and one unknown. Choose **Final reply with editable code** to see the two Python exercises. [Inspect learner actions](benchmarks/openui-audit-2026-11-18/diagnostics.html?source=final&view=action-unmet)

Open **Settings → Diagnostics → Interface use** in Chat. The local deep link is `/chat?settings=diagnostics`. Select **This browser** or **Import JSON**, choose the tutor and learner cue, then switch between **In a draft**, **In the final reply** and **Shown in chat**. Each stage has its own measured denominator and unknown count. In **Inspect turns**, choose **Interface compiled, then dropped** to see the decision model, offered types, private draft count and recorded review issues for individual turns. **Export trace** downloads the source rows, while **Download filtered summary** downloads the current query.

Browser-connected models can read `keating://openui-diagnostics` through Keating’s WebMCP bridge to get the same summary for the device. The browser keeps the 500 most recently started or retried teaching turns. Imports and saved examples are isolated from that history. A withheld result, a native tool call and an unmounted component have different evidence. A native page request alone supplies no proof of a fenced OpenUI component. The **Shown in chat** measure is a committed web presentation, with no claim that the learner saw, used or learned from the control.

## Replay and compare tutors

A provider can reject all four requests before Jev sees a draft. On new guided turns, the tutor filter includes the model Keating requested even if the **Observed tutor** is unknown. The turn shows both identities if they differ. An incomplete pair records the empty slots. Only a completed comparison counts as a Jev vote.

Choose a recording that observed the stage you want to investigate.

| Recording | What it measures |
| --- | --- |
| Jev pair reviews · two predictions | Two learners who wanted to guess saw a Question on the first reply. One ordinary draft and one prediction-focused draft won. [Compare the pair decisions](benchmarks/openui-audit-2026-11-18/diagnostics.html?source=jev-pairs-prediction&view=pair-reviews) |
| MiniMax M3.1 Flash · two predictions | A free-text paper-fold Question reached the learner. MiniMax returned HTTP 429 on all four sock-draw attempts. [Inspect both turns](benchmarks/openui-audit-2026-11-18/diagnostics.html?source=flash-prediction&view=pair-reviews) |
| Jev pair reviews · five classroom turns | Two typed answers, a one-word request and two implicit requests for controls. Includes the feedback-only prompt assignments and a withheld prediction. [Open the five turns](benchmarks/openui-audit-2026-11-18/diagnostics.html?source=jev-pairs&view=pair-reviews) |
| Jev pair reviews · first classroom check | Four MiniMax replies on each of two Jev-guided turns. Both pair preferences, the individual eligibility decisions and the classroom outcome are recorded. |
| Final review · selected tutor replies | Follows guided turns through review and release. Includes withheld turns and provider errors. [Open the two lost prediction fields](benchmarks/openui-audit-2026-11-18/diagnostics.html?source=review&cue=implicit-action&view=draft-loss) |
| Final review · original drafts with two decision models | Compares 24 primary assignments by tutor and task with Jev, Gemini Decision and unguided generation. [Compare first drafts](benchmarks/openui-audit-2026-11-18/diagnostics.html?source=review-first) |
| When the learner declined a quiz | Four public simulations with the same learner opt-out. Two still instructed the learner to predict. [Inspect the turns](benchmarks/openui-audit-2026-11-18/diagnostics.html?source=assessment-opt-out&view=assessment-opt-out) |
| Recorded tutor audit | 20 synthetic turns from November 18 using the 4.2.0 release harness. The expected learner action was recorded before generation. |
| Revised policy check | New prediction, exploration and direct-answer cases with the same two tutor models under the revised release policy. The recording includes the selected replies’ component types and prose counts. |
| Jev and Gemini Decision 1 | The same two tutors and three prompts with each planner and reviewer. Select a decision model to inspect its offers, releases and dropped drafts. [Compare the recorded replies and identical-input replays](benchmarks/openui-audit-2026-11-18/gemini-decision/comparison.html) · [Study report](benchmarks/openui-audit-2026-11-18/gemini-decision/REPORT.md) |
| Multi-turn teaching episodes | 804 learner turns in completed September terminal episodes. Final types come from the terminal adapter. A new or reopened session starts a new observation window. |
| Paired Jev benchmark | Compact and governed first generations matched on September tutor, case, tool schema, repetition and observed input. Missing output and unscored pairs stay visible in coverage. |
| Hands-on and direct replies · policy 2.2 | A previous policy comparison covering prediction, simulation, editable code and short answers. |
| Sliders and Python editors · policy 2.3 | Tracks the offered action, selected editor language and withheld replies in four follow-up assignments. |

Models can call the read-only WebMCP tool `keating.openui_diagnostics` with `{"view":"draft-loss","cue":"implicit-action","limit":5}` to retrieve five matching cases and the full match count. The default view returns aggregates. `render-loss` selects final interfaces that were absent on an observed mount.

Use `--view released-drafts`, or the same WebMCP `view`, for released replies with a recorded winning draft. `unknownSelections` counts releases in the filtered sample that lack this evidence, including ungated replies. Settings shows the winning attempt and review disposition when you expand a turn.

To analyse a later executed prompt-adherence benchmark, convert its receipts and open the resulting file in the inspector or CLI.

```sh
rtk bun scripts/openui-diagnostics/from-benchmark.ts prompt-adherence /path/to/executed-run > comparison.json
rtk bun src/cli/main.ts openui-diagnostics comparison.json
```

The benchmark's `compact` arm omits the turn-specific plan and its `governed` arm supplies it. Both include the common tutor instructions and component grammar. Compare **In a draft** and the **Teaching assessment** for matched prompts, then review lost and gained cases by cue. Differences in ordinary classroom traffic can flag a problem for investigation. Controlled runs establish what differed on those prompts. Include terse-answer controls when evaluating new guidance. The default classroom tutor and browser presentation require their own evidence. [Benchmark implementation](../scripts/prompt-adherence/benchmark.ts) · [Recorded November audit](benchmarks/openui-audit-2026-11-18/REPORT.md)

## Find a missed learner cue

In **Inspect turns → Show turns**, choose **Missed learner cue**. Each row shows the expected interface family and what the harness selected on the triggering turn. Open it to see whether the tutor produced a valid draft, the gate withheld the reply, or the tutor requested a native page. A known empty selection, a display-only block and a different interface family each count as a miss. A question group satisfies a question cue. A native page proposal alone supplies no selected OpenUI component.

```sh
rtk bun src/cli/main.ts openui-diagnostics web/src/keating/openui/examples/terminal-episodes.json --view unmet --limit 2
rtk bun src/cli/main.ts openui-diagnostics web/src/keating/openui/examples/november-audit.json --view unmet --cue implicit-action --limit 6
```

September’s terminal episodes had **34 same-turn misses in 40 observed opportunities**. One of those cues received a matching interface on a later reply. The November tutor audit had **6 misses in 16 observed opportunities**, five from MiniMax and one from Gemini Flash-Lite. Gemini requested a native page on that turn. Both recordings observed final selection for every cued opportunity. Use **Replies until a matching interface** for later responses and unresolved waits.

The read-only WebMCP tool `keating.openui_diagnostics` accepts `{"view":"unmet","cue":"implicit-action","limit":6}` for the current browser’s records. The CLI and WebMCP return `matchingTurns` observed misses, `observedOpportunities` eligible turns with known selection, and `unknownOpportunities` eligible turns without selection evidence. Each physical turn counts once. The limit applies only to the returned `turns` list. Direct-text requests, absent cues and unclassified prompts stay outside these counts.

## Query an export

```sh
rtk bun src/cli/main.ts openui-diagnostics schema
rtk bun src/cli/main.ts openui-diagnostics classroom.json
rtk bun src/cli/main.ts openui-diagnostics classroom.json --model inkling-2-small --cue implicit-action
rtk bun src/cli/main.ts openui-diagnostics experiment.json --experiment tutor-instruction-check
rtk bun src/cli/main.ts openui-diagnostics web/src/keating/openui/examples/decision-models.json --decision-model gemini-decision-1 --cue implicit-action
rtk bun src/cli/main.ts openui-diagnostics web/src/keating/openui/examples/november-audit.json --cue implicit-action --view draft-loss --limit 2
```

The last command finds four matching turns and returns two example rows. Use `--view render-loss` to inspect a selected control that disappeared before a measured presentation. The installed CLI accepts the same arguments after `keating openui-diagnostics`. Pass `-` for standard input. Use `--mode` to select `guided`, `baseline`, `offer-only` or `unknown`. Omit mode filtering to compare two experimental arms.

Use `--view withheld --cue direct-text` to find answers a reviewer blocked even when the tutor wrote only text. The Settings turn list calls this **Reply withheld**. Inspect the completed draft evidence and issue codes alongside the source receipt when diagnosing a provider failure.

In TypeScript, import `parseOpenUiDiagnosticExport` and `summarizeOpenUiDiagnostics` from `@keating/learner-contracts`. Parsing checks the version, field allowlists, identifiers, component names and optional gate issue codes. The summarizer accepts a row array and optional `model`, `decisionModel`, `mode`, `cue` and `experimentId` filters. The CLI flag is `--decision-model`. WebMCP takes `{"decisionModel":"gemini-decision-1"}`. Grouped results under `byDecisionModel` keep unrecorded identities in `unknown`.

## Export a production window

Run this read-only query against Keating’s US PostHog project 473463. Supply `POSTHOG_PERSONAL_API_KEY` through the process environment using a personal key limited to that project with `query:read`. The script fixes the API address and production hosts to `keating.help` and `chat.keating.help`.

```sh
rtk bun scripts/openui-diagnostics/from-posthog.ts --from 2026-11-11 --until 2026-11-18 --app-version 4.2.0 > classroom.json
rtk bun src/cli/main.ts openui-diagnostics classroom.json
```

Use `--sql` with the same scope to print the complete HogQL query without a key. It runs in the PostHog SQL editor or through its read-only MCP connector. If you save a Query API result as JSON with its original `columns` and `results`, pass it to the adapter with `--input query-result.json` or `--input -`. The default output is the same v1 export that Settings and the CLI accept. [PostHog SQL](https://posthog.com/docs/sql) and [Query API](https://posthog.com/docs/api/queries)

The half-open window uses UTC event timestamps, with dates or UTC timestamps at whole-second precision. Each event is a full snapshot. The highest numeric revision observed within the window wins per conversation and turn. Timestamp and event UUID break ties. A newer pending retry stays pending. Counts cover only captured browser telemetry for the requested version. The exporter limits each result to 1,000 turns by default. A total-row count calculated before the SQL limit catches partial pages. Use `--max-turns N` up to 5,000 or query narrower windows. A physical turn can have revisions on both sides of a boundary, so summaries for adjacent windows can overlap.

The connected project accepted the 28-column query, including `outside_words` and `native_page_requested`, for release 4.2.0 for November 11–17, 2026 UTC. It returned zero rows and reported that `openui_turn_observed` was absent from the project taxonomy. The first confirmation of production ingestion requires a captured event from a build containing the observer.

The current 39-column query includes `assessment_opt_out` and `assessment_checkpoints`. A saved 37-column result imports with that observation absent. The 37-column format includes `draft_selection` for the winning tutor attempt, review disposition and any observed prediction rule. The 36-column format includes `coding_challenge_languages` for the actual language of a selected challenge. The 35-column format includes `editor_outside_words`. The 34-column format supplies `editable_code`, `cue_code_language` and `guidance_code_language`. The 31-column format retains `native_page` and `guidance_reason`. Saved 29-column queries retain their timing. Saved 28-column queries import with timing unknown. Missing observations from each older format remain unknown.

## Follow a native page

Open **Native pages and combined delivery** in Settings to see each stage and its measured denominator. **Inspect turns → Native page activity** lists the individual proposals, including failures. Models can ask the WebMCP tool for `{"view":"native","limit":5}`. The CLI accepts the same views.

```sh
rtk bun src/cli/main.ts openui-diagnostics classroom.json --view native --limit 5
rtk bun src/cli/main.ts openui-diagnostics classroom.json --view combined-unmet --limit 5
```

A public `interactive_page` request establishes a proposal. The tool can return a rejection as ordinary text. A successful response supplies a validated page tag. **Attached** means the result entered the originating tutor’s conversation. **Saved** requires a successful session snapshot containing that result. Keating stores the page in the transcript. An unexecuted proposal has unknown execution, attachment, and presentation.

**Mounted** records the actual page card. **Ready** requires the host to accept the sandbox handshake. **Preview failed** records a renderer fallback. **Ready frame in viewport** requires a foreground tab and a positive-area frame intersection, subject to the browser’s visibility checks. **Opened full screen** records the learner opening the ready card’s full-screen view. A preview can run below the fold. Exposure describes the browser state. Learner attention, task completion and learning outcomes require their own evidence.

Each stage counts physical turns. A turn can contain several page calls, including both a failed and a successful one. Positive evidence survives remounts. A measured negative at a presentation stage means the observer had seen no positive at its latest observation. A missing observer, ambiguous identity, or unavailable legacy history stays unknown. The result, code, title, page ID and tool-call ID are absent from the exported diagnostic row.

In the combined selection count, a turn qualifies through selected fenced OpenUI or a validated native page attached to chat. In combined presentation, it qualifies through a committed fenced component or a ready native frame. A turn with both counts once. A known positive on either source establishes delivery. A negative requires measurement of both. The summary reports source counts and incomplete coverage separately. For a request naming a component, a native page has unassessed family fit. A generic request for any interface can be fulfilled by either source. The combined delay counts compatible reminders and ends a wait when the learner changes the request. Historical offers and native proposals keep their original fenced measurements.

## Check a declined quiz

A learner can ask for a slider and add “No quiz, thanks.” The interface cue records the slider, so a reply with a slider matches even when its instructions tell the learner to predict first. Each new web turn with readable learner words now also records `assessment`, with two values.

- `optOut` is true when the learner explicitly declined a quiz, test, exam or prediction in English. False means no recognised decline. It does not mean the learner asked to be tested.
- `checkpoints` lists signals in the released reply. `simulation-brief` and `reply-text` mark a sentence that opens by telling the learner to predict, guess or answer. `question-interface` marks a Question, quiz or exam component. An empty list is an observed reply with no signal. Null means the reply was not released or a fence did not compile.

Optional, negated, quoted and mid-sentence wording is not a signal. The row stores these categories only, never the learner’s or tutor’s words. Older rows and structured answers carry no `assessment`, and the summary omits `assessmentOptOut` when no row has one. A reply with no signal can still fit poorly, and a signal is not proof of harm.

Open **Assessment opt-outs** in Settings for the count, or **Inspect turns → Checkpoint after an assessment opt-out** for the turns. Models can ask the WebMCP tool for `{"view":"assessment-opt-out","limit":5}`. The four released irrigation replies from the final review give two matches, both unguided. [Evidence](benchmarks/openui-audit-2026-11-18/final-review/assessment-opt-out/evidence.json)

```sh
rtk bun src/cli/main.ts openui-diagnostics docs/benchmarks/openui-audit-2026-11-18/final-review/assessment-opt-out/turns.json --view assessment-opt-out
```

## Check editable code

**Editable code in final replies** counts complete, nonempty Python, JavaScript and TypeScript Markdown blocks selected for release. Use **Inspect turns → Final reply with editable code**, or `--view editable-code` in the CLI and WebMCP. Totals count each reply once, with additional per-language counts for a reply containing several languages. Quoted or incomplete examples, Markdown demonstrations, OpenUI program content, Strudel music and unsupported language labels are excluded. The browser inspects the source locally. No code, execution result or notebook identifier enters the row. A selected block measures eligibility for the editor. Execution, mounting and learner use need independent evidence.

For a request to fix a Python loop, set the cue targets to `["editable-code"]` and its `codeLanguage` to `"python"`. The selected fence must use Python to fulfill that code action. The fenced OpenUI family score is unassessed for an editor-only cue. `overall.learnerActionSelected` and `delays.learnerActionSelected` combine supported actions at selection. Use `--view action-unmet` to see measured misses. A recorded `guidance.codeLanguage` also permits measuring whether the tutor used the offered language. Older recordings without code measurements remain unknown. The historical `outsideWords` counter includes whitespace-delimited tokens in Markdown code, since they appear outside OpenUI.

In the completed v2.3 study, MiniMax released editable Python for both Python requests, one under each decision model. Gemini Decision’s plan named Python. Its reply contained **zero words around the code**. Jev’s recorded plan cited `no-supported-family` and supplied no code language. Its reply followed the editor with a **ten-word instruction**. The historical `outsideWords` values are 26 and 24 respectively because that measure includes the Markdown fence and code. Both replies had zero fenced OpenUI components. On the separate filling-line problem, Jev’s run released a simulation and the Google-guided tutor request timed out, leaving its selected interface unknown. Across the four scheduled turns, Python appeared in two of three measured final texts, with one unobserved. [Completed study turns](benchmarks/openui-audit-2026-11-18/policy-v2.3-completion/turns.json)

## Record a turn

An export contains `{"schemaVersion":1,"turns":[…]}`. The parser also accepts the turn array. Use one stable, opaque conversation ID and turn ID per learner turn. Preserve the original zero-based `turnIndex` when exporting part of a conversation. Keep distinct experimental conversations in separate ID namespaces. Repeated identical observations count once. Conflicting final rows or turn positions produce an error so the producer can resolve them.

| Field | Evidence |
| --- | --- |
| `cue` | A learner-side classification with `kind` and acceptable component `targets`. Label an expressly requested interface, an implicit learning action, a request for direct text, an unmatched cue, or unavailable evidence. Optional `repeat: true` marks an explicit reminder about an earlier compatible request. |
| `guidance` | Decision source, requested action, acceptable component targets, and whether the instruction actually reached the tutor. Record `null` for unavailable evidence. |
| `attempted` | Whether a generation attempted an interface. A private draft can contribute. |
| `compiled` | Unique components that passed compilation among the observed drafts. |
| `selected` | Components present in the selected tutor response. |
| `outsideWords` | Optional word count in prose outside structured blocks in the selected reply. Zero means the reply had no outside prose. Null or missing means the count was unavailable. |
| `nativePageRequested` | Whether the tutor publicly emitted an `interactive_page` tool request during the turn. A request can accompany fenced OpenUI. Missing observations and requests from a different tutor in a mixed-model turn stay unknown. |
| `nativePage` | Optional nullable flags for tool success, failure, transcript attachment and save, card mount, sandbox readiness, viewport exposure, full-screen opening and frame failure. Each flag reports whether at least one matching page reached that stage. |
| `guidance.reason` | Optional fixed plan reason from the decision policy, including a reason for offering no components. |
| `editableCode` | Optional list of canonical editor languages in the released reply. Empty means measured and absent. Null or omitted means unobserved. |
| `codingChallengeLanguages` | JavaScript or TypeScript read from selected, validated CodingChallenge nodes. A recorded component with an unobserved language cannot confirm a learner’s language-specific request. |
| `editorOutsideWords` | Optional count for released replies containing eligible editable code. The parser removes the same complete editor fences used for the language measurement and all OpenUI segments, then counts whitespace-delimited words in the remaining Markdown. A code-only reply scores zero. Missing or ineligible replies have no count. The summary reports the median and coverage among known editor replies in `overall.editableCode.outsideWords`. |
| `rendered` | Components with presentation evidence for the learner on this turn. A browser mount is appropriate evidence in the classroom. |
| `reply` | Whether the conversational response was released, withheld, cancelled, pending, errored, or unknown. |
| `replyElapsedMs` | Optional elapsed milliseconds from the browser observing the start of this learner turn to the completed public assistant message selected as the final reply or withholding notice. The browser uses a monotonic clock and exports only the rounded duration. A queued learner turn starts when its message enters the conversation. A retry starts its own clock. Missing either endpoint leaves the observation unknown. |
| `experiment` | Optional predeclared experiment, case and pair IDs. A pair ID binds equivalent case inputs, repetition, settings and protocol across arms. Include exact tutor model ID. |
| `fit` | Optional independent assessment, with rater or rubric version in `source` and a boolean or unknown `passed`. |
| `draftAttempts`, `gateIssues`, `decisionModel` | Optional count of private generations, identifiers of failed or uncertain checks across those drafts, and decision-model revision. A source receipt can distinguish confirmed failure from uncertainty. |
| `selection` | The final public tutor round’s released private attempt (1–10) and its review disposition, `verified` or `best-effort`. An optional `rule` records the winning answer field displacing an approved prose question (`requested-prediction-over-prose`), winning through the presentation-only fallback (`presentation-only-checkpoint-retained`), or neither (`none`). Missing evidence is unobserved. A passing review is the gate’s disposition of that draft. |

Use `[]` for an observed stage with no components and `null` where the observation is missing. Track mixed documents by every canonical component they contain. `question` and `question-group` have distinct frequency entries and both fulfill a question request. `exam`, task subtypes and capture subtypes have their own entries. Display-only markdown, callouts and fallback handoffs remain in component frequencies. An interface-adoption numerator requires a substantive interface component.

`classifyOpenUiCue` examines the learner's words before Jev or generation. Its conservative English patterns recognize named interfaces, opportunities to retrieve, predict, order, manipulate variables, arrange relationships or repair and run code, and direct-answer requests. Asking to pause a quiz still allows an affirmative request to explore a variable to count as an implicit simulation cue. `none` means no rule matched. Missing or unusable input can produce `unknown`. A predeclared experiment can supply human-labelled cues and acceptable target families directly. Keep raw learner text, generated prose, tool arguments, tokens and account credentials outside the export.

## Read the measurements

To check the passive cue detector against prior learner wording, run `rtk bun docs/benchmarks/openui-audit-2026-11-18/verify-archived-cues.mjs`. It compares both the cue kind and the acceptable interface families on 139 recorded learner messages, including 126 distinct wordings, against the frozen November contract.

Delay can be measured for contiguous turns from the same known tutor when guidance mode is unavailable throughout. The mode filter uses the original request.

Each rate has `numerator`, `denominator`, `unknown` and `rate`. The denominator counts eligible known observations. The rate is `null` at zero known observations. Group tables break out model, mode and cue. The component table counts turns containing each type, so a turn can contribute to more than one type.

- `opportunityCompiled`, `opportunitySelected` and `opportunityRendered` ask whether the recorded components matched the learner's acceptable targets on that same turn.
- `nativePageRequested` counts turns with a publicly emitted native page proposal. Tool execution and the resulting page each require separate evidence. Older recordings with no information about native tools remain unknown.
- `directTextCompiled`, `directTextSelected` and `directTextRendered` measure overuse. A positive numerator means an interface appeared on a direct-text turn. Response-stage restraint requires a released tutor reply.
- `jevGuidanceDelivered` measures observed instruction delivery across Jev decisions. `jevCompiled`, `jevSelected` and `jevRendered` measure target agreement among Jev create instructions that reached the tutor. Continue, grade-first and no-create decisions require different behavioral evidence.
- `offeredType.compiled`, `.selected` and `.rendered` measure how often the tutor used one of the specifically offered component types for any recorded decision source. Only delivered create instructions are eligible. A missing stage or target set contributes to the unknown count. Selecting a decision model filters the turn that originated a delay measurement.
- `losses.draftToSelection` measures how often a turn with a compiled interface produced a selection with no substantive interface. `losses.selectionToRender` applies the same rule to selection and observed presentation. An unknown downstream stage contributes only to `unknown`. The counts identify where a component disappeared. The underlying cause requires turn-level evidence.
- `fit` preserves the external evaluation criterion. A schema-valid interface alone supplies no educational fit score.
- `proseBesideInterface` reports how many turns with a selected substantive interface have a known outside-word count, how many have an unknown count, and the median and 90th percentile among measured turns. The median averages the two middle counts for an even sample. The 90th percentile uses nearest rank. With no measured counts, both statistics are null.
- `replyElapsedMs` summarizes released and withheld turns in milliseconds. `observed` counts turns with both clock readings, `unknown` counts eligible turns without a duration, and `median` and `p90` use measured durations including zero. Cancellations, failures and pending turns fall outside the eligible count. Timing ends when the browser finishes receiving the selected message. Component mounting and time between learner turns are separate observations.

Delay has a separate distribution for selected and rendered interfaces. Response 1 is the first released tutor reply following a cue, including its own turn. Private draft attempts, cancellations, errors and withheld responses add no delivered replies. `opportunities` counts distinct request episodes and `reminders` counts linked re-asks. For example, a request to change a value followed by “I still want the slider” measures from the first request. A marked reminder must match the same family and can narrow the set of acceptable targets. An unmarked new request, incompatible family or direct-text cue supersedes the earlier request. A missing index, unknown stage, uncertain cue or model/mode change makes the exact delay unknown. An intact trace ending without a match is unresolved at the end of observation. The median uses observed matches only. Filters select the original trigger turn after measuring its follow-ups in the conversation.

Arm comparisons require matching experiment, case, pair ID, tutor, physical turn index and learner cue. Each named decision model gets its own comparison against the matched control. A shared unguided control can serve both Jev and Gemini Decision. Filtering to a decision model retains its control for pairing and keeps ordinary turn counts scoped to the filter. Duplicate guided observations make that judge’s pair ambiguous. An offer-only control with a named judge belongs to that judge.

Guidance must have been delivered. The trace must identify the guiding model, or explicitly identify Jev on older rows without a model version. `ineligibleGuidance` also includes a baseline that received guidance. Each endpoint reports wins, losses, ties, missing observations and the guided-minus-control rate difference. Component fit uses the requested family, and a direct-text control succeeds when the observed stage contains no substantive interface. Teaching fit requires the two ratings to use the same rubric. For a first-draft experiment, import only the first original candidate from each arm. A union across retries answers a different question.

## Refresh the field report

The report linked from Settings lives in the website build. To refresh its offline inspector and supporting files after editing the report or diagnostics, run these steps from the repository root.

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/build-diagnostics.ts
rtk bun docs/benchmarks/openui-audit-2026-11-18/package-page.ts
rtk bun docs/benchmarks/openui-audit-2026-11-18/package-page.ts --verify
rtk bun docs/benchmarks/openui-audit-2026-11-18/verify-page.mjs
```

After a full web build, pass `--built` to the last command to check the packaged report and the installed app’s navigation fallback.
