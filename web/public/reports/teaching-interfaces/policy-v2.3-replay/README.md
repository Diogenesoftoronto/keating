# The conveyor’s prediction prompt

The learner asked to change conveyor speed and skip test questions. Under v2.2, MiniMax’s second draft delivered two sliders and two calculated readouts. The brief required the learner to predict the result before touching the controls. Gemini Decision approved that draft. The reply also contained 143 words outside its Simulation. [Original tutor and review receipt](https://github.com/Diogenesoftoronto/keating/blob/main/docs/benchmarks/openui-audit-2026-11-18/policy-v2.2/receipts/conveyor--google.json "Repository source online")

The v2.3 replay starts with those exact tutor bytes and the original Google planning decision. The application removes the initial 164-character prediction instruction from the optional brief. It keeps the directions to move the speed slider and try halving the spacing. The two controls, their ranges and units, both formulas and all 143 outside words are identical. The gate sent the edited draft, including all the surrounding prose, for review. [Before and after](replay.json)

| Review available for the edited draft | What the web gate published |
| --- | --- |
| No provider review | Withheld the candidate |
| Passing test fixture | Released the exact edited Simulation |

No provider reviewed the edited draft in this replay. The learner-facing acceptance rate for v2.3 cannot be inferred from the fixture. The original provider decisions and tutor generation are the only model observations in this comparison. [Release paths and source digests](replay.json)

The same six recorded planning decisions also reproduce the effect of a narrower goal instruction. Both Jev and Gemini had called for goal capture on the conveyor, the direct perimeter answer and the subscription-seat adjustment. The v2.3 projector removed all six instructions and both conveyor pacing directives. Its original interface offers on all six decisions were preserved. [Per-provider plans](replay.json)

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/policy-v2.3-replay/run.mjs --verify
```

The runner verifies the original ledger checksum and provider wire hashes, recompiles the controls, then exercises the v2.3 web release gate twice with the saved tutor message. On a later policy version it restores the archived v2.3 sources into a private directory first. Both replays use one fixed draft and no network. The checks are post hoc and add US$0 to the study. [Replay program](https://github.com/Diogenesoftoronto/keating/blob/main/docs/benchmarks/openui-audit-2026-11-18/policy-v2.3-replay/run.mjs "Repository source online")
