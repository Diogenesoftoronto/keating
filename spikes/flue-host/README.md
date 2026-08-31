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
