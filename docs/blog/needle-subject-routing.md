# Can a local model choose the subject? What I measured

Keating decides the subject of what you are learning so it can choose how to teach it. A calculus topic gets sequenced into formalism, a medical one gets its evidence level named, a history one gets sources distinguished from interpretation. Ten subject-specific teaching stances live in the prompt today. If a small local model could pick the subject reliably, those ten rule sets could become data instead of prose, the prompt could get shorter, and the decision could run offline on your own machine.

That is the bet I tested. Needle 3 is an 8–29 MB on-device model that does tool calls, structured extraction, and embeddings, and it is already installed in Keating for local recall. I measured it four ways on real data. It is fast and it runs offline, exactly as advertised. On this task, with this data and these descriptions, **it was not accurate enough to be the thing that decides the subject — and on ranking it lost to a keyword table I could have written in an afternoon.**

This post is the results, how the benchmarks worked, and the mistakes I made getting there. It is a negative result about one use of one model, not a verdict on the model. It also puts three open Jev replacements on the same task, against the real thing, on the same machine.

## What was actually running

Everything below ran on real, hash-verified assets, on CPU, on Linux x86-64, through Keating's own runtime — a private Python subprocess that loads a pinned engine and weights and returns JSON:

- Needle `3.0.1`, source revision `b274efcb211a9eef48c9a88da4b43bd569696a39`
- engine `libneedle.so` sha256 `978fce13…3568d`
- weights `needle3.cact` sha256 `c9d915ec…70c38`, 35,335,380 bytes

Mechanically it is quick. Model construction took 185 ms. Warm tool-call classification ran at 82–200 ms per call. A warm call reported 711 tok/s prefill and 302 tok/s decode, at 109 MB peak RAM. Sixteen embeddings took 604 ms. A full end-to-end call through Keating's subprocess bridge — embed plus classify — took 681 ms.

So the question is never speed. It is whether the answers are right.

## Four ways to ask the same question

The task is: given a learner's question, pick the subject. I tried to answer it four ways, from most to least structured.

**One tool per subject.** Declare a tool per field, let the grammar constrain the choice, read the function call. This is the documented shape of the model: "the model answers with calls," and a `Literal` becomes "a fixed set [the model] cannot leave."

**One extraction schema with an enum.** A single `field` argument whose value must come from a fixed list. `needle.extract` returns the record, or `None` when nothing matched.

**Embedding prototypes.** Embed one description per subject, embed the question, rank by similarity.

**Recall.** Skip subject labels entirely. Ask whether the model can retrieve the relevant earlier messages from a learner's history — the thing Keating already uses local recall for.

## Results

Eight representative learner questions, eight candidate subjects (physics, chemistry, biology, computing, history, music, languages, general):

| Method | Exact matches | Notes |
|---|---:|---|
| One tool per subject | **2 / 8** | 5-tool variants scored 1 / 8 |
| Single extraction schema | **1 / 8** | 3 returned `None`, 4 returned the wrong field |
| Embedding prototypes (36 subjects) | **0 / 8 top-1** | 1 / 8 top-3, 2 / 8 top-5 |

Three independent formulations, three failures. The failure is not random noise: with the single-schema version, "how do covalent bonds share electrons?" returned `None`, and "why does recursion overflow the call stack?" returned `history`.

The tool-call version produces a `reasoning` field, which is the most instructive part. Asked about wave-function collapse it answered correctly and explained itself: *"User asks about wave function collapse. Field\_physics returns all collapse data."* Asked about covalent bonds with the same tool set it answered *computing* — a fluent, confident, wrong answer. **The output is always well-formed; only the meaning is unreliable.** With these weights there is also no confidence to catch it: tuned archives report `confidence: None`, so there is no calibrated number to threshold on.

For the recall test I used real data: 90 learner messages from 24 sessions in a real Keating workspace, ranked with Keating's production scoring function, compared against two baselines.

| Query style | Needle R@1 | Needle R@4 | Needle R@8 | Needle MRR | Lexical R@1 | Lexical R@4 | Lexical MRR |
|---|---:|---:|---:|---:|---:|---:|---:|
| Follow-up wording (n=11) | 7/11 (64%) | 9/11 (82%) | 10/11 (91%) | 0.717 | **10/11 (91%)** | **11/11** | **0.955** |
| Paraphrased (n=10) | 1/10 (10%) | 4/10 (40%) | 6/10 (60%) | 0.263 | **3/10 (30%)** | **5/10 (50%)** | **0.415** |
| Random baseline | ~1% | ~4% | ~9% | ~0.06 | — | — | — |

