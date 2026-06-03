# Browser Agent Runtime

Local-first agent sandbox interfaces for browser agents.

The package is intentionally capability-based. A NodePod-backed browser sandbox can do a lot locally: files, commands, package installs, previews, and checkpoint/rollback. It is still not a hard security boundary for hostile code. Operations that need real isolation, native binaries, brokered secrets, or durable remote compute should route to a remote adapter such as Daytona or microsandbox.

## Shape

```ts
import {
  createInMemoryBrowserSandbox,
  createDaytonaCompatSandbox,
  selectSandbox,
  withSandboxTransaction,
} from "@keating/browser-agent-runtime";

const local = createInMemoryBrowserSandbox();
const sandbox = createDaytonaCompatSandbox(local);

await sandbox.fs.uploadFile("console.log('hi')", "workspace/app.js");
const result = await sandbox.process.executeCommand("cat workspace/app.js");
console.log(result.artifacts.stdout);
```

## Relay Mode

A browser tab can host a NodePod sandbox and expose the runtime over any request/response transport:

```ts
const handler = createSandboxRpcHandler(nodepodSandbox);

// Use handler behind a WebSocket, BroadcastChannel, postMessage, or fetch endpoint.
const remoteLookingSandbox = createRpcSandboxClient((request) => handler(request));
```

That makes the browser sandbox look like a remote sandbox to an agent while still executing locally on the user's machine.

## Adapter Plan

- `browser-memory`: deterministic fallback used for tests and offline capability checks.
- `browser-nodepod`: wraps a real `@scelar/nodepod` pod and exposes the same `AgentSandbox` contract.
- `remote-daytona`: a future adapter that forwards calls to Daytona's TypeScript SDK.
- `remote-microsandbox`: a future adapter for server/local-native microVM execution.
