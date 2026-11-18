# Same-input decision comparison

The comparison schedules the same six authored planning probes and nine repaired tutor drafts for each decision provider. The public request set contains the shared application requests and their digests. Reference outcomes and labels are stored separately. The manifest pins both files, the source receipts and the policy implementation. [Requests](./requests.json) · [Reference outcomes](./reference.json) · [Manifest](./manifest.json)

| Evidence | Jev 1.14.0 | Gemini Decision 1 |
| --- | --- | --- |
| Planning decision matched the authored assessment preference | 6/6 | 5/6 |
| Offered interface matched the authored criterion under policy v2.1 | 6/6 | 5/6 |
| Repaired draft passed the unchanged release gate | 6/9 | 8/9 |

Five planning probes use archived prompts. One uses a minimal edit from archived learner wording. The preference and interface criteria were frozen before Jev answered. The v2.1 projector was later adjusted using one of these probes, raising the historical offer result from 5/6 to 6/6 on the same saved answers. [Planning probes](../../policy-v2.1/probes.json) · [Original results](../../policy-v2.1/summary.json)

The nine repaired drafts come from six historical MiniMax turns previously rejected for trailing prose after a checkpoint. They include five primary candidate attempts and four repeat-study attempts. Each review compares the same trimmed tutor text under the same historical planning answers. The replay injects those answers and one provider’s recorded review through a local fixture, preserving the application’s single-provider identity check. The original receipts retain the actual provider names. The unchanged release gate produces an approval or withholding decision and the rules that blocked release. A released draft has no independent semantic quality label in this comparison. [Archived review measurements](../../policy-v2/evidence.json)

Verify the frozen inputs from the repository root. This reconstructs every planning request and review from the retained fixtures, checks its historical Jev HTTP payload hash, and replays all Jev outcomes. The script reads local files and does not need credentials.

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/verify-historical.mjs frozen
```

The paid runner wrote `google-outcomes.json`. The scorer joined its results by case ID and application-request hash, reconstructed the Google HTTP request, checked answers against each saved native response, and applied the same policy. The offline command checks the initial and final comparisons byte for byte. Each row preserves both decisions, recorded model identity, missing evidence and the digest of the input.

## Coverage and disagreements

On the first pass, Google returned six planning decisions and three draft reviews. The other six reviews received HTTP 429. Six individually journalled requests recovered those quota rejections. The final comparison has all 15 paired responses, each verified against its native request and reply. Google accepted the named `gemini-decision-1` endpoint request and provided no independent model revision in these responses. [First-pass comparison](./first-pass-comparison.json) · [Final comparison](./comparison.json)

On the six planning probes, Jev matched the assessment preference and acceptable interface offer on 6/6, and Gemini on 5/6. Both Gemini mismatches occurred on the visual request without a quiz. Jev assigned 0.73 to the learner declining assessment. Gemini assigned 0.421, which the policy treated as an abstention. The resulting offers were Simulation from Jev and no interface from Gemini. On two other probes, the providers offered different sets of controls that both met the authored criteria. Their exact action and offered set matched on 3/6.

The gate decisions agreed on 7/9 repaired drafts. Both released six and withheld the ordering draft for an uncertain answer leak. Jev and Gemini assigned probabilities of 0.51 and 0.472 to that violation. On French recall, Jev assigned 0.64 to a repeated checkpoint and withheld the reply. Gemini assigned 0.197 and released it. On the coding draft, Jev assigned 0.74 to an answer leak and withheld the reply. Gemini assigned 0.298 and released it. The review cohort has no independent labels for semantic correctness. [Case-by-case results and blockers](./comparison.json)

## Direct-answer diagnostic

In the separate end-to-end run, the gate withheld correct replies to a direct perimeter question. This motivated one additional check using a saved answer and the original Jev planning answers. The learner had asked for the perimeter of a square with side length four and requested “Just the answer, please.” The tutor’s entire reply was **16.** The common plan requested no activity. The review request contained the learner turn, the literal reply, and 44 questions selected under that plan.

Jev assigned 0.35 probability to giving away a checkpoint answer and passed the reply. Gemini Decision assigned 0.737467, and the same gate withheld the reply for that single rule. The criterion expressly requires a learner checkpoint. No choice, prediction or exercise appeared in the reply. This diagnostic was selected after observing the end-to-end failure. Its one observation is recorded separately from the fifteen frozen cases. [Exact paired result](./perimeter-check.json)

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/verify-historical.mjs perimeter
```
