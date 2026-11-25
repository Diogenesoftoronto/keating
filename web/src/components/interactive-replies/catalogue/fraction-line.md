<!-- Model-facing schema for `FractionLine`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/CATALOGUE.md (ids renamed to OpenUI names). -->

## `FractionLine` (kind `fraction-line`): fraction bars on a number line

Write it in an openui fence as `FractionLine(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values; quoted or bare keys both parse), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Teaches:** fractions as lengths measured from 0. The learner lays one shaded bar on another (are they the
same length? how much is left over?), cuts a bar's pieces into smaller pieces with scissors (renaming 3/4 as
6/8 without changing its size), drags markers along the line, and places a fraction such as 7/4 past 1.
The scissors start at the smallest allowed factor: choosing the shared piece size is the learner's step,
and a cut that still leaves different-size pieces (sixths vs tenths) is called out.

**Choose it for:** "Which is bigger, 3/4 or 5/8?", "Is 2/4 really the same as 1/2?", "Where does 7/4 go on a
number line?", "Why is 5/6 bigger than 4/5 if both are one piece short?", "Why do I need a common
denominator?"

**Not for:** fraction *arithmetic procedures* with symbols ("solve x/3 = 4": `EquationWorkbench`). A parameter that
drives a process (`LinkedModel`). Decimals, percentages, negative numbers: the line runs from 0 to a whole number
and every value is a fraction. "What is a numerator?" (prose).

**Config** (`NumberLineConfig`):

```ts
type NumberLineConfig = {
  max?: number;                 // the line runs 0..max; integer 1–4, default 1
  rows: NumberLineRow[];        // 1–3 rows, one bar each
  moves?: NumberLineMoves;      // omitted = the bars can't be moved
  goal?: NumberLineGoal;        // omitted with 2+ rows = compare rows 0 and 1
  title?: string;               // ≤ 80 chars; default is generated ("Lay 3/4 on 5/8", "Where does 7/4 go?")
};
type NumberLineRow = {
  numerator: number;            // integer ≥ 0; a value above the row's maximum is clamped
  denominator: number;          // integer 1–24; keep ≤ 12 so pieces stay readable (advice)
  tone?: "a" | "b" | "c";       // default by row index
  editable?: boolean;           // learner may change the numerator (marker drag and −/+ buttons)
  label?: string;               // ≤ 30 chars; name in buttons and announcements, e.g. "Top bar"
  minNumerator?: number;        // integer ≥ 0, default 0, ≤ maxNumerator, not past the end of the line
  maxNumerator?: number;        // integer ≥ 0; default and ceiling: max × denominator
};
type NumberLineMoves = {
  layOn?: boolean | { from: number; onto: number }[];   // row indexes, from ≠ onto; true = every pair
  cut?: boolean | { rows?: number[]; factors?: number[] }; // true = every row with factors [2, 3];
                                                           // factors: non-empty, integers 2–10
  markers?: boolean;            // a draggable pin on the line per editable row
  steppers?: boolean;           // −/+ buttons per editable row
};
type NumberLineGoal =
  | { kind: "compare"; a: number; b: number }            // two different row indexes; needs 2 rows
  | { kind: "equivalent"; a: number; b: number }         // same, framed "Is a the same as b?"
  | { kind: "place"; row?: number; target: string | { numerator: number; denominator: number } }; // "7/4"
```

Rules (enforced by `validateNumberLine` unless marked advice):

- Every row index in `layOn`, `cut.rows`, `goal.a`, `goal.b` and `goal.row` must exist.
- **Place:** the target is a fraction like `"7/4"`, ≤ `max`, and writable in the row's denominator (7/4 →
  denominator 4 or 8); the row needs `editable: true` and `moves.markers: true`. Start the numerator at 0
  and add `steppers` for keyboard users (advice).
- **Compare / equivalent** (advice): for the learner to rename both bars into common pieces, each row that
  needs renaming must be in `cut.rows`, and `cut.factors` must include `lcm(denA, denB) / den` for that row
  (3/4 vs 5/8: row 0, factor 2). **Add at least one distractor factor** (`[2, 3, 4, 5]` for thirds vs
  fifths) so choosing the piece size is something to work out; with one factor the instruction names the
  cut. Without the right factor the bars can still be laid on each other and the gap is named in words.
- `editable`, `markers` and `steppers` are optional for compare/equivalent. Add them when the learner should
  also try *other* fractions on the same bars.

**Minimal example** (compare 2/3 and 3/4):

```openui lifecycle=ephemeral id=which-is-bigger-2-3-or-3-4
root = LearningSurface([reply])
reply = FractionLine("Which is bigger, 2/3 or 3/4?", {"rows": [{"numerator": 2, "denominator": 3, "editable": true}, {"numerator": 3, "denominator": 4, "editable": true}], "moves": {"layOn": true, "cut": {"factors": [2, 3, 4]}, "markers": true, "steppers": true}, "goal": {"kind": "compare", "a": 0, "b": 1}})
```
