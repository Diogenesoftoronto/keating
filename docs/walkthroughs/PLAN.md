# Keating web walkthroughs

The recordings follow Alex Rivera, a sample learner working through recursion. **How recursion returns** is the sample session, **Recursion Workshop** the sample course, and **Recursion Study Room** the sample room. Use disposable local profiles and label the sample accounts, including Morgan Lee when a separate host or teacher is needed. Keep the sample-data label visible in the guide and identify scripted replies in captions or the guide’s introduction. Fixture names below refer to `scripts/walkthroughs/fixtures/`.

Desktop takes use 1280×800 and phone takes use 390×844, both at 30 fps. Phone means the responsive web app. Each numbered beat is a chapter and gets its own still. The bold text names the control, the rest of the middle column describes the visible result, and the last column supplies the caption. For glyph-only controls, use the exact accessible label. Recheck labels and availability against the final redesign before recording. Mark any omitted beat in the accompanying guide. Landing destinations are proposed placements or edits, while the linked docs slugs are existing guides.

## 1. First run · `first-run` · 55 s · desktop and phone

**Purpose** Help a new learner reach a first useful message through Question, Model, You and Ready.  
**Audience** Learner.  
**Start** Empty onboarding and profile stores, with the loopback provider available in the model picker. Apply `demo` followed by `first-run`. Use Alex and the goal “I want to understand recursion well enough to explain it to someone else.”  
**Script** Ask what happens to the first call while the second runs.  
**Destinations** `/start-here/` · First Minute deck, proposed web cut alongside terminal onboarding.  
**Capture boundary** Use **Bring your own key** to select the configured local demo model. Leave hosted sign-in, payments, actual offline downloads and spoken onboarding outside the take.

| Step | Control and visible result | Caption |
| --- | --- | --- |
| 1 | **What would you like to understand?** Type the sample goal on Question. | Give Keating something you want to learn. |
| 2 | **A few quick choices**, then **Continue**. The Model step opens. | Choose how to tell Keating about yourself. |
| 3 | **Bring your own key** → **Choose a model and provider**. Select the sample local tutor. The model picker closes on selection. | This walkthrough uses a local demo tutor. |
| 4 | **Continue**. On You, enter Alex in **What should Keating call you?** and choose **Nudge me**. | Choose what helps you learn. |
| 5 | **Continue**. Ready shows the saved goal in **Your first message**. | Your question is waiting in the composer. |
| 6 | **Start chatting**. The draft appears in Chat. | Open Chat with your first message ready. |
| 7 | **Send**. Hold on Keating’s scripted opening question. | Give Keating a starting point. |

## 2. A lesson in chat · `lesson-in-chat` · 85 s · desktop and phone

**Purpose** Work through one tutoring turn, interact with lesson materials, and recover a failed reply.  
**Audience** Learner.  
**Start** Fresh Chat with `demo` and `profile`: onboarding completed, local demo model selected, no existing transcript. Use the two-call countdown and a local sample source.  
**Script** Socratic opening question, streamed reasoning and teaching reply, corrective feedback for the first quick check, a follow-up quick check for the corrected answer, a stack deck, runnable countdown, source citation, controlled provider error and recovery reply. Use a repeated quick check if the original card records its answer permanently.  
**Destinations** `/learning-with-keating/` and `/quizzes-and-practice/` · Classroom deck, **Ask in the classroom**.  
**Capture boundary** The provider streams authored sample content. Show real progress labels only when the app exposes them. If judgement is unavailable, identify the actual phases captured. Use local browser execution and fixture grounding, with no external search, hosted sign-in, payments, model downloads or Live.

