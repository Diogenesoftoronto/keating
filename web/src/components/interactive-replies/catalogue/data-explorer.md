<!-- Model-facing schema for `DataExplorer`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/CATALOGUE.md (ids renamed to OpenUI names). -->

## `DataExplorer` (kind `data-explorer`): regroup a dataset

Write it in an openui fence as `DataExplorer(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values; quoted or bare keys both parse), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Teaches:** whether a gap between two groups survives regrouping: confounding, Simpson's paradox, base
rates, small groups. Everything happens inside the chart: the learner drags a field chip onto the
**axis** (a dashed line under the group labels: groups the bars), the **legend** (a dashed line above the
bars: splits each bar and carries the colour key), or the **keep only** zone at the top (tap the chip there
to cycle its value); a chip dropped on the bars lands on the axis. Every bar is recounted from the rows.
Dragging one bar onto another compares them, and a what-if handle re-mixes one group's cases to match the
other's (it snaps to the other group's exact mix). "Explain" tells the story behind the numbers. The table
starts collapsed.

**Choose it for:** "The new treatment has a lower success rate overall. Is it worse?", "Were women
admitted less often?", "Do students who sleep more get better grades, or is it something else?", "Why does
this hospital have a higher death rate if it's the better hospital?", "Does the gap survive inside each
class?"

**Not for:** one-number statistics questions ("what's the mean of 3, 5, 7?", prose). A parameter that drives
a model (`LinkedModel`). A dataset with no second grouping field: regrouping is the point. Checking whether a
sentence of an article supports its headline (`EvidenceBoard`).

**Config** (`DataExplorerConfig`):

```ts
type DataExplorerConfig = {
  title: string;
  goal?: string;                        // one instruction line
  source?: string;                      // where the numbers come from; only its first sentence shows at first,
                                        // so make that sentence self-contained ("Made-up numbers for practice.")
  fields: Record<string, FieldSpec>;    // ids /^[A-Za-z]\w*$/
  rows: Record<string, string | number>[];  // 1–200 records; aggregated rows are fine with `weight`
  weight?: string;                      // a measure field holding each row's count (≥ 0)
  measure:
    | { kind: "count"; label?: string }
    | { kind: "rate"; field: string; value: string; label?: string }   // share of rows where field = value
    | { kind: "mean"; field: string; label?: string; domain?: [number, number] };  // domain max > min
  layout: { rows: string[];             // the axis
            cols: string[];             // the legend
            filter?: { field: string; value: string } | null };   // keep only
  colorBy?: string;                     // a dimension; default question.compare
  smallGroup?: number;                  // groups with fewer cases are flagged; default 30
  question?: {
    ask?: string;
    compare: string;                    // the dimension being judged
    pair?: [string, string];            // two of its values; default its first two
    reveal?: string[];                  // other dimensions that reveal the insight
    expect?: "flip" | "no-flip";        // default flip
    explain?: string;                   // domain story shown in Explain
    caveat?: string;                    // what grouping cannot fix
  };
};
type FieldSpec = { label: string; role: "dimension" | "measure";
                   values?: string[];   // optional category order (any dimension, the outcome too);
                                        // if given, every row value must be listed
                   unit?: string; digits?: number };
```

Rules (enforced):

- Every row has a **string** for every dimension and a **finite number** for every measure.
- `rate.field` is a dimension (the outcome) and `rate.value` one of its values; `mean.field` is a measure.
- Apart from the rate outcome there must be **at least two dimensions** to regroup.
- `layout` uses only those groupable dimensions (never the outcome), each at most once, at most 2 in rows
  and 2 in cols. Start with the headline view, usually `{ "rows": [], "cols": ["<compare>"] }`.
- `question.compare` and `reveal` are groupable dimensions; `reveal` must not include `compare`.
- At most 24 bars can be drawn at once.

Make `expect` true of the numbers. `flip` means the pooled gap and the **case-weighted average** of the
within-group gaps (grouped by a `reveal` field, each group weighted by its cases on both sides) have
opposite signs; groups within 0.5 points (rate), 0.05 (mean) or 0.5 cases (count) of zero count as even. Not
every group has to reverse: when only the average does, the feedback says "reversed on average" and names
the groups on each side. **If your intro or `explain` says "in every group", the data must reverse in every
group**; otherwise say "on average". `no-flip` means no single other field reverses it. Keep category values
short (narrow screens drop a shared prefix, then wrap, then tilt labels). Rows need not cover every combination of values. Check your arithmetic before sending, and label invented data as
invented in `source`.

**Minimal example:**

```openui lifecycle=ephemeral id=two-clinics
root = LearningSurface([reply])
reply = DataExplorer("Two clinics", {"title": "Two clinics", "source": "Made-up numbers for practice.", "fields": {"clinic": {"label": "Clinic", "role": "dimension"}, "age": {"label": "Age group", "role": "dimension"}, "result": {"label": "Result", "role": "dimension"}, "n": {"label": "Patients", "role": "measure"}}, "weight": "n", "rows": [{"clinic": "North", "age": "Under 60", "result": "Recovered", "n": 90}, {"clinic": "North", "age": "Under 60", "result": "Not yet", "n": 10}, {"clinic": "South", "age": "Under 60", "result": "Recovered", "n": 19}, {"clinic": "South", "age": "Under 60", "result": "Not yet", "n": 1}], "measure": {"kind": "rate", "field": "result", "value": "Recovered"}, "layout": {"rows": [], "cols": ["clinic"]}, "question": {"compare": "clinic", "reveal": ["age"], "expect": "no-flip"}})
```
