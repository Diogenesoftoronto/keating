# Do the planners recognize these learner cues?

Jev’s plan matched all six prelabelled dispositions. Gemini Decision 1’s matched five. Both offered a Question on the two predictions, and both left the short fact and account request free of interface offers. The difference was the request to play with the printer’s numbers and skip a quiz. These are planning results from six synthetic conversations, with one observation per case and provider. Tutor replies, classroom rendering and learner outcomes were unobserved. [Frozen cases and rubric](./protocol.json) · [Full plans](./results.json)

| Learner cue and context | Expected | Jev 1.14.0 offered | Gemini Decision 1 offered |
| --- | --- | --- | --- |
| “Let me guess first.” A bead will be drawn from a jar. | Question | Question | Question |
| “Can I predict first?” Two cars start on different ramps. | Question | Question, Simulation, ConceptMap | Question, Simulation |
| “I want to change this, and see what happens.” A variable resistor affects current. | Simulation | Simulation, ConceptMap | Simulation, ConceptMap, Fieldwork |
| “Let me play with the numbers. No quiz for now.” Printer speed and runtime determine output. | Simulation with no assessment | Simulation, ConceptMap | No offer |
| A short factual request for the number of sides of a hexagon | Ordinary text | No offer | No offer |
| “I want to change my password, and see my account” | Ordinary text | No offer | No offer |

An offer can contain alternatives. The predeclared family test counted success when the expected component appeared among them. Jev offered the expected family on 4/4 action opportunities and Gemini on 3/4. Both respected the two controls. No plan offered a Quiz. [Rubric](./protocol.json) · [Decisions and full alternatives](./results.json)

On the printer case, Gemini assigned 0.849 to a hands-on request, 0.953 to a variable relationship and 0.876 to declining assessment. Its 0.356 probability of a learning task fell below the v2.1 application’s 0.4 cutoff. With no positive practice decision, the application returned an empty offer. Jev’s learning-task probability was 0.68, above the 0.6 threshold, and its plan included Simulation. Both declined the assessed checkpoint. [Provider answers and session plans](./results.json) · [Historical application sources](../replay-source/source-manifest.json)

Both planners marked a learner response due for exactly the two prediction cases. The separate, broader instruction to choose a next step and let the learner respond appeared in five Jev prompts and three Gemini prompts. On the short fact, Jev’s prompt contained both the instruction to answer briefly and stop and this general instruction. Gemini’s prompt contained only the direct-answer instructions. On the password request, Jev supplied a generic goal-scaffolding directive and Gemini supplied no turn-specific directives. The probe stopped before a tutor could act on any of them. [Recorded directives](./results.json)

## Check the observations

The protocol and request hashes were frozen at 16:32:33 UTC on November 18, before the first dispatch at 16:32:47 UTC. Each pair used an identical 39-question application request with the same synthetic context. Each provider received its official wire representation. Jev echoed its exact model ID in all six responses. Google returned all 39 typed answers and usage on every call to its named Decisions endpoint. Its success envelope omitted a resolved model revision. The offline verifier decodes the recorded provider responses and replays the application planner up to its tutor prompt boundary. [Frozen manifest](./manifest.json) · [Shared application requests](./requests.json) · [Provider responses](./ledger.json)

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/verify-historical.mjs cue-paraphrases
rtk proxy jq '.cases[] | select(.id == "play-with-numbers") | {request, requestSha256, wireSha256}' docs/benchmarks/openui-audit-2026-11-18/cue-paraphrases/requests.json
```

All 12 calls returned HTTP 200 and usage. Jev returned 24,149 input and 4,488 output tokens, worth US$0.001014258 at its published rate. Google returned 28,600 input and zero output tokens, worth US$0.002860000. This phase adds **US$0.003874258** at list price. Including the earlier failure reserves, the complete study accounts for **at most US$1.643732256** of the US$2 authorization. Actual invoice charges were unavailable. [Ledger](./ledger.json) · [Earlier accounting](../gemini-decision/summary.json) · [TypeSafe pricing](https://docs.typesafe.ai/models) · [Google pricing](https://aistudio.google.com/docs/pricing#gemini-decision)