| Step | Control and visible result | Caption |
| --- | --- | --- |
| 1 | Chat composer → **Send**. Alex types “Teach me how recursion returns.” | Ask what happens when a function calls itself. |
| 2 | **Draft**, **Review**, **Reply**. Follow the active phase, then the tutor’s opening question. | Watch the turn progress as Keating asks back. |
| 3 | **The first call is replaced** → **Finish check**. The quick check records Alex’s first answer. | Try an answer before reading the explanation. |
| 4 | **The first call waits** → **Finish check** on the follow-up check. Keating explains the paused frame. | Try again after the hint. |
| 5 | **Reveal · Space** → **Good**. Reveal the base case and rate recall. | Reveal the card and rate your recall. |
| 6 | **Run tests** in the coding lab. Compare the result with what Alex predicted. | Run the countdown and watch the calls return. |
| 7 | **Sources**. Inspect the source entry for the sample reading. | See the source behind the reply. |
| 8 | **Explain another way**. Confirm the study chip fills the composer. | A study chip puts a prompt in the composer. |
| 9 | **Send message**. The scripted connection failure exposes the recovery notice. | The reply failed. Your question is still here. |
| 10 | **Retry response**. Wait for the sample follow-up to finish. | Retry the turn to continue the lesson. |

## 3. Keating the companion · `companion` · 45 s · desktop

**Purpose** Use the companion to quote a passage and choose how much it moves.  
**Audience** Learner.  
**Start** `sessions` with the recursion replay open on a paragraph about the paused call. Use a wide Chat canvas, allowed motion and Lively.  
**Script** No new turn needed. The existing sample reply gives the drag a real text target.  
**Destinations** `/visual-guide/`, Chat and messages · Tour deck, proposed companion beat.  
**Capture boundary** Capture the app’s pointer interactions and skip the throw if the real gesture cannot be recorded. No hosted sign-in, payments, model downloads or live voice.

| Step | Control and visible result | Caption |
| --- | --- | --- |
| 1 | Drag **Study with Keating** over the paragraph about a paused call. Release when targeted. | Drop Keating onto a passage. |
| 2 | **Give me an example**. The composer shows the quoted paragraph and draft request. | Choose a suggestion to quote the passage. |
| 3 | Throw **Study with Keating** into clear space with a quick desktop release. | Try a quick release in the margin. |
| 4 | **More menu** → **Settings** → **Interface** → **Companion and sound**. Show **Lively** selected. | Find Keating’s companion setting. |
| 5 | **Calm**. Show the description and return to Chat. | Calm keeps Keating in place. |
| 6 | Reopen the Companion section → **Off**. Return to the composer. | Choose Off to turn the companion off. |

## 4. Sessions and materials · `sessions-and-materials` · 50 s · desktop and phone

**Purpose** Find, organise and branch a lesson, then reopen its materials.  
**Audience** Learner.  
**Start** Seed `sessions` and `study`: the recursion session with a plan and cards, another subject, and a root-linked recursion branch. No session pinned initially.  
**Script** Make a one-card sample deck with the local tutor. The saved transcript and materials already contain the study plan and an earlier deck.  
**Destinations** `/sessions-and-review/`, Find a conversation · Tour deck, Sessions beat.  
**Capture boundary** Show browser-local search, grouping and persistence. Leave cross-device sync, public sharing, hosted sign-in, payments, model downloads and Live out of this take.

| Step | Control and visible result | Caption |
| --- | --- | --- |
| 1 | **Open sessions panel** (phone) or **Expand session panel** (collapsed desktop). Open the library. | Open your session library. |
| 2 | **Find a session**. Type “recursion” and wait for matching rows. | Search your sessions for recursion. |
| 3 | **Clear search** on desktop, or clear **Find a session** on phone → **CS**. Show the subject’s sessions and count. | Narrow the library by subject. |
| 4 | Return to **All**. Open **Actions for How recursion returns** → **Pin**, then look under **Pinned**. | Pin a session you expect to revisit. |
| 5 | **How recursion returns** → **Fork session from here** on the selected turn. Reopen the library and disclose the parent’s fork count. | Fork a turn and keep the original conversation. |
| 6 | Open the original session → **Make flashcards** → **Send message** → **Reveal answer**. Choose **All** in the open Materials panel to show the new deck alongside the saved study plan. | Make a deck and find it in Materials. |
| 7 | **All materials** → **Flashcards**, then the sample deck. | Open your flashcards from the workspace. |
| 8 | **More menu** → **Share session**. Show the disclosure, then **Cancel**. | Read the sharing disclosure before sharing. |

