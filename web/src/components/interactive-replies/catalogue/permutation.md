<!-- Model-facing schema for `PermutationLab`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/CATALOGUE.md (ids renamed to OpenUI names). -->

## `PermutationLab` (kind `permutation`): the permutation lab

Write it in an openui fence as `PermutationLab(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values; quoted or bare keys both parse), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Teaches:** a permutation as a rule on places. Tiles show the arrangement, strands show where each place
goes, and cycle notation and parity update live. Three goals: **compose** (stack two rules, swap their
order by dragging, see whether the bottom rows agree), **sort** (swap tiles back into order in the fewest
swaps; the cycles shown as rings explain the minimum), **order** (apply one rule again and again; with
`predict` the learner first drags a flag along a repeat ruler to guess how many times until everything is
back; the ruler is longer than the answer, so it gives nothing away).

**Choose it for:** "Why does the order matter when I compose two permutations?", "What is the fewest number
of swaps to sort this?", "How many times do I repeat this shuffle before the deck is back?", "Why is a
5-cycle's order 5?", "What does odd or even permutation mean, can I see it?", "If every week everyone moves
two seats left, when are they back?"

**Not for:** counting arrangements (nPr, nCr): that is a formula question, use prose. Putting real-world
steps in order (`SortBoard` sequence). "Define a permutation" (prose).

**Config** (`PermutationLabConfig`):

```ts
type PermutationLabConfig = {
  title: string;              // heading
  items: string[];            // 2 to 8 distinct labels, each 1–12 chars, in start order (place 1, 2, …)
  place?: string;             // word for a place: "seat", "slot"; default "place"
  matrix?: boolean;           // also show the permutation matrix; default false
  goal:
    | { kind: "compose"; first: string[]; second: string[]; firstName?: string; secondName?: string }
    | { kind: "sort"; scrambled: string[] }
    | { kind: "order"; rule: string[]; ruleName?: string; step?: string; predict?: boolean };
};
```

**How a rule is written:** as the row you get by applying it once to `items` (always against `items`, never
against another rule's result). Every rule row lists every
item exactly once. With `items: ["A","B","C"]`, `rule: ["C","A","B"]` means place 1 now holds C, place 2
holds A, place 3 holds B. In `compose`, `first` acts first and `second` then acts on the result; the lab shows both orders, so you
don't need to pick the "interesting" one. Names (`firstName`, `secondName`, `ruleName`) are 1–3 chars (any
Unicode, e.g. ρ), default σ and τ;
the two compose names must differ. `step` is the noun for one application ("shuffle", "week"); `predict:
true` asks the learner to guess the order first. `sort.scrambled` must not already be in order; an
`order.rule` must not leave everything in place. Pick `place` to match the story ("seat", "slot") and a
singular `step` noun ("week", "riffle"); both are pluralised for you. For "order matters", pick two compose
rules whose cycles overlap: a commuting pair still works, but the lab then explains why they agree. Use
`matrix: true` only when the question is about matrices (it adds height).

**Minimal example:**

```openui lifecycle=ephemeral id=how-many-turns-until-the-wheel-is-back
root = LearningSurface([reply])
reply = PermutationLab("How many turns until the wheel is back?", {"title": "How many turns until the wheel is back?", "items": ["A", "B", "C", "D"], "goal": {"kind": "order", "rule": ["D", "A", "B", "C"], "step": "turn", "predict": true}})
```
