# Keating web charts inventory · A2

Source checkout `/home/diogenes/.cache/keating-deploy/design-pass-20261119`, branch `feature/design-pass`. The inventory covers 77 chart and data-graphic implementations, including status, timing and progress graphics and shared implementations with several call sites. Geometry uses CSS dimensions unless identified as SVG units or browser-native. Phone behavior is source-derived.

![Light and dark comparison of Activity, Benchmark, Training data and Review rubric](shots/A2/main-comparison.png)

## 1. Inventory

`--series-1/2/3` map to `#14743c/#2f6fed/#c2610c` in light and `#25a05a/#4f8fe6/#cf7d24` in dark. Theme tokens use the current scheme unless noted. The Kit Meter uses `--green-deep` by default and a square `.2885rem` track with motion gated by product and system preferences. [web/panda.config.ts:797](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/panda.config.ts:797), [kit.css:92](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/design-system/kit/kit.css:92), [primitives.tsx:70](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/design-system/kit/primitives.tsx:70).

### Activity

<a id="u01"></a>

- **U01 · Activity · daily activity heatmap.** Hand SVG calendar; 14-unit cells (see sizing constants), 2-unit gap/radius, default 1-unit stroke at 5% ink; muted empty cells and series-1/card tints. 9/10 SVG-unit weekday, month and Less/More labels in inherited ink at .5–.55 opacity. Year/filter buttons, count-labelled focusable active cells, pointer/focus popover, daily table and a session drill-down. The whole SVG scales down to 17rem minimum before scrolling; both gap and label sizes scale. Motion-gated rect fade. [components/UsageCharts.tsx:694–918](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/UsageCharts.tsx:694), [pages/learning.css:57–73](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/learning.css:57).

<a id="u02"></a>

- **U02 · Activity · Topics explored.** CSS ranked bars via Kit Meter, square .2885rem green-deep/paper-deep, normalized to leading count. Direct names and counts in .625rem UI ink. Reading names leader and total. Drill-down breadcrumb, hover/focus tooltip and table. Motion follows Kit; rows use shrinkable columns and wrap long labels. [components/UsageCharts.tsx:483–505](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/UsageCharts.tsx:483), [pages/learning.css:27–34](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/learning.css:27), [design-system/kit/kit.css:92–97](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/design-system/kit/kit.css:92).

<a id="u03"></a>

- **U03 · Activity · model share.** Kit Meter in Spend by model table. Same square .2885rem; green-deep/paper-deep for all models. Share shown in ink plus cost/token columns; .6rem UI/tabular, .5rem mono headings. Named per row; native table always present; hover/focus via data-lr-tip. Minimum table width 22rem, scroll container; no extra plot grid. [pages/Usage.tsx:260–303](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/Usage.tsx:260), [pages/learning.css:39–45,96–100](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/learning.css:39).

<a id="u04"></a>

- **U04 · Activity · feedback signals.** CSS 100% stacked buttons, square, 1.1rem tall, 2px gaps plus 2px minimum segment. Label/count/% legend buttons (.55rem UI), pressed underline, drill-in text; group announces counts. Shared hover/focus tooltip and table. Theme series and ink; flex legend wraps; motion-gated .6s fill. [components/usage-chart-data.ts:59–74](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/usage-chart-data.ts:59), [components/UsageCharts.tsx:220–230,508–547](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/UsageCharts.tsx:220), [pages/learning.css:49–53,65–71](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/learning.css:49).

<a id="u05"></a>

- **U05 · Activity · policy scores over time.** Hand SVG 400-unit viewBox; series-1 solid / series-2 5:3 dashed, both 2 units, r3/4 dots with .5-unit background stroke. 0–100 horizontal rules at 8% currentColor; 8/9-unit ink ticks/direct latest labels and .52rem mono dates, .75rem UI legend with latest numbers. Group name states latest readings. Point hover/focus and table; motion-gated reveal. Full-width SVG shrinks text and marks on narrow cards. [components/UsageCharts.tsx:286–319,351–416](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/UsageCharts.tsx:286), [pages/learning.css:65–73,94](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/learning.css:65).

<a id="u06"></a>

- **U06 · Activity · recent improvements.** CSS bottom-aligned positive and negative magnitude bars, series-1/3 at .75 opacity, height abs(delta)×40+4 capped at 40px; square, 4px gaps, ± glyphs in inherited ink; 10px footer; shared hover/focus and a table. Group name includes measured/kept counts. Low widths reduce bar widths, no axis/grid; no individual mark transition. [components/UsageCharts.tsx:51–54,432–454](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/UsageCharts.tsx:51), [pages/learning.css:58,65](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/learning.css:58).

<a id="u07"></a>

- **U07 · Activity · curriculum timeline.** Hand SVG Gantt. Domain palette cycles series-1/2/3, fallback 1. Bars 22 SVG units high, 6 apart, min width 2, r3; weaker alpha for open sessions. One 15%-ink baseline; 10-unit date and 11-unit truncated topic in currentColor. Caption-like accessible group gives count/range; hover/focus and table. No mark motion. 480px minimum in scroll wrapper. [components/UsageCharts.tsx:231–238,583–690](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/UsageCharts.tsx:231).

### Benchmark

<a id="b01"></a>

- **B01 · Benchmark · outcome and 95% interval.** CSS interval/dot on 0–100. 4px square series-1 range, .44rem square point with 1px card outline or 2px ink-soft hollow sparse point. 1px line grid; translucent shared leader band. Desktop numeric outcome/range and legend; mobile card keeps plot, hides the axis header and replaces desktop cells with a compact numeric summary. Label/title includes outcome and available interval, inside leaderboard table. Native title hover only; motion-gated interval grow and point pop. [pages/KeatingBench.tsx:488–502,759–765](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/KeatingBench.tsx:488), [pages/bench.css:34–41,71–72,83–102](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/bench.css:34).

<a id="b02"></a>

- **B02 · Benchmark · PROSPER total.** Desktop .25rem square ink/paper-deep Kit Meter plus tabular outcome reading in leaderboard. Named PROSPER with value/max; no tooltip. Kit motion preference applies. Desktop plot cell hidden in card layout. [pages/KeatingBench.tsx:519–525](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/KeatingBench.tsx:519), [pages/bench.css:42,95](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/bench.css:42), [design-system/kit/primitives.tsx:70–76](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/design-system/kit/primitives.tsx:70).

<a id="b03"></a>

- **B03 · Benchmark · PROSPER seven dimensions.** Expanded row seven .25rem square ink/paper-deep Kit Meters, direct dimension labels and percentages in ink, inherited .6rem UI. Named per dimension, values via meter. No tooltip or separate table. Kit motion; details can wrap into phone layout. [pages/KeatingBench.tsx:529–538](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/KeatingBench.tsx:529), [pages/bench.css:42–48,83–102](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/bench.css:42).

<a id="b04"></a>

- **B04 · Benchmark · evidence source split.** CSS .25rem square stacked fill, no gap or separator, fixed quiz/explicit/inferred series-1/2/3. Total in ink, swatch/key beneath entire table with no per-model numbers in legend. Per-row breakdown in role=img name and native hover title; no focus tooltip. Motion-gated .6s expand; hidden on phone cards. [pages/KeatingBench.tsx:506–527,762–765](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/KeatingBench.tsx:506), [pages/bench.css:34,42–43,72,95](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/bench.css:34).

<a id="b05"></a>

- **B05 · Benchmark · readiness thresholds.** CSS .39rem square continuous gradient with hard stops, 1px ink outline and tick marks; paper-deep then series-1/card tints then solid. Labels and thresholds below in .47rem mono ink. Direct text, no graphic accessible summary, tooltip, table or motion. Same graphic on narrow layout; labels are nowrap. [pages/KeatingBench.tsx:746–751](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/KeatingBench.tsx:746), [pages/bench.css:15–20,111](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/bench.css:15).

### Training data

<a id="e01"></a>

- **E01 · Training data · source composition.** CSS stack .55rem tall, r.15rem clipped, border-token track; three fixed series-1/2/3 fills touch. .52rem wrapping ink legend with .36rem squares and bold counts, including zeros. Chart aria-hidden, counted definition list available. No tooltip or table. Motion-gated scaleX; overview stacks below step/form area on phones. [components/training/DatasetFigures.tsx:5–9,30–53](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/training/DatasetFigures.tsx:5), [pages/training-data.css:37–48,66–78](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/training-data.css:37).

<a id="e02"></a>

- **E02 · Training data · dataset count tiles.** Numeric display. Three bordered card cells (.2rem radius, 1px training-line) with .52rem muted input labels and .96rem bold tabular values. Semantic definition list, stable screen-reader value; only painted value animates from zero. No axes, tooltip or separate table; 3 columns persist inside stacked phone overview. [components/training/DatasetFigures.tsx:11–28,43–45](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/training/DatasetFigures.tsx:11), [pages/training-data.css:38–42](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/training-data.css:38).

<a id="e03"></a>

- **E03 · Training data · source/shape/score/download stepper.** CSS ordinal controls; .96rem number box, 1px line, .14rem radius, active ink/paper with bordered/shadowed wrapper. .52rem mono digit, .62rem UI title/.48rem mono detail. Named navigation with aria-current=step. No chart table/tooltip/mark movement. Mobile turns 4 stages into columns and shrinks text. [pages/TrainingData.tsx:205–235](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/TrainingData.tsx:205), [pages/training-data.css:7–15,67–89](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/training-data.css:7).

### Coming up and courses

<a id="c01"></a>

- **C01 · Coming up · forecast interval.** CSS .5rem muted pill r999, primary 35% range and 2px primary median; no axes or grid. Direct ink sentence labels likely score/rating and endpoints, .8125rem UI/.75rem explanatory notes, plus specific image name. No hover/focus tooltip or table. Static, fluid up to 18rem on all widths. Only appears with saved eligible forecasts. [pages/ComingUp.tsx:582](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/ComingUp.tsx:582), [components/LearningOutlook.tsx:7–18,31–54](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/LearningOutlook.tsx:7).

