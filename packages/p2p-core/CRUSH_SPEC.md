# CRUSH fill-in spec — P2P desktop

You are implementing the bodies marked `TODO(crush)` in an already-scaffolded
feature. **Do not change public type signatures, file layout, or the IPC
contract.** Read `docs/p2p-electron-plan.md` first for architecture and the
two locked-in decisions (Option B cloud seeder; Hyperbee single-writer v1).

## Scope (every `TODO(crush)` in these files)

1. `packages/p2p-core/src/swarm.ts`
   - `deriveTopic(userSecret)` → deterministic 32-byte hash, personalized with
     a fixed context string. Pure, deterministic, and Bun-compatible on import.
   - `joinSwarm(topic, replicate)` → real `hyperswarm`: connection→replicate,
     `join(topic,{server:true,client:true})`, `flushed()`, peer-count tracking,
     `onPeerChange`, `destroy`.

2. `packages/p2p-core/src/store.ts`
   - `P2PStore.open` → `corestore` + `hyperbee` (keyEncoding utf-8, valueEncoding
     json) in a namespace derived from `userSecret`; derive topic; join swarm
     wiring `store.replicate(socket)`. Honor `seedOnly` (no writable mutations).
   - `get/set/del/keys/clear/batch/stats/close` against the bee. `keys` uses the
     `${store}\x00${key}` encoding helpers already exported. `set/del/batch`
     throw a clear error when `seedOnly`.

3. `packages/p2p-core/src/storage-adapter.ts`
   - `createP2PStorageBackend(store)` → full `StorageBackendLike`. Map
     `transaction` to buffered reads + one `store.batch` on commit. For
     `getAllFromIndex`, first **grep the web app for actual call sites** of
     `getAllFromIndex`; implement only what's used (likely sort all values in a
     store) — if unused, throw a descriptive "not supported on P2P backend".

4. `packages/p2p-core/src/seeder.ts` — `main()` per its TODO (hex secret parse +
   validate 32 bytes, open seedOnly store, log stats on interval/peer change,
   graceful SIGINT/SIGTERM shutdown, keep alive).

5. `desktop/src/ipc.ts` — `registerP2PIpc` dispatch over `P2P_IPC_CHANNEL` per the
   `rpc.ts` contract; validate params per method; never throw across the
   boundary (wrap in `P2PRpcResponse`); push `peerstats` events.

6. `desktop/src/main.ts` — `loadUserSecret` (persist a crypto-random 32-byte
   secret under `userData`, or read `KEATING_USER_SECRET` hex if set).

7. `desktop/src/preload.ts` — only the inner `call`/`onPeerStats` TODO notes;
   keep the bridge shape.

8. `web/src/lib/p2p-storage-backend.ts` — implement every method via
   `this.bridge.call(...)` per the in-file mapping. Pure renderer code, no Node.

## Invariants — do not break

- Renderer stays sandboxed: no Node APIs in `web/` or `preload` beyond
  `contextBridge`/`ipcRenderer`. No `ipcRenderer` passthrough to the page.
- `web/` must not import from `desktop/` or `@keating/p2p-core` (Node-only).
  The structural `KeatingP2PBridge`/`StorageBackendLike` duplicates stay.
- Keep `StorageBackend` (web/src/types.ts) and `StorageBackendLike`
  (storage-adapter.ts) structurally identical.

## Verify before finishing (all must pass)

```bash
cd packages/p2p-core && bun run typecheck
cd ../../desktop && bun run typecheck
cd ../web && bun x tsc --noEmit -p tsconfig.json   # new files must not regress
```

Add a focused test at `packages/p2p-core/test/store.test.ts` covering
`deriveTopic` determinism and a two-`P2PStore` (memory/temp dir) put→replicate→get
round trip if feasible with `bun test`. Do not edit unrelated files.
