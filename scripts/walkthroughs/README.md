# Recording Keating walkthroughs

The [recording plan](../../docs/walkthroughs/PLAN.md) covers the full set. Each executable storyboard has the same slug as its guide. The responsive alternatives use a -phone suffix.

## Record a walkthrough

Run from the redesign checkout. Keep the existing local Keating app running on port 3420. Wait for any other capture to finish first. Bun, FFmpeg with libx264 and libvpx-vp9, and a Playwright Chromium headless shell are required. The recorder selects the newest installed shell. Set CHROME to its absolute path to choose another copy.

Try a storyboard with scratch output first:

```sh
rtk bun scripts/walkthroughs/record.mjs scripts/walkthroughs/storyboards/lesson-in-chat.json --out=/tmp/keating-design-shots/W2/trial
```

For final media, omit the output override:

```sh
rtk bun scripts/walkthroughs/record.mjs scripts/walkthroughs/storyboards/lesson-in-chat.json
rtk node scripts/walkthroughs/render-viewer.mjs
```

The default destination is docs/walkthroughs/media. The recorder prints a unique scratch directory containing original frames, diagnostics, timestamps and trial encodes. Set WALKTHROUGH_SCRATCH to an absolute path under the checkout’s ignored .keating directory to keep diagnostics across restarts. A failed browser step prints the storyboard step number and saves a viewport still and visible controls when the page is reachable. For an interrupted browser, wait for memory to recover, confirm the prior browser has exited, then rerun the same storyboard. Pause the recording work if another lane is capturing.

## Record the full set

Translate the remaining approved chapters in PLAN.md into executable JSON files in storyboards/. Keep the same slugs as the viewer. Use a -phone or -desktop suffix for an alternate viewport. The viewer combines those takes on one guide page. Once the final app and those storyboards are ready, run:

```sh
rtk bun scripts/walkthroughs/record-all.mjs --base=http://localhost:3420 --out=/tmp/keating-design-shots/W2/final-review
```

The batch command runs every JSON storyboard in filename order and stops at the first failure. Inspect the scratch clips and correct any selectors, captions, or fixtures. Then run the publish-to-folder pass in sequence:

```sh
rtk bun scripts/walkthroughs/record-all.mjs --base=http://localhost:3420
rtk node scripts/walkthroughs/render-viewer.mjs
```

Run rtk node scripts/walkthroughs/render-viewer.mjs --check to compare the pages with the current plan and media manifests.

Review each guide before moving its selected assets to the learner docs or landing page. For the learner guides, use the viewport still from a matching chapter and record the PNG dimensions, source, capture date and SHA-256 in the screenshot manifest. For learner docs, use the existing videos/screenshots content contract, including surrounding instructions that still work without playback. Landing cuts should retain clear provenance and unaltered captures. This workflow publishes files locally.

## Add a storyboard

Use slug, title, viewport (desktop or phone), theme (light or dark), fixtures (seed names), transcript (optional fixture JSON basename), ready (optional wait conditions), and steps. Step 1 opens the starting route and applies the fixtures before playback. Readiness checks establish the initial view before the first recorded frame.

| Step kind | Fields and behavior |
| --- | --- |
| goto | path on the app origin, or mockup naming an existing *-mockups.html file. A mockup may have a hash. Set ready to wait for the next view before resuming capture. |
| click, hover | label or selector. Optionally use within for scope, nth for a zero-based match, contains for partial labels, or ms for pointer travel. Labels match visible text, aria-label, title, or placeholder. |
| type | selector or label, text, and optional per-character delay in milliseconds. Appends at the caret. |
| drag | from and to as target objects or viewport [x,y] pairs. Optional ms, hold, and throw for an accelerating release. |
| scroll | to as a target object, or dx and dy for actual wheel input, optionally over a selector or label. A following wait-for can confirm the destination. |
| wait-for | label, selector, text anywhere in rendered body text, or a trusted browser-side condition expression. Optional absent for selector or text, and timeout in milliseconds. |
| caption | text of at most 12 words and optional ms. By default it lasts until the next caption or clip end. |
| chapter | id, title, a short explanation, and screenshot alt text. The chapter uses the still named by id or explicit image. |
| pause | ms. Use deliberate holds for reading and condition waits for readiness. |
| press | key such as Enter, Tab, Escape, Backspace, ArrowUp, or ArrowDown. |
| profile | name, path or pathFrom (target resolving to an invitation URL), and optional fixtures. Reusing a name restores its separate storage. Set keepPrevious to keep the previous tab running in the background during a room handoff. Only the active tab is captured. |
| select-text | selector and an exact passage in text. Optional label and contains locate the containing transcript turn. The recorder drags between the passage's endpoints. |
| seed | fixtures and optional reload. Use this after creating the blank course to populate the course with the sample lesson and owner-entered material. |

Set still on an action to save the resulting screen. Use still: "poster" to set the video poster, otherwise one is taken from the clip. Put a chapter marker before the action it describes, and take its still after the relevant screen reaches its final state. Use app copy from the visible interface and keep overlays, captions, and stills free of unsupported claims.

## Fixture stores and sample data

The recorder reads fixtures/NAME.js as the body of an asynchronous browser-side seeder. The matching NAME.json, if present, supplies data. It also passes the providerUrl, base, and theme. The seeders follow the app's storage contracts. They use source modules served by the local development app and require a fresh browser profile. Provider credentials are sample strings.

Start from demo for the local model and capture preferences, add first-run for the onboarding reset, profile for Alex Rivera, sessions for the sample history, review after sessions for annotation and feedback, and study after sessions for review material. Course and room fixtures use the local account API. For the join walkthrough, create the room in the host profile and use its generated link in the learner profile. Where the course fixture seeds a sample submission, identify it as owner-entered sample material. Use a second role and real submit flow for a live hand-off demonstration.

The loopback provider follows the existing demo-provider SSE protocol. Each turn matches the latest learner message. It can stream a reply and optional thinking text, or return a specified error. An entry with times: 1 is consumed once. The first available matching entry wins. An optional auxiliaryReply serves title generation and other non-streamed requests. Unexpected prompts return a visible error and are logged without their content.

## Verification and limits

- The recorder captures live Chromium pixels and draws its pointer inside the page. It preserves screencast timestamps and encodes a 30 fps H.264 MP4 with faststart. A VP9 WebM is kept only if smaller. MP4 is capped at 4 MB. The portrait capture is a narrow web viewport using a mouse.
- A browser session is limited to three minutes. The browser closes before the serial encodes. The recorder controls its own browser only. A switch to a second room profile is sequential and may show the actual navigation delay.
- The fixture provider demonstrates app behavior with authored replies. Hosted sign-in, credits, downloads, live voice, external sources, human learning, and independent judgement are outside local proof. The progress rail can display Draft, Review and Reply labels while the local route skips independent review.
- The recorder suppresses the OpenUI and Popmelt development widgets, hides room invitation URLs and QR codes, and keeps app error states visible. Keep a failure still under the scratch directory and update the storyboard when the corresponding flow stabilizes.
- Before local publication, check dimensions, codec, frame rate and file sizes with ffprobe and inspect a frame every few seconds. Compare chapter starts and caption cue times with the visible actions. Inspect all named stills and check playback, step seeking and the readable fallback.