<a id="c02"></a>

- **C02 · Courses · library completion.** Kit Meter completion against course lessons, square .2885rem green-deep/paper-deep. Done/total printed with small course metadata; name/value per meter. No axis, tooltip or table. Kit motion. Meter stays on stacked course cards. [pages/Courses.tsx:48–67](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/Courses.tsx:48), [pages/course-workspace/courses.css:68,93–100,262](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/course-workspace/courses.css:68), [design-system/kit/kit.css:92–97](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/design-system/kit/kit.css:92).

<a id="c03"></a>

- **C03 · Courses · workspace rail completion.** Same square Kit Meter and green-deep/paper-deep. Relative to lessons in rail; printed count and named Progress meter. Kit motion, no tooltip/table. Fills its rail row; rail placement determined by workspace responsive layout. [pages/course-workspace/LiveRoomRail.tsx:41–53](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/course-workspace/LiveRoomRail.tsx:41), [pages/course-workspace/courses.css:93–100](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/course-workspace/courses.css:93), [design-system/kit/kit.css:92–97](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/design-system/kit/kit.css:92).

<a id="c04"></a>

- **C04 · Courses · outline completion/unread markers.** CSS ordinal lesson markers. Filled, hollow and current boxes share ink/line/paper tokens, numeric unread badge and labelled status merged with lesson row. Static. No grid axes or table. Form/outline placement changes by tab and width. [pages/course-workspace/CourseOutline.tsx:45,87–119](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/course-workspace/CourseOutline.tsx:45), [pages/course-workspace/courses.css:112–187](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/course-workspace/courses.css:112).

### Rooms and review

<a id="r01"></a>

- **R01 · Rooms · member participation.** Kit Meter and adjacent count for each counted learner, including zero; denominator is total learner messages in the loaded transcript. Square .2885rem green-deep/paper-deep, width 2.6rem, .55rem mono. Named per member, no mark tooltip; Details provides participation table. Kit motion. Rail moves into mobile room tools; cell size stays fixed. [components/rooms/RoomPeoplePanel.tsx:60–80,130–155,240–266](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/rooms/RoomPeoplePanel.tsx:60), [components/rooms/rooms.css:38–39,53–66](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/rooms/rooms.css:38), [pages/RoomWorkspace.tsx:192–199](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/RoomWorkspace.tsx:192).

<a id="r02"></a>

- **R02 · Rooms · presence avatar count/stack.** Categorical count display via overlapping Kit avatars and text. Named image declares total and available names; individual titles are native. .55rem mono room metadata; uses ink/card kit tones. Static; workspace avatars can hide on mobile. No axis or table. [components/rooms/RoomList.tsx:42–53](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/rooms/RoomList.tsx:42), [components/rooms/rooms.css:16–21,53–59,118](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/rooms/rooms.css:16), [design-system/kit/primitives.tsx:54–68](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/design-system/kit/primitives.tsx:54).

<a id="r03"></a>

- **R03 · Review index · status composition.** CSS stack .43rem, r.24rem, 1px line border, ink solid/45° ink hatching 2-on/3-off/paper remainder. Group image reading gives all three counts, nearby summary and note tally. Static, responsive strip; no tooltip/table. [pages/TrajectoryReviewIndex.tsx:123–137](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/TrajectoryReviewIndex.tsx:123), [components/trajectory/review.css:42–49](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/review.css:42).

<a id="r04"></a>

- **R04 · Review workspace · rubric dimensions and overall.** Five CSS radio boxes, 1.13rem square, r.15rem, 1px line/2px dashed proposal; checked ink/paper; accent-dim focus ring. .54rem mono numbers and .64rem label, visible question and chosen verbal score. Fieldset labels and per-radio score/proposal names. Native title, keyboard radios without focus tooltip; static apart from proposal apply feedback. Compact rubric adapts positioning and uses a phone tab. [components/trajectory/ReviewDesk.tsx:66–102,313–355](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/ReviewDesk.tsx:66), [components/trajectory/review.css:227–235,270–276](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/review.css:227).

<a id="r05"></a>

- **R05 · Review workspace · proposed score receipts.** Numeric proposal list, dimension/value out of 5 plus reasons and overall/verdict; labels and scores in the proposal card’s inherited typography. Named section, no plotted marks, tooltip, table or chart motion. Wraps as a normal list in desk. [components/trajectory/MarginProposals.tsx:173–229](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/MarginProposals.tsx:173), [components/trajectory/ReviewDesk.tsx:327–346](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/ReviewDesk.tsx:327).

<a id="r06"></a>

- **R06 · Review workspace · annotated video range.** CSS annotation track below native video, absolute ranges scaled to duration, accent-dim on a themed track; overlapping notes can cover each other. No ticks or segment text/tooltips on track. Time range input and annotation list give nearby equivalent context; native video time UI. Static, fluid width. [components/trajectory/TrajectoryCanvas.tsx:686–714](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/TrajectoryCanvas.tsx:686).

<a id="r07"></a>

- **R07 · Review workspace · outline speaker/note markers.** CSS chronological markers and note shapes beside turn previews, categorical rather than elapsed-time scale. Ink, paper, semantic problem/strength/suggestion tokens. Direct speaker and note status/count cues via text/labels, tooltips/title vary by turn mode. No alternate table. Mobile outline opens in sheet. [components/trajectory/TurnRail.tsx:63–87](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/TurnRail.tsx:63), [components/trajectory/review.css:142–178](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/review.css:142).

### Lesson, chat, streaming and marketing

<a id="l01"></a>

- **L01 · OpenUI Simulation · base-rate sweep and other authored sweeps.** Recharts responsive SVG scatter, dots from Z size 16, series and 6px current marker primary, 2px background outline; dashed primary reference rule 3:3 at .4 opacity. Horizontal-only border grid 3:4, no axis strokes/tick marks; 10px muted ticks, 11/12px UI now/axis/caption. One X and one Y; caption and live readouts. Recharts tooltip (12px/8px radius, accessibilityLayer enabled), keyboard point parity unverified. Sample table disclosure. Plot animation off. Plot stays 14rem on phone and controls become one column. [components/SimulationRenderer.tsx:173–208,249–260](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/SimulationRenderer.tsx:173), [keating/openui/shared-renderer.tsx:92,744–782](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/keating/openui/shared-renderer.tsx:92), [Simulation.stories.tsx:45](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/keating/openui/Simulation.stories.tsx:45).

<a id="l02"></a>

- **L02 · OpenUI/Markdown Mermaid charts and concept/dependency maps.** Mermaid-generated SVG in overflow wrapper and fullscreen viewer, source-defined graph types/palette/geometry/labels with Mermaid theme and font defaults. StudyPlan emits a labelled flowchart; arbitrary authored diagrams can encode quantities. Built-in source disclosure, no normalized data table. Name, marks, tooltips and legend depend on authored syntax. Static render with overflow/zoom instead of phone-specific plot layout. [components/MermaidRenderer.tsx:127–297,350–460](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/MermaidRenderer.tsx:127), [keating/openui/library.tsx:335–350](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/keating/openui/library.tsx:335), [keating/openui/study-plan.tsx:268–295,460–471](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/keating/openui/study-plan.tsx:268), [components/MarkdownBlock.tsx:313–320](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/MarkdownBlock.tsx:313).

<a id="l03"></a>

- **L03 · Interactive page · gradient descent plot sample.** Story/test example of authored HTML, iframe-hosted hand SVG. Muted 2-unit curve, chart-2 4:3 dashed trail, primary r7 current point with foreground 1-unit edge. No grid/ticks. Dynamic SVG title gives x and steps; separate numeric mono readouts, verdict text. No tooltip/table; updates synchronously on Step, responsive width with fixed 220px height. Theme via iframe tokens. [components/interactive/interactive-page-samples.ts:9–27,50,69–98](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/interactive/interactive-page-samples.ts:9), [components/interactive/InteractivePage.tsx:278–292](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/interactive/InteractivePage.tsx:278).

<a id="l04"></a>

- **L04 · OpenUI MusicLab · piano roll.** Iframe canvas pitch/time Gantt with labelled notes/time grid; literal CRT palette including #a8beb0 labels, #2d4336 grid, #e4fbed 1.5px playhead. Width/DPR-driven canvas; labels mono, chart scroll-free on phone. Canvas name explains axes, note count caption and note-data details. No per-mark tip. Playback playhead suppressed by OS reduced motion. Fixed dark style in both themes. [components/MusicLab.tsx:8–34](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/MusicLab.tsx:8), [components/labs/music-document.ts:13–15](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/labs/music-document.ts:13), [components/labs/music-player.ts:29–48,79–83](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/labs/music-player.ts:29).

<a id="l05"></a>

- **L05 · OpenUI MusicLab · oscilloscope.** Canvas waveform of Strudel audio, #72eda0 2px line; #2d4336 grid; #a8beb0 labels with adaptive ±/0 scale and time. Caption gives peak/RMS, generic descriptive canvas name; note-data disclosure hidden for scope. Live playback drawing, canvas width/DPR sized, fixed CRT style in both themes. [components/labs/music-player.ts:29–30,50–62,79–83](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/labs/music-player.ts:29), [components/labs/music-document.ts:13–15](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/labs/music-document.ts:13).

<a id="l06"></a>

- **L06 · Chat · goal step completion.** CSS .375rem primary fill against muted track, both r9999px. Visible .6875rem tabular done/total, 150ms width change. No meter role, table or tooltip. Width changes use CSS transition; fluid row in card. Theme-token based. [components/GoalRenderer.tsx:75–104](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/GoalRenderer.tsx:75).

<a id="l07"></a>

