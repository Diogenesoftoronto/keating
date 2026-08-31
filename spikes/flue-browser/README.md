# Flue browser compatibility spike

This spike tests the current official Flue 2.0.3 packages at the boundary Keating
needs. It deliberately separates two questions that are easy to conflate:

1. Can the browser consume a Flue agent conversation? **Yes.** `@flue/sdk` is a
   fetch-only browser client. `src/browser-client.ts` builds with no transitive
   Node built-ins and calls a request-aware Not Organic authorization adapter
   for every SDK request. That adapter can mint the method/URL-bound DPoP proof.
2. Can the browser execute a Flue agent definition and harness? **No, not with
   the current runtime.** Importing `@flue/runtime` reaches server/runtime
   dependencies and Node built-ins. `@flue/runtime/node` is more explicitly
   Node-only. Agent definitions can be authored, versioned, learned, and synced
   as account artifacts in the browser/mobile app, but execution belongs in a
   replaceable remote runner (Node, Cloudflare Worker, microVM, etc.).

## Run the evidence

```sh
bun install
bun run build
bun run test
```

`bun run test` first builds three independent entries and fails if their
observed boundary changes:

- `src/browser-client.ts` must contain no Node built-ins or Vite browser stubs.
- `src/keating-agent.ts` must remain classified as remote-only.
- `src/node-runtime.ts` must remain classified as remote-only.

The generated HTML application is under `dist/browser-client/`; the supported
SDK library probe bundle is under `dist/probes/src-browser-client/`. Negative
runtime probes stop at the first Node built-in and intentionally emit no bundle.

## Architectural implication for Keating

Keep the learner UI, artifact editor, prompt/policy/MAP-Elites state, candidate
evaluation UI, and Not Organic account session on-device. Treat Flue agent
source, skills, hook configuration, and MCP manifests as versioned account
artifacts that clients can edit and sync. Run model calls, Flue durability,
subagent orchestration, MCP credentials, and sandboxed code execution behind a
provider-neutral runner contract authorized by the Not Organic account.

This is not Cloudflare-specific: Flue documents Node and Cloudflare targets, and
the browser only needs the stable SDK conversation protocol. Any compatible
runner can own the remote half.
