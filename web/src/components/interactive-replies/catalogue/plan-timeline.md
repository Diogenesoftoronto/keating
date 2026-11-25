<!-- Model-facing schema for `PlanTimeline`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/CATALOGUE.md (ids renamed to OpenUI names). -->

## `PlanTimeline` (kind `plan-timeline`): a plan on a day grid

Write it in an openui fence as `PlanTimeline(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values; quoted or bare keys both parse), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Teaches:** planning with dependencies, capacity and a deadline. Tasks are bars on a day grid. The learner
drags a bar to move it or its edge to change its length; moving a task later pushes its dependents later
(push, don't pull); a pushed task hops over the lost day; fixed tasks and exams never move, so a push into
one becomes a visible conflict. Pushes don't level hours: a day over capacity just turns amber. The
**critical path** is the dependency chain of least float (real `dependsOn` links with no free day between)
ending at a fixed task, the exam, the deadline or the end of the plan. **Slack** is capacity-aware: how many
days a task can move later before anything new goes wrong. An optional Keating proposal is drawn over the
plan and can be applied, tweaked or dismissed. For a study plan the share reply suggests where the plan can
give in a study-aware order (a review first, then practice, new material last).

**Choose it for:** "I lost Wednesday to a shift, can you move my study plan?", "Help me plan my thesis
chapters before the hand-in", "Can I fit spaced reviews before my test?", "Our group poster is due in two
weeks, who does what when?", "If the lab results come late, what slips?"

**Not for:** recalling the order of steps in a process (`SortBoard` sequence). General study advice ("how
should I revise?", prose). Plans longer than 21 days (summarise in prose, or zoom into the next 3 weeks).
Time-management feelings ("I'm overwhelmed", prose).

**Config** (`PlanTimelineConfig`):

```ts
type PlanTimelineConfig = {
  title: string;
  startDate?: string;          // "YYYY-MM-DD" for day 0; without it days are numbered and dates can't be used
  horizon: number;             // integer, 5–21 days shown
  capacityPerDay: number;      // hours available per day, > 0 and ≤ 16
  today?: number | string;     // day index or date, inside the horizon; earlier days are shaded and tasks
                               // that started before today are locked
  deadline?: number | string;  // everything must finish before this day starts; 1..horizon
  deadlineLabel?: string;      // "hand-in", "exam"
  tasks: PlanTask[];           // 2–16
  proposal?: { rationale: string; moves: PlanMove[] };   // rationale ≤ 280 chars, ≥ 1 move
  disruption?: { day: number | string; label: string };  // a lost day; label ≤ 24 chars
  kindNames?: Partial<Record<TaskKind, string>>;         // rename kinds in the legend: { study: "research" }
};
type TaskKind = "study" | "review" | "practice" | "exam" | "fixed";
type PlanTask = {
  id: string;                  // unique, non-empty
  title: string;               // 1–40 chars
  start: number | string;      // day index (always fine), or a date when startDate is set
  duration: number;            // whole days ≥ 1; start + duration ≤ horizon
  dependsOn?: string[];        // ids that must finish first; no cycles, no self
  kind: TaskKind;              // exam and fixed never move
  hours?: number;              // hours per day, > 0 and ≤ 16; default study 2, review 1, practice 2, exam 2, fixed 1
};
type PlanMove = { task: string; start?: number | string; duration?: number;
                  hours?: number;             // > 0 and ≤ 16: change the task's hours per day
                  why?: string };             // ≤ 120 chars
```

Rules: days are integers 0..horizon−1 and a task occupies `[start, start + duration)`. `deadline: d` means
the last task must end by the end of day d−1, so for an exam on day 11 either omit `deadline` (the exam is
the anchor) or set it to 12. Fixed tasks may have `dependsOn` (a late prerequisite then shows as a
conflict). Proposal moves are applied in order and each one pushes its dependents later automatically, so
list only the tasks you move on purpose. A move can change `start`, `duration` and `hours`: to spread a
heavy task thinner, lengthen it and lower its hours in the same move
(`{ "task": "essay", "duration": 3, "hours": 2 }`). If you want a critical path to show, the tasks must be
linked with `dependsOn`: back-to-back tasks without links are not a chain. A proposal may not
move an exam, a fixed task, or a task that started before `today`, and each moved slot must lie between
`today` and the horizon. The starting plan may contain conflicts on purpose (that is often the lesson), but
make sure the ones you didn't intend aren't there: a dependent that starts before its prerequisite ends, or
a day whose hours exceed `capacityPerDay`.

**Minimal example:**

```openui lifecycle=ephemeral id=essay-plan
root = LearningSurface([reply])
reply = PlanTimeline("Essay plan", {"title": "Essay plan", "horizon": 7, "capacityPerDay": 3, "deadline": 7, "deadlineLabel": "hand-in", "tasks": [{"id": "read", "title": "Read sources", "kind": "study", "start": 0, "duration": 2}, {"id": "draft", "title": "Write draft", "kind": "practice", "start": 2, "duration": 3, "dependsOn": ["read"]}, {"id": "edit", "title": "Edit", "kind": "review", "start": 5, "duration": 1, "dependsOn": ["draft"]}]})
```
