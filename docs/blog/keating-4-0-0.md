# Keating 4.0: make room for the whole lesson

You have twenty minutes before dinner. Yesterday's fraction problem is still bothering you, there are cards due for review, and the course you are following has already moved on. You open Keating, pull up your saved answer, and ask for a closer look. The review points to the sentence where your reasoning went astray. Your work is there beside the feedback. You can try again.


Keating 4.0 brings judgement into answer review, lesson plans, course creation, and choosing what to study. You can shape how the tutor speaks and how the interface feels. Developers can watch a judgement during a reply and inspect the evidence behind it. Local execution has new capabilities, too, with guides that walk through a whole learning session.

We have also been following what happens after the tutor answers. The research tools connect a teaching response to the tokens the model generated, an independent assessment, and a training update. You can open the notebooks and follow each step. Some experiments found a useful signal; others changed the model without improving its teaching.


## Tell Keating how you want to work

The first-run experience now has space for the details that make a tutor easier to work with. Alongside account and model setup, optional steps cover language, background, goals, teaching preferences, and accessibility. Fill in what is useful, skip a section, and return to it in Settings whenever your circumstances change.

A returning student might want rigorous explanations and generous hints. Someone studying after work might prefer short sessions aimed at a career goal. A learner working in a second language can choose one language for the interface and ask for explanations in another. The profile gives these preferences their own fields, while keeping the free-text notes for everything that resists a dropdown.

Your preferences travel with your learner profile. You can edit them later, and Keating records whether you skipped a group or chose not to answer. Changes stay in a draft until you save. If another update arrives while you are editing, your unfinished work is protected.

Keating now saves longer-term goals as pursuits. They stay available while the conversation follows what you bring up today. Arrive with a question about music and the tutor is instructed to help with music, even if last week's goal was preparing for a calculus exam.

Accessibility preferences have visible effects. Larger text scales the reading surface; high contrast strengthens borders, links, and focus indicators; reduced motion quiets animation. The typography option combines available system fonts with wider spacing and more generous line height. Interface language follows your saved choice or, with the system option, your browser.

Then there is the tour. Choose “Show me around first” and Keating points out the composer, conversation, sessions, and study-material panel on the screen you are actually using. It remembers progress, can be replayed, and skips panels that are closed. Onboarding analytics capture progress identifiers and aggregate counts, keeping the contents of those personal fields out of the event payload.

## Small questions, useful answers

A tutor has to judge whether an answer meets the rubric, which practice task fits the learner's recent work, and when a hint would help more than a worked explanation. Those small decisions shape a lesson.

Keating 4.0 connects these decisions to Not Organic's hosted judgement service, including Jev. The application supplies the question and specifies one of three answer types:

- **Noul:** a binary question, returned as an estimated probability of “yes.”
- **Choice:** a selection from alternatives supplied by the application.
- **Score:** a judgement against authored, ordered levels.

The type tells the application how to use the answer. A rubric with distinct levels deserves a selected level. If a model is split between incompatible levels, averaging them would obscure the disagreement; the runtime can preserve it as an abstention. A choice stays within the alternatives the application supplied.

The saved response identifies the question, the model that answered it, and any calibration used to interpret the estimate. Requests have input limits and can be cancelled. If judgement is unavailable, the application can fall back to its existing rules.

Choose the judgement model separately from your conversational tutor. You can keep the tutor you like and use another model for review. On the CLI, `keating login --judgement` requests that additional account permission. Mobile ties requests to the device session and checks who issued the permission. A compatibility fix also lets the provider and account gateway agree on message roles, resolving requests that could fail before the tutor started answering.

## Your answer comes first

The answer-review flow begins by saving your work. The question, response, and task context are preserved before the optional judgement runs. Feedback arrives alongside that record, ready to inspect.

For an open response, a review can propose an assessment against the authored rubric and point to the exact text supporting it. Take a learner explaining why two fractions are equivalent. The interesting part is often one sentence: the step that preserves the value, or the step that changes it. Anchoring feedback to that sentence gives both learner and teacher something concrete to discuss.