## 5. Reviewing a session · `review-a-session` · 85 s · desktop and phone

**Purpose** Annotate the tutor’s teaching, inspect the rubric, and prepare a portable review.  
**Audience** Teacher or learner.  
**Start** `sessions` and `review`: browser-local reviewed recursion transcript, multiple selectable tutor passages, sample rubric findings and at least one prior note.  
**Script** None for the review or export. A sample rewrite is optional only if the local provider can run the selected pass.  
**Destinations** `/sessions-and-review/`, Leave an anchored note · **Review desk** feature.  
**Capture boundary** Review evidence is authored sample data. Open the pass menu without requiring a hosted judge, sign-in, payments, model downloads or Live. Keep the export local.

| Step | Control and visible result | Caption |
| --- | --- | --- |
| 1 | Open **Session reviews** at `/review`. Show the queued sample session and review status. | Find the session in Reviews. |
| 2 | Open the recursion session, then select “The first call waits” in **Transcript**. | Select the part of the reply you want to mark. |
| 3 | **Problem** → **Add note**. Record “Name the frame before using stack terminology.” | Mark a specific problem. |
| 4 | Select a second passage → **Strength** → **Add note**. Record “The example gives the learner a prediction to test.” | Save what the tutor did well. |
| 5 | Select a third passage → **Suggestion** → **Add note**. Record “Ask what changes at the base case.” | Suggest a concrete next move. |
| 6 | Select the original passage → **Rewrite**. Show the rewrite draft and leave it as a proposal. | Try a rewrite for the selected passage. |
| 7 | **Rubric**. Inspect one scored criterion and its explanation. | Read the rubric alongside the transcript. |
| 8 | **Socratic pass**. Show the available actions and close the menu. | See what a Socratic pass can propose. |
| 9 | **Save review** → **Export**. Read what the sheet includes and excludes. | Check what goes into the review export. |

## 6. Activity, Coming up and the model benchmark · `activity-and-benchmark` · 65 s · desktop and phone

**Purpose** Follow the learner’s activity into due review, then inspect the evidence behind a benchmark.  
**Audience** Learner or someone evaluating Keating.  
**Start** Seed `sessions`, `review`, `study` and local case evidence: recent recursion sessions, a due sample deck, one reviewed case, local feedback and a pending assignment. Use fixture-relative dates so the surfaces remain populated on recapture.  
**Script** None. The local case evidence is sample teaching-review data.  
**Destinations** `/quizzes-and-practice/`, Rate flashcards and `/sessions-and-review/`, model-assisted review · **Return runway** feature, with benchmark as an optional Tour beat.  
**Capture boundary** Use **Private** benchmark evidence and show the actual ranked, unranked or empty state. Sample figures establish neither comparative model performance nor learning outcomes. Leave shared benchmark traffic, sign-in, payments, model downloads and live voice out.

| Step | Control and visible result | Caption |
| --- | --- | --- |
| 1 | **More menu** → **Learning usage**. Open the recent learning dashboard. | Start with your Learning activity. |
| 2 | **7 days** (**7d** on phone). Review the visible summary and session activity. | See what changed this week. |
| 3 | **Coming up**. Show cards due and the open assignment. | See what is ready to review next. |
| 4 | **Start due review**. Reveal one sample card and rate it **Good**. | Recall an answer before rating the card. |
| 5 | **Benchmark** → **Private** under **Evidence from**. Inspect the displayed result state. | Switch the benchmark to private evidence. |
| 6 | **All** in **Replay case bank**. Show the sample case and what supports it. | Read the case behind the evidence. |

## 7. Courses · `courses` · 80 s · desktop and phone

**Purpose** Take one course from assembly to reading, discussion and teacher review.  
**Audience** Teacher and learner.  
**Start** Use `course` to seed Recursion Workshop with modules, “Why the base case matters,” a sample stack reading, cards and an access-approved sample submission. Capture initial blank course creation as a setup beat with the same sample data applied to the new course ID.  
**Script** None. Course reading, cards, comments and sample submission are authored.  
**Destinations** `/courses-and-sharing/` · **Courses** feature and the shared-course **The learning path / The conversation** section.  
**Capture boundary** Use the real local course store and role checks. If learner or teacher access is unavailable, show the actual empty or denied queue. Leave remote enrollment, payment, hosted sign-in, remote model downloads and live voice outside the take.