- **L07 · Chat / landing embeds · question, quiz and flashcard round progress.** CSS 7px r2, 4px gaps, primary/muted segments for up to 20 rounds, continuous beyond 20. .75rem tabular UI count, 12px in landing wrapper; named progressbar plus count. No tooltip/table. 220ms mark change and 180ms count, with reduced motion. Shrinks fluidly; landing hides one-question progress. [components/quiz/ActivityGame.tsx:28–42](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/quiz/ActivityGame.tsx:28), [components/quiz/activity-game.css:21–28,71–72](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/quiz/activity-game.css:21), [components/landing-practice.css:15–18](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/landing-practice.css:15), [keating/openui/shared-renderer.tsx:435,600,1014](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/keating/openui/shared-renderer.tsx:435), [components/FlashcardRenderer.tsx:1018,1113](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/FlashcardRenderer.tsx:1018).

<a id="l08"></a>

- **L08 · OpenUI · inline quiz results completion.** CSS .375rem r999 muted track/primary square fill at % decided, separate from objective score. Named Quiz progressbar; numerical completion and outcome labels in surrounding compact summary/results list. No tooltip or separate table. Fills parent, themed, static. [keating/openui/shared-renderer.tsx:642–687](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/keating/openui/shared-renderer.tsx:642).

<a id="l09"></a>

- **L09 · Chat · graded quiz score card.** CSS .375rem pill track/fill with 9999px corners, green #059669/#10b981 dark, amber #d97706/#f59e0b dark, destructive or muted. 1.125rem bold tabular score itself tone-colored (#047857/#6ee7b7 or #92400e/#fcd34d). Score/count and review answers in text; fill has no named meter or tooltip/table. 150ms transition, width-fluid. [components/QuizResultCard.tsx:86–109,249–297](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/QuizResultCard.tsx:86).

<a id="l10"></a>

- **L10 · Quiz results · remediation by difficulty.** CSS percent missed within difficulty, destructive fill/muted track, .5rem/9999px. .75rem row labels and missed/total placed above fill. No named mark, legend, tooltip, table or motion. Width-fluid, uses theme tokens. [components/quiz/QuizFeedbackPanels.tsx:40–73](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/quiz/QuizFeedbackPanels.tsx:40), [components/quiz/QuizResultsView.tsx:72–89](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/quiz/QuizResultsView.tsx:72).

<a id="l11"></a>

- **L11 · Quiz results · benchmark comparison.** CSS three horizontal comparisons relative to max, .5rem/9999px muted track and primary, muted-foreground and literal #10b981 top-quartile row. Label and value (terminal/tabular) at .75rem. Mark unnamed, no tooltip/table. 150ms fill transition, width-fluid, with theme tokens for the first two rows and fixed top-quartile green. [components/quiz/QuizFeedbackPanels.tsx:83–133](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/quiz/QuizFeedbackPanels.tsx:83), [components/quiz/QuizResultsView.tsx:72–75](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/quiz/QuizResultsView.tsx:72).

<a id="l12"></a>

- **L12 · Classic quiz · header time remaining.** CSS remaining-time scaleX bar with a numeric clock and urgency treatments. 5px r9999 track, arena-accent/phosphor with amber/red urgency and glow. 1.75rem mono-display digits rise to 2.125rem at the sm breakpoint. 900ms transform and 150ms color transition. No chart tooltip/table, clock conveys magnitude. Header can reflow on phone. [components/quiz/QuizHeader.tsx:66–98](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/quiz/QuizHeader.tsx:66), [components/quiz/quiz-styles.ts:243–276](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/quiz/quiz-styles.ts:243).

<a id="l13"></a>

- **L13 · OpenUI quiz · per-question countdown.** CSS 5px rounded 2px track, primary/amber/destructive urgency variable and 18% tint track. Clock and icon; role=timer, named, critical screen-reader message. No chart tooltip/table. 900ms transform and urgency motion disabled on reduce; fluid track. [components/quiz/QuizCountdown.tsx:6–15](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/quiz/QuizCountdown.tsx:6), [components/quiz/quiz-countdown.css:1–23](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/quiz/quiz-countdown.css:1).

<a id="l14"></a>

- **L14 · Flashcard · auto-reveal countdown.** 3px/r2 CSS track, muted/primary or muted-foreground when paused. Countdown/paused words, hidden paint. 110ms transition disabled on reduced motion; width 3rem becomes 2rem on small screen. No tooltip/table; theme tokens. [components/flashcards/FlashcardTimer.tsx:12–24](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/flashcards/FlashcardTimer.tsx:12), [components/flashcards/flashcard-timer.css:1–9,25–30](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/flashcards/flashcard-timer.css:1).

<a id="l15"></a>

- **L15 · Language Lab · round completion.** CSS 6px/r3 muted and primary, visible round/card position. Named round progressbar with bounds. 260ms scale transition; fluid track and theme tokens. No tooltip/table. [components/LanguagePractice.tsx:54–74](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/LanguagePractice.tsx:54), [components/language/language-practice.css:14–15](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/language/language-practice.css:14).

<a id="l16"></a>

- **L16 · Exam · question progress rail.** CSS per-question cells and linked question buttons. Active/answered styling and numbered positions, with surrounding labels/status. No scaled axes, tooltip or alternate data table; CSS exam theme and mobile layout. Static painted progress tied to answer state. [components/ExamRenderer.tsx:311–345](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/ExamRenderer.tsx:311), [components/exam/exam.css:139–193](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/exam/exam.css:139).

<a id="l17"></a>

- **L17 · Exam · results score graphic.** CSS unframed numeric score, 2rem bold tabular display with .8125rem muted denominator/context, named by status content. Theme ink/accent surfaces. Nearby answer results. No plotted axes, tooltip, table or mark animation. Responsive result panel. [components/ExamRenderer.tsx:551–573](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/ExamRenderer.tsx:551), [components/exam/exam.css:310–334](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/exam/exam.css:310).

<a id="l18"></a>

- **L18 · Chat · scene progress strip.** CSS .25rem r9999 primary fill on muted track with 150ms width transition. Active scene currently receives fixed 60; unnamed paint, no value text, axes, tooltip/table. Fluid and scene-attached. Theme tokens own both themes. [components/SceneRenderer.tsx:87–91,123–136,244](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/SceneRenderer.tsx:87).

<a id="l19"></a>

- **L19 · Chat · audio recording waveform.** Canvas analyzer bars, 128×28 backing and clamp(48px,14vw,128px) CSS width. Current text color, transient animated input levels; canvas hidden, adjacent elapsed recording timer with 12px tabular type. No waveform legend, table or tooltip. No axis. Theme via inherited color. [components/RecordingWaveform.tsx:21–60](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/RecordingWaveform.tsx:21).

<a id="l20"></a>

- **L20 · Live · audio activity visualizer.** Canvas amplitude-driven concentric rings, voice line or radial motions; 2/2.5px rings and 2/3px line strokes, accent input/opacity theme, no internal labels, scale, legend or data table/tooltip. Canvas decorative with parent live state. Uses resize/DPR and respects reduced motion; size determined by caller. [components/live/LiveVisualizer.tsx:39–145,150–229](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/live/LiveVisualizer.tsx:39).

<a id="l21"></a>

- **L21 · Lesson artifacts · benchmark result score.** Numeric block with 1.875rem primary-colored bold score and surrounding benchmark metadata/score components as text. No plotted geometry, axis, tooltip, chart name or table disclosure. Theme primary and inherited labels; wraps in artifact panel. [components/ArtifactViewer.tsx:558–590](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/ArtifactViewer.tsx:558).

<a id="l22"></a>

- **L22 · Landing · learning journey.** CSS/motion scrollytelling with named stages, current step and text; track and selection are ordinal rather than measured, layout changes via scroll width. Theme styles, no separate data table/tooltip, motion coordinated with selected step. [components/LandingWonder.tsx:333–461](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/LandingWonder.tsx:333).

<a id="l23"></a>

- **L23 · Chat · animation playback progress.** CSS #fcd34d fill over a dark pill, width from elapsed playback; transitions width. Media buttons give actions; bar itself unnamed, no labels, tooltip or table. Fluid in player; literal colors in both themes. [components/AnimationPlayer.tsx:94–112,149–157](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/AnimationPlayer.tsx:94).

<a id="l24"></a>

- **L24 · Chat · HyperFrames playback scrub strip.** Native range as a seek bar with elapsed/duration display in UI text. UA stroke, radius and fill, optional theme accent from container. Named seek control. Static geometry and live playback updates; shrinks with player. No tooltip or table. [components/HyperframesPlayer.tsx:165–209](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/HyperframesPlayer.tsx:165).

<a id="l25"></a>

- **L25 · Exam · time remaining.** CSS 3px square primary/muted scaleX track. Named timer and 1.75rem mono display digits switch from primary to destructive under urgency. 250ms linear transform with OS reduced-motion override. Responsive width, no chart tooltip/table. [components/ExamRenderer.tsx:279–310](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/ExamRenderer.tsx:279), [components/exam/exam.css:107–137,405](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/exam/exam.css:107).

<a id="l26"></a>

- **L26 · Marketing source · screencast playback position.** CSS 3px square accent fill that RAF scales to playback position. Hidden from AT, no tick or value text on the mark, tooltip or table. Sized to the CRT player. Source-only export, with no route callsite found. [components/SurfaceScreencasts.tsx:151–178](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/SurfaceScreencasts.tsx:151), [components/SurfaceScreencasts.tsx:476–485](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/SurfaceScreencasts.tsx:476).

<a id="l27"></a>

- **L27 · OpenUI coding challenge · work-time readout.** 28px mono display tabular digits with ink, status text and play/pause. Accessible timer includes elapsed value and timing methodology. No bars, grid, legend, tooltip or table. Numbers update while working, visual wraps in the lab. [components/CodingChallenge.tsx:69–77](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/CodingChallenge.tsx:69), [components/labs/learning-labs.css:24](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/labs/learning-labs.css:24).

### Decision and judgement diagnostics

<a id="d01"></a>