That also makes revision easier to reason about. You can compare the submitted answer with the proposal, see which criterion is involved, and decide what to change. An existing exact grade remains in place; the model's contribution has its own status and evidence.

This save-first path reaches the CLI and Pi teaching tools, browser learner activities, and mobile records. On mobile, the raw answer lives in the local repository with the judgement recorded separately. A slow review can finish later; your submission has already been saved.

For developers, the useful tests here are about behaviour: saving before inference, keeping profiles isolated, preserving deterministic grades, and discarding a result after its source changes. Those are the conditions that make a review dependable in an ordinary session, including the messy one where a connection drops halfway through.

## Review a lesson while you are building it

A plan can look polished and still leave out the moment when the learner gets to demonstrate understanding. Lesson-plan review now sits inside the planning flow, where that omission can be caught while the author is still working.

In the web interface, **Save & review plan** saves the authored plan and requests feedback on observable outcomes, prerequisite sequencing, checks for understanding, actionable instructions, and support for claims. CLI and Pi planning have the corresponding optional integration.

Picture a lesson on recursion. The plan has an explanation, a diagram, and three examples, but the only exercise asks the learner to repeat a definition. A review against explicit criteria gives the author a way to examine that gap. The source references sit beside the proposal, so the next edit can be specific: add a trace exercise, ask for a prediction, or check a base case.

Course authors can request a design review, including while assembling and saving a course through supported workflows. To review a submission, Keating brings together the learner's answer, task, rubric, and reference material. The author decides which revisions and feedback to accept, what grade to give, and when to publish.

Find a course item by name, or search for an explanation. Keyword results appear immediately; you can ask Jev to review a shortlist using its titles and excerpts. The review separates a relevant title from a passage that helps answer your question. A fixed set of course items stays outside model review and follows keyword order, with membership preserved across searches and course edits.

These reviews track their source. Edit a plan while a request is in flight and the old result becomes stale. The feedback belongs to the version that was actually reviewed.

## Open the work that matters today

Coming Up on the web and Learn on mobile now offer explicit readiness review. It starts with the application's study records: due work, recorded exposure, known prerequisites, and relevant saved answers.

Suppose you have a deck due on derivatives. The review uses the actual due card fronts and relevant work, rather than trying to infer the task from the deck's title. Before asking the model, deterministic checks establish whether the candidate is due and whether the prerequisite information is usable. Candidates that pass those checks receive individual readiness questions, followed by a separate choice among eligible options.

The interface shows the resulting estimates with their status. Your due list stays available throughout, so you can open a card immediately or spend a moment considering the second opinion. Flashcard schedules, mastery records, and your priorities keep their existing meaning.

Freshness is part of this flow. Switching profiles, changing relevant saved work, editing settings, or replacing calibration invalidates an active review. The adapters check between model stages as well as when the result arrives. That prevents a late answer about yesterday's inputs from appearing beside today's work.

For the learner, this puts the question “What should I work on?” beside the evidence already collected in Keating. You still make the choice. The application can now show more of the reasoning that informs it.

## Put calibration to work

The new calibration workflow gives developers a way to connect model estimates to independently labelled outcomes, inspect the result, and install it in the application.

Open Quiz estimate before answering a practice quiz on web or mobile, or choose Estimate before answering in the terminal. Keating saves its prediction, then compares it with the answers it can score directly after you submit. The record keeps the question, model, and whether you opened a hint. Download the record on web, share it from your phone, or export a private file from the terminal to examine the estimates alongside your results.

Start with labelled observations and a policy stating how much error is acceptable. The offline fitter uses one set of groups to choose thresholds, then checks those thresholds unchanged against separate validation groups. It rejects overlapping identities so the same evidence cannot serve both jobs. Approval requires enough independent groups and a conservative bound on error.

For yes-or-no estimates, the report shows how often events actually happened at each predicted probability. It includes Brier scores, which measure squared prediction error, along with expected calibration error and reliability bins that compare predictions with observed frequencies. These measurements use held-out data. Choice and Score get checks based on whether the selected answer was correct and how often acting on it would be wrong. A standalone plot lets you inspect the binary results.

