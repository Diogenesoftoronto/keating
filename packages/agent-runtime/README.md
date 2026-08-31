# `@keating/agent-runtime`

Environment-neutral agent authoring contracts and a synchronous render-frame collector for Keating.

This package is intentionally not an agent harness. It imports neither Flue nor Pi, performs no model or network work, opens no MCP connection, provisions no sandbox, and executes no tool or lifecycle callback. A browser renderer or hosted Flue adapter consumes the collected frame and owns those effects.

## Why it exists

Flue 2 provides the high-level interface Keating wants on hosted Node runtimes, but its published runtime is not browser-executable. Keating still requires a complete client-side browser agent. This package defines the portable subset once so the same authored agent can be rendered by:

- the real Flue runtime through a hosted adapter;
- the current browser `pi-agent-core` loop and NodePod through a browser adapter;
- test and deterministic evaluation harnesses.

React Native consumes hosted conversations and declarative revisions; this package does not make arbitrary evolved JavaScript safe to execute inside a mobile app.

## Example

```ts
import {
  PortableAgentInstance,
  useInstruction,
  useMcpConnection,
  useModel,
  usePersistentState,
  useSandbox,
  useSkill,
  useSubagent,
  useTool,
} from "@keating/agent-runtime";

function Reviewer() {
  useModel("notorganic/balanced");
  return "Review the candidate against the learner evidence.";
}

let evolutionEnabled = false;

function Teacher() {
  useModel("notorganic/balanced");
  const [revision] = usePersistentState("revision", 1);

  // Keep the call in every render. Toggle presence through enabled.
  useTool(evolveTool, { enabled: evolutionEnabled });
  useSkill(evolutionSkill, { enabled: evolutionEnabled });
  useSubagent({
    name: "reviewer",
    description: "Reviews a candidate before activation.",
    agent: Reviewer,
  }, { enabled: evolutionEnabled });
  useMcpConnection({
    name: "learner-evidence",
    transport: "streamable-http",
    endpoint: "https://api.notorganic.info/mcp",
    tools: ["evidence_read"],
    authRef: "notorganic:mcp/learner-read",
  }, { enabled: evolutionEnabled });
  useSandbox(evolutionEnabled ? runnerFactory : null, { slot: "evolution" });
  useInstruction(`Active pedagogy revision: ${revision}.`, { slot: "revision" });

  return "Teach through diagnosis, retrieval, and verified transfer.";
}

const instance = new PortableAgentInstance({ id: "conversation-1" });
const frame = instance.render(Teacher);
```

## Portable semantics

### Synchronous render

An agent function must return `string | undefined` synchronously. Async work belongs in a tool, sandbox/resource factory, or lifecycle callback. Hooks called outside a render and nested/concurrent renders fail.

### Strict topology, dynamic presence

The first successful render pins the ordered `(hook kind, stable key)` topology. Later renders must make the same calls in the same order. A conditional hook call is rejected even when the resulting active resource set would appear equivalent.

Dynamic resources remain possible through stable calls:

- `useTool(definition, { enabled })`;
- `useSkill(definition, { enabled })`;
- `useSubagent(definition, { enabled })`;
- `useMcpConnection(definition, { enabled })`;
- `useSandbox(factoryOrNull, { enabled, slot })`;
- `useInstruction(text, { enabled, slot })`;
- lifecycle hooks with `{ enabled, slot }`.

Each completed frame reports deterministic `added`, `removed`, and `changed` resource entries. Supply a resource `revision` when a still-active definition changes semantically. A newly activated executable source revision should receive a new `PortableAgentInstance`; changing a live conversation's hook topology is not supported.

### Persistent state

`usePersistentState` accepts JSON-compatible plain data only. Defaults are staged and commit only after the complete render passes topology validation. Setters use copy-in/copy-out values and become valid only after their render commits. Updates are visible on the next render.

`MemoryStateStore` is the deterministic default. Hosted and browser adapters may supply their own synchronous store, but account-global pedagogy state and MAP-Elites archives do not belong in per-conversation hook state.

### Data writers

`useDataWriter` creates a named JSON writer. Emissions are cloned and sent to the instance's `onData` callback. Writers cannot emit during render or from a failed frame. The adapter decides how a data event maps to OpenUI, a Flue data part, persistence, or transport.

### MCP declarations

`useMcpConnection` collects metadata only: name, description, transport, endpoint, tool allowlist, opaque `authRef`, and revision. Unknown fields are rejected so callers cannot smuggle headers, bearer tokens, cookies, or private keys through this portable contract. The hosted/browser adapter resolves `authRef` and owns the actual connection and authorization policy.

### Sandboxes

The `PortableSandbox`/`PortableSandboxFactory` shape matches the common filesystem and shell surface needed by a Flue adapter without importing Flue. Checkpoints, capabilities, runner selection, attestations, cancellation, and disposal remain in Keating's richer provider-neutral runner layer.

## Deliberate gaps from Flue

- Flue permits conditional resource hook calls; this collector requires stable calls with `enabled` toggles.
- It does not scan `'use agent'` modules or assign deployment identities.
- It does not execute model turns, compact context, retry work, or provide durable submissions.
- It does not connect MCP servers or discover workspace skills.
- It does not provision or destroy sandboxes.
- It does not execute tools, subagents, data transport, or lifecycle callbacks.
- It does not implement a conversation stream, routing, `dispatch`, `initialData`, or delivery cursors yet.
- It does not replace Not Organic account authentication, DPoP authorization, artifact sync, or evolution-job state.

Those are adapter/host responsibilities. Keeping them outside this package is what makes its source safe to import in a browser bundle.

## Verification

```sh
bun run test
bun run typecheck
```

The focused suite checks deterministic collection, strict topology, dynamic presence diffs, state commit/clone behavior, lifecycle registration, MCP credential rejection, and absence of Node, Flue, and Pi imports from package source.
