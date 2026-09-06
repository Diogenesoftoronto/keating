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

The September 6 integration result is deliberately split:

- Keating's portable hook runtime executes and retains state across renders in
  NodePod. This is `@keating/agent-runtime`, not the official Flue host.
- The official Flue 2.0.3 host loads but its default startup fails with
  `Failed to initialize persistence ... node:sqlite is not supported in the browser environment`.
  The regression test asserts this exact boundary. It does **not** count as proof
  that official Flue dispatch works in NodePod.
- The same official host passes real Node tests for dispatch, tool reconciliation,
  repeated learner turns, skill activation, an authenticated allowlisted MCP read,
  and detached subagent completion.

To demand actual official-host execution, run
`FLUE_NODEPOD_REQUIRE_HOST=1 devenv tasks run keating:test-flue-nodepod`.
That acceptance probe currently fails at SQLite startup. It requires successful
dispatch, a tool call, and persisted state observed on a second dispatch before
it can pass. No skipped assertions or mocked NodePod satisfy that probe.

Flue exposes `StartOptions.db: PersistenceAdapter`. The next implementation step
is a NodePod-compatible adapter providing submission lifecycle storage,
conversation streams, and immutable attachments. It must uphold Flue's format
version, admission/lease, and settlement contracts. The presence of in-memory
conversation and attachment helpers alone does not provide the required
submission store. A custom adapter and its contract tests are still needed;
process restart durability, MCP, and subagents inside NodePod remain unverified.