| Step | Control and visible result | Caption |
| --- | --- | --- |
| 1 | **Courses** → **Or assemble manually**. Open the assembler. | Open the course assembler. |
| 2 | **Course title** → **Create blank course**. Enter Recursion Workshop; wait for **Build**. | Create a course you can fill in. |
| 3 | **Outline**. Show the fixture modules and lessons after applying the seed to the created course. | Organise lessons into modules. |
| 4 | **Read** → **Why the base case matters**. Read the lesson and find its Countdown trace source. | Open the lesson and its reading. |
| 5 | **Mark complete**. Show the completed lesson state. | Mark this lesson complete. |
| 6 | **Discuss** in the bar above the scrolled lesson → **Write a comment** → **Post comment**. Add Alex’s question in the lesson channel. | Keep the question with the lesson. |
| 7 | **Review** → **Only work awaiting review**. Open the sample submission and its evidence. | See which learner work awaits review. |
| 8 | Open **Self-paced courses** at `/learn`, then the sample local draft if available. Open **Review this plan**. | A self-paced plan stays a draft until you approve it. |

## 8. Study rooms · `study-rooms` · 90 s · desktop

**Purpose** Demonstrate invitation, audience boundaries and teacher approval across two local profiles.  
**Audience** Teacher and learner.  
**Start** Empty room directory with Morgan Lee’s local host profile and Alex’s distinct learner profile. Use `room` for inputs and sample posts, and the live local create and invite operations for IDs. Use two isolated browser contexts in one headless Chromium process. Capture the profiles in sequence. During facilitation keep the host tab backgrounded only as long as the learner interaction requires. Keep the invite URL out of the recording.  
**Script** A room reply asks Alex which frame resumes after the base case. Use the local facilitator and wait for the real held state.  
**Destinations** `/study-rooms/` · Tour deck, proposed Study rooms beat.  
**Capture boundary** Use the same local backend for both profiles and check learner visibility directly. If facilitation or approval can only be seeded, identify the fixture and its limits. Show no hosted sign-in, external invite delivery, payments, model downloads or live voice.

| Step | Control and visible result | Caption |
| --- | --- | --- |
| 1 | Host **New room** → **Title**. Enter Recursion Study Room. | Create a room for the sample study group. |
| 2 | **When asked** → **Teacher approves** → **Create room**. Check the room header. | Hold replies for teacher approval. |
| 3 | Rename the host in **People**, then use **Invite** → **Learner**. Set **Uses** to 1, then **Create invite link** → **Copy link**. | Make a limited learner invitation. |
| 4 | Open the link in Alex’s browser profile. Show **Before you join**. | Read what the room shares before joining. |
| 5 | **Your name in this room** → **Join as learner**. Show Alex in the room. | Join through the learner invitation. |
| 6 | Host **Private guidance for Keating** → **Send private guidance**. Add the sample question to ask. | Send guidance visible only to teachers. |
| 7 | Host **Run Keating from this tab** → **Use my model access**. As Alex, post a question with **Send message** addressed to Keating. | Ask Keating a question from the learner profile. |
| 8 | Host **Approve and post** on the held reply. Wait for it to enter the transcript. | Approve the held reply. |
| 9 | Learner **People**, then transcript. Show the approved reply in the shared view. | The learner sees the approved reply. |

## 9. Your profile · `profile` · 50 s · desktop and phone

**Purpose** Edit what Keating is told and preview the separate profile visitors would see.  
**Audience** Learner.  
**Start** Use `profile` for Alex’s preferred name, recursion goal and study preference. Begin an unpublished public-profile draft tied to the local account.  
**Script** None. Show the real context preview before sending a new message.  
**Destinations** `/learning-with-keating/`, Tell Keating what helps you learn · First Minute deck, proposed profile beat.  
**Capture boundary** Stop in preview. Leave publication, share links, hosted sign-in, payments, model downloads and voice outside the take.

