# Keating charts

Import from `@/design-system/charts`. Give categories unique labels, finite numeric inputs, ascending domain and interval bounds, and stable series order. LineChart, StackBar and Legend reject a fourth series. Choose three or fold counts into Other before rendering. Collection charts derive a reading from the supplied data and include a table above three values. Keyboard focus follows data order. Chart components inherit the application theme. See Design System/Charts → Sheet for interactive examples.

## Meter

Show one bounded value, a pass line or a download with unknown duration. Give live readings updates through props.

**Props.** `max`, `value` (defaults to zero), `label`, `valueText` (visible beside track), `threshold: {value,label}`, `tone` (data, ink, ok, warn, bad or legacy series1–3), `size` (sm/md/lg), `indeterminate`, `progress` and native div props. The ref targets the track.

```tsx
<Meter
  value={8} max={10}
  valueText="8 of 10" tone="ok"
  threshold={{value:7,label:"Pass"}}
/>
```

## Progress

Show completed steps in a course or a quiz. The next step gets an outline. Counts above twelve share the continuous Meter.

**Props.** `done`, `total`, optional `label`.

```tsx
<Progress
  done={4}
  total={7}
  label="Course progress"
/>
```

## Countdown

Show the time left on an exam. The caller owns the clock and passes seconds. Below one quarter the reading says Warning. Below one tenth it says Critical.

**Props.** `remaining`, `total` in seconds, optional `label`.

```tsx
<Countdown
  remaining={12}
  total={60}
  label="Exam clock"
/>
```

## BarList

Compare nonnegative counts across topics. Rows sort largest first unless their source order carries meaning. A selection handler turns rows into drill-in buttons.

**Props.** `data: {label,value}[]`, `label`, `preserveOrder`, `onSelect(label)`.

```tsx
<BarList
  data={topics}
  onSelect={openTopic}
  label="Sessions by topic"
/>
```

## StackBar

Show how counts divide a whole. Keep category order stable between renders. Zero-count categories retain their legend slot. Selection is controlled through the mark or legend.

**Props.** `data: {label,value,pattern?}[]`, `size` (md/lg), `label`, `selected`, `onSelect(label)`.

**Tones.** A datum takes the next series colour unless it has a `tone`: `ok`, `warn` and `bad` are the status colours (graded answers: Correct, Partly, Not quite), `ink` is for one measure counted in steps (reviewed, done), and `rest` is the unfilled remainder of a whole (not reviewed, to do), drawn as the track and outlined in the legend. Never use series colours for right and wrong, and never give "not started" a colour of its own.

```tsx
<StackBar
  data={feedback}
  size="lg" selected={signal}
  onSelect={setSignal}
/>
```

## IntervalPlot

Compare outcomes with uncertainty on one axis. Supply the leader’s interval as a shared band. Omit a sparse estimate’s range to draw a hollow point.

**Props.** `data: {label,value,range?: [low,high]}[]`, `domain` (default [0,100]), `band: [low,high]`, `label`.

```tsx
<IntervalPlot
  data={outcomes}
  domain={[0,100]}
  band={[66,82]}
/>
```

## LineChart

Show scores or samples over numeric x coordinates. Timestamps and irregular spacing keep their distances. Each series sorts by x. Use disconnected squares for discontinuous simulations.

**Props.** `series: {label,points: {x,y,label?}[]}[]`, `domain` (y bounds, otherwise observed extent), `label`, `connect` (default true), `crosshair`. End labels and legend report the last sample.

```tsx
<LineChart
  series={simulationRuns}
  connect={false}
  crosshair
/>
```

## HeatGrid

Show a nonnegative quantity per ordered cell. Zero uses the track. Four equally spaced intervals over the observed maximum form the heat ramp.

**Props.** `data: {label,value}[]` in row-major order, `columns` (default 7), `selected`, `onSelect(label)`, `label`.

```tsx
<HeatGrid
  data={days}
  selected={date} columns={14}
  onSelect={setDate}
/>
```

## StateGrid

Show named checks and outcomes. Each state carries a check, alert or cross. The legend includes counts for all three states.

