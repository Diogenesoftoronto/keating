# Two learners asked to guess. Both got a Question.

Keating showed an answerable Question on the first tutor reply in both pre-registered synthetic cases. Neither learner named an interface. The browser selected and submitted **4 layers** on the repeated paper-fold problem and **Blue** on an unseen sock-draw problem. Both answers appeared in local storage with grading pending and a null score. Each submission used zero additional provider calls. [Pre-registered prompts and criteria](protocol.json) · [Measured outcomes](summary.json)

| Learner opportunity | Earlier result | Result with teaching policy v2.4.1 | Composer to reply | Actual Jev pair overlap |
| --- | --- | --- | ---: | ---: |
| Guess the layer count after folding paper twice | The same learner prompt was withheld despite three private Question drafts. | Three eligible drafts. The selected Question offered 2, 4 and 8 layers. The browser committed **4 layers**. | 14.99 s | 95 ms |
| Guess the more likely colour when drawing from two blue socks and one yellow sock | First observation of this prompt. | Three eligible drafts. The selected Question offered Blue and Yellow with no surrounding explanation. The browser committed **Blue**. | 8.56 s | 78 ms |

The paper-fold case put 17 words of tutor prose outside its Question. The sock-draw case put all the learner-facing content in its Question. Both screens presented unmarked choices and left the answer for the learner to supply. Each local submission completed through the real Question handler and left exactly one pending grade. [Paper classroom](paper-fold-classroom.png) · [Paper submission](paper-fold-after-action.png) · [Sock classroom](sock-draw-classroom.png) · [Sock submission](sock-draw-after-action.png)

## What Jev and the tutor did

Jev judged a learner response was due with probability 0.87 for paper and 0.88 for socks. The browser gate created four drafts on each turn. In each pair, one tutor request retained its ten tools and the other received a tool-free instruction to author one Question using OpenUI. The four actual tutor HTTP bodies were distinct on each turn. The two specialized drafts, slots 2 and 4, passed independent release checks on both cases. One of those four private Questions used free text. The other three used choices. [Provider request and decision ledger](ledger.json)

On paper, ordinary draft 1 revealed “Four layers total” before inviting a guess. Jev preferred it in pair 1, but its independent answer-leak finding was 0.98. The release check excluded it and advanced eligible draft 2. Ordinary draft 3 beat that finalist and supplied the published Question. On socks, specialized draft 2 beat ordinary draft 3 and supplied the published Question. In both cases the learner received exactly one control to answer. [Paper candidates, checks and saved submission](paper-fold.json) · [Sock candidates, checks and saved submission](sock-draw.json)

Jev made both pair comparisons concurrently on both turns. The four tutor HTTP requests overlapped for 1,457 ms on paper and 1,412 ms on socks. The pair HTTP windows overlapped for 95 ms and 78 ms, while their wider gate intervals overlapped for 175 ms and 163 ms. Both Settings rows record the actual decision model, policy version, candidate numbers, eligible finalists and timings. The order in which concurrent HTTP requests reached the provider can differ from the numbered slots assigned by the gate. [Settings recording](settings-export.json)

## Comparison and limits

The earlier five-case test used the same MiniMax M2.7 Highspeed tutor, Jev 1.14.0 judge, browser classroom and paper prompt. It released the correct and wrong tile feedback, the one-word copper response and the adjustable toy-train Simulation. It withheld the paper Question. Using those exact saved planning and candidate data with local pair-choice responses, the updated code retained all four earlier releases and the working train renderer. Replaying the earlier paper candidates still withheld them. The subsequent live run made fresh candidates, so the outcome reflects the new policy and new model samples together. These purpose-selected cases measure these classroom behaviours and leave broader production rates and learning outcomes unknown. [Earlier five-case report](../jev-paired-feedback-2026-11-18/README.md) · [Source-matched offline replay](offline-routing.json)

The local release-worktree classroom made 24 successful, metered requests across the two physical learner turns. They comprised 8 tutor generations, 2 Jev plans, 8 independent draft reviews, 4 pair comparisons and 2 final choices. Recorded token usage accounts for **$0.067113672** under the **$0.75** phase ceiling and brings the cumulative study bound to **$3.137837464** of **$10**. Invoiced total is unknown. The archived accounting and exact source digest are in the ledger. [Accounting](ledger.json)

Open the Settings recording in the inspector, or run these offline from the repository root.

~~~sh
rtk bun src/cli/main.ts openui-diagnostics docs/benchmarks/jev-paired-prediction-2026-11-18/settings-export.json --view pair-reviews --limit 10
rtk bun scripts/openui-diagnostics/probe-jev-pairs.mjs --verify docs/benchmarks/jev-paired-prediction-2026-11-18
rtk bun scripts/openui-diagnostics/probe-jev-pairs.mjs --preflight --prediction
~~~
