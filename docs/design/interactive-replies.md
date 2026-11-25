# Interactive replies: integration design

Ten draggable reply components, built and reviewed as mockups in the main checkout under
`web/.keating-mockups/` (git-excluded), move into the production OpenUI path. Source components:
`/home/diogenes/Projects/experiments/keating/web/.keating-mockups/lanes/<lane>/` (component.tsx, CSS, model/engine
files). Model-facing catalogue: `/home/diogenes/Projects/experiments/keating/web/.keating-mockups/CATALOGUE.md`.

| kind (contract) | OpenUI Lang name | lane dir |
|---|---|---|
| `state-machine` | `StateMachine` | https |
| `construction` | `Construction` | compass |
| `fraction-line` | `FractionLine` | numberline |
| `equation` | `EquationWorkbench` | algebra |
| `permutation` | `PermutationLab` | permutations |
| `linked-model` | `LinkedModel` | linked |
| `sort-board` | `SortBoard` | sortboard |
| `data-explorer` | `DataExplorer` | data |
| `plan-timeline` | `PlanTimeline` | timeline |
| `evidence-board` | `EvidenceBoard` | evidence |

Names avoid the existing `NumberLine` (early learning), `Simulation`, `Diagram`, `StudyPlan` and `Question`
components, which stay as they are.

## Contract (`packages/learner-contracts`)
One generic node type and one action, so the ten components share one validation and journal path.

```ts
// new file: src/interactive-replies.ts
export const INTERACTIVE_KINDS = ["state-machine","construction","fraction-line","equation","permutation",
  "linked-model","sort-board","data-explorer","plan-timeline","evidence-board"] as const;
export type InteractiveKind = typeof INTERACTIVE_KINDS[number];
export const INTERACTIVE_COMPONENT_NAMES: Record<InteractiveKind, string>;   // kind -> OpenUI name (table above)
export interface UiInteractiveNode {
  type: "interactive"; id: string; title: string; kind: InteractiveKind;
  brief?: string;          // markdown framing, bounded
  config: JsonObject;      // component config; structural bounds only here (JSON-safe, <= 48 KB serialised, depth <= 12)
}
export interface UiInteractiveShare { learner: string; data: string; analysis: string } // each bounded (learner/data <= 600, analysis <= 2000)
export function validateInteractiveNode(value): value is UiInteractiveNode;
export function validateInteractiveShare(value): value is UiInteractiveShare;
export function interactiveTextLines(node: UiInteractiveNode): string[];  // mobile/TUI fallback text
```
Semantic config validation (each component's `validateX`) runs in the web renderer, which shows the calm
fallback line on failure. The contract only guarantees bounded, JSON-safe structure.

Action added to `UiAction`:
`{ schemaVersion; type: "share-interactive"; documentId; documentRevision; nodeId; kind: InteractiveKind; share: UiInteractiveShare; idempotencyKey }`
with `ACTION_TYPES`, `ACTION_KEYS` (`[...ACTION_BASE_KEYS,"kind","share"]`), `validateUiAction`
(`validateInteractiveShare`) and `validateUiActionAgainstDocument` (target node is `interactive` and `kind` matches).

OpenUI source compiler (`openui-source.ts`): ten mapper entries. Each component takes the single-object form
`Name({ title, brief?, config })` and positional `Name(title, config, brief?)`. Every one compiles to
`{ type:"interactive", id, title, kind, brief?, config }`. Register in `WEB_OPENUI_COMPONENTS` (rendering.ts), the
parity fixture and `RENDERING_FIXTURE_PACK_VERSION` (bump), `UiDocumentNode`, `validateUiDocumentNode`, index exports.
Mobile (`mobile/src/components/UiDocumentRenderer.tsx`) and TUI (`src/tui/ui/render.ts`) render
`interactiveTextLines`.

## Web
- `web/src/components/interactive-replies/<kind>/`: ported component files. Keep the component code as is.
  Change only imports and the `--mock-*` token layer: `interactive-replies/tokens.css` defines `--mock-ink`,
  `--mock-muted`, `--mock-line`, `--mock-surface`, `--mock-input`, `--mock-accent`, `--mock-ring` and the
  T3-style names the components read (`--foreground`, `--card`, `--border`, `--chart-1..6`, `--warning`,
  `--destructive`, `--success`) from the app's theme tokens (`--ink`, `--paper`, `--line`, `--accent-green`,
  `--amber`, `--series-*`), scoped under `.interactive-reply`. Strip test hooks (`window.keating*`) or gate them
  behind `import.meta.env.DEV`.
- `interactive-replies/registry.ts`: kind -> `{ load: () => import(...), validate }` with React.lazy, so the
  boot chunk does not grow (check the boot-bundle size).
