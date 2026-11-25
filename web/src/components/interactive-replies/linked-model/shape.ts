/* Structural (JSON shape) validation for LinkedConfig. Runs before any formula is compiled, any regime is
   computed or anything is rendered, so a wrong container never reaches code that assumes the right one.
   Closed schema: unknown keys are refused. Returns plain-sentence problems; never throws. */
type Problems = string[];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isFin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function shapeProblems(raw: unknown): Problems {
  const out: Problems = [];
  const bad = (m: string) => { if (out.length < 12) out.push(m); };
  const closed = (o: Record<string, unknown>, keys: string[], where: string) => {
    for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`${where}: unknown key “${k}”`);
  };
  const optStr = (o: Record<string, unknown>, k: string, where: string) => { if (o[k] !== undefined && !isStr(o[k])) bad(`${where}.${k} must be text`); };
  const optFin = (o: Record<string, unknown>, k: string, where: string) => { if (o[k] !== undefined && !isFin(o[k])) bad(`${where}.${k} must be a number`); };
  const strArr = (v: unknown, where: string, optional = false) => {
    if (v === undefined && optional) return;
    if (!Array.isArray(v) || !v.every(isStr)) bad(`${where} must be a list of text`);
  };
  const range = (v: unknown, where: string, optional = false) => {
    if (v === undefined && optional) return;
    if (!Array.isArray(v) || v.length !== 2 || !v.every(isFin)) bad(`${where} must be [min, max] numbers`);
  };
  const strMap = (v: unknown, where: string, optional = false) => {
    if (v === undefined && optional) return;
    if (!isObj(v) || !Object.values(v).every(isStr)) bad(`${where} must map names to text`);
  };

  if (!isObj(raw)) return ["config must be an object"];
  const c = raw;
  closed(c, ["title", "goal", "views", "params", "model", "equation", "handles", "table", "regimes", "notes", "share", "labels", "secondary"], "config");
  if (!isStr(c.title)) bad("title must be text");
  optStr(c, "goal", "config");
  strArr(c.views, "views");
  if (!isObj(c.params)) bad("params must be an object of parameters");
  else for (const [id, p] of Object.entries(c.params)) {
    const w = `params.${id}`;
    if (!isObj(p)) { bad(`${w} must be an object`); continue; }
    closed(p, ["label", "symbol", "min", "max", "value", "step", "unit", "digits"], w);
    if (!isStr(p.label)) bad(`${w}.label must be text`);
    for (const k of ["min", "max", "value"]) if (!isFin(p[k])) bad(`${w}.${k} must be a number`);
    optStr(p, "symbol", w); optStr(p, "unit", w);
    if (p.step !== undefined && !(isFin(p.step) && p.step > 0)) bad(`${w}.step must be a positive number`);
    if (p.digits !== undefined && !(Number.isInteger(p.digits) && (p.digits as number) >= 0 && (p.digits as number) <= 6)) bad(`${w}.digits must be a whole number 0–6`);
  }
  const m = c.model;
  if (!isObj(m)) bad("model must be an object");
  else if (m.kind === "iterate") {
    closed(m, ["kind", "variable", "start", "map", "steps", "curve", "measure", "measureLabel", "style", "xRange", "yRange", "xLabel", "yLabel", "stepLabel"], "model");
    for (const k of ["variable", "start", "map"]) if (!isStr(m[k])) bad(`model.${k} must be text`);
    if (!isFin(m.steps)) bad("model.steps must be a number");
    for (const k of ["curve", "measure", "measureLabel", "xLabel", "yLabel", "stepLabel"]) optStr(m, k, "model");
    if (m.style !== undefined && m.style !== "path" && m.style !== "cobweb") bad("model.style must be path or cobweb");
    range(m.xRange, "model.xRange"); range(m.yRange, "model.yRange", true);
  } else if (m.kind === "ode") {
    closed(m, ["kind", "vars", "rates", "initial", "dt", "duration", "ranges", "reference", "timeUnit", "labels"], "model");
    strArr(m.vars, "model.vars");
    strMap(m.rates, "model.rates"); strMap(m.initial, "model.initial"); strMap(m.labels, "model.labels", true);
    if (!isStr(m.dt)) bad("model.dt must be text");
    if (!isFin(m.duration)) bad("model.duration must be a number");
    if (!isObj(m.ranges)) bad("model.ranges must be an object");
    else for (const [k, r] of Object.entries(m.ranges)) range(r, `model.ranges.${k}`);
    if (m.reference !== undefined && typeof m.reference !== "boolean") bad("model.reference must be true or false");
    optStr(m, "timeUnit", "model");
  } else if (m.kind === "function") {
    closed(m, ["kind", "f", "x", "y", "rows", "probe"], "model");
    if (!isStr(m.f)) bad("model.f must be text");
    for (const axis of ["x", "y"] as const) {
      const a = m[axis];
      if (!isObj(a)) { bad(`model.${axis} must be an object`); continue; }
      closed(a, axis === "x" ? ["name", "label", "min", "max", "unit"] : ["label", "min", "max", "unit"], `model.${axis}`);
      if (axis === "x" && !isStr(a.name)) bad("model.x.name must be text");
      if (!isStr(a.label)) bad(`model.${axis}.label must be text`);
      if (!isFin(a.min) || !isFin(a.max)) bad(`model.${axis} needs numeric min and max`);
      optStr(a, "unit", `model.${axis}`);
    }
    if (!Array.isArray(m.rows) || !m.rows.every(isFin)) bad("model.rows must be a list of numbers");
    optFin(m, "probe", "model");
  } else bad("model.kind must be iterate, ode or function");

  if (c.equation !== undefined) {
    if (!isObj(c.equation)) bad("equation must be an object");
    else { closed(c.equation, ["lines", "live"], "equation"); strArr(c.equation.lines, "equation.lines"); optStr(c.equation, "live", "equation"); }
  }
  if (c.handles !== undefined) {
    if (!Array.isArray(c.handles)) bad("handles must be a list");
    else c.handles.forEach((h, i) => {
      const w = `handle ${i + 1}`;
      if (!isObj(h)) { bad(`${w} must be an object`); return; }
      closed(h, ["view", "at", "vary", "label", "n"], w);
      if (!isStr(h.view)) bad(`${w}: view must be text`);
      if (!(h.at === "start" || h.at === "step" || (isObj(h.at) && isStr(h.at.x) && isStr(h.at.y) && Object.keys(h.at).length === 2))) bad(`${w}: at must be "start", "step" or {x, y} formulas`);
      strArr(h.vary, `${w}: vary`);
      optStr(h, "label", w);
      if (h.n !== undefined && !(Number.isInteger(h.n) && (h.n as number) >= 1)) bad(`${w}: n must be a whole number ≥ 1`);
    });
  }
  if (c.table !== undefined) {
    if (!isObj(c.table)) bad("table must be an object");
    else {
      closed(c.table, ["columns", "note"], "table");
      optStr(c.table, "note", "table");
      if (c.table.columns !== undefined) {
        if (!Array.isArray(c.table.columns)) bad("table.columns must be a list");
        else c.table.columns.forEach((col, i) => {
          const w = `table column ${i + 1}`;
          if (!isObj(col)) { bad(`${w} must be an object`); return; }
          closed(col, ["label", "expr", "digits", "compare"], w);
          if (!isStr(col.label)) bad(`${w}: label must be text`);
          if (!isStr(col.expr)) bad(`${w}: expr must be text`);
          if (col.digits !== undefined && !Number.isInteger(col.digits)) bad(`${w}: digits must be a whole number`);
          if (col.compare !== undefined && typeof col.compare !== "boolean") bad(`${w}: compare must be true or false`);
        });
      }
    }
  }
  if (c.regimes !== undefined) {
    const r = c.regimes;
    if (!isObj(r)) bad("regimes must be an object");
    else {
      closed(r, ["param", "cuts", "bands", "sweep", "axisLabel"], "regimes");
      if (!isStr(r.param)) bad("regimes.param must be text");
      strArr(r.cuts, "regimes.cuts");
      if (r.sweep !== undefined && r.sweep !== "outcome" && r.sweep !== "orbit") bad("regimes.sweep must be outcome or orbit");
      optStr(r, "axisLabel", "regimes");
      if (!Array.isArray(r.bands)) bad("regimes.bands must be a list");
      else r.bands.forEach((b, i) => {
        const w = `band ${i + 1}`;
        if (!isObj(b)) { bad(`${w} must be an object`); return; }
        closed(b, ["name", "tone", "say", "learner", "reply", "short", "cycle", "atCut"], w);
        for (const k of ["name", "tone", "say"]) if (!isStr(b[k])) bad(`${w}: ${k} must be text`);
        for (const k of ["learner", "reply", "short"]) optStr(b, k, w);
        if (b.cycle !== undefined) {
          if (!isObj(b.cycle)) bad(`${w}: cycle must be an object`);
          else { closed(b.cycle, ["name", "tone", "say", "learner", "reply"], `${w}.cycle`); if (!isStr(b.cycle.say)) bad(`${w}.cycle.say must be text`);
            for (const k of ["name", "tone", "learner", "reply"]) optStr(b.cycle, k, `${w}.cycle`); }
        }
        if (b.atCut !== undefined) {
          if (!isObj(b.atCut)) bad(`${w}: atCut must be an object`);
          else { closed(b.atCut, ["name", "tone", "say", "learner", "reply", "short"], `${w}.atCut`); if (!isStr(b.atCut.say)) bad(`${w}.atCut.say must be text`);
            for (const k of ["name", "tone", "learner", "reply", "short"]) optStr(b.atCut, k, `${w}.atCut`); }
        }
      });
    }
  }
  if (c.notes !== undefined) {
    if (!Array.isArray(c.notes)) bad("notes must be a list");
    else c.notes.forEach((n, i) => { if (!isObj(n) || !isStr(n.when) || !isStr(n.say)) bad(`note ${i + 1} needs when and say text`); else closed(n, ["when", "say"], `note ${i + 1}`); });
  }
  if (c.share !== undefined) {
    if (!isObj(c.share)) bad("share must be an object");
    else { closed(c.share, ["learner", "reply"], "share"); if (!isStr(c.share.learner) || !isStr(c.share.reply)) bad("share needs learner and reply text"); }
  }
  if (c.labels !== undefined) {
    if (!isObj(c.labels)) bad("labels must be an object");
    else { closed(c.labels, ["curve", "trace", "phase"], "labels"); for (const k of ["curve", "trace", "phase"]) optStr(c.labels, k, "labels"); }
  }
  if (c.secondary !== undefined) strArr(c.secondary, "secondary");
  return out;
}
