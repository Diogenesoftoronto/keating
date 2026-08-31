# Keating on Flue spike

This is an isolated integration spike, not a production migration. It proves three seams:

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

Run:

```sh
bun install
bun run typecheck
bun test
```
