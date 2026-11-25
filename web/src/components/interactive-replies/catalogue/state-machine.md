<!-- Model-facing schema for `StateMachine`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/CATALOGUE.md (ids renamed to OpenUI names). -->

## `StateMachine` (kind `state-machine`): build, trace or fix a state machine

Write it in an openui fence as `StateMachine(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values; quoted or bare keys both parse), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Teaches:** a process as states joined by events. Three modes:

- **build**: the states are on the canvas. The learner drags one state onto another to draw an arrow (onto
  its own loop spot for a self-loop), then drops an event token from the shelf onto the arrow. "Run and
  check" compares the machine with the answer (right / wrong destination / extra / missing / unlabelled) and
  replays the traces on the graph.
- **trace**: the answer machine is drawn. For each input symbol the learner drags the marker along the arrow
  it takes, or presses "No X arrow" when the input gets stuck. A first slip gets a hint, a second names the
  answer and quotes the transition's `why`.
- **fix**: a machine with a planted mistake (`given`) is drawn. The learner edits arrows and labels, then
  "Run the inputs" shows which input fails and where it leaves the answer.

**Choose it for:** "What actually happens when I click an HTTPS link?" (build), "How does the TCP three-way
handshake work?" (build), "Walk me through a vending machine taking coins" (trace), "Which strings does
`ab*c` accept?" (trace or fix), "My traffic-light controller is wrong somewhere, can you help me find it?"
(fix), "How does a turnstile work as a state machine?", "What does a DFA for even numbers of 1s look like?"

**Not for:** "What does HTTPS stand for?" or "What is a finite automaton?" (prose). A fixed sequence with no
branching (`SortBoard` sequence). A system with more than 8 states or continuous quantities (`LinkedModel`, or
prose). Counting or probability over transitions (Markov chains with probabilities): prose.

**Config** (`StateMachineConfig`):

```ts
type StateMachineConfig = {
  title: string;                       // 1–90 chars
  mode: "build" | "trace" | "fix";
  states: MachineState[];              // 2–8; exactly one kind "start"
  events: MachineEvent[];              // 1–8
  answer: MachineTransition[];         // the correct machine, 1–24 transitions
  given?: MachineTransition[];         // build: correct arrows drawn in advance and locked (a strict subset of answer)
                                       // fix: the machine as shown, with the mistake (required in fix)
                                       // trace: ignored (the machine shown is `answer`)
  traces?: MachineTrace[];             // ≤ 6 inputs to run
  takeaway?: string;                   // ≤ 320 chars: what Keating says when the learner gets it right
};
type MachineState = { id: string;      // /^[A-Za-z][A-Za-z0-9_-]{0,23}$/, unique, not "stuck"
                      label: string;   // 1–28 chars
                      kind?: "start" | "goal" | "error";
                      icon?: MachineIcon };
type MachineIcon = "link" | "search" | "pin" | "lock" | "unlock" | "hourglass" | "file" | "coin" | "cup" | "check"
  | "x" | "send" | "inbox" | "power" | "play" | "flag" | "alert" | "dot" | "handshake" | "server";
type MachineEvent = { id: string;      // same id rule, unique
                      label: string }; // 1–22 chars
type MachineTransition = { event: string; from: string; to: string;   // existing ids
                           why?: string };                            // ≤ 260 chars, quoted in feedback
type MachineTrace = { input: string[];   // 1–12 event ids
                      expect: string;    // the state id the ANSWER machine ends in, or "stuck"
                      label?: string;    // ≤ 40 chars; default: the event labels joined by spaces
                      note?: string };   // ≤ 260 chars, said when this input finishes
```

Rules (all enforced by `validateStateMachine`; the science checker runs your answer machine):

- **Deterministic:** each (state, event) pair has at most one transition, in `answer` and in `given`.
- **A missing arrow means reject:** an input with no matching arrow ends `"stuck"`. You may leave dead
  states out. Self-loops (`from === to`) are allowed.
- Every trace's `expect` must be where the **answer** machine really ends. Work each trace through by hand.
- Every state must be reachable from the start in `answer`.
- `kind` is one value per state. `goal` draws a double outline and is placed last; mark accepting states
  of an automaton as `goal` (several may be). A start state that is also accepting can't be both kinds:
  keep `kind: "start"` and write "(accept)" in its label. In build mode with no traces, Check replays the
  shortest start → goal path.
- A trace that ends `"stuck"` on one machine and at a state on the other counts as ending somewhere else.
- State ids and event ids are separate namespaces, but keeping them different reads better.
- There are no counters or variables: "three tries, then lock out" needs one state per try, and the 8-state
  cap rules out anything longer. Icons are optional; leave `icon` off rather than pick one that misleads.
- Dense machines get crowded at phone width: at 320 px a 6-state, 12-transition machine already has chips
  over arrows. Keep it to about 10 transitions, leave out arrows the lesson doesn't need (a missing arrow
  just means "stuck"), and keep state labels short (advice).
- **build:** `given` ⊂ `answer` and leaves at least one arrow to draw; needs a `goal` state or ≥ 1 trace.
  States start in config order (start at the left, goal at the right, the rest in between), so **the order
  of `states` is the initial scramble**: don't list them in the answer's order. The `kind: "start"` and
  `kind: "goal"` states are placed at the ends whatever their position in the list.
- **trace:** needs ≥ 1 trace. Include an input that gets stuck if rejection is part of the lesson.
- **fix:** `given` is required, differs from `answer` in 1–4 transitions, and at least one trace must end
  somewhere else on `given` than on `answer`, or the mistake can't be found. Transitions are compared as
  whole (from, event, to) triples, so one arrow with the wrong destination counts as **2** (one missing, one
  extra): at most two such planted mistakes. States may be unreachable on `given` (only `answer` must reach
  every state). `why` on `given` arrows is ignored; feedback quotes the answer's `why`.

**Minimal example** (trace):

```openui lifecycle=ephemeral id=push-through-the-turnstile
root = LearningSurface([reply])
reply = StateMachine("Push through the turnstile", {"title": "Push through the turnstile", "mode": "trace", "states": [{"id": "locked", "label": "Locked", "kind": "start", "icon": "lock"}, {"id": "open", "label": "Unlocked", "icon": "unlock"}], "events": [{"id": "coin", "label": "Coin"}, {"id": "push", "label": "Push"}], "answer": [{"event": "coin", "from": "locked", "to": "open", "why": "A coin releases the lock."}, {"event": "push", "from": "open", "to": "locked", "why": "Pushing through locks it again behind you."}, {"event": "push", "from": "locked", "to": "locked", "why": "Pushing a locked turnstile does nothing."}, {"event": "coin", "from": "open", "to": "open", "why": "An extra coin is just kept."}], "traces": [{"input": ["coin", "push"], "expect": "locked"}, {"input": ["push", "coin", "coin"], "expect": "open", "note": "The second coin was wasted."}]})
```
