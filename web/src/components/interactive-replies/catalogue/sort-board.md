<!-- Model-facing schema for `SortBoard`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/CATALOGUE.md (ids renamed to OpenUI names). -->

## `SortBoard` (kind `sort-board`): sequence, bins or label

Write it in an openui fence as `SortBoard(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values; quoted or bare keys both parse), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Teaches:** retrieval practice. Three layouts: **sequence** (drag steps onto a track, line or cycle, in
order; with art the learner drags the drawings themselves and each placed stage shows its `effect`),
**bins** (sort 2–12 items into 2–4 categories), **label** (drag labels onto numbered spots on a diagram). The
learner can mark any placement as a guess with ?. Checking explains each miss, names the misconception it
most likely reveals, and retries only the misses. On a `cycle` track any rotation of the right order counts.

**Choose it for:** "Quiz me on the stages of mitosis", "Can you test me on the order of the scientific
method?", "Help me remember which rocks are igneous, sedimentary or metamorphic", "Quiz me on the parts of a
neuron / the heart / a flower", "Is this a chemical or a physical change?" (a set of examples), "Put the
events leading to WWI in order", "Test me on the phases of the Moon".

**Not for:** planning dated work (`PlanTimeline`). Judging sentences of one passage against a claim
(`EvidenceBoard`). Rearrangements as mathematical objects (`PermutationLab`). A process whose next step depends on
an input (`StateMachine`). A single fact ("what comes after metaphase?", prose). A learner who wants an
explanation rather than a quiz: explain in prose first.

**Config** (`SortBoardConfig`):

```ts
type SortBoardConfig = {
  title: string;                          // 1–120 chars
  instructions?: string;
  noun?: string;                          // plural noun for the share text: "stages", "rocks", "labels"
  misconceptions?: Record<string, { name: string; reply: string }>;  // name ≤ 120, reply ≤ 600 chars
  perfectReply?: string;                  // Keating's reply when all right first time, none marked ?
  hideLabels?: boolean;                   // hide names until the check: recognise items by their drawings alone;
                                          // only when every item has art
} & (
  | { layout: "sequence"; steps: SequenceStep[];           // listed in the CORRECT order
      track?: { shape?: "line" | "cycle"; start?: TrackEnd; end?: TrackEnd; center?: TrackEnd };
      startOrder?: string[] }                              // every step id once; default: shuffled
  | { layout: "bins"; bins: SortBin[];                     // 2–4 bins
      items: BinItem[] }
  | { layout: "label";
      diagram: string | { width: number; height: number; shapes: SortShape[] };  // library name, or custom (width, height ≥ 40)
      parts: LabelPart[] }
);
type SortItem = {
  id: string;                    // /^[A-Za-z0-9_-]{1,40}$/, unique
  label: string;                 // 1–140 chars
  why: string;                   // 1–600 chars: why the right answer is right, shown on a miss
  misconception?: string;        // key into misconceptions
  wrong?: Record<string, string | { why: string; misconception?: string }>;
                                 // sharper feedback when THIS item is dropped in the wrong place, keyed by that
                                 // place: the bin id (bins) or the part id whose spot it landed on (label).
                                 // The object form names the misconception that wrong place reveals.
};
type SequenceStep = SortItem & { effect?: string; art?: ArtRef };   // effect: caption once placed
type BinItem = SortItem & { bin: string; art?: ArtRef };            // bin = a bin id
type SortBin = { id: string; label: string; hint?: string };        // id as above, label ≤ 40 chars
type LabelPart = SortItem & { at: string | [number, number] };      // library anchor name, or [x, y] inside a custom diagram
type TrackEnd = { label: string; art?: ArtRef };                    // label ≤ 80 chars
type ArtRef = string | SortShape[];      // a library art name (preferred), or shapes drawn in a 100 × 80 box
type SortShape = ShapeStyle & (
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; rx?: number }
  | { kind: "path"; d: string }          // only SVG path commands and numbers, ≤ 600 chars
  | { kind: "text"; x: number; y: number; text: string; size?: number;   // text ≤ 60 chars
      anchor?: "start" | "middle" | "end"; weight?: number } );
