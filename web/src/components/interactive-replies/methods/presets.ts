/* MethodsLab presets: real, sourced examples (citations in NOTES.md), plus the chat framing for each. */
import type { MethodsLabConfig } from "./config";

export const presets: Record<string, MethodsLabConfig> = {
  /* Confounding in an observational coffee study. Story after Hernán & Robins, What If, ch. 6–7;
     coffee–smoking confounding: Freedman et al., NEJM 2012; "sick quitters": reverse causation. */
  coffee: {
    mode: "dag",
    title: "Is the coffee–heart link confounded?",
    exposure: "coffee", outcome: "chd",
    variables: [
      { id: "coffee", label: "Coffee", x: 0.02, y: 0.6 },
      { id: "chd", label: "Heart disease", x: 0.98, y: 0.6 },
      { id: "smoking", label: "Smoking", x: 0.5, y: 0.0, note: "Measured at baseline by questionnaire in most cohorts." },
      { id: "illness", label: "Early illness", x: 0.5, y: 0.36, note: "Existing illness or early heart symptoms at the start of follow-up." },
      { id: "bp", label: "Blood pressure", x: 0.5, y: 1.0, note: "Caffeine raises blood pressure acutely." },
    ],
    edges: [
      { from: "coffee", to: "chd", why: "The effect the paper wants to estimate." },
      { from: "smoking", to: "coffee", why: "Smokers drink more coffee, so heavy coffee drinkers are more often smokers." },
      { from: "smoking", to: "chd", why: "Smoking is a major cause of coronary heart disease." },
      { from: "illness", to: "coffee", why: "People who are already unwell often cut down on coffee (“sick quitters”), so low intake partly marks poor health." },
      { from: "illness", to: "chd", why: "Existing illness and early heart symptoms predict a heart disease diagnosis." },
      { from: "coffee", to: "bp", why: "Caffeine raises blood pressure, at least in the short term." },
      { from: "bp", to: "chd", why: "Raised blood pressure causes heart disease." },
    ],
    drawn: [{ from: "coffee", to: "chd" }],
    adjusted: [],
    source: "Story after Hernán & Robins, Causal Inference: What If (2020), ch. 6–7. Freedman et al., NEJM 2012 (NIH-AARP) found the coffee–mortality association grew stronger after adjusting for smoking.",
  },
  /* The obesity paradox as collider stratification: Banack & Kaufman, Prev Med 2014. */
  obesityParadox: {
    mode: "dag",
    title: "Why does obesity look protective in heart patients?",
    exposure: "obesity", outcome: "death",
    variables: [
      { id: "obesity", label: "Obesity", x: 0.02, y: 0.45 },
      { id: "death", label: "Death", x: 0.98, y: 0.45 },
      { id: "smoking", label: "Smoking", x: 0.5, y: 0.0 },
      { id: "cvd", label: "Heart disease", x: 0.36, y: 1.0, note: "The study only enrolled people who already had heart disease." },
      { id: "other", label: "Other causes", x: 0.86, y: 1.0, measured: false, note: "Genetics, other illnesses: causes of heart disease that also raise mortality. Not measured." },
    ],
    edges: [
      { from: "obesity", to: "death", why: "The effect in question." },
      { from: "obesity", to: "cvd", why: "Obesity is a cause of cardiovascular disease." },
      { from: "cvd", to: "death", why: "Heart disease raises mortality." },
      { from: "smoking", to: "obesity", why: "Smokers tend to weigh less." },
      { from: "smoking", to: "cvd", why: "Smoking causes cardiovascular disease." },
      { from: "smoking", to: "death", why: "Smoking raises mortality." },
      { from: "other", to: "cvd", why: "Other causes of heart disease exist besides obesity and smoking." },
      { from: "other", to: "death", why: "Many of those causes also raise mortality directly." },
    ],
    adjusted: ["cvd"],
    source: "Banack HR, Kaufman JS. The obesity paradox: understanding the effect of obesity on mortality among individuals with cardiovascular disease. Prev Med 2014;62:96–102.",
  },
  /* Berkson's bias: Berkson, Biometrics Bulletin 1946 (cholecystitis and diabetes among hospital patients). */
  berkson: {
    mode: "dag",
    title: "Two unrelated diseases, linked in hospital data",
    exposure: "diabetes", outcome: "chole",
    variables: [
      { id: "diabetes", label: "Diabetes", x: 0.04, y: 0.15 },
      { id: "chole", label: "Cholecystitis", x: 0.96, y: 0.15 },
      { id: "hosp", label: "In hospital", x: 0.5, y: 1.0, note: "Cases and controls were all hospital patients." },
    ],
    edges: [
      { from: "diabetes", to: "hosp", why: "Diabetes is a reason to be admitted." },
      { from: "chole", to: "hosp", why: "Gallbladder inflammation is a reason to be admitted." },
    ],
    adjusted: ["hosp"],
    source: "Berkson J. Limitations of the application of fourfold table analysis to hospital data. Biometrics Bulletin 1946;2(3):47–53.",
  },
  /* Mammography screening: Gigerenzer et al., Psychol Sci Public Interest 2007 (1%, 90%, 9% false positives). */
  mammography: {
    mode: "diagnostic",
    title: "A positive mammogram: how likely is cancer?",
    condition: "breast cancer", test: "mammogram", population: "women screened in one region (teaching example)",
    prevalence: 0.01, sensitivity: 0.9, specificity: 0.91,
    predict: true,
    source: "Teaching problem from Gigerenzer G et al. Helping doctors and patients make sense of health statistics. Psychol Sci Public Interest 2007;8(2):53–96, set among women in an assumed region: prevalence 1%, sensitivity 90%, false-positive rate 9%. Illustrative rates, not a measured test.",
  },
  /* Illustrative binormal score model for the threshold / ROC view. */
  threshold: {
    mode: "diagnostic",
    title: "Where should the cut-off go?",
    condition: "the disease", test: "a blood marker", population: "people referred to clinic with symptoms (illustrative)",
    prevalence: 0.1,
    scores: { label: "Marker level", unit: "units", healthy: { mean: 40, sd: 10 }, disease: { mean: 65, sd: 12 }, threshold: 55, min: 0, max: 110 },
    source: "Illustrative binormal model (not a real assay): healthy N(40, 10²), diseased N(65, 12²). Binormal AUC = Φ(25/√244) ≈ 0.95.",
  },
  /* Small illustrative oncology trial: hand-computed KM table in NOTES.md. */
  smallTrial: {
    mode: "survival",
    title: "Reading a small trial's survival curves",
    endpoint: "death", unit: "months", horizon: 26,
    arms: [{ id: "std", label: "Standard care" }, { id: "new", label: "New drug" }],
    riskLabel: "poor performance status",
    illustrative: true,
    patients: [
      { id: "S1", arm: "std", time: 2, event: true, risk: "high" },
      { id: "S2", arm: "std", time: 4, event: true, risk: "high" },
      { id: "S3", arm: "std", time: 5, event: false, risk: "low" },
      { id: "S4", arm: "std", time: 7, event: true, risk: "low" },
      { id: "S5", arm: "std", time: 9, event: true, risk: "high" },
      { id: "S6", arm: "std", time: 10, event: true, risk: "low", switchAt: 6 },
      { id: "S7", arm: "std", time: 15, event: false, risk: "low" },
      { id: "S8", arm: "std", time: 18, event: true, risk: "low", switchAt: 9 },
      { id: "N1", arm: "new", time: 3, event: true, risk: "high" },
      { id: "N2", arm: "new", time: 6, event: false, risk: "low" },
      { id: "N3", arm: "new", time: 8, event: true, risk: "high", switchAt: 4 },
      { id: "N4", arm: "new", time: 11, event: true, risk: "low" },
      { id: "N5", arm: "new", time: 14, event: false, risk: "low" },
      { id: "N6", arm: "new", time: 17, event: true, risk: "high" },
      { id: "N7", arm: "new", time: 20, event: false, risk: "low" },
      { id: "N8", arm: "new", time: 24, event: false, risk: "low" },
    ],
    source: "Illustrative data, not a real trial. Sixteen patients, eight per arm, built so the product-limit table can be checked by hand.",
  },
  /* Freireich et al., Blood 1963; data as tabulated by Gehan, Biometrika 1965 (remission in weeks). */
  leukaemia: {
    mode: "survival",
    title: "6-MP and remission in childhood leukaemia",
    endpoint: "relapse", unit: "weeks", horizon: 36,
    arms: [{ id: "pbo", label: "Placebo" }, { id: "mp", label: "6-MP" }],
    patients: [
      ...[1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23].map((t, i) => ({ id: `P${i + 1}`, arm: "pbo", time: t, event: true })),
      ...([[6, 1], [6, 1], [6, 1], [6, 0], [7, 1], [9, 0], [10, 1], [10, 0], [11, 0], [13, 1], [16, 1], [17, 0], [19, 0], [20, 0], [22, 1], [23, 1], [25, 0], [32, 0], [32, 0], [34, 0], [35, 0]] as const)
        .map(([t, e], i) => ({ id: `M${i + 1}`, arm: "mp", time: t, event: e === 1 })),
    ],
    source: "Freireich EJ et al. Blood 1963;21:699–716; data as given by Gehan EA, Biometrika 1965;52:203–224. The 21 matched pairs (42 children) in the sequential stopping analysis; 92 patients entered and 62 reached remission. Shown here as an unpaired time-to-event analysis; edits create hypothetical outcomes. Weeks in remission; tick marks were still in remission when last seen.",
    analysisNote: "These are the 21 matched pairs in the trial's sequential stopping analysis, analysed here without the pairing as an unpaired time-to-event comparison.",
  },
  /* BCG vaccine trials reported by 1968 (Colditz et al., JAMA 1994; metadat dat.bcg). */
  bcg: {
    mode: "meta",
    title: "BCG vaccine: what the trials up to 1968 said",
    measure: "RR", outcome: "tuberculosis", favours: ["BCG", "no vaccine"], model: "random",
    studies: [
      { id: "aronson", label: "Aronson", year: 1948, counts: { treatEvents: 4, treatTotal: 123, controlEvents: 11, controlTotal: 139 } },
      { id: "ferguson", label: "Ferguson & Simes", year: 1949, counts: { treatEvents: 6, treatTotal: 306, controlEvents: 29, controlTotal: 303 } },
      { id: "stein", label: "Stein & Aronson", year: 1953, counts: { treatEvents: 180, treatTotal: 1541, controlEvents: 372, controlTotal: 1451 } },
      { id: "rosenthal60", label: "Rosenthal", year: 1960, counts: { treatEvents: 3, treatTotal: 231, controlEvents: 11, controlTotal: 220 } },
      { id: "rosenthal61", label: "Rosenthal", year: 1961, counts: { treatEvents: 17, treatTotal: 1716, controlEvents: 65, controlTotal: 1665 } },
      { id: "coetzee", label: "Coetzee & Berjak", year: 1968, counts: { treatEvents: 29, treatTotal: 7499, controlEvents: 45, controlTotal: 7277 } },
    ],
    source: "Colditz GA et al. Efficacy of BCG vaccine in the prevention of tuberculosis. JAMA 1994;271:698–702; counts as in metadat::dat.bcg (the six trials reported by 1968).",
  },
};