- **D01 · Chat · reply progress rail.** CSS 4px/r4 bars, 4px gap, primary done/active, destructive stopped, line pending. .6875rem foreground labels and .625rem badges; aria-current and hidden state words. Active 1.3s sweep respects OS reduced motion. Mobile ellipsizes labels/tightens badges; no table or tip. [components/TurnProgress.tsx:20–32,77–95](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/TurnProgress.tsx:20), [components/turn-progress.css:6–15,65–74](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/turn-progress.css:6).

<a id="d02"></a>

- **D02 · Chat · reply events timeline.** CSS 1px line, 11px circular nodes with 1.5px borders, primary done/active halo, destructive warn, card/pending line. Detail and query labels .75rem with status/timing text and selective error tone. Named Steps list in disclosure; no alt table or mark tooltip. Static line and responsive wrapping. [components/TurnProgress.tsx:34–50,125–142](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/TurnProgress.tsx:34), [components/turn-progress.css:33–49](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/turn-progress.css:33).

<a id="d03"></a>

- **D03 · Chat / response review · draft stages.** CSS four evenly spaced circles, 1.5/1.875rem with 2px outlines and 2px links; primary/card/pending/destructive, icon strokes 2.25. .75rem labels, current step and hidden state text. Active ring pulses with OS reduced motion guard. Compact can ellipsize. No tooltip/table. [components/DraftProgress.tsx:41–73,105–115](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/DraftProgress.tsx:41), [components/DraftReviewStatus.tsx:87](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/DraftReviewStatus.tsx:87).

<a id="d04"></a>

- **D04 · Chat / response review · draft time budget.** CSS .375rem r999 muted/primary/amber/destructive by threshold. .75rem seconds, named meter with measured/budget seconds and numeric bounds. 1s width/.4s color transitions, flex-shrinking; theme tokens, no tooltip/table. [components/DraftProgress.tsx:76–87](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/DraftProgress.tsx:76), [components/DraftReviewStatus.tsx:88](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/DraftReviewStatus.tsx:88).

<a id="d05"></a>

- **D05 · Chat · draft attempt count dots.** CSS .4rem dots about .2rem apart, primary/card-border cues, max 10 drawn. Named image states draft of total; no axes, legend, table, tooltip or motion. Inline flexible row. [components/DraftProgress.tsx:89–99,109–116](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/DraftProgress.tsx:89).

<a id="d06"></a>

- **D06 · Response review · where the time went.** CSS draft Gantt/stacked time bands, .625rem r.2rem muted track, planning muted-foreground, writing primary, review striped accent-dim 4-on/3-off. Adjoining phases touch, native title per segment. .75rem UI, tabular totals, labels plus patterned legend. Figure title is generic. No dataset disclosure; row template fixes 9rem and 3.5rem side columns, pinching plot on phone. Static. [components/DraftProgress.tsx:146–189](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/DraftProgress.tsx:146), [components/DraftReviewStatus.tsx:90](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/DraftReviewStatus.tsx:90).

<a id="d07"></a>

- **D07 · Response review · draft check grid.** Native table rendered as heat/status cells with check, cross, question and dash. 1.5rem r.3rem chips, .75rem glyphs, semantic mixed fill, matching status-colored glyph. Screen-reader cell labels and native titles with P(violation); all-passing rows fold away. Phone horizontal overflow, static. [components/DraftProgress.tsx:193–226](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/DraftProgress.tsx:193), [components/DraftReviewStatus.tsx:91](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/DraftReviewStatus.tsx:91).

<a id="d08"></a>

- **D08 · Chat · decision trail check heatmap.** Interactive table/heatmap with .6875rem mono ink, .25rem corners, 1px pressed outline and 3px table spacing. Probability/status tints; symbol plus numeric percentage, caption, state legend, named cells, keyboard activation and live details. Static cells; sticky label/scroll region on phones. No per-cell hover/focus tooltip. [components/MessageDecisionVisuals.tsx:7–33,105–132,217–277](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/MessageDecisionVisuals.tsx:7), [components/MessageDraftDecision.tsx:48–75](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/MessageDraftDecision.tsx:48).

<a id="d09"></a>

- **D09 · Chat · earlier vs released draft risk.** CSS dumbbell on 2px muted axis/connector, .625rem circle with 2px destructive hollow vs solid #245ec9 light / #8db6ff dark, 8px arrow when space allows. 1rem tabular percentages and direct endpoint/series labels. Ink plus text conclusion, figure title but plot hidden. Help disclosure, no mark tip/table/motion. Shrinkable two-column reading. [components/MessageDecisionVisuals.tsx:50–76,153–190](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/MessageDecisionVisuals.tsx:50).

<a id="d10"></a>

- **D10 · Chat decision trail · answer confidence / alternatives.** Styled native meter .375rem r999, muted/green-deep with browser-targeted rules. Mono percentages and visible labels, named meter per answer. Alternatives disclosed as a list. No per-mark tooltip, table or motion. Fluid width and theme tokens. [components/MessageDecisionVisuals.tsx:45–50,76–89,293–323](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/MessageDecisionVisuals.tsx:45).

<a id="d11"></a>

- **D11 · Chat decision trail · worth remembering.** Same styled native meter plus 2px foreground cutoff marker. Visible probability and cutoff, named meter includes cutoff, generic diagnostic help, no per-mark tooltip or table; static, fluid, theme tokens. [components/MessageDecisionVisuals.tsx:77–92,325–342](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/MessageDecisionVisuals.tsx:77).

<a id="d12"></a>

- **D12 · Chat · judgement context usage.** 100%-wide .75rem native meter, primary accent request, UA thresholds .65/.8 with optimum 0. Named estimate and adjacent context text. UA geometry/color varies with theme/browser; static, no point tooltip or meter data table. Inspector’s other facts are tabular. [components/JudgementStateInspector.tsx:12–26](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/JudgementStateInspector.tsx:12).

<a id="d13"></a>

- **D13 · Judgement diagnostics · question probabilities.** UA meters per labelled choice with explicit percentage, browser-defined fill/radius and themed surrounding text. Named per label, no axis, table or tooltip. Static, embedded diagnostics flow; width/browser behavior native. [components/JudgementDiagnostics.tsx:88–111](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/JudgementDiagnostics.tsx:88).

<a id="d14"></a>

- **D14 · Chat / review · turn judgement probabilities.** Native meter width 4rem beside textual alternatives and numbers. Names per option; UA fill/radius, surrounding ink. No tooltip/table, static, inline wrap. Theme partly browser native. [components/TurnJudgementSummary.tsx:86–111](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/TurnJudgementSummary.tsx:86), [components/trajectory/TrajectoryCanvas.tsx:139–145](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/TrajectoryCanvas.tsx:139).

<a id="d15"></a>

- **D15 · Review · draft probability receipt with pass line.** Native 3rem meter plus 3-decimal probability and optional position marker for pass line. Names include the threshold when applicable; surrounding compact ink labels and diagnostic rows. UA mark geometry, no mark tooltip or chart disclosure, static; fluid receipt layout. [components/trajectory/DraftReviewReceipt.tsx:98–138](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/trajectory/DraftReviewReceipt.tsx:98).

### Settings, self-paced and profile

<a id="s01"></a>

- **S01 · Settings / chat · local model download bar.** CSS spark-free determinate or indeterminate fill with primary over themed muted track. Label/rate/progress copy and named progressbar with numeric values when known. Width transition/sliding animation with reduced-motion fallback. Responsive overlay bounded by min(100%,32rem). No axes/table/tips. [components/ModelDownloadBar.tsx:32–64,116–158](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/ModelDownloadBar.tsx:32).

<a id="s02"></a>

- **S02 · Settings · Desktop Needle download.** Named native progress for measured percent or indeterminate download, with adjacent status. UA geometry, colors and motion; settings column constrains width. No tip/table/axis. [components/DesktopNeedleSettings.tsx:36–46](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/DesktopNeedleSettings.tsx:36).

<a id="s03"></a>

- **S03 · Settings diagnostics · OpenUI outcome buckets.** CSS .45rem square primary/muted bars normalized by opportunities. Direct text bucket/count; hidden marks. Labels/numbers in diagnostics UI ink. Flex/grid-width driven, theme tokens, static. No hover/focus or table disclosure. [components/settings/OpenUiUsageView.tsx:38–67](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/settings/OpenUiUsageView.tsx:38), [components/settings/openui-diagnostics.css:29–39](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/settings/openui-diagnostics.css:29).

<a id="s04"></a>

- **S04 · Settings diagnostics · OpenUI component rates.** Same CSS .45rem square primary on muted, one row per component normalized to selected pipeline stage rate. Direct component and fraction; paint hidden. No separate name, axis, hover/focus or table. Static, fluid and theme-adaptive. [components/settings/OpenUiUsageView.tsx:276–297](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/settings/OpenUiUsageView.tsx:276), [components/settings/openui-diagnostics.css:29–39](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/settings/openui-diagnostics.css:29).

<a id="s05"></a>

- **S05 · Self-paced · course activity status rail.** CSS categorical sequence: .5rem x r2 with 1.5px line, compact .3rem/1px; 4px gaps. Done ink, available outline, skipped ink-soft hatch. Labelled image with state counts and adjacent words. Static, shrinks flex; mini max 12rem. No tooltip/table. [pages/SelfPaced.tsx:70–82,206–212,508–515](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/SelfPaced.tsx:70), [pages/self-paced.css:61–67](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/self-paced.css:61).

<a id="s06"></a>

- **S06 · Self-paced · token budget.** CSS .5rem r999 ink/paper with line border and transform transition. Named image reports used/cap; text amounts nearby. Fluid, theme adaptive, no grid, tooltip/table. [pages/SelfPaced.tsx:295–303](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/SelfPaced.tsx:295), [components/keating-kit.css:145–146](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/keating-kit.css:145).

<a id="s07"></a>

- **S07 · Chat onboarding · four stages.** CSS 1px connector with .88rem r.14rem framed numbers, active ink on paper inversion; .53rem mono words, semantic ordered steps and current state. 220ms stage motion gated by saved and media motion. Phone hides step words and shrinks connectors. No tips/table. [components/ChatOnboarding.tsx:351–360](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/ChatOnboarding.tsx:351), [components/chat-onboarding.css:19–25,66–74](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/chat-onboarding.css:19).

