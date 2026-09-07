# Flue 2.0.3 host spike

This is an actual standalone Node-target Flue application. It follows the
official 2.0 conventions:

- `vite.config.ts` installs `flue()` from `@flue/vite`.
- `src/app.ts` is the explicit Hono route map.
- `KeatingTeacher` is an exported capitalized function in a module beginning
  with `'use agent'`; it is not returned by a factory.
- `createAgentRouter(KeatingTeacher)` exposes the conversation protocol.
- the host registers Pi's public faux provider and ships no built-in network
  providers, making the integration deterministic and credential-free.

The agent mounts one deterministic teaching tool, one inline skill, one
subagent, one persistent-state value, and an optional host-configured MCP
connection. Merely importing or building the agent does not open that
connection. A host adapter supplies its endpoint and per-request auth resolver;
the agent fixes the exposed surface to the allowlisted read-only
`read_learning_record` tool.

The built Node host reads `KEATING_LEARNING_RECORDS_MCP_URL` when rendering the
agent and re-reads `KEATING_LEARNING_RECORDS_MCP_TOKEN` inside the auth resolver
for every transport request. With no URL, the connection is absent and the
host performs no MCP I/O. A deployment can replace this environment adapter
with another secret/config source without changing the agent's MCP contract.

The integration tests start Flue's real Node runtime and prove two paths:

1. A scripted teaching-tool call updates persistent state, and a later dispatch
   observes that state.
2. One dispatched turn activates the inline skill, discovers and executes the
   allowlisted tool on a real local Streamable HTTP MCP server, delegates a
   lesson critique through Flue's framework-owned `task` tool, receives the
   detached child's final answer, and resumes the parent.

The MCP fixture binds only to `127.0.0.1`, advertises an additional destructive
sentinel that must be filtered out, and requires an ephemeral bearer token. The
test proves the auth resolver ran for every observed request, every peer was
loopback, the mutation sentinel never entered the model tool list or ran, and
the credential never entered any captured model context. The child also proves
Flue's isolation boundary: it inherits the model but not the parent's MCP tool.

## Verification

```sh
bun install
bun run typecheck
bun run build
bun run test
bun run test:contracts
```

The production build should emit `dist/server.mjs` and `dist/app.mjs`. Run the
built host with `node dist/server.mjs`; its mounted agent route is
`/agents/keating-teacher/:id` and its health route is `/health`.

Official contracts inspected for this spike:

- <https://flueframework.com/docs/guide/getting-started/>
- <https://flueframework.com/docs/guide/routing/>
- <https://flueframework.com/docs/reference/agent-api/>
- <https://flueframework.com/docs/reference/provider-api/>
- <https://flueframework.com/docs/guide/agent-hooks/>
- <https://flueframework.com/docs/guide/mcp/>
- <https://flueframework.com/docs/guide/skills/>
- <https://flueframework.com/docs/guide/subagents/>

## NodePod execution evidence

Run `bun install --frozen-lockfile` in this directory and install the test browser
with `bunx playwright install chromium`. From the repository root, use
`devenv tasks run keating:test-flue-nodepod`. An existing Chrome binary can be
selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome`.

These tests launch real Chromium with COOP/COEP, boot NodePod 1.8.2, mount a
Node-targeted bundle, and execute it in a NodePod worker. Browser network requests
are restricted to the local fixture server. Model responses use the existing
local faux provider; no account or paid provider credentials are used.

The September 6 integration checks now prove:

- Keating's portable hook runtime executes and retains state across renders.
- The official Flue 2.0.3 runtime dispatches, executes a teaching tool, and reads
  reconciled learner state on a second dispatch inside NodePod.
- Stopping and reopening the official runtime against the same NodePod file
  preserves that state for another dispatch. The test requires this result;
  unsupported SQLite startup is a failure, with no environment-variable bypass.
- The separate Node host tests cover skill activation, an authenticated
  allowlisted MCP read, and detached subagent completion. Those two capabilities
  have not yet been exercised inside NodePod.

## Custom persistence adapter

`src/nodepod-persistence.ts` supplies Flue's `StartOptions.db` using the official
`@flue/libsql` stores and a custom SQL runner. The engine is sql.js's pure-JavaScript
asm build, so it requires neither `node:sqlite`, a native addon, nor a WASM loader.
It supports submission lifecycle storage, conversation streams, and immutable
attachments through the upstream store implementations.

The runner serializes operations, rolls back failed transactions, and writes an
atomic file snapshot before acknowledging success. An exclusive directory lock
refuses a second owner; this is a single-runtime adapter, not a distributed
multiwriter backend. Closing releases the lock. After an abrupt process death,
verify the owner is gone before removing its stale `.lock` directory. Browser
storage clearing or destroying the NodePod filesystem still loses the database;
the test proves runtime restart within the same pod, not cross-device durability
or recovery after a browser/process crash.

`bun run test:contracts` runs all three upstream Flue store-contract suites and
format-version checks against this engine, plus file reopen, transaction rollback,
and exclusive-owner checks. The suites run under Bun through a narrow Vitest-import
shim; their assertions are unchanged. The canonical `keating:test-flue-host` task
includes these checks. No paid model provider is required.
