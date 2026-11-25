/* MethodsLab config: JSON-serialisable types a model can author, and a validator that never throws. */
import { isAcyclic, type Graph } from "./model";

export type ShareSummary = { learner: string; data: string; reply: string };

export type DagVariable = {
  id: string;           // short id, unique
  label: string;        // ≤ 18 characters, shown in the node
  x: number; y: number; // position as fractions of the canvas, 0–1
  measured?: boolean;   // default true; unmeasured variables cannot be adjusted for
  note?: string;        // one line shown in the paths panel when the variable is picked
};
export type DagEdgeSpec = { from: string; to: string; why?: string };
export type DagConfig = {
  mode: "dag";
  title: string;
  exposure: string;               // variable id
  outcome: string;                // variable id
  variables: DagVariable[];       // 3–9
  edges: DagEdgeSpec[];           // the causal story the analysis should assume (a DAG)
  drawn?: { from: string; to: string }[]; // arrows on the canvas at the start (default: all of `edges`)
  adjusted?: string[];            // what the paper adjusted for, at the start (default none)
  source?: string;
};

export type DiagnosticConfig = {
  mode: "diagnostic";
  title: string;
  condition: string;              // "breast cancer"
  test: string;                   // "mammogram"
  population: string;             // "women aged 40–50 at routine screening"
  prevalence: number;             // 0.001–0.99
  sensitivity?: number;           // required unless `scores` is given (0.01–0.999)
  specificity?: number;           // required unless `scores` is given (0.01–0.999)
  scores?: {                      // binormal score model: drag a threshold instead of sens/spec
    label: string;                // "Test score"
    unit?: string;
    healthy: { mean: number; sd: number };
    disease: { mean: number; sd: number }; // mean above healthy mean; positive = score ≥ threshold
    threshold: number;
    min: number; max: number;     // axis range
  };
  predict?: boolean;              // ask for a guess of P(condition | positive) before revealing results
  source?: string;
};

export type SurvivalPatient = {
  id: string;                     // ≤ 4 characters
  arm: string;                    // arm id
  time: number;                   // follow-up time in `unit`
  event: boolean;                 // true = event at `time`, false = censored at `time`
  risk?: "high" | "low";          // a prognostic factor (for the randomisation check)
  switchAt?: number;              // crossed over to the other arm's treatment at this time (< time)
};
export type SurvivalConfig = {
  mode: "survival";
  title: string;
  endpoint: string;               // "death", "relapse"
  unit: string;                   // "months", "weeks"
  horizon: number;                // axis end, ≥ every time
  arms: [{ id: string; label: string }, { id: string; label: string }]; // [control, experimental]
  patients: SurvivalPatient[];    // 4–48, ≥ 2 per arm
  riskLabel?: string;             // what "high" risk means, e.g. "poor performance status"
  illustrative?: boolean;         // label the data as illustrative on the canvas
  analysisNote?: string;          // how the shown analysis differs from the source design; kept in the share
  source?: string;
};

export type MetaStudy = {
  id: string;
  label: string;                  // ≤ 22 characters
  year?: number;
  counts?: { treatEvents: number; treatTotal: number; controlEvents: number; controlTotal: number };
  estimate?: number;              // natural scale (a ratio for RR/OR); with lower/upper as a 95% CI
  lower?: number;
  upper?: number;
};
export type MetaConfig = {
  mode: "meta";
  title: string;
  measure: "RR" | "OR" | "MD";
  outcome: string;                // "tuberculosis"
  favours: [string, string];      // [left of the null, right of the null], e.g. ["BCG", "control"]
  studies: MetaStudy[];           // 2–10
  model?: "fixed" | "random";     // default "random"
  source?: string;
};

export type MethodsLabConfig = DagConfig | DiagnosticConfig | SurvivalConfig | MetaConfig;

/* ------------------------------ validation ------------------------------ */
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown, max = 200): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optStr = (v: unknown, max = 600) => v === undefined || isStr(v, max);
function closed(o: Record<string, unknown>, allowed: string[], where: string, out: string[]) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) out.push(`${where} has an unknown field "${k}".`);
}

export function validateMethodsLab(config: unknown): string[] {
  try { return check(config); } catch { return ["The configuration could not be read."]; }
}

function check(c: unknown): string[] {
  const out: string[] = [];
  if (!isObj(c)) return ["The configuration must be an object."];
  if (!isStr(c.title, 90)) out.push("It needs a short title (up to 90 characters).");
  if (!optStr(c.source)) out.push("source must be text (up to 600 characters).");
  switch (c.mode) {
    case "dag": checkDag(c, out); break;
    case "diagnostic": checkDiagnostic(c, out); break;
    case "survival": checkSurvival(c, out); break;
    case "meta": checkMeta(c, out); break;
    default: out.push('mode must be "dag", "diagnostic", "survival" or "meta".');
  }
  return out;
}