| Step | Control and visible result | Caption |
| --- | --- | --- |
| 1 | **More menu** → **Settings** → **Learning**. Open **Your profile**. | Open the profile Keating uses to teach you. |
| 2 | **Teaching** inside Your profile. Choose a preference for when Alex gets stuck. | Say what helps when you get stuck. |
| 3 | **What Keating is told**. Read the actual tutor context and select **Save profile**. | Check what Keating will be told. |
| 4 | **Models and connections** → **Your account** (or the available account card) → **Public learning profile**. Open the editor and show the draft preview available in the local deployment. | Open the separate public learning profile editor. |
| 5 | **Headline** and **About**. Add a sample headline and one sentence. | Choose what visitors could see. |
| 6 | **Preview** on phone; on desktop, show **Preview: what visitors will see**. Stop there. | Preview the draft before publishing. |

## 10. Settings · `settings` · 50 s · desktop

**Purpose** Find the right settings group, switch theme and turn off decorative effects.  
**Audience** Learner.  
**Start** Onboarded sample browser with `sessions`, light theme and visual effects enabled.  
**Script** None.  
**Destinations** `/visual-guide/`, Sessions and settings · Tour deck, proposed personalization beat.  
**Capture boundary** Provider rows and Live preflight may be inspected without initiating hosted sign-in, actual downloads, payments or a Live call.

| Step | Control and visible result | Caption |
| --- | --- | --- |
| 1 | **More menu** → **Settings**. Show Interface, Learning, Models and connections, and Data and support. | Start with the Settings groups. |
| 2 | **Models and connections** → **Providers and keys**. Show connection options. | Find the available model connections. |
| 3 | **Find a setting**. Search “effects” and select **Visual effects**. | Search for visual effects in Settings. |
| 4 | **Motion and effects** → **Visual effects**. Turn decorative effects off. | Turn off decorative visual effects. |
| 5 | **Display and reading** → **Terminal**. Compare dark and **Paper** in place. | Switch the theme and keep your place. |
| 6 | **Data and support** → **Your data**. Show where export information lives. | Find export controls under Data and support. |
| 7 | **Close settings** → **More menu** → **Live sessions**. Inspect **Live provider** on the preflight, leaving **Start talking** untouched. | See the voice choices before starting Live. |

## 11. Your data · `your-data` · 65 s · desktop and phone

**Purpose** Follow browser data from its sources to an inspected export, including what may leave the device.  
**Audience** Learner or teacher.  
**Start** Seed `sessions`, `review` and `study` for the recursion transcript, authored review notes and lesson artifact. Begin with an empty dataset job and optional scoring switched off.  
**Script** None. The training set is prepared from the sample local records.  
**Destinations** `/privacy-and-data/`, Understand what leaves the device and Export a copy · Proposed privacy link from the Tour deck.  
**Capture boundary** Show the archive confirmation or download only to the disposable profile. Keep scoring and sharing off. Treat any provider or sync disclosure as a product policy, with no hosted sign-in, payments, downloads of models or Live.

| Step | Control and visible result | Caption |
| --- | --- | --- |
| 1 | **More menu** → **Settings** → **Data and support** → **What leaves this device**. Read both the analytics and optional sharing disclosures. | Check what stays here and what may leave. |
| 2 | **Your data** under **Data and support** → **Prepare** → **Choose your data** → **Source** → **Conversations**. | Choose which conversations go into the dataset. |
| 3 | **Shape the dataset**. Check the redaction and filtering choices. | Review the dataset filters and redaction. |
| 4 | **Score it**. Keep optional scoring off and select **Prepare dataset**. | Prepare the dataset without scoring. |
| 5 | **Download or share**. Inspect **Dataset overview** and **In the ZIP**. | Read the manifest before opening the download sheet. |
| 6 | **Download ZIP**. Read what is included in the sheet, then **Cancel**. | Check what the ZIP will contain. |
| 7 | Open the sample review → **Export**. Read the separate review sheet. | An individual review has its own export. |
| 8 | Return to **Your data** → **Export** beside **Everything on this device**. Show the portable JSON sheet and cancel. | Keep a portable copy of this browser’s work. |