- `InteractiveReplyRenderer.tsx`: validates config with the component's `validateX`, renders inside the
  existing lesson frame vocabulary (one card), maps `onShare(summary)` to
  `onAction({ intent: { type:"share-interactive", nodeId, kind, share:{learner, data, analysis: summary.reply} }, humanFriendlyMessage: summary.learner })`.
  Shows the "Shared" receipt state like `ManipulativeFrame`.
- `shared-renderer.tsx`: `node.type === "interactive"` branch. Also `session-materials.ts`, `openui/preview.ts`,
  `components/OpenUIPreview.tsx` icon map.
- `library.tsx`: ten `defineComponent`s with zod props `{ title: z.string(), config: z.record(z.string(), z.unknown()), brief: z.string().optional() }`.
  Descriptions are short. Add them to `learningBlock` and a new "Interactive replies" component group.
  The base prompt gets a compact guide: the selection policy from CATALOGUE.md plus one line per component (what
  it is for, when not to use it).
- **Per-turn schema injection.** The full schema for a component (its CATALOGUE.md section, kept as
  `interactive-replies/catalogue/<kind>.md`, imported `?raw`) goes into the turn directive only when
  `recommendInteraction` picks that component. This keeps the base prompt small (the full catalogue is about 17k tokens).
- `interaction-affordances.ts`: rows for the ten components keyed on existing features
  (`ordered_procedure` -> sort-board/plan-timeline, `variable_relationship` -> linked-model, `category_distinction` -> sort-board,
  `structure_relations` -> state-machine/evidence-board, and so on). Add new features only where none fit, e.g.
  `symbolic_manipulation`, `geometric_construction`, `data_grouping`, `plan_revision`, `source_evaluation`. Keep `practice` gates
  so prose stays the default.
- `learner-response.ts`: review (`learner`, `data`) and an instruction for `share-interactive`: "The learner
  shared a result from <component>. Respond to what they actually did (data). The component's own analysis is
  advisory: confirm or correct it, and don't repeat it verbatim."

## Gates
- `gitnexus impact` before editing shared symbols (validateUiDocumentNode, validateUiAction, UiAction,
  recommendInteraction, SharedNode); `detect-changes` before commit (index this worktree, `--repo "$PWD"`).
- `cd packages/learner-contracts && bun test test/`; `cd web && bun run typecheck && env -u LD_LIBRARY_PATH bun test`;
  `cd web && bun run build`; boot chunk size compared with main.
- A web test renders every kind from its presets through `SharedUiDocumentRenderer` with zero errors, and
  round-trips a `share-interactive` action through `dispatchSharedUiAction` and `createOpenUIActionLearnerResponse`.

## Contract changes (IR1)
No shape in the Contract section changed. These are additions and clarifications:
- Extra exports from `interactive-replies.ts`: `INTERACTIVE_COMPONENTS` (OpenUI names in kind order),
  `INTERACTIVE_TITLES` (kind -> learner-facing name, e.g. "Sort board"), `INTERACTIVE_LIMITS`, `isInteractiveKind`,
  `interactiveKindForComponent(name)`, `isInteractiveConfig(value)`, and the `JsonValue` / `JsonObject` types.
- `UiInteractiveShare`: `learner` and `data` must be non-blank; `analysis` may be `""`. Map an empty `summary.reply` to `""`.
  Limits are UTF-16 lengths: learner/data <= 600, analysis <= 2000. Clip before dispatch; an over-limit share fails validation.
- `config` limits: plain objects and arrays only; finite numbers; no functions, `undefined`, class instances, accessors,
  sparse arrays, symbol keys or `__proto__`/`constructor`/`prototype` keys. Depth counts the config itself as level 1,
  so at most 12 nested containers. Size is the UTF-8 bytes of `JSON.stringify(config)`, at most 49,152.
- The object form also accepts an optional `id`; a missing `title` falls back to `INTERACTIVE_TITLES[kind]`.
- `interactiveTextLines` omits `brief` and any "open on web" pointer; each surface adds both in its own style.
- `INTERACTIVE_REPLY_CONFIG_FIXTURE` (exported via `rendering.ts`) holds the smallest valid preset per kind from the
  web `presets`. The source and JSON parity fixtures use it, so web parity tests get configs that pass `validateX`.
  If a preset's shape changes in a port, refresh this fixture.
- `RENDERING_FIXTURE_PACK_VERSION` is now 8; `UI_DOCUMENT_NODE_TYPES` includes `"interactive"`.
- Helper lists: `openui-diagnostic-turn.ts` knows `interactive` plus the ten aliases; `activity-learning.ts` counts the node
  as `practice`; `background-activity-guidance.ts` maps the ten components to `practice`, except `LinkedModel` -> `simulation`.