function checkDag(c: Record<string, unknown>, out: string[]) {
  closed(c, ["mode", "title", "exposure", "outcome", "variables", "edges", "drawn", "adjusted", "source"], "The diagram", out);
  const vars = c.variables;
  if (!Array.isArray(vars) || vars.length < 3 || vars.length > 9) { out.push("A diagram needs 3 to 9 variables."); return; }
  const ids: string[] = [];
  vars.forEach((v, i) => {
    if (!isObj(v)) { out.push(`Variable ${i + 1} must be an object.`); return; }
    closed(v, ["id", "label", "x", "y", "measured", "note"], `Variable ${i + 1}`, out);
    if (!isStr(v.id, 24) || !/^[A-Za-z][\w-]*$/.test(v.id)) out.push(`Variable ${i + 1} needs a simple id (letters, digits, - or _).`);
    else ids.push(v.id);
    if (!isStr(v.label, 18)) out.push(`Variable ${i + 1} needs a label of up to 18 characters.`);
    if (!isNum(v.x) || v.x < 0 || v.x > 1 || !isNum(v.y) || v.y < 0 || v.y > 1) out.push(`Variable ${i + 1} needs x and y between 0 and 1.`);
    if (v.measured !== undefined && typeof v.measured !== "boolean") out.push(`Variable ${i + 1}: measured must be true or false.`);
    if (!optStr(v.note, 160)) out.push(`Variable ${i + 1}: note must be up to 160 characters.`);
  });
  if (new Set(ids).size !== ids.length) out.push("Variable ids must all be different.");
  const has = (id: unknown) => typeof id === "string" && ids.includes(id);
  if (!has(c.exposure)) out.push("exposure must be one of the variable ids.");
  if (!has(c.outcome)) out.push("outcome must be one of the variable ids.");
  if (c.exposure === c.outcome) out.push("exposure and outcome must be different variables.");
  const edgeList = (list: unknown, what: string, withWhy: boolean): { from: string; to: string }[] | null => {
    if (!Array.isArray(list) || list.length > 24) { out.push(`${what} must be a list of up to 24 arrows.`); return null; }
    const seen = new Set<string>(); const good: { from: string; to: string }[] = [];
    list.forEach((e, i) => {
      if (!isObj(e)) { out.push(`${what} ${i + 1} must be an object.`); return; }
      closed(e, withWhy ? ["from", "to", "why"] : ["from", "to"], `${what} ${i + 1}`, out);
      if (!has(e.from) || !has(e.to)) { out.push(`${what} ${i + 1} must join two variable ids.`); return; }
      if (e.from === e.to) { out.push(`${what} ${i + 1} points a variable at itself.`); return; }
      if (withWhy && !optStr(e.why, 220)) out.push(`${what} ${i + 1}: why must be up to 220 characters.`);
      const k = `${e.from}>${e.to}`, back = `${e.to}>${e.from}`;
      if (seen.has(k) || seen.has(back)) out.push(`${what} ${i + 1} repeats an arrow between the same two variables.`);
      seen.add(k); good.push({ from: e.from as string, to: e.to as string });
    });
    if (good.length && !isAcyclic({ nodes: ids, edges: good } as Graph)) out.push(`${what} contain a loop; a causal diagram must be acyclic.`);
    return good;
  };
  edgeList(c.edges, "Arrows", true);
  if (c.drawn !== undefined) edgeList(c.drawn, "Drawn arrows", false);
  if (c.adjusted !== undefined) {
    if (!Array.isArray(c.adjusted) || !c.adjusted.every(has)) out.push("adjusted must list variable ids.");
    else {
      if (c.adjusted.includes(c.exposure) || c.adjusted.includes(c.outcome)) out.push("adjusted cannot include the exposure or the outcome.");
      const unmeasured = vars.filter(v => isObj(v) && v.measured === false).map(v => (v as DagVariable).id);
      if (c.adjusted.some(a => unmeasured.includes(a as string))) out.push("adjusted cannot include an unmeasured variable.");
      if (new Set(c.adjusted).size !== c.adjusted.length) out.push("adjusted lists a variable twice.");
    }
  }
}