The command writes three artifacts: the calibration file, a readable report, and the plot. Observations preserve the backend identity under which they were collected. A newly fitted identity binds the method, input, and policy together.

Installation then checks two identities: the fitted calibration and the exact bytes of the artifact file. The verifier reconstructs the result from its embedded observations, including thresholds and metrics. This makes the artifact reviewable all the way back to its input.

Import or remove a calibration file in web or mobile Settings. It stays on that device, separate from synced learner work. On load, the application checks the stored file again and matches it to the exact model and question. Replacing the file cancels active operations that depend on it. If saving or reading it back fails, Settings shows the error.

Developers can now test whether saved terminal quiz results produce better estimates. The command checks the original answers and fits a small decision tree: a set of branching rules you can inspect. If that tree beats the raw estimates on reserved examples, the command tries an ensemble that combines many trees. The simpler tree stays unless the ensemble improves on it. Open the report to see both models, their errors, and the records behind the comparison. Install a verified report in the terminal and the quiz estimate uses the selected model, with the original Jev estimate shown alongside it.

The same approach now reaches the rules behind recall estimates and review order. We used Keating's existing teaching harness, drawing on tasks and learner context from MathDial, Bridge and TutorMoments. Jev reviewed 288 practice states for three separate questions: success on a new question, recall after a delay, and the risk of forgetting a due card. Each judgement stays attached to its source and the practice history used to ask it.

Related tasks were kept together, with whole groups reserved for the comparison. The fitted retention and urgency models beat the existing rules on those harness judgements, including both web and mobile review ordering. The mastery candidate lost, so its existing rule stays. Developers can inspect the reports and install the selected fits in Learning Settings. Review predictions show where the fit came from, while saved answers and chosen priorities keep their place.


## Watch a judgement during a reply

Open the developer diagnostics and you can see which backend was selected, the concrete model, the question identity, raw estimates, timing, errors, and fallback behaviour. You can follow a judgement during the reply that triggered it.

This is especially useful when several things could explain an unexpected result. Was a question requested at all? Did the transport fail? Did the model answer but the policy abstain? The inspector presents those as different states. Optional detail capture has bounded storage and redaction controls, while the default view concentrates on metadata.

Developers can also review a reply or a sequence of teaching moves, with each assessment attached to its source evidence. The review desk lets you inspect those proposals and choose which to accept. Prompt evaluation and CLI prompt evolution use typed judgements too, keeping a record of the model behind each comparison.

During debugging, the chat inspector can turn a reply review into a direction for the next response. If the tutor gave away too much, choose **Apply to next reply** to give the learner more room to reason. Other suggestions ask the tutor to explain the next step or clarify the goal. Send your next message and the teacher writes a fresh response using that direction. The adjustment lasts for that reply, and you can cancel it.

Browser prompt evolution now uses the independently configured judge to compare the starting prompt with four proposed revisions. It fixes the scoring method, model identity, and question definitions for the whole run. Only the starting comparison may fall back to the labelled heuristic. If a later judgement abstains, the model changes, or the run is cancelled, the comparison stops without naming a winner. The raw review records remain available for inspection.

Live voice sessions gain an optional **Review live transcripts** toggle in Settings under Diagnostics. Turn it on to review paired learner and tutor transcript text in the live overlay. After a 700-millisecond pause, three separate Choice questions assess the teaching move, the learner's need, and how well the two fit. The review uses a limited, redacted excerpt and the same visual inspector as other judgements. It starts off, follows changes to the transcript and settings, and cancels when the session ends. It neither interrupts speech nor writes learning records.

Before a costly teaching experiment, a spending review examines a limited set of earlier training records. It asks whether they show a failure, whether a new proposal could address it, and whether the evidence supports skipping another attempt. The saved review includes the raw answers and fingerprints of its sources. A proposal still has to pass both independent behaviour checks before becoming active.

Suppose one change improves how the tutor explains a difficult step, while another helps it uncover a misconception. Keating can now keep the best measured change in each category, along with its instructions and results. Later proposals can build on that work. Jev helps choose what to try next, with every fourth selection exploring a less-visited category. Fresh synthetic teaching runs decide which changes keep their place.