export const scenario = {
  tab: "Methods",
  prompt: "This paper says coffee drinkers have less heart disease. How do I tell if that's confounding?",
  intro: "Confounding is a claim about causes, so draw them. The paper's arrow is Coffee → Heart disease. Drag from Smoking and from Early illness to whatever each one affects, then drag variables into “Adjusted for” and watch which paths stay open.",
  receiptLabel: "Causal diagram",
  receiptText: "The learner asked how to tell whether an observational association is confounded. The diagram checks every path between coffee and heart disease against the backdoor criterion as they draw and adjust.",
  preset: "coffee",
};

export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  coffee: { label: "Methods", prompt: scenario.prompt, intro: scenario.intro, receiptLabel: scenario.receiptLabel, receiptText: scenario.receiptText },
  obesityParadox: {
    label: "Obesity paradox",
    prompt: "Why do studies find obese heart-disease patients live longer? Isn't that backwards?",
    intro: "Selection on heart disease is one plausible explanation. This diagram illustrates how it could work: the paper only enrolled people with heart disease, which is the same as adjusting for it. Look at which paths that opens, then try taking it out of “Adjusted for”.",
    receiptLabel: "Collider bias", receiptText: "The learner asked about the obesity paradox. The diagram shows how restricting to heart-disease patients opens a path through unmeasured causes.",
  },
  berkson: {
    label: "Berkson's bias",
    prompt: "In our hospital data, diabetics seem to have less gallbladder disease. Is that real?",
    intro: "Maybe not. Everyone in hospital data was admitted for something, so being in hospital is a common effect of both diseases. Drag In hospital out of “Adjusted for” to see which path would close in an unselected population under this graph.",
    receiptLabel: "Selection bias", receiptText: "The learner asked about an association seen only in hospital data. The diagram shows the path opened by selecting on admission.",
  },
  mammography: {
    label: "Mammogram PPV",
    prompt: "A woman's screening mammogram came back positive. The test is 90% sensitive, so she probably has cancer, right?",
    intro: "Sensitivity answers a different question. Here are 1,000 women like her. Before you see their results, drag the flag to how likely you think cancer is after a positive test.",
    receiptLabel: "Test accuracy", receiptText: "The learner asked what a positive screening test means. The icon array and nomogram compute the post-test probability from prevalence, sensitivity and specificity.",
  },
  threshold: {
    label: "Cut-off and ROC",
    prompt: "Why can't a test just be made more sensitive by lowering the cut-off?",
    intro: "It can, but you pay in false alarms. Drag the cut-off along the two score distributions, or drag the point along the ROC curve, and watch how results change in the two groups within this population of 1,000.",
    receiptLabel: "Threshold trade-off", receiptText: "The learner asked about test cut-offs. The lab links the threshold, the ROC point and the icon array.",
  },
  smallTrial: {
    label: "Kaplan–Meier",
    prompt: "How do I read the survival curves in this oncology trial? What do the little tick marks mean?",
    intro: "Each step down is a death; each tick is a patient who left follow-up still alive (censored). Drag a patient's end mark along their line, or drop an event or a censoring mark on it, and watch the curve recalculate.",
    receiptLabel: "Survival curve", receiptText: "The learner asked how to read a Kaplan–Meier plot. The lab recomputes the product-limit curve, medians and hazard ratio from the patient timelines.",
  },
  leukaemia: {
    label: "6-MP trial",
    prompt: "What does a hazard ratio of about 4.8 actually mean in the 6-MP leukaemia trial?",
    intro: "That 4.8 is placebo versus 6-MP; read the other way round, 6-MP versus placebo, it is 1/4.8 ≈ 0.21. These are the 21 matched pairs (42 children) in the 1963 trial's stopping analysis, remission in weeks, shown here as an unpaired time-to-event analysis; any edit makes the outcomes hypothetical. Compare the hazard ratio with the gap between the medians, then drag a few placebo relapses later and see which number moves.",
    receiptLabel: "Hazard ratio", receiptText: "The learner asked about a hazard ratio. The lab fits a Cox model (Efron ties) and Kaplan–Meier curves to the Freireich data.",
  },
  bcg: {
    label: "Forest plot",
    prompt: "How do I read a forest plot? Why does one big study matter so much?",
    intro: "Each square is a trial; its area is proportional to its weight in the pooled diamond. Drag a square to change that trial's result, drag a whisker end to change its precision, or drop a small trial in the file drawer and check the funnel plot.",
    receiptLabel: "Meta-analysis", receiptText: "The learner asked how to read a forest plot. The lab recomputes inverse-variance weights, the pooled estimate, I² and the funnel plot as they drag.",
  },
};
