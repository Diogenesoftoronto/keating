# Web storage architecture

Keating uses storage by data lifetime and authority, not by whichever browser API is easiest at a call site.

## The three layers

| Layer | Data | Browser implementation | Other authority |
|---|---|---|---|
| UI bootstrap | Theme, panel dimensions, dismissed hints, pending OAuth handshake | `localStorage` | Never synchronized |
| App records | Sessions, session metadata, provider definitions, provider keys, durable settings | `StorageBackend` over IndexedDB | P2P/Hyperbee today; a server backend must implement the same interface |
| Learning records | Evidence, learner beliefs, goals, reviews, quizzes, generated artifacts | `KeatingStorage` over versioned IndexedDB | Portable export/import until a remote learning-record backend exists |

`localStorage` is not appropriate for conversations, learner records, credentials, artifacts, or anything requiring transactions. It remains useful for tiny values needed before React or IndexedDB hydration, where a stale value is harmless.

## Source-of-truth rules

1. A record has one authoritative backend at a time. Browser and P2P/server stores are not written independently from feature code.
2. Feature code talks to `AppStorage`, `KeatingStorage`, or a domain hook. It does not open IndexedDB directly.
3. Provider keys are keyed by provider identity and reused by its models. A model never owns a duplicate credential.
4. Model discovery is advisory. Failure of `/models` cannot invalidate or prevent saving a provider.
5. Every persisted aggregate carries a schema version or lives in a database with an explicit migration version.

## Versioning and upgrades

The app-record database is `keating` version 2. Its IndexedDB backend declaratively reconciles missing stores and indices during upgrades, closes on `versionchange`, and reports upgrades blocked by an older tab.

The learning-record database is `keating-db` version 7. It writes upgrade metadata to `_meta`, closes stale connections on `versionchange`, and normalizes the learner aggregate to schema version 2. Record normalization is intentionally separate from database layout migration: adding a field does not require destructive store recreation.

Portable data formats keep their own schema versions because their compatibility boundary is independent of either browser database.

## Adding a server backend

A future authenticated server store should implement `StorageBackend` with `kind = "server"` and be selected once during app bootstrap. Call sites must not dual-write IndexedDB and the server. Offline support belongs in that backend as an outbox with idempotent mutations, server revisions, and explicit conflict handling. Provider secrets should be server-encrypted or remain device-local; they must not enter portable learner exports.

## Migration checklist

- Identify the current authority and legacy key/store.
- Add a versioned, idempotent migration before changing readers.
- Copy and validate records, then mark migration completion.
- Keep rollback/read compatibility for one release.
- Remove the legacy copy only after the new authority is confirmed.
- Test upgrade from the previous database version, a blocked multi-tab upgrade, and quota/write failure.