**Props.** `data: {label,state}[]`, `states: Record<"ok"|"warn"|"bad",string>`, `columns` (default 7), `selected`, `onSelect(label)`, `label`.

```tsx
<StateGrid
  data={checks}
  states={{ok:"Passed",warn:"Partial",bad:"Failed"}}
  columns={6}
/>
```

## Timeline

Show start/end phases on parallel lanes. Put overlapping events on separate lanes. Waiting phases have a hatch and explicitly say Waiting on inspection.

**Props.** `lanes: {label,bands: {label,start,end,waiting?}[]}[]`, optional `domain: [min,max]` and `label`.

```tsx
<Timeline
  lanes={reviewPhases}
  domain={[0,60]}
  label="Review time in seconds"
/>
```

## Stat

Show a headline number with an optional supporting line explaining its scope or comparison. Format units before passing the value.

**Props.** `label`, `value: string | number`, optional `support`.

```tsx
<Stat
  label="Learning sessions"
  value={14}
  support="Across nine active days"
/>
```

## Legend

Pair series names with numbers. Selectable entries use pressed buttons. Their order must match the plotted series.

**Props.** `entries: {label,value,pattern?,tone?}[]`, optional `label`, `selected`, `onSelect(label)`.

```tsx
<Legend
  entries={signals}
  selected={signal}
  onSelect={setSignal}
/>
```

## ChartTooltip

Use the hook once per chart. Spread its mark bindings and mount its tooltip once. The hook places the panel from the mark bounds for both hover and keyboard focus. Escape dismisses it.

**Props.** `useChartTooltip()` returns `bind(text)`, `active` and `tooltip`. The underlying panel accepts `text`, `id`, `x`, `y` (viewport coordinates) and `above`.

```tsx
const tip = useChartTooltip();
return <div>
  <button {...tip.bind("November 17, two sessions")}>Nov 17</button>
  {tip.tooltip}
</div>;
```

## ChartTable

Offer the values in reading order. Use the same rows that produce the marks. The first column supplies row headings. The disclosure works without client JavaScript.

**Props.** `columns: string[]`, `rows: (string | number)[][]`, optional `caption`.

```tsx
<ChartTable
  columns={["Signal","Count"]}
  rows={signals.map(s => [s.label,s.value])}
  caption="Activity feedback"
/>
```

## ChartFrame

Group a chart with its title, time scope and main reading. Wrap real-time canvas or authored graphics here while their existing renderer handles updates.

**Props.** `title`, `reading`, `children`, optional `scope` and accessible `label` override.

```tsx
<ChartFrame title="Session feedback"
  scope="All time"
  reading="41 sessions ended with a confident learner.">
  <StackBar data={feedback}/>
</ChartFrame>
```

## Migrating existing drawings

| Existing pattern in the inventory | Shared primitive |
| --- | --- |
| Kit Meter, ModelDownloadBar, spend, budget, score, receipt cutoff | Meter with units, threshold or indeterminate state |
| Course, reply stages, quiz rounds, exam and onboarding steps | Progress for counts, Countdown for time |
| DatasetFigures count tiles | Stat |
| Topics or domain hierarchy | BarList with onSelect |
| FeedbackMix, evidence split, dataset composition, review status | StackBar and its counted Legend |
| OutcomePlot, LearningOutlook | IntervalPlot with optional shared band |
| Policy scores, Simulation samples | LineChart, with connect disabled for independent samples |
| CurriculumGantt, review phase timing | Timeline |
| Calendar, probability matrix | HeatGrid |
| Decision heatmap, draft checks, review rubric | StateGrid for named outcomes, retain native controls for rubric inputs |
| Activity dashboard handlers, activity table, sample disclosure | useChartTooltip and ChartTable |
| Music piano roll, waveform, authored Mermaid and HTML | ChartFrame around the renderer |

## Live fills

`<Meter live .../>` and `<Progress live .../>` mark work that is happening right now (a download, a run, a generation). Light streaks step through the filled part of a meter and the current step of a stepped bar ticks (CSS only: the chart kit imports nothing from the shader layer). It is decoration: the value is still written beside the bar, and it stands still with reduced motion or effects off. Do not set `live` on a finished or paused bar.
