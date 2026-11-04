# Study rooms

Study rooms are shared web sessions for a group of learners, teachers, and one
Keating facilitator. Open **Rooms** to start a standalone room, or open a course
to join a room attached to its current lesson. A course owner or teacher can
create a course room. Other course members can join it without another invite.
Members admitted through the course follow its current membership and role:
removing a course member removes that derived room access, and demoting a
course teacher removes their derived oversight. Admission through an explicit
room invitation, or a host-assigned room role, is a separate grant. Accepting
an invite while already a member does not upgrade the current role or replace
course-derived access with an independent invitation grant.

## Open a room

1. Open **Rooms**, choose **New room**, and give the group a title, topic, and
   goal. A course teacher can instead create a room from the lesson's
   **Study rooms** section.
2. Open **Invite**, choose the recipient's role, expiry, and use limit, then
   create a link and QR code. Invitees read the shared-transcript, teacher
   oversight, and model-provider disclosure before joining.
3. Use **People** to check membership and roles. The host stages a role change
   and confirms it before applying it; choosing an item in the role menu alone
   does not grant teacher access.
4. A permitted member starts Keating from their browser as described below.
   The group can exchange messages while Keating is off.

## Invitations and visibility

The host can invite teachers, learners, and observers. Teachers can invite
learners and observers. Learners can invite other learners only when that room
setting is enabled. An invitation specifies its role, expiry, and use limit;
the creator receives a link and QR code. Revoke a link to prevent future joins.
A room keeps at most 200 open links and each learner at most 10; at the cap a
new link is refused rather than replacing an open one.
Removing a member also blocks that account from rejoining the room. Hosts and
teachers can undo this under **Settings → Removed people**; only the host can
let a removed teacher back in. The person then needs a new or still-open link.

Display names are unique within a room, ignoring case and spacing, and
"Keating" and "Room" are reserved. Someone joining under a taken name is
numbered ("Maya 2"); renaming to a taken name is refused.

Everyone in a room can read its shared transcript, including messages sent
before they joined. Teachers can read and moderate the conversation. Joining a
room does not grant access to a learner's private tutoring sessions, course
submissions, or progress. Existing course consent rules still apply to that
separate information.

Hosts and teachers can send private guidance to Keating and review held replies.
These messages and drafts are excluded from learner and observer snapshots,
WebSocket traffic, and transcript exports. Hidden public messages appear as
placeholders to learners. An observer can read the room but cannot post or run
Keating.

## Running Keating

Choose **Run Keating from this tab**, read the model-access disclosure, then
confirm **Use my model access** to provide the room with this browser's
configured Chat model. Model credentials stay in that browser.
The shared conversation is sent to its configured model when Keating takes a
turn. A per-tab lease and heartbeat allow one browser to run Keating at a time;
a teacher can explicitly take over. Closing the facilitating tab attempts to
release its lease. Heartbeats run every 15 seconds; if release fails or the
browser disappears, the facilitator lease expires 45 seconds after its last
heartbeat. The server keeps heartbeats in memory and writes one to storage at
most every 30 seconds, so a restart cannot expire a live lease. An individual
unfinished turn has a separate 90-second deadline.
Members can keep talking while Keating is offline.

When a learner runs Keating and teacher review is off, each reply Keating
publishes is labelled with that learner's name and "not reviewed", because the
learner's browser composed it. Turn on teacher review to keep learners from
facilitating.

In facilitation mode, Keating reads attributed contributions and decides whether
to reply or pass. In on-request mode, a mention of Keating or a teacher's explicit
request triggers a turn. The prompt includes the room topic, goal, and any
captured course and lesson objectives. Room conversation is separate from each
learner's personal tutoring history.
Private teacher guidance is available only to a host or teacher facilitating the
room. If learners are allowed to facilitate, their model receives the shared
transcript and no private guidance.

## Private continuations

A room learner can choose **Continue privately** on a visible public message
from a person or Keating. In a course, choose **Continue privately** below a
lesson's reading. Room hosts, teachers, and observers do not have the learner
message-fork control.