Evaluation observations carry backend and calibration identity into the observability path. When a configuration changes, a developer can still work out which model produced an earlier assessment. That makes diagnosis possible across a long experiment rather than only while the original tab is open.

## Take the lesson into GPT Live

GPT Live joins the voice model picker. Choose it, connect your Not Organic account and carry the current conversation into a spoken lesson. Recent messages and the learner's course context go with you, so you can pick up the question you were already working through. The Live surface keeps microphone controls, captions and the way back to chat in one place.

The account connection handles access and a visible session spending ceiling. Review the audio disclosure once, then approve or revoke live consent from Settings. Keating keeps the OpenAI credential on the provider service. Ending a call stops the microphone immediately and gives the service time to return its final usage record.

## Keep useful work close to the device

Desktop and mobile offline execution gain native label scoring through their application bridges. Supported local models can answer small typed questions using the same judgement contracts as the rest of the application. Generation and scoring share the runtime's lifecycle and cancellation controls.

The CLI gains optional local recall through Needle and Cactus. A configured runtime indexes a bounded selection of saved evidence and recent learner-message windows, then retrieves source material with exact offsets. The tutor can recover a relevant piece of earlier work while keeping a reference to where it came from.

Cache reuse is tied to the model assets and source identity. Changed or removed evidence is excluded on subsequent retrieval. Deadlines and process cleanup bound each operation, and the existing context path remains available if recall fails. The local index keeps embeddings and selected evidence in private learner-scoped storage.

An interest mentioned in one session can become useful context in the next. With memory review enabled, Needle picks an exact learner quote and separate judgements assess whether it is worth retaining and which category it belongs to. Saved memories keep their source and review record. This path now reaches CLI, web, desktop and mobile. On shared local runtimes, new memory reviews wait until the tutor finishes its reply.

Turn on recall in Learning Settings to bring earlier work into your next question. On desktop, a 36 MB model download stays in the app's data directory across restarts; you can follow its progress, cancel it or remove it. Your phone has a 35 MB download and a **Search by meaning** action in the Library. Browser recall runs locally after a one-time download too. Before a reply, Needle selects exact excerpts from earlier learner messages and sends them with your question to the tutor you choose.

Model downloads are easier to live with, too. Close the browser-model picker or move to another route and the active download remains visible. Progress distinguishes checking support, downloading files, and loading the model into memory. You can keep using Keating or cancel the download from the persistent status panel.

And if your lesson takes a musical turn, Strudel snippets now go directly to the isolated music sandbox. They keep their editable code and copying controls, with the music interface ready to play the pattern. The application recognizes the purpose of the snippet instead of offering JavaScript-shaped music to the general Node runner.

## Follow a teaching action into the research pipeline

The tutor answers; the learner responds. They might describe their confusion, make an error in the next exercise, or mark the explanation as useful. Keating now keeps a clearer connection between those events and the teaching response that preceded them.

Questions, answers, messages, and teaching actions keep their links and timestamps as they pass through the terminal tools and shared documents. Mobile preserves those distinctions when exporting saved work and training data. Explicit feedback takes priority over a signal inferred from the next message. A weak conversational signal keeps its source attached and receives a deliberately low weight.

Export review gains resumability and stronger judge identity. A paused job can retain its provenance when it resumes; changed or missing identity is surfaced. This is particularly useful for reviewing a collection of sessions over time, when the configured provider may change between runs.

Research episodes run through the same Pi teaching runtime used by the application. They preserve the work delivered to the learner and the learner's subsequent actions. They also capture the original token IDs and probabilities while the tutor generates its response. Training can then update the response the model actually produced.

Those records support several kinds of training export: inputs for an independent observer, passages to learn from directly, comparisons between preferred responses, and records that include what happened next. Each has evidence requirements. Independent review checks whether a delivered action qualifies. Missing or invalid evidence remains visible in the export so a researcher can see why an action was left out.

Pick a response in a research export and you can trace it back to the request, the work delivered, and the learner event used to assess its consequence.

## Explore the teaching decision itself

