# Account chat sync

Browser chats use the Not Organic account API and its existing Convex database.
No GUN relay, peer URL, or additional service is needed. Browser, native mobile,
and CLI clients share the encrypted record protocol under `shared/account-sync/`.
Courses retain their existing server authority and use a verified account bridge.
General local learning-artifact and sandbox replication is not part of this protocol.

## Data and bandwidth

Messages are compressed when that saves bytes, split into bounded encrypted
records, and referenced by a small encrypted conversation manifest. Appending a
message uploads its new records and the manifest. A rename uploads only the
manifest. Existing message records are reused across edits and forks. Derived
full-text search indexes are rebuilt locally rather than retransmitted.

`GET /v1/sync/records?after=<cursor>&limit=50` returns changes since the device's
durable cursor. The server caps pages at 50 records and 256 KiB. Writes use
`PUT /v1/sync/records/:id` with an expected revision and durable mutation ID.
Convex commits record revisions, account change sequences, and retry receipts
atomically. An uncertain response is retried with the exact original ciphertext
and mutation ID; a revision conflict requires reconciliation.

Saved streaming changes are debounced. Quiet visible tabs reduce polling from
15 seconds to one minute; hidden tabs stop polling. Focus and reconnection
trigger a fresh read. The initial download transfers history once; idle reads
return no chat records. API requests and retained database records still incur
normal provider costs; no monetary savings estimate is implied.

## Privacy and local behavior

The authenticated DPoP principal supplies account and product identity; requests
cannot select another account. AES-GCM authenticates every encrypted record to
the account namespace, record ID, and key ID. Account keys and content-index keys
are non-extractable browser keys. Keyed content IDs prevent cross-account
correlation of identical message chunks. Provider credentials and connection
headers are excluded from chat records.

Each account has its own local checkpoint, pending-write queue, and key store.
The first account connection adopts existing anonymous chats. Switching accounts
does not upload the former account's chats. Signing out stops network sync while
leaving local history available. Concurrent divergent transcripts are preserved
as visible forks instead of silently discarding one device's messages.

Conversation deletions are retained as encrypted tombstones to prevent an old
device from restoring deleted chats. Immutable message chunks are retained for
offline reconciliation and shared forks; this is not immediate secure erasure of
every historical chunk. Provider account erasure includes records, counters, and
retry receipts. Per-conversation garbage collection is not implemented.

The codec limits each decrypted record to 32 KiB, a message to 16 MiB, and a
conversation to 64 MiB. Missing, oversized, or unauthenticated records fail sync
without silently dropping parts of a conversation. Local chats remain usable.

## Rollout and verification

Deploy in this order:

1. Not Organic Convex schema and `chatSync` functions, including erasure indexes.
2. Not Organic gateway routes and Keating-only public-client consent for
   `sync:key:read`, `sync:read`, and `sync:write`.
3. The Keating web build. Existing sessions must reconnect once for these scopes;
   a token refresh cannot silently grant them.

No deployment is performed by the source change. Enabling the new browser
consent before the provider accepts it would prevent authorization, so preserve
that ordering. The new record store uses Convex explicitly, including provider
deployments whose other subsystems select a native backend.

Local tests cover separate IndexedDB stores, encryption, per-record conflicts,
retry identities, cursors, isolation, and transfer shape. Provider tests exercise
signed DPoP requests and transactional Convex behavior. These are distinct from
live acceptance: sign into two independent browser profiles, create/continue/
rename/delete a chat in each direction, disconnect and reconnect one device,
reload both, and verify another account cannot receive the chats. An idle, saved browser conversation refreshes when remote changes arrive.
Streaming or unsaved work waits for local persistence, and navigation fences
prevent a delayed import from replacing a newly opened conversation. This is
saved-history synchronization, not simultaneous collaborative editing.

## Courses and uploads

The course server verifies a client-generated DPoP proof against the configured
Not Organic `/v1/account` endpoint. Only the verified DID becomes the course
account; client-provided IDs cannot select ownership. An opaque, short-lived
HttpOnly cookie (browser) or secure client token (native) authorizes existing
course APIs. Expired linked sessions fail closed rather than falling back to a
new device-local account.

On the first connection, ownership from that device's existing secret local
course cookie is adopted once. An adoption receipt prevents later accounts from
claiming it again. Course revisions, memberships, private submissions and progress
still use their existing server-side authorization and operation IDs.

Set runtime `NOTORGANIC_ISSUER` to the same HTTPS gateway origin as the client.
Keep `KEATING_COURSES_STORAGE_DIR`, `KEATING_COURSE_MATERIALS_STORAGE_DIR` and
`KEATING_SUBMISSION_STORAGE_DIR` on a persistent volume. Nitro's runtime plugin
remounts these stores using runtime values; build-time configuration alone is
insufficient. Existing room identities remain separate.

## Native clients

Mobile imports the same encrypted messages into its SQLite learner repository.
The full wire conversation remains in an account-scoped sidecar, retaining tool
traces, model metadata and native branch records even when the mobile view renders
only its supported messages. Account switching fences database transactions and
network requests. Polling stops in the background and backs off when idle.

The new `KeatingSyncCrypto` native module keeps unlocked keys in native memory
and uses platform ECDH, HKDF, AES-GCM and HMAC. A rebuilt Android/iOS app is
required; a JavaScript-only update cannot add this module.

CLI account sync has a separate, refreshable login:

```sh
keating sync login
keating sync list
keating sync open <exact-conversation-id>
keating sync add <existing-Pi-session.jsonl>
keating sync
keating sync logout
```

`keating login` retains its existing five-minute inference capability semantics.
Sync credentials and checkpoints are scoped to the selected learner profile;
account conversations live in a separate directory. Existing local Pi files are
uploaded only by explicit `sync add`. Signed-in shell launches sync before and
after execution. The complete native JSONL tree is preserved, including branches
and custom records; browser edits create a new native branch when needed.