## 12. Phone tour · `phone-tour` · 65 s · phone

**Purpose** Orient a learner to the compact web navigation, composer and review tools.  
**Audience** Learner or someone evaluating Keating.  
**Start** 390×844 responsive web view with `demo`, `sessions`, `study`, `review` and `course`.  
**Script** One sample flashcard turn, “What keeps its local variables while a second call runs?”  
**Destinations** `/visual-guide/` · Tour deck, proposed responsive-web cut.  
**Capture boundary** Label the take as responsive web. Leave mobile OS permissions, hosted sign-in, payments, native model downloads, and Live out of the recording.

| Step | Control and visible result | Caption |
| --- | --- | --- |
| 1 | **Open sessions panel**. Open the sheet and show the search field. | Open Sessions on your phone. |
| 2 | **Find a session**. Search “recursion” and open the matching session. | Find an earlier lesson. |
| 3 | **Make flashcards** → **Send**. Reveal the sample card. | Make flashcards from your lesson. |
| 4 | **Materials**. Open the sheet and inspect the deck. | Open the same materials alongside Chat. |
| 5 | **More menu** → **Review session** → **Notes** → **Rubric**. Switch the review tabs. | Move between transcript notes and the rubric. |
| 6 | Return to Chat → **More menu** → **Settings** → **Interface**. Show the labelled mobile groups. | Find appearance controls in phone Settings. |

## 13. Design-system reel · `design-system` · 40 s · desktop

**Purpose** Show how glyphs, charts and decorative effects behave in the design boards.  
**Audience** Someone evaluating Keating.  
**Start** Open the shipped local mockup pages `glyphs-mockups.html` and `system-mockups.html`. Use their built-in assets and interactive toggles.  
**Script** None. Label the design-board charts as sample data in the guide.  
**Destinations** `/visual-guide/` as an optional design reference · Tour deck, proposed separate design reel.  
**Capture boundary** Caption this as a mockup reel. It establishes board behavior and appearance only. There is no app interaction, hosted sign-in, payments, model download or live voice in this reel.

| Step | Control and visible result | Caption |
| --- | --- | --- |
| 1 | Scroll to **The set**. Hover the **left** glyph and show its moving accent. | Design boards · the glyph set in motion. |
| 2 | Scroll to **In controls** → **Copy message**. Show the copy affordance and state change. | The same glyphs live inside controls. |
| 3 | **Motion** → **Reduced**. Hover a glyph again, then restore **Full**. | Reduced motion keeps the state change visible. |
| 4 | Scroll to **Shaders**. Move over **Marbled ink** and switch **Theme** to **Terminal**. | Shaders respond to the pointer and theme. |
| 5 | **Shaders** → **Off**. Show the static fallback. | Turn off the shader and keep the layout. |
| 6 | Open the system board and scroll to **Charts**. Show line, interval and distribution examples. | Read the chart sheet across several kinds of evidence. |
| 7 | **Theme** → **Terminal** on the chart board, then **Paper**. Show the same data in each theme. | The chart keeps the same values in both themes. |

## Before the full recording

- Confirm which planned controls ship, including subject chips, progress phases, browser code execution, companion throws and the room’s second-profile behavior. Refresh names and selectors from the final app. Record conditional or empty states as they appear and describe any skipped beat.
- Decide whether to use the current Settings navigation or the proposed groups and search, which phone cuts need their own guide, and whether a private benchmark case is present in the profile. Use a non-shared ledger for sample cases.
- Check local sharing, the self-paced draft, and Live preflight before the capture. A disposable local sharing environment is required to show an actual read-only snapshot. Keep self-paced preparation and Live transport outside a local-only capture. Confirm with the docs owner whether to give those surfaces their own cuts.
- Resolve the placement of proposed landing beats and keep the procedure-specific versions for the learner docs. Use one browser and one encode at a time. Verify each take’s actual frames, pointer, caption timing, chapter timing and named stills before export to the site or landing deck.