1. Review the source in the confirmation panel. To use an excerpt, expand
   **Choose a passage** and select text in the original-source field. The
   excerpt above it updates to show exactly what will be copied. Use
   **Use whole source** to restore the whole reading or message when it fits.
   Selections must be nonempty and at most 8,000 characters; longer readings
   require an excerpt and do not show **Use whole source**.
2. Optionally enter **Your question**. Choose **Open private Chat** to save the
   context and open your own conversation.
3. The question is filled into the Chat composer. Press **Send message** when
   you want to ask it. Opening the continuation does not send a question or run
   inference. If the selected model is unavailable, choose or connect one in
   Chat settings, then retry.

The saved chat keeps the quotation, its attributed source, and a return link.
Room context stops at the chosen message; it excludes later messages, hidden
content, private teacher guidance, and held replies. Earlier context is bounded,
so a continuation is not an archive of the entire room. The source stays in
the shared transcript or lesson.

### Offers from Keating

Keating can also offer a private continuation to one learner. Only that learner
receives it in **Your private study offers**. **Review private offer** shows the
chosen source; the learner decides whether to open it or **Dismiss offer**.
**Reopen private Chat** returns to the same saved continuation without
overwriting its history, after rechecking room membership and source access.
Dismissed offers disappear; only opened offers show the reopen control. A
previously saved continuation remains accessible through normal Chat history
even when the room offer can no longer reopen it.

With teacher review enabled, a teacher first uses **Approve private-study
offer** or **Reject offer**. A private offer cannot be edited into a room reply
or supplied with a replacement message body. Approval sends the invitation to
the recipient; it does not open their chat. The subsequent conversation stays
outside room oversight. Teachers and classmates do not receive its messages;
opening or dismissing an offer does not report private progress to the room.
Keating selects existing public source material for an offer, rather than
writing an arbitrary private seed message.

### History, privacy, and returning to the source

The continuation uses the learner's own configured Chat model. Creating it does
not share the facilitator's credentials. Imported quotations appear as
**Imported room context** or **Imported lesson context** and are excluded from
learner-evidence extraction. The learner's later answers remain eligible for
the normal learning settings.

Private continuations are saved in normal Chat history, with the usual storage,
sync, portable-export, and explicit-sharing controls. Room membership grants
no access to them, but this is not a separate account-isolated vault in a
shared browser profile. Explicitly sharing or exporting the chat can include
the copied source material. Opening one never marks a lesson complete or
submits course work.

Expand **View full imported context** to inspect the saved source. **Return to
source room** and **Return to source lesson** open a new tab at the exact
message or lesson reading. An older room source may require **Load earlier
source messages**. A hidden, removed, inaccessible, or ambiguous source shows
an unavailable state instead of substituting another passage. A lesson's
current reading can differ from the saved quotation.

## Teacher oversight

Teachers can pause Keating, request a turn, mute learners, hide messages, and
end or reopen the room. The host manages roles. Teacher review holds generated
replies for approval, editing, or rejection before they are published. While
review is enabled, only hosts and teachers can facilitate. A pause during a turn
holds its reply or private-study offer, even if teacher review is otherwise off.

Participation summaries count visible contributions in the loaded transcript.
They help teachers notice who has spoken; they do not measure understanding,
retention, or learning effectiveness. Load earlier messages when a longer view
of the conversation is needed.

## Storage and identity

Rooms reuse the Courses account session. Hosted deployments use their verified
Not Organic product session. Local mode uses a stable HTTP-only browser cookie;
separate browser profiles have separate identities. Clearing that cookie loses
access to the local identity.

Room records and hashed invitation tokens use the existing `keating:courses`
Nitro storage mount. Set `KEATING_COURSES_STORAGE_DIR` to persistent storage in a
deployment. The default is `web/.data/keating-courses` when running from `web/`.
Room writes and realtime fan-out are coordinated within one server process;
run a single writer instance. Multiple replicas require shared transactional
coordination and pub/sub before they can serve the same rooms safely.
Rooms support at most 200 members, 4,000 messages and 2,000,000 characters
of message text, which keeps each room record to a few megabytes. An account
can host at most 50 rooms; deleting one frees a slot.
When the transcript limit is reached, new content is rejected with an explicit
error; joins and moderation can continue without adding system notices.
Operation receipts (for retry idempotency) keep the newest 20,000 and drop the
oldest, so no amount of activity can lock a room. Heartbeats take no receipt.
Socket frames are limited to 10 a second per connection, with bursts of 30.
Invitation pointers are deleted when a revoked, used-up or expired link is
tried, and when the room is deleted.