The research tools check source material and scenarios before running them. They support different instructions and sampling methods, simulated learners, reviews of completed episodes, and reports of training updates. Each captured model output stays linked to the teaching action it produced. Researchers can also branch one accepted situation into several responses: a hint, a worked example, or a task that asks the learner to apply the idea elsewhere.

Pinned source datasets give these situations an inspectable starting point. TutorMoments and MathDial adapters preserve source families and distinguish the material visible before an action from later replies and evaluation material. The dataset explorer places original excerpts beside their adaptations, so a reviewer can follow what changed.

To examine the signals inside a response, an independent observer measures a model whose weights stay fixed. We compare three sources of information: the response text, the model's raw internal activations, and features extracted by a sparse autoencoder, or SAE. The SAE represents an activation using a small set of features. A fitted readout checks whether those features help identify a property of the teaching action.

The experiments record which model revision and layer supplied the activations, how they were extracted, and which source families went into each split. Preprocessing uses training data only; calibration and test groups stay separate. Open a notebook to inspect saved captures, feature scores, source labels, update calculations, costs, and the behaviour of each saved model checkpoint.

One source-action experiment used **200 independent families**: 120 for training and 40 each for calibration and test. On the held-out 40-family set, the SAE readout achieved **0.92 AUC** for identifying a particular source teaching move, compared with **0.78** for the raw representation. The primary text fit was effectively a majority baseline. The report keeps those baselines together so readers can assess the comparison.

An authored premature-answer experiment provides another view, with contrast records and feature contributions that can be inspected at the token level. These experiments are useful because they give a proposed signal somewhere concrete to succeed or fail.

## Sometimes the right move is to explain

A learner has tried twice and is still making the same mistake. Another learner is halfway through a promising approach. Give both the same worked explanation and its role changes completely.

That observation drives the contextual reward work. It classifies learner need from the visible conversation, locates the tutor's delivered moves, and assesses their fit, substance, and correctness. Context-flip pairs put the same response in different situations. A helpful explanation in one can become an interruption in the other; a question can open up thinking or leave someone stranded.

Two terms guide training. The feature term, **F**, assesses the teaching action itself. The hindsight term, **S**, uses a restricted set of information from the next learner event that actually occurred. Each term has its own weight and diagnostics, so researchers can inspect where the two agree and where they pull in different directions.

Each action contributes through its original completion tokens. Learner messages and tool results stay in the context, and highlighted text spans retain their own source offsets. This keeps the training target connected to the actor's contribution to the exchange.

The first contextual expansion accepted **478 model-reviewed examples from 48 source families**. Incomplete sources were deferred, and review rejected a pair in which “Exactly right” affirmed a learner who had only expressed confusion. The accepted examples preserve these review decisions and split assignments.

A later expansion is queued across sixteen domains with a **32,000-contrast target**. Music, mathematics, and the other subjects supply different situations in which to test the same central question: what kind of help fits this moment?

The teaching-v4.1 challenge revises **73 learner messages across twelve cases** to make those distinctions more realistic. Its predecessor remains frozen, so the v4.0 checkpoint results continue to describe the exact challenge on which they were collected.

## The first updates and their results

The pipeline has now carried feature and hindsight signals into real optimizer updates. In the feature-only, hindsight-only, and combined experiment, each arm updated the same two native teaching actions from a shared starting checkpoint, with separate optimizer state.

The follow-up sampled **64 fresh responses**. The initial, feature-only, and combined arms each passed **10 of 16** cases; hindsight-only passed **9 of 16**. The comparison found no improvement. It gives the next experiment a concrete starting point, with the inputs, updates, and behaviour available for inspection.

Controlled generation offers a different test. Across **six paired tasks and 30 continuations**, a selected SAE direction changed some token sequences, while the independently reviewed criteria stayed unchanged relative to baseline. The archive includes those continuations and the reviews, making it possible to examine the exact point where the outputs diverged.

The original teaching-v4 suite also completed **all twelve cases through real Pi** with authored offline responses. That exercised the runtime path. In the paid checkpoint pilot, **one of four** scheduled case–checkpoint slots completed; that conversation received **4 of 8** rubric points in a separate review. The other paths exposed malformed output, tool loops, and a halted bridge. Those are recorded results we can use to improve the next run.

