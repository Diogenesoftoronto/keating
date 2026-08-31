# Keating on Flue spike

This is an isolated integration spike, not a production migration. It exercises three seams:

1. Keating's existing provider-neutral `AgentSandbox` can satisfy Flue's `SandboxFactory` contract.
2. A Keating Flue agent can declare skills, specialist subagents, optional account MCP tools,
   persistent state, and model-facing evolution tools in one authoring interface.
3. The portable evolution document treats prompts, self-evolution code, MAP-Elites parameters,
   weights, and attributable learner performance as one versioned unit.

The important boundary is deliberate: Flue 2's runtime is currently a Node/Cloudflare-style host,
not a proven browser or React Native runtime. Browser-local Keating therefore keeps executing through
`@keating/browser-agent-runtime`; the adapter lets the same sandbox abstraction mount under Flue where
Flue is available. A signed-in account moves versioned evolution documents and evidence through Not
Organic, never raw credentials. Mobile can request any conforming remote sandbox/microVM provider;
Cloudflare is one adapter, not the architecture.

The agent factory is typechecked authoring code, not yet a built or dispatched Flue application.
Flue discovers exported agent modules at build time, so the next vertical slice must turn dependency
injection into a build-discoverable exported agent, run it through `@flue/vite`, and dispatch one
deterministic conversation. Until then, the verified claims are the adapter/state contracts and the
separate browser SDK bundle—not end-to-end hosted execution.

Run:

```sh
bun install
bun run typecheck
bun test
```