type ShapeStyle = { fill?: SortTone; stroke?: SortTone; width?: number; dash?: boolean; opacity?: number };
type SortTone = "ink" | "muted" | "line" | "soft" | "paper" | "accent" | "c1" | "c2" | "c3" | "c4" | "c5" | "c6" | "none";
```

**Art library** (prefer a name to drawing your own; an unknown name is rejected):

- mitosis: `cell.interphase` `cell.prophase` `cell.metaphase` `cell.anaphase` `cell.telophase` `cell.cytokinesis` `cell.daughters`
- water: `water.evaporation` `water.condensation` `water.precipitation` `water.collection` `sun` `cloud` `rain` `drop` `snowflake` `flame` `leaf`
- energy: `energy.wind` `energy.coal` `energy.oil` `energy.atom` `energy.solar` `energy.hydro`
- life cycles: `plant.seed` `plant.sprout` `plant.young` `plant.flower` `plant.fruit` · `insect.egg` `insect.caterpillar` `insect.chrysalis` `insect.butterfly`
- moon: `moon.new` `moon.waxingCrescent` `moon.firstQuarter` `moon.waxingGibbous` `moon.full` `moon.waningGibbous` `moon.lastQuarter` `moon.waningCrescent`
- matter: `matter.solid` `matter.liquid` `matter.gas`
- scientific method: `method.observe` `method.question` `method.hypothesis` `method.predict` `method.experiment` `method.analyse` `method.conclude` `method.share`

**Diagram library** (`diagram` as a name; each part's `at` is then an anchor name; a wrong anchor is rejected):

| diagram | anchors |
|---|---|
| `plantCell` | `wall` `membrane` `cytoplasm` `nucleus` `nucleolus` `vacuole` `chloroplast` `mitochondrion` |
| `animalCell` | `membrane` `cytoplasm` `nucleus` `nucleolus` `mitochondrion` `ribosome` |
| `neuron` | `dendrites` `cellBody` `nucleus` `hillock` `axon` `myelin` `node` `terminal` (signal runs left to right) |
| `flower` | `petal` `sepal` `anther` `filament` `stigma` `style` `ovary` `stem` |
| `heart` | `rightAtrium` `rightVentricle` `leftAtrium` `leftVentricle` `septum` `aorta` `pulmonaryArtery` `venaCava` `pulmonaryVein` (drawn as you face the person: their right is on your left) |

Rules: 2–12 items (steps, items or parts). Two parts may not share a spot. `wrong` has no use in a sequence
(there is no wrong *place* to name); use `misconception` there. At most 80 shapes per custom `art` or
diagram. Colours are only the tone names above (they follow the light/dark theme), so **never name a colour
in `why`, `wrong` or `reply`** ("the orange ones"): describe shapes instead. In `label`, parts are numbered
spots (1, 2, 3…) in the order listed; don't draw `text` shapes that name the parts. In a `cycle`, don't
number the stages in the instructions.

Misconceptions: the share reply groups first-try misses by misconception (the wrong place's, else the
item's) and quotes each group's full `reply`, so **write one misconception per distinct idea** and never reuse
a key for two different errors.

Custom diagrams (no library match): the diagram spans the canvas width and overlapping markers are pushed
apart with pin lines, but keep spots at least width ÷ 12 apart, use a near-4:3 shape 240–300 units wide,
and for a part inside another put the outer part's spot on its edge. Keep labels short: a long single word
can overflow a chip.

**Minimal example** (bins):

```openui lifecycle=ephemeral id=chemical-or-physical-change
root = LearningSurface([reply])
reply = SortBoard("Chemical or physical change?", {"layout": "bins", "title": "Chemical or physical change?", "noun": "changes", "bins": [{"id": "chem", "label": "Chemical"}, {"id": "phys", "label": "Physical"}], "items": [{"id": "rust", "bin": "chem", "label": "An iron nail rusts", "why": "Iron reacts with oxygen to make a new substance, iron oxide."}, {"id": "melt", "bin": "phys", "label": "Ice melts", "why": "It is still water; only its state changed."}]})
```
