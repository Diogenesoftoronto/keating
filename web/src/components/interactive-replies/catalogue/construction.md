<!-- Model-facing schema for `Construction`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/CATALOGUE.md (ids renamed to OpenUI names). -->

## `Construction` (kind `construction`): straightedge-and-compass constructions

Write it in an openui fence as `Construction(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values; quoted or bare keys both parse), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Teaches:** classical constructions with the tools themselves. The learner drops the compass needle on a
point (it snaps to given and found points), drags the pencil leg to set the opening (it snaps onto points;
any other length is allowed), twists the handle to sweep arcs, and drags the straightedge between points.
The canvas finds where arcs and lines cross, names the points that matter, and checks each step from the
geometry drawn. A wrong opening still draws, and its effect (an off-centre midpoint, a lopsided bisector, a
hexagon that misses) is measured and explained with the learner's own lengths.

**Choose it for:** "Help me practise constructing an equilateral triangle", "How do I find the middle of a
line with a compass?", "How do I bisect an angle without a protractor?", "How do I copy a segment / an
angle?", "Why does the radius step round a circle exactly six times?", "Why does the compass construction
give equal sides?", "Test me: can I bisect this angle without hints?"

**Not for:** constructions outside the six below (pentagon, tangent, square, triangle from three given
sides, parallel through a point): describe them in prose. Definitions ("what is a perpendicular
bisector?"): prose. Measuring with a ruler or protractor. Proving a theorem in general (prose; the
component shows one case).

**Config** (`CompassConstructionConfig`):

```ts
type CompassConstructionConfig = {
  construction: "equilateralTriangle" | "perpendicularBisector" | "angleBisector"
              | "copySegment" | "copyAngle" | "hexagon";     // required; steps and checks are built in
  points?: string[];       // labels of the given points, in order; exact count per construction (below);
                           // each /^[A-Z][0-9′']?$/ (A, P1, A′), all different
  length?: number;         // the given length in cm (AB, or the circle's radius), 1–30, default 6. Allowed for every
                           // construction; it only changes the cm values printed, not the drawing
  angle?: number;          // degrees; angleBisector 25–150 (default 64), copyAngle 25–120 (default 50); not allowed otherwise
  segmentDrawn?: boolean;  // equilateralTriangle only: start with AB drawn (default false); not allowed otherwise
  showSteps?: boolean;     // default true; false hides the step list and shows the goal line (goal-check mode)
  hints?: "full" | "light" | "none";  // default "full": next move + how-to + pulsing handle;
                           // "light": the instruction only; "none": only problems are pointed out
  title?: string;          // 1–60 chars; default per construction ("Bisect AB at right angles")
  goal?: string;           // 1–160 chars; allowed always, but shown only when showSteps is false or hints is "none";
                           // name the points as they are labelled (your `points`, else the defaults)
};
```

**Unknown fields are rejected.** You cannot author steps, checks or point positions; layouts are fixed so
points can't be placed badly.

| `construction` | given points (default labels) | starts with |
|---|---|---|
| `equilateralTriangle` | 2: A, B | two points (AB drawn if `segmentDrawn`) |
| `perpendicularBisector` | 2: A, B | segment AB |
| `angleBisector` | 3: O (vertex), A, B (arm ends) | the angle |
| `copySegment` | 3: A, B, C (C starts the target line) | AB and a ray from C |
| `copyAngle` | 4: O, A, B, P (P starts the target line) | the angle and a ray from P |
| `hexagon` | 2: O (centre), P (a point on the circle) | the circle |

Labels follow the table order (the vertex or centre comes first for `angleBisector`, `copyAngle` and
`hexagon`). Points the learner finds (the copied endpoint, the bisector's crossing) are named by the canvas,
so a `title` or `goal` can only refer to the given points. "Goal-check mode" means `showSteps: false`; add
`hints: "none"` for a real test. The drawing itself is fixed: `angle` sets the angle's size, but you can't reproduce a learner's
own sketch. `showSteps` and `hints` combine freely. Pick the support: `hints: "full"` for a first try, `"light"` for practice, and `showSteps: false` with
`hints: "none"` and a `goal` to test whether the learner can do it unaided (the checks still run and Share
reports the result).

**Minimal example:**

```openui lifecycle=ephemeral id=bisect-angle-pvq
root = LearningSurface([reply])
reply = Construction("Bisect angle PVQ", {"construction": "angleBisector", "angle": 120, "points": ["V", "P", "Q"], "showSteps": false, "hints": "none", "goal": "Split angle PVQ into two equal angles."})
```
