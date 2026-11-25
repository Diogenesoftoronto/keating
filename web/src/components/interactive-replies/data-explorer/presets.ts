import type { DataExplorerConfig } from "./model";

const r = (treatment: string, size: string, outcome: string, patients: number) => ({ treatment, size, outcome, patients });
const kidney: DataExplorerConfig = {
  title: "Kidney stone treatments",
  goal: "A succeeds less often overall. Drag the A bar onto the B bar to see who each one treated, then split them and decide whether A is actually worse.",
  source: "Charig et al., BMJ 1986: 700 patients, not randomised. A = open surgery, B = percutaneous nephrolithotomy (keyhole). Success = stones cleared at follow-up.",
  fields: {
    treatment: { label: "Treatment", role: "dimension", values: ["A", "B"] },
    size: { label: "Stone size", role: "dimension", values: ["Small", "Large"] },
    outcome: { label: "Outcome", role: "dimension", values: ["Success", "Failure"] },
    patients: { label: "Patients", role: "measure" },
  },
  weight: "patients",
  rows: [
    r("A", "Small", "Success", 81), r("A", "Small", "Failure", 6), r("A", "Large", "Success", 192), r("A", "Large", "Failure", 71),
    r("B", "Small", "Success", 234), r("B", "Small", "Failure", 36), r("B", "Large", "Success", 55), r("B", "Large", "Failure", 25),
  ],
  measure: { kind: "rate", field: "outcome", value: "Success", label: "Success rate" },
  layout: { rows: [], cols: ["treatment"] },
  colorBy: "treatment",
  question: {
    ask: "Is A actually worse?", compare: "treatment", pair: ["A", "B"], reveal: ["size"], expect: "flip",
    explain: "In the study, surgeons tended to choose open surgery (A) for the large, harder stones.",
    caveat: "The study wasn’t randomised, so stone size is the difference we can see, not necessarily the only one. Grouping adjusts for the confounders you measured, never for the ones you didn’t.",
  },
};

const DEPTS: [string, number, number, number, number][] = [
  // dept, men admitted, men rejected, women admitted, women rejected
  ["Dept A", 512, 313, 89, 19], ["Dept B", 353, 207, 17, 8], ["Dept C", 120, 205, 202, 391],
  ["Dept D", 138, 279, 131, 244], ["Dept E", 53, 138, 94, 299], ["Dept F", 22, 351, 24, 317],
];
const berkeley: DataExplorerConfig = {
  title: "Berkeley graduate admissions, 1973",
  goal: "Men were admitted more often overall. Regroup by department and see whether that holds.",
  source: "Fall 1973 applications to Berkeley’s six largest departments (Bickel, Hammel & O’Connell, Science 1975), as tabulated in the widely used UCBAdmissions data. These counts are reconstructed from rounded published percentages, so treat them as approximate. Departments are anonymised. Across the whole campus the rates were about 44% for men and 35% for women.",
  fields: {
    dept: { label: "Department", role: "dimension", values: DEPTS.map(d => d[0]) },
    gender: { label: "Gender", role: "dimension", values: ["Men", "Women"] },
    outcome: { label: "Decision", role: "dimension", values: ["Admitted", "Rejected"] },
    applicants: { label: "Applicants", role: "measure" },
  },
  weight: "applicants",
  rows: DEPTS.flatMap(([dept, ma, mr, wa, wr]) => [
    { dept, gender: "Men", outcome: "Admitted", applicants: ma }, { dept, gender: "Men", outcome: "Rejected", applicants: mr },
    { dept, gender: "Women", outcome: "Admitted", applicants: wa }, { dept, gender: "Women", outcome: "Rejected", applicants: wr },
  ]),
  measure: { kind: "rate", field: "outcome", value: "Admitted", label: "Admission rate" },
  layout: { rows: [], cols: ["gender"] },
  colorBy: "gender",
  question: {
    ask: "Were women less likely to be admitted?", compare: "gender", pair: ["Men", "Women"], reveal: ["dept"], expect: "flip",
    explain: "Bickel and colleagues concluded that the overall gap came from where people applied, not from departments favouring men.",
    caveat: "Grouping doesn’t say why women applied mostly to the most crowded departments, or whether those departments were under-funded. It only shows the admission decisions themselves weren’t tilted against women.",
  },
  smallGroup: 30,
};

