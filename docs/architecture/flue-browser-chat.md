# Browser chat with official Flue

Typed chat uses `FlueConversation`, an application controller whose UI snapshot
contains the native `@flue/sdk` conversation projection. It does not extend Pi's
`Agent`. The chat panel renders stable Flue message IDs, streaming text/reasoning,
attachments, tool inputs/outputs, and failed or aborted submissions.

## Execution and storage

- Vite builds the Node-only harness in `spikes/flue-host/src/browser/runtime.ts`
  as a separate asset. Each conversation executes it in a dedicated NodePod,
  separate from the learner's editable source sandbox.
- The official Flue router handles SDK send, observe, read, history and abort
  requests through a local fetch bridge. No localhost HTTP server or remote
  Flue deployment is needed.
- Flue decides when to request model turns and execute tools. The browser retains
  the selected provider, credentials, original system prompt, multimodal context,
  tool schemas and authorization wrappers. Credentials never enter the pod.
- Existing tool results retain their full content and details, including quiz,
  exam, flashcard and OpenUI payloads. Provider transcripts and execution events
  remain available for existing session storage, exports and learner evidence.
- The custom sql.js adapter uses official Flue stores. Settled SQLite snapshots
  are saved in IndexedDB. Reloading restores the last settled snapshot; an
  unfinished submission is never automatically replayed. A Web Lock permits
  only one live runtime for a session in this browser profile.
- Old sessions remain readable and become a preserved history prefix when their
  first Flue turn starts. Attachment bytes are fetched through the local bridge
  and presented using browser blob URLs.

The portable authoring facade still supplies progressive skills, tool scopes and
the lesson-critic delegate. Realtime voice retains its separate WebRTC connection.
Account synchronization and mobile execution remain separate integrations.

## Verification

Install with `devenv tasks run keating:install`, then build with
`devenv tasks run keating:build keating:web-build`.

From `spikes/flue-host`, `bun run test:nodepod` exercises the official runtime in
real Chromium with deterministic local provider responses. Its chat fixture mounts
the actual chat panel, executes the real quiz tool, restores history in a new pod,
and checks cancellation/retry and exclusive ownership. `bun run test:contracts`
checks the custom adapter against the upstream persistence contracts.

These checks do not call a paid model provider or establish deployment or mobile
behavior. Run `bun test` in `web` for the application regression suite. Vet is
intentionally skipped for this change at the user's request.
