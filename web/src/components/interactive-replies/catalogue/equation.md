<!-- Model-facing schema for `EquationWorkbench`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/CATALOGUE.md (ids renamed to OpenUI names). -->

## `EquationWorkbench` (kind `equation`): the equation workbench

Write it in an openui fence as `EquationWorkbench(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values; quoted or bare keys both parse), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Teaches:** legal algebraic moves on one equation or expression. The learner drags terms across the `=`
(the sign flips), drops a term on a like term to combine, drags a factor across the `=` and drops it under
the other side to divide (from a denominator, to multiply), drops a number on a bracket to distribute,
multiplies brackets term by term (a power is first written out by dragging the exponent under its bracket),
and drags a number out past the left edge to factor, then picks which divisor to take out. Common slips
(combining unlike terms, dividing one term only, (a + b)² → a² + b², wrong sign when crossing, a factor that
isn't common) can be tried and are explained instead of applied. A hint gives the next move of the shortest
route. The share reply opens with the direct answer ("x = 6.", "6x + 9 = 3(2x + 3).", "No: …").

**Choose it for:** "How do I solve 5 − 2x = 11?", "Why do I flip the sign when I move a term over?", "How do
I get rid of the fraction in (x + 4)/2 = 3x − 1?", "Is (x + 3)² the same as x² + 9?", "How do I factor
12y + 18?", "Is 3(x − 2) + x the same as 4x − 6?", "Solve 4(p − 1) = 2p + 6 for p".

**Not for:** seeing how a formula's output changes with its parameters (`LinkedModel` function). Fraction size
comparisons (`FractionLine`). Quadratics to *solve*, systems of equations, decimals, inequalities: not
supported, use prose. "What is a coefficient?" (prose). A learner who just wants the answer (prose, then
offer the workbench).

**Config** (`EquationWorkbenchConfig`):

```ts
type EquationWorkbenchConfig = {
  expression: string;   // ≤ 80 chars. "3x - 5 = x + 7", or an expression: "(a + b)^2"
  goal: "isolate" | "equivalent" | "simplify" | "expand" | "factor";
  variable?: string;    // one letter, for isolate; default "x", so set it when the letter is not x
  fadeAfter?: number;   // integer 0–9: after this many automatic sign flips, the learner picks the sign
                        // of a term moved across the =. Omit to always flip it for them.
  compareWith?: string; // expand / simplify only: what the learner suspects it equals ("x^2 + 9"), same grammar,
                        // no "=". The finished reply answers yes or no and says what differs, with numbers.
  title?: string;       // ≤ 60 chars; default "Solve …" / "Expand …" / "Factor …" / "Simplify …"
};
```

Expression grammar: whole numbers 0–9999, single-letter variables, implicit multiplication (`3x`, `2(x+1)`),
`+ - * / ( ) ^`, whole-number powers only, and `− · × ÷ ² ³` as aliases. **No decimals** (write fractions,
`(x + 1)/2`), no negative numbers inside products (`2(−3)`), at most one `=`.

Goal rules (enforced):

- `isolate`: needs `=`; the expression may contain **only** the letter in `variable`; it must be linear with
  exactly one solution; it must not already be solved (`x = 4`).
- `equivalent`: needs `=`, and the two sides must really be equal (a false identity is rejected). To test a
  suspected identity ("is (x + 3)² the same as x² + 9?"), send
  `{ "expression": "(x + 3)^2", "goal": "expand", "compareWith": "x^2 + 9" }`.
- `factor`: **no** `=`; factoring takes out a numeric common factor only (`6x + 9` → `3(2x + 3)`), not `x`,
  not trinomials.
- `expand` / `simplify`: with or without `=`; done when no brackets or like terms remain.
- **Any goal already met at the start is rejected** (an expanded expression to expand, `x = 4` to isolate).
- `variable` must be one letter and `fadeAfter` an integer 0–9; anything else is rejected, not defaulted.

`fadeAfter`: omit it for a learner meeting sign changes for the first time, 1–2 for practice, 0 when the
learner says they know the rule and want to be tested on it.

**Minimal example:**

```openui lifecycle=ephemeral id=solve-4x-3-2x-11
root = LearningSurface([reply])
reply = EquationWorkbench("Solve 4x + 3 = 2x + 11", {"expression": "4x + 3 = 2x + 11", "goal": "isolate", "fadeAfter": 1})
```