function checkDiagnostic(c: Record<string, unknown>, out: string[]) {
  closed(c, ["mode", "title", "condition", "test", "population", "prevalence", "sensitivity", "specificity", "scores", "predict", "source"], "The test", out);
  if (!isStr(c.condition, 40)) out.push("condition must be a short name (up to 40 characters).");
  if (!isStr(c.test, 40)) out.push("test must be a short name (up to 40 characters).");
  if (!isStr(c.population, 90)) out.push("population must describe who is tested (up to 90 characters).");
  if (!isNum(c.prevalence) || c.prevalence < 0.001 || c.prevalence > 0.99) out.push("prevalence must be between 0.001 and 0.99.");
  if (c.predict !== undefined && typeof c.predict !== "boolean") out.push("predict must be true or false.");
  const rate = (v: unknown, name: string) => { if (!isNum(v) || v < 0.01 || v > 0.999) out.push(`${name} must be between 0.01 and 0.999.`); };
  if (c.scores === undefined) { rate(c.sensitivity, "sensitivity"); rate(c.specificity, "specificity"); return; }
  if (c.sensitivity !== undefined || c.specificity !== undefined) out.push("With scores, leave out sensitivity and specificity: the threshold sets them.");
  const s = c.scores;
  if (!isObj(s)) { out.push("scores must be an object."); return; }
  closed(s, ["label", "unit", "healthy", "disease", "threshold", "min", "max"], "scores", out);
  if (!isStr(s.label, 30)) out.push("scores.label must be short text.");
  if (!optStr(s.unit, 16)) out.push("scores.unit must be short text.");
  const dist = (d: unknown, name: string) => {
    if (!isObj(d)) { out.push(`scores.${name} must be { mean, sd }.`); return null; }
    closed(d, ["mean", "sd"], `scores.${name}`, out);
    if (!isNum(d.mean) || !isNum(d.sd) || d.sd <= 0) { out.push(`scores.${name} needs a mean and a positive sd.`); return null; }
    return d as { mean: number; sd: number };
  };
  const h = dist(s.healthy, "healthy"), d = dist(s.disease, "disease");
  if (!isNum(s.min) || !isNum(s.max) || s.max <= s.min) { out.push("scores.min must be below scores.max."); return; }
  if (!isNum(s.threshold) || s.threshold <= s.min || s.threshold >= s.max) out.push("scores.threshold must lie between min and max.");
  if (h && d && d.mean <= h.mean) out.push("scores.disease.mean must be above scores.healthy.mean (positive = high score).");
  if (h && d && (h.mean < s.min || d.mean > s.max)) out.push("Both means must lie inside min–max.");
}

function checkSurvival(c: Record<string, unknown>, out: string[]) {
  closed(c, ["mode", "title", "endpoint", "unit", "horizon", "arms", "patients", "riskLabel", "illustrative", "analysisNote", "source"], "The trial", out);
  if (!optStr(c.analysisNote, 300)) out.push("analysisNote must be text (up to 300 characters).");
  if (!isStr(c.endpoint, 30)) out.push("endpoint must be short text such as \"death\".");
  if (!isStr(c.unit, 16)) out.push("unit must be short text such as \"months\".");
  if (!optStr(c.riskLabel, 40)) out.push("riskLabel must be short text.");
  if (c.illustrative !== undefined && typeof c.illustrative !== "boolean") out.push("illustrative must be true or false.");
  if (!isNum(c.horizon) || c.horizon <= 0 || c.horizon > 1000) out.push("horizon must be a positive number.");
  const arms = c.arms;
  let armIds: string[] = [];
  if (!Array.isArray(arms) || arms.length !== 2) out.push("arms must be exactly two: [control, experimental].");
  else {
    arms.forEach((a, i) => {
      if (!isObj(a)) { out.push(`Arm ${i + 1} must be an object.`); return; }
      closed(a, ["id", "label"], `Arm ${i + 1}`, out);
      if (!isStr(a.id, 16) || !isStr(a.label, 24)) out.push(`Arm ${i + 1} needs an id and a label (up to 24 characters).`);
      else armIds.push(a.id);
    });
    if (armIds.length === 2 && armIds[0] === armIds[1]) out.push("The two arms need different ids.");
  }
  const ps = c.patients;
  if (!Array.isArray(ps) || ps.length < 4 || ps.length > 48) { out.push("patients must list 4 to 48 patients."); return; }
  const ids = new Set<string>();
  ps.forEach((p, i) => {
    if (!isObj(p)) { out.push(`Patient ${i + 1} must be an object.`); return; }
    closed(p, ["id", "arm", "time", "event", "risk", "switchAt"], `Patient ${i + 1}`, out);
    if (!isStr(p.id, 4)) out.push(`Patient ${i + 1} needs an id of up to 4 characters.`);
    else if (ids.has(p.id)) out.push(`Patient id ${p.id} is used twice.`); else ids.add(p.id);
    if (!armIds.includes(p.arm as string)) out.push(`Patient ${i + 1} must be in one of the two arms.`);
    if (!isNum(p.time) || p.time <= 0 || (isNum(c.horizon) && p.time > c.horizon)) out.push(`Patient ${i + 1} needs a time between 0 and the horizon.`);
    if (typeof p.event !== "boolean") out.push(`Patient ${i + 1}: event must be true or false.`);
    if (p.risk !== undefined && p.risk !== "high" && p.risk !== "low") out.push(`Patient ${i + 1}: risk must be "high" or "low".`);
    if (p.switchAt !== undefined && (!isNum(p.switchAt) || p.switchAt <= 0 || !isNum(p.time) || p.switchAt >= p.time)) out.push(`Patient ${i + 1}: switchAt must be after 0 and before their time.`);
  });
  if (armIds.length === 2) for (const a of armIds) if (ps.filter(p => isObj(p) && p.arm === a).length < 2) out.push("Each arm needs at least 2 patients.");
}