Subsequent experiments can track which checkpoint an update came from, which examples it revisits, and which material it should still remember. The replay, curriculum, and retention contracts preserve those connections for comparisons over time. A larger pilot has an execution plan for **180 episodes**.

Another offline framework asks what a question could teach us about a learner. It starts with a finite set of possible profiles and keeps observations, unknowns, and authored assumptions separate. Given a supplied answer, it calculates how the probabilities assigned to those profiles change. Researchers can compare candidate questions against a specific decision before trying such a policy in a product interaction.

## Open the notebooks, read the story

The companion report, [Learning from the next turn](https://learning-to-teach-report-production.up.railway.app/learning-from-next-turn/), follows this work through examples, source excerpts, saved results, and the decisions they prompted. You can explore datasets, inspect benchmark diagnostics, compare generated responses, and examine token-level probe contributions.

The static package works offline. Its controls filter and recompute views of the supplied evidence. Printable reports and local notebooks provide other ways to work through the same material, including the mathematical details of the updates.

The user guides have been rewritten around the tasks people come to Keating to do: start a lesson, choose a model, prepare offline use, protect learning data, practise, and return to saved work. New demonstrations follow a CLI workflow, a TUI session, and a lesson using the same named learning scenario across surfaces. Videos have native controls, posters where available, and direct downloads.

Start with the [first-lesson guide](https://docs.keating.help/start-here/), the [visual walkthroughs](https://docs.keating.help/visual-guide/), or the [privacy and learning-data guide](https://docs.keating.help/privacy-and-data/). The [developer handbook](https://dev.keating.help) covers setup, while repository tasks and capability-based sandbox profiles support the new native research workflows.

## What is still open

The GPT Live client, authenticated relay and Not Organic consent and billing changes are deployed to production. No paid Live session was opened during release preparation, so provider access and microphone and speaker behaviour still need a live check. This route carries voice and lesson context; use chat for tools and artifacts, and another Live provider for images or video.


**Learning outcomes.** The reported probe scores concern classification of source actions or authored contrasts. The checkpoint comparison found no improvement, and the controlled-generation experiment changed text without improving the reviewed criteria. These experiments do not establish better human learning, retention, or transfer. The controlled-generation archive is missing two planned capability tasks; the 180-episode pilot is prepared but unrun. Sibling training updates are not yet a validated continual-learning sequence.

**Calibration.** You can collect predictions in the shared practice quizzes on web, mobile and terminal. Exams and older quiz flows are not covered. Terminal estimates require earlier saved work on the same topic and currently support choice questions. Start the estimate before opening an answer or hint; restored terminal attempts cannot receive a new estimate. Keating records hints opened inside the app. Outside help is unknown. Records stay on your device. On web, collect from one tab at a time: simultaneous tabs can overwrite saved records.

The release includes tools to fit and install calibration. Building a production calibration still requires real learner outcomes with independently checked labels; no such dataset or fitted calibration is bundled. The automated tests use fixtures. The file verifier checks calculations and consistency. The accuracy of the underlying labels needs its own check. Readiness suggestions remain advisory without a matching calibration. A confident choice or a similar search result cannot establish what someone learned.

The terminal can consume fitted quiz predictions; web and mobile quiz estimates still show the raw model result. No production quiz model is bundled. The saved outcome records a correct answer without an in-app hint; outside help remains unknown. Repeated work from the same learner or task family belongs in one group. Both models are compared on the same reserved groups, so judging how well the selected model works on new learners requires fresh evidence.

The new retention and urgency fits measure agreement with Jev on source-grounded harness scenarios. Their subsequent practice counts and delays are explicitly simulated. The 36 source families, rather than their 288 variants, define the independent groups. These results support the selected harness policies, not a claim of improved human learning. Private fit files retain their original source licenses and are imported separately; they are not bundled into the public package.

**Scope of evidence.** A completed study item records exposure, a declared profile records what the learner chose to share, and a model review supplies an assessment. None alone establishes mastery. The finite user-model demonstrations contain zero real respondents. The sixteen-domain corpus figure is a queued generation target; completed accepted counts come from the actual exports, and synthetic profile variants do not count as independent people. The accessibility controls implement reading preferences without claiming a clinical outcome.

**Remaining integration.** Needle recall has a verified Linux CLI path, browser WASM engine check and desktop native-bridge check covering installation, restart and reply context. Its desktop worker also ran from a packaged Electron archive. Linux packages, a Windows installer and a signed Android APK are built. Android native scoring compiled for ARM64 and x86_64; Needle embeddings support ARM64. Device inference, native Windows installation and browser interaction checks remain with the user, and the Windows installer is unsigned. iOS compilation remains unverified. Completed-reply adjustments require explicit acceptance in the chat inspector. Applying live transcript feedback during speech remains open, along with fitted duration bands and a controlled Sol comparison. Older scalar engagement helpers keep their fallback rules where the required assessment or review history is unavailable.

**Memory.** Automatic saving has its own opt-in setting. Both review questions need thresholds fitted to labelled examples; none are bundled, so quotes remain unsaved until that calibration is supplied. Saved quotes are tentative and cannot displace memories you explicitly recorded. The cross-platform admission paths have code tests; hosted calibrated admission and memory usefulness still need evaluation.

**Verification and release status.** Release preparation completed **656 root tests**, **1,971 web tests**, and the root plus Vite and Nitro production build. Keating web and the Not Organic Live integration are deployed. Fresh browser, manual, device, and provider checks remain separate, as does package publication. The versioned installation commands below apply once the 4.0.0 package is available in the registry.

## Try a lesson

Open [keating.help](https://keating.help), set the preferences that matter to you, and bring a question you have been working on. Save an answer and request a review, or build a plan and examine it before starting. If you are developing with Keating, open the judgement diagnostics alongside that session and follow the request through.

For the CLI, install or update with npm:

```sh
npm install -g keating@4.0.0
keating shell
```

Or use Bun:

```sh
bun add -g keating@4.0.0
keating shell
```

Installed clients can use `keating login` for the supported Not Organic account flow, with `--judgement` to request the additional capability. The [model setup guide](https://docs.keating.help/choose-a-model/) covers the available alternatives.

The session can begin with something small: a fraction comparison, a few bars of music, a confusing paragraph in a course. Keating 4.0 gives that work more places to go. You can keep the answer, inspect the feedback, revise the lesson, and return to the next attempt with the earlier work still in view.

## Release coverage


| Area | Included work |
| --- | --- |
| First use and preferences | Optional onboarding and profile editing; saved pursuits; language and accessibility settings; a resumable tour with aggregate progress counts |
| Teaching judgements | Shared answer types and routing; hosted and local models; account permissions; model identity; cancellation and diagnostics; optional live transcript review |
| Learning activities | Saved-answer and rubric review; lesson plans; course design and submission review; search relevance |
| Study selection | Readiness review in web Coming Up and mobile Learn, using due work and prerequisite checks |
| Calibration | Fitting from observed outcomes; independent validation; reliability reports; file verification; local installation on web and mobile |
| Local execution | Desktop native label scoring; CLI, desktop and mobile Needle recall; mobile meaning search; persistent model-download status; Strudel music routing |
| Review and export | Linked learner events and timestamps; traced conversational signals; mobile export parity; resumable judging; reply, sequence, and prompt review |
| Teaching evolution | Typed evaluation; prompt comparisons with a fixed scoring method; spending review; source records; independent promotion checks |
| Native research | Source and scenario checks; Pi episodes; sampling; original token capture; action comparisons; training exports and updates |
| Measurement and datasets | Text, raw-activation, and SAE probes; splits by time and source family; contextual rewards; source adapters and expansion queues |
| Research continuity | Checkpoint ancestry; replay and retention contracts; finite learner profiles and calculations of what a question could reveal |
| Research communication | Notebooks; source and text-span inspectors; figures from saved results; offline and printable reports |
| Documentation and maintenance | Task-oriented guides; refreshed demos; video controls; development tasks; sandbox profiles; synchronized release versions |
