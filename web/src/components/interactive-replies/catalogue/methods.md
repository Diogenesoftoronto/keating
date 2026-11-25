<!-- Model-facing schema for `MethodsLab`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/lanes/methods/CATALOGUE-DELTA.md. -->

## `MethodsLab` (kind `methods`): a paper's methodology, handled directly

Write it in an openui fence as `MethodsLab(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Teaches:** how a study's design or analysis produces its number. The learner draws the causal diagram and adjusts for variables (`dag`), drags the edges of groups among 1,000 tested people (`diagnostic`), drags event and censoring marks on patient timelines (`survival`), or drags trials on a forest plot (`meta`). Every number is recomputed from the model.

| Question | Mode |
|---|---|
| confounding, "should they have adjusted for X", collider / selection bias, the obesity paradox, Berkson's bias, mediators, overadjustment, M-bias | `dag` |
| PPV/NPV, base-rate neglect, screening, sensitivity vs specificity, likelihood ratios, pre/post-test probability, cut-offs and ROC | `diagnostic` |
| Kaplan–Meier, censoring, median survival, hazard ratio, log-rank, randomisation balance, crossover, ITT vs per-protocol | `survival` |
| forest plot, pooled estimate, weights, fixed vs random effects, heterogeneity / I², funnel plot, small-study effects, file drawer | `meta` |

**Not for:**
- **Regrouping a real table of counts** (Simpson's paradox in admissions or kidney-stone counts, rates recomputed from rows): `DataExplorer` shows what happens when you stratify. `MethodsLab` `dag` decides which variables to stratify on and why, including when it makes things worse (mediators, colliders). "Why did the gap reverse in these counts?" → `DataExplorer`; "should we adjust for X / is this confounded?" → `MethodsLab`.
- **Whether a passage's words support a claim**, or drafting a better conclusion: `EvidenceBoard` works on the words of a paper, `MethodsLab` on the machinery of its methods.
- **Patient-specific decisions.** Never configure it with a real patient's numbers to advise testing or treatment. The diagnostic mode carries "Educational model, not for clinical decisions."
- General probability puzzles with no study design, regression output, power or sample-size calculations, PK or dosing (`PharmLab`), individual prognosis.

**Config** (`MethodsLabConfig`; validation is closed, unknown keys are errors). Every mode also takes `title: string` (≤ 90) and `source?: string` (≤ 600). The first sentence of `source` shows under the canvas, the rest behind "More": keep it self-contained, and say "illustrative" there if the data are made up.

```ts
type DagConfig = {
  mode: "dag"; title: string; source?: string;
  exposure: string; outcome: string;                 // variable ids (different)
  variables: {                                       // 3–9
    id: string;                                      // /^[A-Za-z][\w-]*$/, unique
    label: string;                                   // ≤ 18 chars
    x: number; y: number;                            // 0–1 fractions of the canvas
    measured?: boolean;                              // default true; unmeasured can't be adjusted (dashed node)
    note?: string;                                   // ≤ 160, tooltip
  }[];
  edges: { from: string; to: string; why?: string }[];  // ≤ 24, the reference causal story; acyclic; why ≤ 220
  drawn?: { from: string; to: string }[];            // arrows on screen at the start (default: all of `edges`)
  adjusted?: string[];                               // the paper's adjustment set at the start (measured, not X/Y)
};

type DiagnosticConfig = {
  mode: "diagnostic"; title: string; source?: string;
  condition: string; test: string;                   // ≤ 40 each
  population: string;                                // ≤ 90: shown as "1,000 <population>"
  prevalence: number;                                // 0.001–0.99
  sensitivity?: number; specificity?: number;        // 0.01–0.999; required unless `scores`
  scores?: {                                         // binormal score model → drag a cut-off; omit sens/spec
    label: string; unit?: string;
    healthy: { mean: number; sd: number }; disease: { mean: number; sd: number }; // disease.mean > healthy.mean
    threshold: number; min: number; max: number;     // positive = score ≥ threshold; min < threshold < max
  };
  predict?: boolean;                                 // hide results until the learner guesses P(condition | positive)
};

type SurvivalConfig = {
  mode: "survival"; title: string; source?: string;
  endpoint: string; unit: string;                    // "death"/"relapse"; "months"/"weeks"
  horizon: number;                                   // axis end ≥ every time
  arms: [{ id: string; label: string }, { id: string; label: string }]; // [control, experimental]
  patients: {                                        // 4–48, ≥ 2 per arm
    id: string;                                      // ≤ 4 chars
    arm: string; time: number; event: boolean;       // event false = censored at time
    risk?: "high" | "low";                           // prognostic factor → balance row, "Randomise again"
    switchAt?: number;                               // crossover time (0 < switchAt < time) → ITT vs per-protocol
  }[];
  riskLabel?: string;
  illustrative?: boolean;                            // prints "Illustrative data" on the canvas and in the share
};