<a id="s08"></a>

- **S08 · Public learning profile · activity companion.** Plant companion rendered beside public activity count, with empty icon label and themed mascot art. Adjacent count is the quantitative encoding; fixed icon state in renderer. No scale, table, tooltip, chart labels or stimulus-driven figure geometry. Responsive normal text flow. [components/profile/PublicProfileView.tsx:102–116](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/profile/PublicProfileView.tsx:102).

<a id="s09"></a>

- **S09 · Settings · offline tutor download.** Native progress using downloaded/total bytes, named and accompanied by status. UA geometry/motion and theme treatment; responsive settings column. No axis, tip or table. [components/OfflineTutorSettings.tsx:39–50](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/OfflineTutorSettings.tsx:39).

### Renderer boundaries

- The current topic plot is [U02](#u02). The Recharts donut is described in release history. The direct Recharts import in the audited source is [L01](#l01). The scan surfaced no dedicated radar or sparkline renderer. [pages/Blog.tsx:1916](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/pages/Blog.tsx:1916), [components/UsageCharts.tsx:483](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/UsageCharts.tsx:483), [components/SimulationRenderer.tsx:4](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/SimulationRenderer.tsx:4).
- OpenUI registers Simulation, MusicLab and Mermaid alongside the progress views above. Authored HTML/canvas/SVG, generated SVG illustrations and authored Mermaid can supply further graphics. [L02–L05](#l02) cover the renderer boundaries and checked-in chart sample. [keating/openui/library.tsx:335](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/keating/openui/library.tsx:335), [keating/openui/library.tsx:625](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/keating/openui/library.tsx:625), [keating/interactive-page/guide.ts:16](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/keating/interactive-page/guide.ts:16).
- Icons, decorative shaders and avatar-only effects are outside the chart list. Audio canvases are included because they respond to measured audio. The public-profile plant is included because the design assigns it an activity encoding. [components/companion/PixelScreen.tsx:291](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/companion/PixelScreen.tsx:291), [components/ShaderField.tsx:306](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/ShaderField.tsx:306), [S08](#s08).

## 2. Comparison with the chart intentions

Each yes/no/partial links to its source-backed entry. A yes in **gap** can mean there are no adjacent fills to separate, and a yes in **axes** can mean an axis-free form uses no grid. Partial covers a different nonzero gap or a nearby list/text substitute for a table. A table-native chart qualifies when the relevant values are available in that table. **Name** asks for the main reading as an accessible name or equivalent named value, beyond a generic title. **Tip** asks for both hover and focus. **Single** means no dual quantitative axes. Status-only graphics can intentionally use state colors.

| Chart | Fixed series | Beyond color | 2px gap | Thin marks | Quiet axes/grid | Ink text | Reading name | Table | Hover/focus tip | Single scale | Evidence detail |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **U01** Activity · daily activity heatmap | [yes](#u01) | [partial](#u01) | [partial](#u01) | [yes](#u01) | [yes](#u01) | [yes](#u01) | [yes](#u01) | [yes](#u01) | [yes](#u01) | [yes](#u01) | Legend endpoint words; numeric swatch titles and cell tips. |
| **U02** Activity · Topics explored | [no](#u02) | [yes](#u02) | [partial](#u02) | [yes](#u02) | [yes](#u02) | [yes](#u02) | [yes](#u02) | [yes](#u02) | [yes](#u02) | [yes](#u02) | Single fill with air between separate rows; green is a brand token. |
| **U03** Activity · model share | [no](#u03) | [yes](#u03) | [partial](#u03) | [yes](#u03) | [yes](#u03) | [yes](#u03) | [yes](#u03) | [yes](#u03) | [yes](#u03) | [yes](#u03) | Table is the primary view. |
| **U04** Activity · feedback signals | [yes](#u04) | [yes](#u04) | [yes](#u04) | [no](#u04) | [yes](#u04) | [yes](#u04) | [yes](#u04) | [yes](#u04) | [yes](#u04) | [yes](#u04) | Built order is Confident/Off-track/Confused. Mockup places Confused before Off-track. |
| **U05** Activity · policy scores over time | [yes](#u05) | [yes](#u05) | [yes](#u05) | [yes](#u05) | [yes](#u05) | [yes](#u05) | [yes](#u05) | [yes](#u05) | [yes](#u05) | [yes](#u05) | Line forms use open space; there are no touching stack segments. |
| **U06** Activity · recent improvements | [partial](#u06) | [yes](#u06) | [no](#u06) | [no](#u06) | [yes](#u06) | [yes](#u06) | [yes](#u06) | [yes](#u06) | [yes](#u06) | [yes](#u06) | Sign text survives color; height alone selects magnitude, not sign. |
| **U07** Activity · curriculum timeline | [partial](#u07) | [yes](#u07) | [no](#u07) | [no](#u07) | [yes](#u07) | [yes](#u07) | [yes](#u07) | [yes](#u07) | [yes](#u07) | [yes](#u07) | Palette repeats across domains; topic names and timestamps recover meaning. |
| **B01** Benchmark · outcome and 95% interval | [yes](#b01) | [yes](#b01) | [yes](#b01) | [yes](#b01) | [yes](#b01) | [yes](#b01) | [yes](#b01) | [partial](#b01) | [no](#b01) | [yes](#b01) | Current evidence is in the leaderboard table, with no equivalent chart disclosure. |
| **B02** Benchmark · PROSPER total | [no](#b02) | [yes](#b02) | [partial](#b02) | [yes](#b02) | [yes](#b02) | [yes](#b02) | [yes](#b02) | [yes](#b02) | [no](#b02) | [yes](#b02) | Already in table; single fill track. |
| **B03** Benchmark · PROSPER seven dimensions | [no](#b03) | [yes](#b03) | [partial](#b03) | [yes](#b03) | [yes](#b03) | [yes](#b03) | [yes](#b03) | [partial](#b03) | [no](#b03) | [yes](#b03) | Direct numeric rows instead of table disclosure. |
| **B04** Benchmark · evidence source split | [yes](#b04) | [partial](#b04) | [no](#b04) | [yes](#b04) | [yes](#b04) | [yes](#b04) | [yes](#b04) | [partial](#b04) | [no](#b04) | [yes](#b04) | Hover and accessible text contain values that the always-visible legend omits. |
| **B05** Benchmark · readiness thresholds | [yes](#b05) | [yes](#b05) | [no](#b05) | [partial](#b05) | [partial](#b05) | [yes](#b05) | [partial](#b05) | [partial](#b05) | [no](#b05) | [yes](#b05) | Ticks are explicit; compact labels and ink outline carry visual weight. |
| **E01** Training data · source composition | [yes](#e01) | [yes](#e01) | [no](#e01) | [yes](#e01) | [yes](#e01) | [yes](#e01) | [partial](#e01) | [partial](#e01) | [no](#e01) | [yes](#e01) | Readable definition list stands in for an unnamed chart/table. |
| **E02** Training data · dataset count tiles | [partial](#e02) | [yes](#e02) | [yes](#e02) | [yes](#e02) | [yes](#e02) | [yes](#e02) | [yes](#e02) | [partial](#e02) | [no](#e02) | [yes](#e02) | Numeric display uses one ink palette and a real definition list. |
| **E03** Training data · source/shape/score/download stepper | [partial](#e03) | [yes](#e03) | [partial](#e03) | [yes](#e03) | [yes](#e03) | [yes](#e03) | [yes](#e03) | [no](#e03) | [no](#e03) | [yes](#e03) | Steps have order and current state in text and semantics. |
| **C01** Coming up · forecast interval | [no](#c01) | [yes](#c01) | [yes](#c01) | [yes](#c01) | [yes](#c01) | [yes](#c01) | [yes](#c01) | [partial](#c01) | [no](#c01) | [yes](#c01) | Text equivalent is always inline; thicker than benchmark range. |
| **C02** Courses · library completion | [no](#c02) | [yes](#c02) | [partial](#c02) | [yes](#c02) | [yes](#c02) | [yes](#c02) | [yes](#c02) | [partial](#c02) | [no](#c02) | [yes](#c02) | Inline done/total is available. |
| **C03** Courses · workspace rail completion | [no](#c03) | [yes](#c03) | [partial](#c03) | [yes](#c03) | [yes](#c03) | [yes](#c03) | [yes](#c03) | [partial](#c03) | [no](#c03) | [yes](#c03) | Same primitive as library, different available width. |
| **C04** Courses · outline completion/unread markers | [partial](#c04) | [yes](#c04) | [partial](#c04) | [yes](#c04) | [yes](#c04) | [yes](#c04) | [partial](#c04) | [no](#c04) | [no](#c04) | [yes](#c04) | Per-item semantics and count; whole sequence is conveyed as an outline. |
| **R01** Rooms · member participation | [no](#r01) | [yes](#r01) | [partial](#r01) | [yes](#r01) | [yes](#r01) | [yes](#r01) | [yes](#r01) | [yes](#r01) | [no](#r01) | [yes](#r01) | Count is adjacent to fill. |
| **R02** Rooms · presence avatar count/stack | [partial](#r02) | [yes](#r02) | [no](#r02) | [yes](#r02) | [yes](#r02) | [yes](#r02) | [yes](#r02) | [partial](#r02) | [partial](#r02) | [yes](#r02) | Overlap is intentional; text supplies membership and count. |
| **R03** Review index · status composition | [no](#r03) | [yes](#r03) | [no](#r03) | [yes](#r03) | [yes](#r03) | [yes](#r03) | [yes](#r03) | [partial](#r03) | [no](#r03) | [yes](#r03) | Pattern is the second cue; fills touch. |
| **R04** Review workspace · rubric dimensions and overall | [partial](#r04) | [yes](#r04) | [no](#r04) | [partial](#r04) | [yes](#r04) | [yes](#r04) | [yes](#r04) | [partial](#r04) | [partial](#r04) | [yes](#r04) | Controls are the reading, with 0.16rem gap and no data table. |
| **R05** Review workspace · proposed score receipts | [partial](#r05) | [yes](#r05) | [partial](#r05) | [yes](#r05) | [yes](#r05) | [yes](#r05) | [yes](#r05) | [partial](#r05) | [no](#r05) | [yes](#r05) | Pairs with dashed rubric cells while pending. |
| **R06** Review workspace · annotated video range | [no](#r06) | [partial](#r06) | [no](#r06) | [yes](#r06) | [yes](#r06) | [yes](#r06) | [no](#r06) | [partial](#r06) | [no](#r06) | [yes](#r06) | Graphical marks are hidden from AT; source note text remains elsewhere. |
| **R07** Review workspace · outline speaker/note markers | [partial](#r07) | [yes](#r07) | [partial](#r07) | [yes](#r07) | [yes](#r07) | [yes](#r07) | [partial](#r07) | [no](#r07) | [partial](#r07) | [yes](#r07) | Uses review note shapes for tone, not chart series. |
| **L01** OpenUI Simulation · base-rate sweep and other authored sweeps | [no](#l01) | [yes](#l01) | [yes](#l01) | [yes](#l01) | [yes](#l01) | [yes](#l01) | [partial](#l01) | [yes](#l01) | [partial](#l01) | [yes](#l01) | Figure name states variables; caption carries the reading. Arbitrary authored outputs share this renderer. |
| **L02** OpenUI/Markdown Mermaid charts and concept/dependency maps | [partial](#l02) | [partial](#l02) | [partial](#l02) | [partial](#l02) | [partial](#l02) | [partial](#l02) | [partial](#l02) | [partial](#l02) | [partial](#l02) | [partial](#l02) | Generic renderer rates are conditional on authored input. |
| **L03** Interactive page · gradient descent plot sample | [no](#l03) | [yes](#l03) | [yes](#l03) | [yes](#l03) | [yes](#l03) | [yes](#l03) | [yes](#l03) | [partial](#l03) | [no](#l03) | [yes](#l03) | Shows the authoring surface’s capabilities; arbitrary authored plots can vary. |
| **L04** OpenUI MusicLab · piano roll | [no](#l04) | [yes](#l04) | [partial](#l04) | [yes](#l04) | [yes](#l04) | [partial](#l04) | [partial](#l04) | [yes](#l04) | [no](#l04) | [yes](#l04) | Table/notes equivalent comes from note data, independent of canvas. |
| **L05** OpenUI MusicLab · oscilloscope | [no](#l05) | [yes](#l05) | [yes](#l05) | [yes](#l05) | [yes](#l05) | [partial](#l05) | [partial](#l05) | [partial](#l05) | [no](#l05) | [yes](#l05) | Heading/axes and peak/RMS are text; no sample table. |
| **L06** Chat · goal step completion | [no](#l06) | [yes](#l06) | [partial](#l06) | [yes](#l06) | [yes](#l06) | [yes](#l06) | [partial](#l06) | [partial](#l06) | [no](#l06) | [yes](#l06) | Adjacent count is the accessible equivalent. |
| **L07** Chat / landing embeds · question, quiz and flashcard round progress | [no](#l07) | [yes](#l07) | [no](#l07) | [yes](#l07) | [yes](#l07) | [yes](#l07) | [yes](#l07) | [partial](#l07) | [no](#l07) | [yes](#l07) | A single done vs remaining scale; no series legend needed. |
| **L08** OpenUI · inline quiz results completion | [no](#l08) | [yes](#l08) | [partial](#l08) | [yes](#l08) | [yes](#l08) | [yes](#l08) | [yes](#l08) | [partial](#l08) | [no](#l08) | [yes](#l08) | Per-question result list supplies underlying detail. |
| **L09** Chat · graded quiz score card | [no](#l09) | [yes](#l09) | [partial](#l09) | [yes](#l09) | [yes](#l09) | [no](#l09) | [partial](#l09) | [partial](#l09) | [no](#l09) | [yes](#l09) | Explicit percentage and detailed answer list, custom colors partly dark-adjusted. |
| **L10** Quiz results · remediation by difficulty | [no](#l10) | [yes](#l10) | [partial](#l10) | [yes](#l10) | [yes](#l10) | [yes](#l10) | [partial](#l10) | [partial](#l10) | [no](#l10) | [yes](#l10) | Text gives numerator and denominator. |
| **L11** Quiz results · benchmark comparison | [no](#l11) | [yes](#l11) | [partial](#l11) | [yes](#l11) | [yes](#l11) | [yes](#l11) | [partial](#l11) | [partial](#l11) | [no](#l11) | [yes](#l11) | Visible value corroborates width. |
| **L12** Classic quiz · header time remaining | [no](#l12) | [yes](#l12) | [partial](#l12) | [yes](#l12) | [yes](#l12) | [partial](#l12) | [partial](#l12) | [partial](#l12) | [no](#l12) | [yes](#l12) | Separate implementation from newer QuizCountdown. |
| **L13** OpenUI quiz · per-question countdown | [no](#l13) | [yes](#l13) | [partial](#l13) | [yes](#l13) | [yes](#l13) | [partial](#l13) | [yes](#l13) | [partial](#l13) | [no](#l13) | [yes](#l13) | Timer digits are direct; active urgency color also colors shell/digits. |
| **L14** Flashcard · auto-reveal countdown | [no](#l14) | [yes](#l14) | [partial](#l14) | [yes](#l14) | [yes](#l14) | [yes](#l14) | [partial](#l14) | [partial](#l14) | [no](#l14) | [yes](#l14) | The bar is supplementary to timer text. |
| **L15** Language Lab · round completion | [no](#l15) | [yes](#l15) | [partial](#l15) | [yes](#l15) | [yes](#l15) | [yes](#l15) | [yes](#l15) | [partial](#l15) | [no](#l15) | [yes](#l15) | Progress semantics and counter supplement fill. |
| **L16** Exam · question progress rail | [partial](#l16) | [yes](#l16) | [partial](#l16) | [yes](#l16) | [yes](#l16) | [yes](#l16) | [partial](#l16) | [partial](#l16) | [no](#l16) | [yes](#l16) | Interaction/navigation and completion share the visualization. |
| **L17** Exam · results score graphic | [partial](#l17) | [yes](#l17) | [yes](#l17) | [yes](#l17) | [yes](#l17) | [yes](#l17) | [yes](#l17) | [partial](#l17) | [no](#l17) | [yes](#l17) | Numeric score display, not an arc/dial. |
| **L18** Chat · scene progress strip | [no](#l18) | [partial](#l18) | [partial](#l18) | [yes](#l18) | [yes](#l18) | [partial](#l18) | [no](#l18) | [no](#l18) | [no](#l18) | [yes](#l18) | Fixed 60 can read as measured playback. |
| **L19** Chat · audio recording waveform | [partial](#l19) | [no](#l19) | [yes](#l19) | [yes](#l19) | [yes](#l19) | [yes](#l19) | [no](#l19) | [no](#l19) | [no](#l19) | [yes](#l19) | Time describes recording, rather than signal amplitude. |
| **L20** Live · audio activity visualizer | [partial](#l20) | [partial](#l20) | [yes](#l20) | [yes](#l20) | [yes](#l20) | [yes](#l20) | [partial](#l20) | [no](#l20) | [no](#l20) | [yes](#l20) | State text/icons supplement the signal visual. |
| **L21** Lesson artifacts · benchmark result score | [partial](#l21) | [yes](#l21) | [yes](#l21) | [yes](#l21) | [yes](#l21) | [no](#l21) | [partial](#l21) | [partial](#l21) | [no](#l21) | [yes](#l21) | Numeric outcome visual receives series-like accent styling. |
| **L22** Landing · learning journey | [partial](#l22) | [yes](#l22) | [partial](#l22) | [yes](#l22) | [yes](#l22) | [yes](#l22) | [partial](#l22) | [partial](#l22) | [no](#l22) | [yes](#l22) | Source-only export, with no route callsite found. |
| **L23** Chat · animation playback progress | [no](#l23) | [partial](#l23) | [partial](#l23) | [yes](#l23) | [yes](#l23) | [yes](#l23) | [no](#l23) | [no](#l23) | [no](#l23) | [yes](#l23) | Playback control supports the affordance conceptually. |
| **L24** Chat · HyperFrames playback scrub strip | [no](#l24) | [yes](#l24) | [partial](#l24) | [partial](#l24) | [yes](#l24) | [yes](#l24) | [yes](#l24) | [partial](#l24) | [no](#l24) | [yes](#l24) | Functional media position control. |
| **L25** Exam · time remaining | [no](#l25) | [yes](#l25) | [partial](#l25) | [yes](#l25) | [yes](#l25) | [no](#l25) | [yes](#l25) | [partial](#l25) | [no](#l25) | [yes](#l25) | The track is hidden; the visible and named clock provides the reading. |
| **L26** Marketing source · screencast playback position | [no](#l26) | [partial](#l26) | [partial](#l26) | [yes](#l26) | [yes](#l26) | [yes](#l26) | [no](#l26) | [no](#l26) | [no](#l26) | [yes](#l26) | Position is decorative beside a tape selector. |
| **L27** OpenUI coding challenge · work-time readout | [partial](#l27) | [yes](#l27) | [yes](#l27) | [yes](#l27) | [yes](#l27) | [yes](#l27) | [yes](#l27) | [partial](#l27) | [no](#l27) | [yes](#l27) | Readout only, included alongside exam and training readouts. |
| **D01** Chat · reply progress rail | [no](#d01) | [yes](#d01) | [no](#d01) | [yes](#d01) | [yes](#d01) | [yes](#d01) | [yes](#d01) | [no](#d01) | [no](#d01) | [yes](#d01) | Ordinal rail, no measured time scale. |
| **D02** Chat · reply events timeline | [no](#d02) | [partial](#d02) | [partial](#d02) | [yes](#d02) | [yes](#d02) | [partial](#d02) | [partial](#d02) | [partial](#d02) | [no](#d02) | [yes](#d02) | Semantic chronological list, no elapsed scale. |
| **D03** Chat / response review · draft stages | [no](#d03) | [yes](#d03) | [partial](#d03) | [partial](#d03) | [yes](#d03) | [partial](#d03) | [yes](#d03) | [no](#d03) | [no](#d03) | [yes](#d03) | Uses icon change as well as fill. |
| **D04** Chat / response review · draft time budget | [no](#d04) | [yes](#d04) | [partial](#d04) | [yes](#d04) | [yes](#d04) | [yes](#d04) | [yes](#d04) | [partial](#d04) | [no](#d04) | [yes](#d04) | Semantic urgency threshold plus count. |
| **D05** Chat · draft attempt count dots | [no](#d05) | [partial](#d05) | [no](#d05) | [yes](#d05) | [yes](#d05) | [yes](#d05) | [yes](#d05) | [partial](#d05) | [no](#d05) | [yes](#d05) | AT name carries exact attempt value. |
| **D06** Response review · where the time went | [no](#d06) | [yes](#d06) | [no](#d06) | [yes](#d06) | [yes](#d06) | [yes](#d06) | [partial](#d06) | [partial](#d06) | [no](#d06) | [yes](#d06) | Pattern and visible row totals, detailed phase durations in native hover only. |
| **D07** Response review · draft check grid | [no](#d07) | [yes](#d07) | [partial](#d07) | [yes](#d07) | [yes](#d07) | [no](#d07) | [partial](#d07) | [yes](#d07) | [no](#d07) | [yes](#d07) | The graphic itself is a table; detailed mouse value in title. |
| **D08** Chat · decision trail check heatmap | [no](#d08) | [yes](#d08) | [no](#d08) | [yes](#d08) | [yes](#d08) | [yes](#d08) | [partial](#d08) | [yes](#d08) | [partial](#d08) | [yes](#d08) | Keyboard and pointer can open details, rather than on focus/hover. |
| **D09** Chat · earlier vs released draft risk | [no](#d09) | [yes](#d09) | [yes](#d09) | [yes](#d09) | [partial](#d09) | [yes](#d09) | [partial](#d09) | [partial](#d09) | [no](#d09) | [yes](#d09) | Marker shape and numerical reading survive color. |
| **D10** Chat decision trail · answer confidence / alternatives | [no](#d10) | [yes](#d10) | [partial](#d10) | [yes](#d10) | [yes](#d10) | [yes](#d10) | [yes](#d10) | [partial](#d10) | [no](#d10) | [yes](#d10) | Percentage text stays visible. |
| **D11** Chat decision trail · worth remembering | [no](#d11) | [yes](#d11) | [yes](#d11) | [yes](#d11) | [yes](#d11) | [yes](#d11) | [yes](#d11) | [partial](#d11) | [no](#d11) | [yes](#d11) | Threshold has explicit text and position. |
| **D12** Chat · judgement context usage | [no](#d12) | [yes](#d12) | [partial](#d12) | [yes](#d12) | [yes](#d12) | [yes](#d12) | [yes](#d12) | [partial](#d12) | [no](#d12) | [yes](#d12) | Separate browser-native threshold treatment. |
| **D13** Judgement diagnostics · question probabilities | [no](#d13) | [yes](#d13) | [partial](#d13) | [partial](#d13) | [yes](#d13) | [yes](#d13) | [yes](#d13) | [partial](#d13) | [no](#d13) | [yes](#d13) | Uses unstyled browser geometry. |
| **D14** Chat / review · turn judgement probabilities | [no](#d14) | [yes](#d14) | [partial](#d14) | [yes](#d14) | [yes](#d14) | [yes](#d14) | [yes](#d14) | [partial](#d14) | [no](#d14) | [yes](#d14) | Same native element with a different width. |
| **D15** Review · draft probability receipt with pass line | [no](#d15) | [yes](#d15) | [yes](#d15) | [partial](#d15) | [yes](#d15) | [yes](#d15) | [yes](#d15) | [yes](#d15) | [no](#d15) | [yes](#d15) | The receipt is already a data table with the exact probability. |
| **S01** Settings / chat · local model download bar | [no](#s01) | [yes](#s01) | [partial](#s01) | [yes](#s01) | [yes](#s01) | [yes](#s01) | [yes](#s01) | [partial](#s01) | [no](#s01) | [yes](#s01) | Indeterminate states still have a text status. |
| **S02** Settings · Desktop Needle download | [no](#s02) | [yes](#s02) | [partial](#s02) | [partial](#s02) | [yes](#s02) | [yes](#s02) | [yes](#s02) | [partial](#s02) | [no](#s02) | [yes](#s02) | Browser-owned native paint. |
| **S03** Settings diagnostics · OpenUI outcome buckets | [no](#s03) | [yes](#s03) | [partial](#s03) | [yes](#s03) | [yes](#s03) | [yes](#s03) | [partial](#s03) | [partial](#s03) | [no](#s03) | [yes](#s03) | Inline count for each bucket. |
| **S04** Settings diagnostics · OpenUI component rates | [no](#s04) | [yes](#s04) | [partial](#s04) | [yes](#s04) | [yes](#s04) | [yes](#s04) | [partial](#s04) | [partial](#s04) | [no](#s04) | [yes](#s04) | Stage filter changes the denominator. |
| **S05** Self-paced · course activity status rail | [no](#s05) | [yes](#s05) | [no](#s05) | [yes](#s05) | [yes](#s05) | [yes](#s05) | [yes](#s05) | [partial](#s05) | [no](#s05) | [yes](#s05) | A fill, an outline and a pattern carry state. |
| **S06** Self-paced · token budget | [no](#s06) | [yes](#s06) | [partial](#s06) | [yes](#s06) | [yes](#s06) | [yes](#s06) | [yes](#s06) | [partial](#s06) | [no](#s06) | [yes](#s06) | One track denominator. |
| **S07** Chat onboarding · four stages | [partial](#s07) | [yes](#s07) | [partial](#s07) | [yes](#s07) | [yes](#s07) | [yes](#s07) | [yes](#s07) | [no](#s07) | [no](#s07) | [yes](#s07) | Desktop names and numeric phone position. |
| **S08** Public learning profile · activity companion | [partial](#s08) | [yes](#s08) | [yes](#s08) | [yes](#s08) | [yes](#s08) | [yes](#s08) | [partial](#s08) | [partial](#s08) | [no](#s08) | [yes](#s08) | Included as a mockup-adjacent visual, no growth scale in this callsite. |
| **S09** Settings · offline tutor download | [no](#s09) | [yes](#s09) | [partial](#s09) | [partial](#s09) | [yes](#s09) | [yes](#s09) | [yes](#s09) | [partial](#s09) | [no](#s09) | [yes](#s09) | Download bytes from app state; paint from browser. |

## 3. Inconsistencies, most visible first

| Severity | Comparison | What differs |
|---|---|---|
| High | Activity feedback, benchmark evidence split, dataset composition | The same three-series language is drawn as a 1.1rem stack with 2px gaps, a .25rem stack with 0 gaps, and a .55rem rounded stack with 0 gaps. The activity legend counts values and opens details. The benchmark legend only maps swatches, while dataset counts are visible and static. [U04](#u04), [B04](#b04), [E01](#e01), [main-comparison.png](shots/A2/main-comparison.png) |
| High | Activity, benchmark, training data | The mark inspection model changes from hover/focus and native `View as table` to native-title-only, then to an aria-hidden visual backed by a static definition list. Benchmark mobile also hides the evidence split. [U01](#u01), [U04](#u04), [B01](#b01), [B04](#b04), [E01](#e01) |
| High | Benchmark outcome, Coming up outlook | Two point-and-interval readings use a square point/leader band/grid versus a pill range and perpendicular line without grid. Both have precise accessible readings but different ways to show the central estimate. The ranked overlap and saved forecast are visible side by side in the synthetic-fixture captures. [B01](#b01), [C01](#c01), [interval-comparison.png](shots/A2/interval-comparison.png) |
| High | Quiz result card, quiz feedback, course progress | Compact square Kit meters on course cards, 8px pill feedback bars, and a separately styled quiz score bar with a tone-colored number. The quiz card supports dark with its own light/dark hex pairs. [C02](#c02), [L09](#l09), [L10](#l10), [L11](#l11) |
| Medium | Activity calendar, response review grids | Daily activity uses a green quantity ramp and ordinal Less/More. Draft check grids use categorical colors, glyphs and numbers, with different spacing, keyboard behavior and table structure. The palette should distinguish quantitative intensity from rule state while allowing the cells and labels to share geometry. [U01](#u01), [D07](#d07), [D08](#d08) |
| Medium | Activity timeline, response review timeline, MusicLab piano roll | SVG calendar time with 22-unit/3r bars, CSS stacked phase time with .625rem tracks and diagonal hatching, and a canvas cycle ruler with literal CRT styling. All are start/end intervals, but scale, labels, segment access and theme conventions differ. [U07](#u07), [D06](#d06), [L04](#l04) |
| Medium | Activity line and inline Simulation | Activity uses hand SVG solid/dashed 2-unit paths, ink direct labels and app tooltip. Recharts draws unconnected primary dots and a primary dashed cursor, with independent fixed chart height, tooltip, 10px ticks and sample disclosure. Keeping unconnected samples is necessary for nonlinear or discontinuous authored arithmetic. [U05](#u05), [L01](#l01) |
| Medium | Reply stages, quiz rounds, exam progress, onboarding | The same progress role is presented as 4px sweep bars, icon bubbles, 7px segmented fills, exam cells and .88rem numbered chips. Motion and phone label retention differ. [D01](#d01), [D03](#d03), [L07](#l07), [L16](#l16), [S07](#s07) |
| Medium | Judgement context, alternative confidence and receipt pass line | UA threshold meter, CSS-painted native pill, and UA meter with separate cutoff. Native sizing and paint vary by browser even within the same judgement flow. [D10](#d10), [D11](#d11), [D12](#d12), [D13](#d13), [D14](#d14), [D15](#d15) |
| Low | Download progress, self-paced token budget | Settings has both native UA and custom tracks. The self-paced budget adds a separate bordered ink pill; all can share value/denominator semantics while retaining indeterminate support. [S01](#s01), [S02](#s02), [S06](#s06), [S09](#s09) |
| Low | Live waveforms and media progress | A currentColor recorder canvas, themed accent live canvas, fixed CRT audio scope and fixed amber playback fill have four different theme paths. Keep real-time audio updating separate from decoration and use consistent surrounding labels. [L05](#l05), [L19](#l19), [L20](#l20), [L23](#l23) |

## 4. Smallest shared chart kit

| Primitive | Best starting point | Coverage and change |
|---|---|---|
| Meter / progress track / numeric readout | [Kit Meter](#c02), [ModelDownloadBar](#s01), [DatasetFigures count tile](#e02) | Common slim track and text placement. Support native-like meters, task progress, indeterminate, countdown, threshold marker and explicit semantic states. Covers course, spend, room, quiz, budget, download and score uses. |
| Bar and stacked bar | [Topics](#u02), [FeedbackMix](#u04) | Ranked bars and horizontal/vertical magnitude bars share scale and direct labels. Stack supports 2px separators, stable slots, zero segments, patterns and optional mark focus. Covers evidence, composition, review status and phase stacks. |
| Point / interval / line / time band | [OutcomePlot](#b01), [Policy scores](#u05), [CurriculumGantt](#u07) | Use one scale mapping for point/range, confidence band, Gantt segments, time annotation, scatter and lines. Support categorical lanes and optional line interpolation. Canvas-backed waveform and music views can share frame, scale and legend without changing their renderers. |
| Cell / state mark / ordinal track | [Calendar](#u01), [decision heatmap](#d08), [review rubric](#r04) | One sized mark, optional outline, glyph/pattern, and state label. Compose calendars, probability matrices, step/count progress, rubric radios, note icons and categorical rails. Keep true data tables semantic. |
| Axis / grid / reading / legend | [Policy scores](#u05), [FeedbackMix](#u04), [LearningOutlook](#c01) | Quiet rules and one scale per measure. Distinguish series by label and shape or pattern, keep numbers in the legend/direct label, and generate a reading that can name the figure. |
| Tooltip / data disclosure | [Activity dashboard handlers](#u03), [Activity table](#u01), [Simulation samples](#l01) | Reuse one hover/focus/escape behavior and equivalent no-hover interaction. Caption and row/column headings should come from the same data as the marks. Preserve native plain text for single values. Authored Mermaid/HTML can opt in at the host boundary. |

## 5. Mockup fidelity

- **U1 note 2**. The three headline tiles match. The policy panel still has its own four metric tiles, while the design calls for three improvement counts folded into the improvement row. [surfaces.body.html:253](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/surfaces.body.html:253), [UsageCharts.tsx:332](/home/diogenes/.cache/keating-deploy/design-pass-20261119/web/src/components/UsageCharts.tsx:332).
- **U1 notes 3 and 4**. Consolidated Spend by model and ranked drill-down bars are implemented. The mock shows 6px series-1 bars; the app uses the slimmer Kit green-deep track on both surfaces. [surfaces.body.html:216](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/surfaces.body.html:216), [surfaces.body.html:254](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/surfaces.body.html:254), [shared.css:474](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/shared.css:474), [U02](#u02), [U03](#u03).
- **U1 note 5**. Feedback preserves the 2px separator and counted legend, while switching the second and third positions. The heat ramp has a Less/More key and titles instead of visible numeric counts per swatch. The line plot uses round interactive marks and a dashed second series where the board sketches square endpoints and solid paths. The built direct labels, table and focus path add ways to read the series. [surfaces.body.html:232](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/surfaces.body.html:232), [surfaces.body.html:256](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/surfaces.body.html:256), [shared.css:526](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/shared.css:526), [U01](#u01), [U04](#u04), [U05](#u05).
- **B1 note 3**. The shared leader band and point/range logic are present for ranked rows. The plot is 1.05rem tall with a .44rem square and an opaque series-1 range, against the board’s 22px plot, 10px square and 45% range. The board places the score by its mark, while the app puts it below or in a phone summary. The synthetic ranked run exercised both ranges and the overlapping leader band. [surfaces.body.html:174](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/surfaces.body.html:174), [shared.css:480](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/shared.css:480), [B01](#b01).
- **B1 note 4**. The seven-column table and expanded dimension list landed. Six-pixel series-1 dimension bars became .25rem ink meters, and the evidence split lost the mock’s 2px gaps. There is no counted visible source legend per model. [surfaces.body.html:175](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/surfaces.body.html:175), [shared.css:474](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/shared.css:474), [shared.css:487](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/shared.css:487), [B02–B04](#b02).
- **B1 note 5 and M1 note 1**. The four readiness ticks and the phone outcome plot are present. The phone outcome summary retains values while the desktop scale heading and split disappear. [surfaces.body.html:176](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/surfaces.body.html:176), [surfaces.body.html:300](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/surfaces.body.html:300), [B01](#b01), [B04](#b04), [B05](#b05).
- **E1 note 2**. A counted overview remains visible as a prepared snapshot and explicitly waits for preparation to apply control changes. The board’s 14px square composition has 2px gaps, while the production .55rem stack has rounded clipping and touching fills. The color mapping and counts match. [more.body.html:310](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/more.body.html:310), [more.body.html:323](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/more.body.html:323), [shared.css:526](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/shared.css:526), [E01](#e01).
- **Rooms R2 note 4**. Transcript counts sit inline with counted learner names for the overseeing viewer and Details opens tabular participation. The mock depicts host/teacher rows with counts too. The built People rail on a host-only room omitted the bars. [more.body.html:175](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/more.body.html:175), [more.body.html:192](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/more.body.html:192), [R01](#r01), [room-people-light.png](shots/A2/room-people-light.png).
- **Courses C1 note 1 and C2 notes 3 and 5**. The course card and progress rail use Kit’s slim green-deep track where both boards use the 6px series-1 bar. Outline states are represented separately with lesson markers. [more.body.html:206](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/more.body.html:206), [more.body.html:214](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/more.body.html:214), [more.body.html:265](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/more.body.html:265), [more.body.html:279](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/more.body.html:279), [C02–C04](#c02).
- **Review R1 note 2 and R4 notes 1–2**. The status strip retains solid and hatched segments, with no separator between them. The rubric’s questions, named chosen scores and dashed proposal on the same numbered scale are implemented. The review screenshot exercised the unscored scale, with no pending model proposal. [review.body.html:59](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/review.body.html:59), [review.body.html:271](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/review.body.html:271), [R03](#r03), [R04](#r04), [review-rubric-light.png](shots/A2/review-rubric-light.png).
- **Profile P1 note 5**. The published activity count turns on a fixed plant pose. The renderer does not vary the plant with the number of active days. [more.body.html:63](/home/diogenes/.cache/keating-deploy/design-pass-20261119/docs/design/2026-11-19-review-chat-mockups/src/more.body.html:63), [S08](#s08).

## Live evidence

All captures below are local desktop screenshots with light and forced dark variants. An isolated profile used three synthetic chat sessions from the supplied seed. A second isolated run added a synthetic comparison model, 42 quiz records and a saved forecast to expose ranked and forecast states. Source-backed behavior covers the data-dependent paths outside those fixtures.

| Surface | Captures | State inspected |
|---|---|---|
| Activity | [Light](shots/A2/activity-seeded-light.png), [dark](shots/A2/activity-seeded-dark.png), [lower light](shots/A2/usage-lower-light.png), [lower dark](shots/A2/usage-lower-dark.png) | Calendar reported three sessions across three days. Model table rendered. No synthetic topic, feedback, policy trend or curriculum data populated these plots. |
| Benchmark | [Light](shots/A2/bench-both-light.png), [dark](shots/A2/bench-both-dark.png) | Both selected. Initial fixture showed one sparse model. Adding 42 local quiz records across two models produced two intervals, two leader-band instances and the tie verdict. [Ranked light](shots/A2/bench-ranked-light.png), [ranked dark](shots/A2/bench-ranked-dark.png). |
| Training data | [Light](shots/A2/training-prepared-light.png), [dark](shots/A2/training-prepared-dark.png) | Prepare dataset yielded three conversation responses, zero teaching artifacts and zero sandbox records. Only one filled segment visible. |
| Coming up | [Light](shots/A2/coming-up-light.png), [dark](shots/A2/coming-up-dark.png) | Initial route had no outlook. Added a local synthetic saved forecast with median 72% and interval 51–84%. [Outlook light](shots/A2/coming-up-outlook-light.png), [outlook dark](shots/A2/coming-up-outlook-dark.png). |
| Course card | [Light](shots/A2/course-card-light.png), [dark](shots/A2/course-card-dark.png) | Synthetic course shown as 0 of 0. Nonzero fill source-inspected. |
| Room People | [Light](shots/A2/room-people-light.png), [dark](shots/A2/room-people-dark.png) | Synthetic host-only room opened the default People rail. It had no counted learner rows. |
| Review rubric | [Light](shots/A2/review-rubric-light.png), [dark](shots/A2/review-rubric-dark.png) | Rubric tab opened on seeded session, unscored and without a pending proposal. |

[Interval comparison](shots/A2/interval-comparison.png) pairs ranked Benchmark with the Coming up forecast in both themes. The first comparison montage places Activity, Benchmark, Training data and Review rubric left to right, with light above dark. These captures support desktop visual comparisons. Phone layout, keyboard tooltip parity in Recharts, platform-specific native-meter paint and provider-dependent chart states were source-inspected only.