function checkMeta(c: Record<string, unknown>, out: string[]) {
  closed(c, ["mode", "title", "measure", "outcome", "favours", "studies", "model", "source"], "The meta-analysis", out);
  const ratio = c.measure === "RR" || c.measure === "OR";
  if (!ratio && c.measure !== "MD") out.push('measure must be "RR", "OR" or "MD".');
  if (!isStr(c.outcome, 40)) out.push("outcome must be short text.");
  if (!Array.isArray(c.favours) || c.favours.length !== 2 || !c.favours.every(f => isStr(f, 20))) out.push("favours must be two short labels: [left of the null, right of the null].");
  if (c.model !== undefined && c.model !== "fixed" && c.model !== "random") out.push('model must be "fixed" or "random".');
  const ss = c.studies;
  if (!Array.isArray(ss) || ss.length < 2 || ss.length > 10) { out.push("studies must list 2 to 10 studies."); return; }
  const ids = new Set<string>();
  ss.forEach((s, i) => {
    if (!isObj(s)) { out.push(`Study ${i + 1} must be an object.`); return; }
    closed(s, ["id", "label", "year", "counts", "estimate", "lower", "upper"], `Study ${i + 1}`, out);
    if (!isStr(s.id, 24)) out.push(`Study ${i + 1} needs an id.`); else if (ids.has(s.id)) out.push(`Study id ${s.id} is used twice.`); else ids.add(s.id);
    if (!isStr(s.label, 22)) out.push(`Study ${i + 1} needs a label of up to 22 characters.`);
    if (s.year !== undefined && (!isNum(s.year) || s.year < 1800 || s.year > 2100)) out.push(`Study ${i + 1}: year looks wrong.`);
    const hasCounts = s.counts !== undefined, hasCi = s.estimate !== undefined || s.lower !== undefined || s.upper !== undefined;
    if (hasCounts === hasCi) { out.push(`Study ${i + 1} needs either counts or estimate + lower + upper (not both).`); return; }
    if (hasCounts) {
      if (!ratio) { out.push(`Study ${i + 1}: counts only work with RR or OR; give estimate/lower/upper for MD.`); return; }
      const k = s.counts;
      if (!isObj(k)) { out.push(`Study ${i + 1}: counts must be an object.`); return; }
      closed(k, ["treatEvents", "treatTotal", "controlEvents", "controlTotal"], `Study ${i + 1} counts`, out);
      const int = (v: unknown) => isNum(v) && Number.isInteger(v) && v >= 0;
      if (![k.treatEvents, k.treatTotal, k.controlEvents, k.controlTotal].every(int)) { out.push(`Study ${i + 1}: counts must be whole numbers.`); return; }
      const [a, n1, b, n2] = [k.treatEvents, k.treatTotal, k.controlEvents, k.controlTotal] as number[];
      if (n1 < 2 || n2 < 2 || a > n1 || b > n2) out.push(`Study ${i + 1}: events cannot exceed totals, and each arm needs 2+ people.`);
      if (a === 0 && b === 0) out.push(`Study ${i + 1} has no events in either arm; it carries no information about a ratio.`);
      return;
    }
    if (!isNum(s.estimate) || !isNum(s.lower) || !isNum(s.upper)) { out.push(`Study ${i + 1}: estimate, lower and upper must be numbers.`); return; }
    if (ratio && (s.lower <= 0 || s.estimate <= 0 || s.upper <= 0)) { out.push(`Study ${i + 1}: a ratio and its interval must be above 0.`); return; }
    if (!(s.lower < s.estimate && s.estimate < s.upper)) out.push(`Study ${i + 1}: need lower < estimate < upper.`);
  });
}