Needle beats chance. It loses to token overlap in both regimes. On paraphrased queries — a learner coming back later, using their own words rather than the words already in the transcript — it retrieves the right message at rank one one time in ten.

## Why ranking fails, not just how often

The more useful finding is *why*, and it is visible in the per-query scores. Keating ranks by standardizing cosine against the corpus mean, and the relevant items are not separated from the irrelevant ones:

| Query | Best relevant | Top irrelevant |
|---|---:|---:|
| "run a mastery quiz on climate change" | z = 0.33 | z = 1.43 |
| "a check on my knowledge of weather patterns" | z = 0.48 | z = 2.17 |
| "why are towns located where they are?" | z = 1.16 | z = 1.35 |
| "the logic that adapts teaching over time" | z = 1.39 | z = 1.58 |

Relevant items sit around one standard deviation above the corpus mean. Irrelevant items routinely score higher. No threshold and no margin gate can separate them, which is the same reason the 36-prototype version failed: the top candidate for "why does a wave function collapse" was `mathematics`, ahead of `physics`, by a margin of 0.023.

The embeddings are not broken. They are compressed into a narrow band where topical relevance barely moves the score — the anisotropy the existing retrieval code already documents and refuses to threshold on.

## The open Jev replacements, on the same task

Within days of Jev's launch, open drop-in replacements appeared. I benchmarked the three that fit the only constraint that matters for shipping: they have to run on this machine's CPU and travel inside the application. That excludes the biggest of them — a 27B chat model crushed to about a bit per weight, which scores well but weighs 3.5 GB and takes 1.7 seconds per decision on hardware faster than mine. Past that size, a network round trip to the real thing is the better architecture.

The three that fit:

- **Von 1.0** — 395M-parameter ModernBERT NLI classifier, Apache 2.0, 1.5 GB. A direct `decide(state, choices)` API.
- **Laya** — 421M-parameter ModernBERT-large, Apache 2.0, 2.2 GB. Choice/score/noul primitives that mirror Jev's.
- **GLiNER2.5-base** — 194M-parameter DeBERTa schema-conditioned extractor, Apache 2.0. Its `classify_text` takes a label list.

Same eighteen questions, same eleven-way choice, same laptop, CPU only, one virtual environment per model — because their transformers requirements conflict with each other, which is itself a packaging fact.

| Model | Params | Correct | Median latency | Confidence on its misses |
|---|---:|---:|---:|---|
| Jev 1.13 (hosted) | — | **18/18** | 306 ms | — |
| Laya | 421M | 12/18 | 807 ms | all six ≥ 0.87, four at 1.0 |
| Von 1.0 | 395M | 11/18 | 1,297 ms | five of seven below 0.4 |
| GLiNER2.5-base | 194M | 9/18 | 130 ms | seven of nine ≥ 0.83 |
| Needle (tool call) | 121M | 2/8 on the first eight | 82–200 ms | none available |

**None of these ships in the application.** At 1.5 to 2.2 GB each, a bundled model costs more disk than the rest of the app, and the three of them want mutually incompatible versions of the same runtime. A 35 MB model is a reasonable thing to carry; a two-gigabyte one is a decision about what the product is. The interesting version of this comparison is therefore not "which one do we bundle" but "which one, if any, is worth serving" — a judgement model on a cheap GPU behind the same request shape, where the application stays small and the accuracy question moves to the server.

Three findings worth more than the accuracy column:

**The CPU inverts the latency story.** The published figures are GPU numbers: Laya advertises 33 ms on a T4, Von 18 ms. On this laptop's CPU the order is GLiNER2 at 130 ms, then hosted Jev's full network round trip at 306 ms, then Laya at 807 ms, then Von at 1,297 ms. Two of the three local models are slower than calling the hosted model. On a GPU that flips completely — which makes the local-vs-hosted question really a do-you-have-a-GPU question.

**Calibration is the quiet failure.** A decision engine's whole value over a plain classifier is that you can threshold its confidence and abstain. Laya returned confidence 1.0 on four of its six wrong answers; GLiNER2 returned 0.83 or higher on seven of nine. Those numbers cannot gate anything. Von is the exception — five of its seven misses came back below 0.4, which is the first honest uncertainty signal any of these models has shown on this task.

**They fail on the same pairs, and they are our pairs.** Code versus mathematics. Medicine versus psychology. Politics versus law. Philosophy versus law. Every model that missed did so inside these clusters, which are exactly the confusable pairs the subject taxonomy has to separate. No unadapted small encoder has them.