type MetaConfig = {
  mode: "meta"; title: string; source?: string;
  measure: "RR" | "OR" | "MD";
  outcome: string;                                   // ≤ 40
  favours: [string, string];                         // [left of the null, right of the null], ≤ 20 each
  model?: "fixed" | "random";                        // default "random" (DerSimonian–Laird)
  studies: {                                         // 2–10
    id: string; label: string; year?: number;        // label ≤ 22
    // exactly one of:
    counts?: { treatEvents: number; treatTotal: number; controlEvents: number; controlTotal: number }; // RR/OR only
    estimate?: number; lower?: number; upper?: number; // natural scale; ratios > 0; lower < estimate < upper
  }[];
};
```

Authoring notes: in a DAG put the exposure at x≈0, y≈0.5 and the outcome at x≈1, y≈0.5; confounders above (y≈0–0.4), mediators and colliders below (y≈1); keep labels short. **The `why` on each story edge is the teaching**: it is quoted when the learner draws, erases or reverses that arrow, so write a reason with its evidence. Roles (common cause, mediator, collider) are computed, never authored: don't put "confounder" in a label. A build task sets `drawn: [{from: X, to: Y}]`; an appraisal task omits `drawn` and sets `adjusted` to the paper's set. Use `predict: true` when the learner shows base-rate neglect. Use `illustrative: true` for made-up survival data. For a published forest plot prefer `counts`.

**Examples:**

```openui lifecycle=ephemeral id=coffee
root = LearningSurface([reply])
reply = MethodsLab("Is the coffee–heart link confounded?", {"mode": "dag", "title": "Is the coffee–heart link confounded?", "exposure": "coffee", "outcome": "chd", "variables": [{"id": "coffee", "label": "Coffee", "x": 0.02, "y": 0.6}, {"id": "chd", "label": "Heart disease", "x": 0.98, "y": 0.6}, {"id": "smoking", "label": "Smoking", "x": 0.5, "y": 0, "note": "Measured at baseline by questionnaire in most cohorts."}, {"id": "illness", "label": "Early illness", "x": 0.5, "y": 0.36, "note": "Existing illness or early heart symptoms at the start of follow-up."}, {"id": "bp", "label": "Blood pressure", "x": 0.5, "y": 1, "note": "Caffeine raises blood pressure acutely."}], "edges": [{"from": "coffee", "to": "chd", "why": "The effect the paper wants to estimate."}, {"from": "smoking", "to": "coffee", "why": "Smokers drink more coffee, so heavy coffee drinkers are more often smokers."}, {"from": "smoking", "to": "chd", "why": "Smoking is a major cause of coronary heart disease."}, {"from": "illness", "to": "coffee", "why": "People who are already unwell often cut down on coffee (“sick quitters”), so low intake partly marks poor health."}, {"from": "illness", "to": "chd", "why": "Existing illness and early heart symptoms predict a heart disease diagnosis."}, {"from": "coffee", "to": "bp", "why": "Caffeine raises blood pressure, at least in the short term."}, {"from": "bp", "to": "chd", "why": "Raised blood pressure causes heart disease."}], "drawn": [{"from": "coffee", "to": "chd"}], "adjusted": [], "source": "Story after Hernán & Robins, Causal Inference: What If (2020), ch. 6–7. Freedman et al., NEJM 2012 (NIH-AARP) found the coffee–mortality association grew stronger after adjusting for smoking."})
```

```openui lifecycle=ephemeral id=mammography
root = LearningSurface([reply])
reply = MethodsLab("A positive mammogram: how likely is cancer?", {"mode": "diagnostic", "title": "A positive mammogram: how likely is cancer?", "condition": "breast cancer", "test": "mammogram", "population": "women screened in one region (teaching example)", "prevalence": 0.01, "sensitivity": 0.9, "specificity": 0.91, "predict": true, "source": "Teaching problem from Gigerenzer G et al. Helping doctors and patients make sense of health statistics. Psychol Sci Public Interest 2007;8(2):53–96, set among women in an assumed region: prevalence 1%, sensitivity 90%, false-positive rate 9%. Illustrative rates, not a measured test."})
```