The web build must include both Vite and Nitro. Room HTTP routes are under
`/api/rooms`; the WebSocket endpoint is `/api/rooms/realtime?roomId=…`.
WebSocket authorization runs before upgrade: outsiders are rejected with HTTP
404, malformed room IDs with 400, and foreign origins with 403. Behind a
TLS-terminating proxy (such as Railway), the `X-Forwarded-Proto` scheme is
accepted for the same host. Membership is
checked again before opening and handling socket messages.
Durable changes use the authenticated HTTP operations endpoint. Sockets carry
projected updates, presence, typing, previews, and ping; attempts to send room
mutation frames are rejected. HTTP mutations also reject a supplied foreign
`Origin`.
CLI, TUI, and native mobile session views continue to use their existing
single-learner flows.

### Private-context API and bounds

`POST /api/rooms/:roomId/private-fork-context` accepts a `sourceMessageId` and
optional `selectedText`, UTF-16 `start`/`end` offsets, and `sourceHash`. It
revalidates current access and the exact public source under the room lock.
Ambiguous quotations, stale hashes, invalid ranges, and ranges that split a
Unicode surrogate pair are rejected. A context read does not advance the room
revision or publish an activity notice.

The response contains at most 40 public messages and 32,000 body characters,
ending at the source. Requests are limited to 60 per account per minute. The
saved imported-context message is bounded to 24,000 characters; selected
quotations are limited to 8,000. The client retains the chosen quotation and
trims earlier public context as needed. Lesson continuations reread the exact
course revision and reading before saving.

A room retains at most 200 private-fork offers, with at most 20 pending for a
learner. Full capacity produces an explicit error instead of silently evicting
pending offers. Private offer approval uses `draft.resolve` without a `body`;
only the addressed learner can use `private-fork.resolve` to open or dismiss
the resulting offer. The private continuation itself uses the existing local
session store, not the room record.

## Verification

From `web/`:

```sh
rtk bun test src/test/room src/test/private-fork \
  src/test/learning-source-navigation.test.ts \
  src/test/learning-intelligence-runtime.test.ts
rtk bun run typecheck
rtk bun run build
```

The tests include session persistence and provenance, exact source selection,
UI cancellation and reopening, private-offer projections, and real Node
WebSocket handshake regressions.
The normal web development task starts Vite and Nitro together; a Vite-only
server cannot persist or coordinate room sessions.

For browser verification, use independent profiles for the host and learners.
Disable `KEATING_COURSES_DEV_ACCOUNT_ID` in nonproduction; that override gives
every profile the same development identity and defeats identity separation.
Create a room, accept learner and teacher invites, exchange messages, and check
that private guidance and held replies stay out of the learner connection.
Exercise demotion, mute/removal, invite revocation, reconnect, explicit
facilitator takeover, and a narrow viewport. For private continuations:

- Select the second occurrence of a repeated quotation, open a private Chat,
  and check its exact source range and unsent question.
- Hold a model offer for teacher approval. Check that approval has no editable
  message body and that only the recipient receives the approved offer.
- Open, dismiss, and reopen offers. Reopening must preserve existing private
  conversation history. Check both room-message and lesson-reading return
  links, including unavailable sources.
- Reload the saved chat and check the imported-context presentation. Verify
  that creating it did not submit course work, complete a lesson, or send
  private conversation text to the room.

Local integration verification on 2026-10-25 passed 402 feature tests and 9
additional real-adapter handshake tests, the full web typecheck, and Vite/Nitro
production builds. Browser checks covered desktop and 390px layouts, exact
source returns, unsent question prefill, persistence, and reopening with a
continued-history fixture. A compiled HTTP/WebSocket smoke passed 281
assertions across five independent identities, including rejection before
upgrade and recipient-only offer delivery.

Model offers in those checks used deterministic streams or API simulation.
These results do not establish live hosted-model behavior or learning
effectiveness, and the checks did not publish or deploy the feature.