This reproduces an independent measurement rather than contradicting it: on the third-party suite the same family of models scored Jev 0.974, the 27B at 0.885, GLiNER2-large at 0.795, Von at 0.769, Laya at 0.590. Our eighteen cases land in the same order. (I ran GLiNER2's 194M base checkpoint — the packageable one — not the 486M large that suite used.)

## The hosted model may still be cheaper

A local model is not automatically a cheaper model. A current public listing for Jev quotes $0.042 per million input tokens and no output-token charge ([OpenRouter's Jev listing](https://openrouter.ai/typesafe/jev-1.13)); RunPod's [current pricing page](https://www.runpod.io/pricing) is the right place to check GPU pricing rather than hard-code one into this article.

The comparison is:

```text
Jev per hour = decisions/hour × input tokens/decision × 0.042 / 1,000,000
Von per hour = active GPU seconds × GPU price/3,600
               + cold starts + storage + service operations
```

At 5,000 input tokens per judgement, Jev costs about $0.00021 per decision at that listed rate. One hundred judgements per hour costs about two cents. A dedicated GPU that costs $0.44/hour therefore needs roughly 2,100 such decisions per hour before its idle time, cold starts, monitoring and maintenance are counted. Serverless billing can change that arithmetic, but only if the platform's active-time and minimum-billing rules are measured rather than assumed.

That makes the product decision less dramatic than the model comparison. Do not ship a two-gigabyte classifier to avoid a few cents of hosted judgements. Keep Jev as the default until a self-hosted model has both a measured quality advantage or a privacy/availability requirement and enough traffic to amortize its endpoint. Von is worth trying as a cheap optional server route after fine-tuning; it is not automatically worth operating.

## How the benchmarks worked, and what was wrong with them

The harness is small: extract learner messages from the session store, embed the corpus and the queries in one bridge call, rank with Keating's production scoring function, compare against a lexical baseline and chance. It lives in scratch files, not in the test suite, because it needs the real model and real data.

It took several bad attempts to get a fair test, and the mistakes are worth stating plainly.

**My first query set was quietly cheating.** Half the queries were near-verbatim copies of messages already in the corpus, which measure self-retrieval and nothing else. I rewrote the set and split it into "follow-up" and "paraphrased", then reported the paraphrase result separately because that is the case that matters.

**I wrote the queries after reading the corpus.** That is a labeling bias, and it favors lexical matching. The paraphrase set exists to remove it — and Needle did worse there, so the bias ran in Needle's favor in the follow-up set. If anything, these numbers flatter the model.

**The corpus is small and narrow.** 90 messages, roughly 25 of them substantive, with a median length of 34 characters because it includes every "hi" and `/help`. Its topics are mostly software and this product, not the academic subjects the taxonomy is for. Treat the percentages as directional, and treat the separation numbers as the more robust signal, since they do not depend on a single threshold choice.

**I used the embedding head for something it does not claim to do.** The documentation describes `agent.embed` as the retrieval head for *tool* retrieval — embedding serialized tool schemas so a large catalogue can render the top five tools per turn. Document-to-document topical similarity is off-label. That is a real caveat and it is the first thing I would revisit: serializing the subject descriptions as tool schemas and using the built-in tool index is the documented path, and I did not test it.

**Two bugs of my own.** I called the similarity helper with the wrong argument shape and spent a while on a `TypeError` from code that had "passed" its tests — the test runner strips types, so a type error only appears at runtime. Run the type checker even when the tests are green. Then I broke a validation expression's parentheses, which failed a whole test file with a parse error and hung a combined run for over a minute until I bisected it file by file.

**A corrupt transfer nearly became a published finding.** Moving the trained archive off the GPU host, I stripped terminal control sequences with a pattern that also ate base64 characters. The truncated file failed to load, and the error it produced — an unrecognised archive format tag — reads exactly like a version-incompatibility between the training toolchain and the runtime that ships. I wrote that conclusion down before checking it. It was wrong: the archive was fine and loads under both runtime versions with identical results. A byte-level check of the first sixteen bytes, against the host, is what settled it. When a failure appears only around a transfer boundary, suspect the transfer before the software.

**Failures are silent.** Every failure path in the runtime collapses to `null`: missing assets, a hash mismatch, a timeout, a malformed answer, and a genuine model abstention are indistinguishable. That is deliberate — local recall must never break a lesson — but it means the pipeline cannot tell you *which* one happened. Measuring any of this required building a harness by hand. A local model you cannot diagnose is a local model you cannot trust.

**The path is host-only, today.** The Python bridge cannot run in a browser tab. The browser and mobile bindings expose loading, embedding, and resetting — not extraction or tool calls. So whatever this decides, it decides in the CLI and the desktop app, not in the web client or on a phone.

One thing I could not resolve: a desktop test that bundles the runtime expects the bundle to print its model identity under Node and gets an empty string, even though I verified the bundle builds and imports correctly with its exports intact. I left it unresolved rather than guess at it.

## What did work

Two things, and they matter.

**Extraction from a supplied span.** Give the model a schema with an enum and a quote field, feed it one real message, and it returns a well-formed record whose quote is an exact substring of the input — the property Keating's memory store enforces and rejects paraphrases for. On a real message it selected `{category: "communication-preference", quote: "diagrams"}`, verbatim. The *category* labels were shaky — it missed an obvious stated interest entirely and labelled a bare question as a learning preference — but the mechanism is sound, and it is the documented use.

**Speed and footprint.** Under a second per decision, offline, on CPU, in ~109 MB. If the accuracy problem is solvable, this cost structure is exactly what an offline tutor wants.

## What I would do next

1. **Test the documented path.** Serialize the subject descriptions as tool schemas, use the built-in retrieval head with a persisted tool index, and re-run the same benchmark. If the head is trained for query-against-schema matching, this is the version that should work.
2. **Fine-tune on Keating's own labels.** Every model card gain cited for this family is on a tuned, product-specific tool set, and the docs are blunt that describing tools well is the whole game. A few hundred labeled topic-to-subject pairs and `needle build` is the standard remedy.
3. **Define success before measuring again.** A paraphrase R@1 at or above the lexical baseline, and relevant items scoring above irrelevant ones at almost every query — not just a better average.

A 171-row labeled set for the eleven families now exists: fourteen or fifteen queries per subject plus sixteen refusals, generated by an external model against the taxonomy specification and validated for shape, duplicates, and coverage. I fine-tuned Needle on 170 of those rows (15% holdout, 8 epochs, 80 GPU steps) on a RunPod A40. The run reported validation loss 0.9309 and exported a 63.4 MB `.cact` archive.

The held-out application probe moved Needle from **1/18 to 7/18** exact choices when compared with the same full eleven-tool vocabulary and the same Needle 3.0.4 runtime. Both numbers reproduce: the models answer identically across repeated runs, so this is a real shift and not sampling noise.

Then I measured the same model on its own training data, and that number is the one to keep. It scores **39/170 (23%) in-sample**. It is not fitting the task it was trained on. Code, law and psychology were never learned at all — zero of fourteen each — and the confusion is structured: those three collapse into `field_science` and `field_politics`, which are also where the out-of-sample probe misses land.

Refusal fared worse. Given inputs no tool should serve — `"hi"`, `"rewrite this paragraph to be shorter"`, `"why is my deploy failing"` — the fine-tuned model still picks an academic field five times out of six. A router that cannot abstain on nonsense will file nonsense under a subject.

So the honest reading is: the pipeline works, the artifact is small, and the training recipe is under-powered. Eighty steps is far too few for the loss to move (it went from 1.02 to 0.85), rank 16 may be too small, and every tool declares an empty argument object, which leaves the grammar nothing to condition on but the name. The fine-tuned archive also has no trained confidence head. This is a useful training result, not a successful subject router.

The export is also portable across the two runtime versions in play. The training container used the 3.0.4 package; Keating pins 3.0.1. I ran the whole evaluation under both and got identical results — base 1/18 and 17/170, tuned 7/18 and 39/170 in both cases. Training with a newer toolchain did not produce an archive the shipped runtime cannot read.

The experiment needs a GPU again for a serious run: at least hundreds or thousands of diverse, human-checked examples, a held-out set from real learner questions, and a separately calibrated confidence head. A 170-row synthetic set can tell us whether the training loop works. It cannot establish that the resulting judgement is safe to automate.

Until then, the deterministic keyword-and-phrase layer stays the authority offline, the embedding tier stays advisory, and a hosted judgement model stays the escalation when a real decision is needed. The local model keeps the job it already does well: finding exact spans in your own words.

The honest summary is that a 35 MB model can read your question and return a well-formed answer about it at interactive speed, on your machine, with no network. What it cannot yet do is tell you reliably which subject you are asking about. The same is true of the open Jev replacements three sizes larger: fast, local, well-formed, and wrong on the same hard pairs. The one model that gets every one of them right is still the hosted one.
