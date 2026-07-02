# P2P Desktop (Electron + Hypercore) — Plan

Goal: ship a **desktop Electron app** for Keating whose lesson/session/quiz data
syncs **peer-to-peer** between a user's devices, with a **cloud node acting as an
always-on seeder** so data is available when no two devices are online at once.

## Why Electron (not the browser)

The browser cannot open raw TCP/UDP sockets, so Hyperswarm's DHT and UDP
hole-punching don't work there — you'd be forced into WebRTC + a signaling
server or a WebSocket relay. **Electron's main process is full Node.js**, so
`hyperswarm` works natively: real DHT, real hole-punching, no signaling server.

All P2P / Hypercore code therefore lives in the **main process** (Node), never
the renderer. The renderer (the existing `web/` React UI) stays sandboxed and
talks to the main process over a `contextBridge` IPC surface.

## Storage model decision: seeder, not cloud-as-disk

Two readings of "cloud storage as backing store" were considered:

- **(A) Cloud as the disk under one peer** — Hypercore's `random-access-*`
  writes blocks into cloud object storage. Rejected: Hypercore is an
  append-only log needing cheap random reads; S3-style per-op latency/cost makes
  this sluggish for hot data.
- **(B) Cloud as an always-on super-peer / pinning node** — a headless Node
  process that joins the same swarm topics and replicates+persists every core.
  **Chosen.** Idiomatic, doesn't bend Hypercore's storage model, and gives
  availability without a central authority.

Local disk (`app.getPath('userData')`) is each device's primary store via
`random-access-file`. The cloud seeder is just another peer that never sleeps.

## Synced data layer: Hyperbee

Keating data is structured documents (lessons, sessions, quizzes), so we layer
**Hyperbee** (a B-tree KV/db on top of Hypercore) over the raw cores rather than
using raw Hypercore append logs. Hyperbee maps cleanly onto the existing
`StorageBackend` interface (`get`/`set`/`delete`/`keys`/prefix scans).

- **v1: single-writer per device.** Each device owns one writable Hyperbee; it
  reads others read-only. Simple, no conflict resolution.
- **Extension point: Autobase** for true multi-writer (multiple devices writing
  the same logical store, linearized). Documented as a TODO seam in `store.ts`;
  not built in v1.

## Component map

```
┌─ desktop/ (Electron) ───────────────────────────────────────────┐
│  renderer  = web/ build (React, sandboxed)                       │
│      │  window.keatingP2P  (contextBridge, preload.ts)           │
│      ▼  ipcRenderer ⇄ ipcMain  (typed channels, ipc.ts)          │
│  main process (Node)                                             │
│      └─ uses packages/p2p-core ───────────────┐                 │
└───────────────────────────────────────────────┼─────────────────┘
                                                 │ same swarm topic
┌─ cloud seeder (headless Node) ─────────────────┼─────────────────┐
│      └─ uses packages/p2p-core  (seeder.ts)    ▼                 │
│         pins + persists every core, 24/7                        │
└──────────────────────────────────────────────────────────────────┘

packages/p2p-core (Node, shared by main process AND seeder)
  ├─ swarm.ts            join/leave swarm topics, peer lifecycle, replication
  ├─ store.ts            Hyperbee-backed KV store (P2PStore) + Autobase seam
  ├─ storage-adapter.ts  P2PStore  →  StorageBackend  (multi-store over one bee)
  ├─ rpc.ts              IPC method contract (mirrors browser-agent-runtime/rpc.ts)
  ├─ seeder.ts           headless always-on peer entry point
  └─ types.ts            config + key types
```

## Renderer integration

`web/src/lib/p2p-storage-backend.ts` implements `StorageBackend` by calling
`window.keatingP2P.*` (the preload bridge). The React app picks a backend at
startup: `window.keatingP2P` present → `P2PStorageBackend`, else the existing
`IndexedDBStorageBackend`. No UI code changes.

## Security boundary

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Preload exposes a **narrow, typed** API only — no `ipcRenderer` passthrough.
- Main validates every IPC payload against the `rpc.ts` contract.
- Swarm topics are derived from a per-user secret (keypair), not guessable
  strings — only a user's own devices + their seeder join the topic.

## Build / wiring

- `packages/p2p-core` and `desktop` are workspace packages (Bun workspaces).
- `desktop` main/preload compiled with `tsc`; renderer is the existing
  `web/dist` build, loaded via `loadFile` in production / dev server URL in dev.
- Packaging via `electron-builder` (config stub included; not run in v1 scaffold).

## Status

Scaffolded with `TODO(crush)` markers for the implementation bodies
(replication wiring, Hyperbee plumbing, seeder reconnection, IPC handlers).
See `packages/p2p-core/CRUSH_SPEC.md` for the fill-in contract.