const COURSES: [string, number, number, number, number, number, number][] = [
  // course, under n fall, under n spring, under mean, over n fall, over n spring, over mean
  ["Calculus", 15, 15, 64, 22, 23, 73], ["History", 20, 20, 72, 12, 13, 83], ["Biology", 17, 18, 69, 15, 15, 79],
];
const study: DataExplorerConfig = {
  title: "Study hours and exam scores",
  goal: "Students who study 10 hours a week or more score higher overall. Check whether that gap survives inside each course.",
  source: "Illustrative numbers made up for practice: 205 students in three courses over two terms. Not a real study.",
  fields: {
    course: { label: "Course", role: "dimension", values: COURSES.map(c => c[0]) },
    hours: { label: "Study hours", role: "dimension", values: ["Under 10 h", "10 h or more"] },
    term: { label: "Term", role: "dimension", values: ["Fall", "Spring"] },
    students: { label: "Students", role: "measure" },
    score: { label: "Exam score", role: "measure", unit: "points", digits: 1 },
  },
  weight: "students",
  rows: COURSES.flatMap(([course, uf, us, um, of, os, om]) => [
    { course, hours: "Under 10 h", term: "Fall", students: uf, score: um - 1 }, { course, hours: "Under 10 h", term: "Spring", students: us, score: um + 1 },
    { course, hours: "10 h or more", term: "Fall", students: of, score: om - 1 }, { course, hours: "10 h or more", term: "Spring", students: os, score: om + 1 },
  ]),
  measure: { kind: "mean", field: "score", label: "Mean exam score", domain: [0, 100] },
  layout: { rows: [], cols: ["hours"] },
  colorBy: "hours",
  smallGroup: 15,
  question: {
    ask: "Does the gap survive inside each course?", compare: "hours", pair: ["10 h or more", "Under 10 h"], reveal: [], expect: "no-flip",
    caveat: "Studying more and scoring higher go together here, but students who study more may differ in other ways (earlier grades, sleep, interest), so this alone doesn’t show the hours caused the scores.",
  },
};

export const presets: Record<string, DataExplorerConfig> = { kidney, berkeley, study };

export const scenario = {
  tab: "Data",
  prompt: "The new treatment has a lower success rate overall. Does that mean it’s worse?",
  intro: "Not necessarily. An overall rate can hide who got which cases. Here’s the classic kidney-stone study: treatment A succeeded less often overall. (In that study A was actually the older open surgery; the trap is the same whichever one is new.) Start on the bars: drag A onto B and see what kinds of cases each one holds. Then split them by stone size (from the comparison, or by dragging Stone size onto the chart) and every bar is recounted.",
  receiptLabel: "Data explorer",
  receiptText: "The learner regroups the study’s patients by dragging fields. Every number is recounted from the rows in the config, and the feedback is computed from the grouping they built.",
  preset: "kidney",
};

/** Per-preset chat framing (the learner's question and Keating's lead-in), for the catalogue and the harness. */
export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  kidney: { label: scenario.tab, prompt: scenario.prompt, intro: scenario.intro, receiptLabel: scenario.receiptLabel, receiptText: scenario.receiptText },
  berkeley: { label: "Admissions", prompt: "Was Berkeley biased against women in 1973? Men got in far more often.",
    intro: "That’s what the overall numbers suggested, and it’s a famous case for checking. Here are the six largest departments. Drag Department onto the chart and see whether the gap holds inside the departments.",
    receiptText: "The learner regroups the applicants by dragging fields onto the chart. Every rate is recounted from the department counts in the config, and the feedback names which departments reverse the gap and which don’t." },
  study: { label: "Study hours", prompt: "Students who study more get better grades. Could that be a Simpson’s paradox thing too?",
    intro: "It could be, so it’s worth checking rather than assuming. Here’s a small practice dataset. Drag Course or Term onto the chart and see whether the gap holds, shrinks or flips.",
    receiptText: "The learner regroups made-up practice data by dragging fields onto the chart. Every mean is recounted from the rows, and the feedback says whether the gap survives each grouping." },
};
