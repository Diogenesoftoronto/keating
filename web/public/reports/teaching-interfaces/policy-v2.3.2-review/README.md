# Can the learner find the bug?

Fable found two problems that a count of editable interfaces missed. One starter skipped the first item but still printed every even number on its supplied input. Another annotated the faulty line before the learner had a chance to find it. We sent all four original MiniMax drafts to both Jev 1.14.0 and Gemini Decision 1 for a fresh review. Each provider saw the same full draft, including the native page arguments. Two typed questions asked whether the input exposed a bug and how much the reply disclosed about its solution. We recorded the expected answers before dispatch. [Inputs](./requests.json) · [Expected results and rationale](./examples.json) · [Provider answers and probabilities](./summary.json)

| Original MiniMax draft | What the supplied code does | Jev’s review | Gemini Decision’s review |
| --- | --- | --- | --- |
| Jev-guided, first draft | Correctly prints all three even numbers. Its native page description names the skipped index. The description appears during loading or fallback. | Called the bug observable (0.92 confidence) and the task independent (0.66). | Chose observable (0.55, below the gate threshold) and independent (0.84). |
| Jev-guided, released | Prints all three fruits and then raises `IndexError`. The diagnosis stays with the learner. | Observable, independent. | Observable, independent. |
| Gemini-guided, first draft | Counts two long words where there are three. The text gives the expected result. | Observable, independent. | Observable, independent. |
| Gemini-guided, released | Prints 9 where the sum is 13. A comment next to the faulty slice tells the learner to include every number. | Observable, line clue (0.76). | Observable, line clue (0.62). |

Each reviewer matched three of four reference labels on each question. Both missed the same masked example and the diagnosis in its page description. Both recognized the clue on the released sum. No new tutor replies were generated. This is a post-hoc check on four known examples. It measures reviewer behavior on those examples and supplies no estimate of general code quality or human learning. [Fixed-code interpreter check](./check-examples.py)

### How the application handles the missed example

Policy v2.3.2 asks the two review questions when a learner wants a new independent debugging exercise. A confident finding of a masked example or a disclosed fix requests repair. A line clue is a minor finding. With multiple otherwise acceptable replies it can help favor the one that leaves more for the learner to discover.

The local v2.3.3 follow-up also checks a small class of literal integer-list programs against an explicit goal to collect every even or odd number. It compares the results by inspection and leaves unsupported programs to the reviewer. In the Jev-guided first draft it establishes that the listed input masks the fault. Other possible inputs on the associated native page remain unverified. Its learner-visible description states the exact diagnosis, which independently blocks release. The other three saved programs fall outside this check. This replay reused the paid decisions and generated no new tutor response. [Recorded application checks and dispositions](../policy-v2.3.3-proof/replay.json)

The original gate had already rejected this first draft for an empty OpenUI fence. The new check identifies a second reason it would have been a poor exercise. On the still-usable sum, both reviews request an optional improvement to the line clue. With only that draft available, the original Gemini Decision review still permits release. The paired replay left all four historical tutor outputs intact.

The original captured wire bytes and all eight successful provider responses are preserved. The eight reviews added US$0.004183064, bringing the conservative bound for all studies to **US$1.91711828 of the authorized US$2**. The total includes the earlier US$0.12 reservation for an unobserved tutor timeout. [Frozen review protocol](./protocol.json) · [Cost and responses](./summary.json)

From the repository root, the following commands replay the provider adapters on their saved responses and check the four hash-pinned snippets with local Python.

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/policy-v2.3.2-review/review.mjs --verify
rtk python3 -I -S docs/benchmarks/openui-audit-2026-11-18/policy-v2.3.2-review/check-examples.py
```
