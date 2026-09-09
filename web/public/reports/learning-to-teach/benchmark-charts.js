/** Descriptive benchmark views. Missing measurements never become zero. */
const FIELDS = ["quality", "cost_usd", "output_tokens", "latency_seconds"];
const METRICS = {
  quality: { label: 'Teaching score', field: 'quality', unit: 'AI rubric score / 100', higher: true },
  cost: { label: "Cost per task", field: "cost_usd", unit: "USD per task" },
  tokens: { label: "Output tokens per task", field: "output_tokens", unit: "Output tokens per task" },
  latency: { label: "Episode latency", field: "latency_seconds", unit: "Seconds per episode" },
  quality_cost: { label: "Score vs cost", field: "cost_usd", unit: "USD per task", pareto: true },
  quality_latency: { label: "Score vs latency", field: "latency_seconds", unit: "Seconds per episode", pareto: true },
};
const numeric = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const measured = (row, key) => numeric(row[key]) && (key !== "quality" || row[key] <= 100)
  && (key !== "output_tokens" || Number.isInteger(row[key]));
const filtered = (model, category) => model.rows.filter((row) => category === "all" || row.category === category);
const unique = (values) => [...new Set(values)];
// Model developer and serving transport are different identities.
export function modelProvider(model) {
  const name = `${model.model || model.id || ''} ${model.label || ''}`.toLowerCase();
  const providers = [
    [/inkling|thinkingmachines/, 'Thinking Machines', '#146d48'],
    [/nemotron/, 'NVIDIA', '#516d08'],
    [/qwen/, 'Qwen', '#7041a5'],
    [/deepseek/, 'DeepSeek', '#225bb0'],
    [/kimi|moonshot/, 'Moonshot AI', '#915225'],
    [/glm|zhipu/, 'Z.ai', '#a4395a'],
    [/gemma|gemini/, 'Google', '#256d87'],
    [/claude/, 'Anthropic', '#975025'],
    [/gpt|o[134]-/, 'OpenAI', '#276853'],
  ];
  const found = providers.find(([pattern]) => pattern.test(name));
  return { name: found?.[1] || model.model_provider || 'Other', color: found?.[2] || '#555d55',
    transport: model.served_by || model.provider || 'Not recorded' };
}
const hasMeasurements = (model) => model.rows.some((row) => FIELDS.some((field) => measured(row, field)));

export function validateChartData(data) {
  if (!data || !Array.isArray(data.models)) throw new Error("Benchmark model data is unavailable.");
  const models = new Set();
  for (const model of data.models) {
    if (!model || typeof model.id !== "string" || !model.id || models.has(model.id) || !Array.isArray(model.rows)
      || (model.label !== undefined && typeof model.label !== "string")) {
      throw new Error("Benchmark models must have distinct IDs and case rows.");
    }
    models.add(model.id);
    const cases = new Set();
    for (const row of model.rows) {
      if (!row || typeof row.case_id !== "string" || !row.case_id || cases.has(row.case_id) || typeof row.category !== "string") {
        throw new Error("Each model must retain distinct case IDs and categories.");
      }
      cases.add(row.case_id);
    }
  }
  return data;
}

export function summarizeRows(rows, total = rows.length) {
  const result = { total, provided: rows.length };
  for (const field of FIELDS) {
    const values = rows.filter((row) => measured(row, field)).map((row) => row[field]);
    result[field] = { value: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, count: values.length, total };
  }
  const known = rows.filter((row) => typeof row.contract_passed === "boolean");
  result.contracts = { value: known.length ? 100 * known.filter((row) => row.contract_passed).length / known.length : null,
    count: known.length, total };
  return result;
}

export function commonCaseIds(models, fields, category = "all") {
  if (!models.length) return [];
  const maps = models.map((model) => new Map(filtered(model, category).map((row) => [row.case_id, row])));
  return [...maps[0].keys()].filter((id) => maps.every((map) => {
    const row = map.get(id);
    return row && row.category === maps[0].get(id).category && fields.every((field) => measured(row, field));
  })).sort();
}

export function paretoFrontier(points) {
  const valid = points.filter((point) => numeric(point.x) && numeric(point.y) && point.y <= 100);
  return valid.filter((point) => !valid.some((other) => other.x <= point.x && other.y >= point.y
    && (other.x < point.x || other.y > point.y))).sort((a, b) => a.x - b.x || b.y - a.y);
}

export function comparisonPoints(models, metric, category = "all", qualityMetric = "quality") {
  if (!FIELDS.includes(metric) || metric === "quality") throw new Error("Unknown comparison metric");
  if (!["quality", "contracts"].includes(qualityMetric)) throw new Error("Unknown vertical metric");
  if (qualityMetric === "contracts") models = models.map((model) => ({ ...model, rows: model.rows.map((row) => ({
    ...row, quality: typeof row.contract_passed === "boolean" ? (row.contract_passed ? 100 : 0) : null,
  })) }));
  const caseIds = commonCaseIds(models, ["quality", metric], category);
  const shared = new Set(caseIds);
  const points = caseIds.length ? models.map((model) => {
    const summary = summarizeRows(model.rows.filter((row) => shared.has(row.case_id)));
    return { id: model.id, label: model.label || model.id, x: summary[metric].value, y: summary.quality.value, case_ids: caseIds };
  }) : [];
  return { case_ids: caseIds, points, frontier: paretoFrontier(points) };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function svgEl(tag, attributes = {}, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, action, className = "bc-button") {
  const node = el("button", className, text); node.type = "button"; node.addEventListener("click", action); return node;
}
function format(value, field) {
  if (value === null || value === undefined) return "Unknown";
  if (field === "cost_usd") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 3, maximumFractionDigits: 5 }).format(value);
  if (field === "output_tokens") return Math.round(value).toLocaleString("en-US");
  return `${value.toFixed(1)}${field === "latency_seconds" ? " s" : "%"}`;
}
function interactiveMark(group, label, action) {
  group.setAttribute("tabindex", "0"); group.setAttribute("role", "button"); group.setAttribute("aria-label", label);
  group.append(svgEl("title", {}, label)); group.addEventListener("click", action);
  group.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); } });
}

/** onSelect({model_id,case_id,category}); returns update(data) and destroy(). */
export function mountBenchmarkCharts(container, initialData, onSelect = () => {}) {
  let data = validateChartData(initialData);
  let selected = new Set(data.models.filter(hasMeasurements).map((model) => model.id));
  let category = "all", mode = data.quality_available ? 'quality' : 'tokens', activeModel = null;
  let qualityMetric = data.preferred_pareto_score === "contracts" ? "contracts" : data.quality_available ? "quality" : "contracts";
  let qualityChosen = false;
  const root = el("section", "benchmark-charts");
  root.tabIndex = -1;
  root.setAttribute("aria-label", "Compare benchmark quality, cost and latency");
  container.append(root);
  const tooltip = el('div', 'bc-tooltip'); tooltip.id = `bc-tooltip-${crypto.randomUUID()}`;
  tooltip.setAttribute('role', 'tooltip'); tooltip.setAttribute('popover', 'manual'); tooltip.hidden = true;
  let tooltipTarget = null, dismissTimer;
  function hideTooltip() { clearTimeout(dismissTimer); tooltipTarget?.removeAttribute('aria-describedby'); tooltipTarget = null; try { tooltip.hidePopover?.(); } catch {} tooltip.hidden = true; }
  function showTooltip(target, text) {
    hideTooltip(); tooltipTarget = target; tooltip.textContent = text; tooltip.hidden = false;
    target.setAttribute('aria-describedby', tooltip.id);
    tooltip.showPopover?.();
    const rect = target.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - tooltip.offsetHeight - 8))}px`;
  }
  function postponeHide() { dismissTimer = setTimeout(() => { if (!tooltip.matches(':hover') && !tooltipTarget?.matches(':focus')) hideTooltip(); }, 140); }
  function explain(target, text, tap = false) {
    target.addEventListener('pointerenter', () => showTooltip(target, text));
    target.addEventListener('pointerleave', postponeHide);
    target.addEventListener('focus', () => showTooltip(target, text));
    target.addEventListener('blur', postponeHide);
    if (tap) target.addEventListener('click', () => showTooltip(target, text));
  }
  tooltip.addEventListener('pointerenter', () => clearTimeout(dismissTimer)); tooltip.addEventListener('pointerleave', postponeHide);
  const dismiss = event => { if (event.key === 'Escape' || event.type === 'pointerdown' && !tooltip.contains(event.target) && !tooltipTarget?.contains(event.target)) hideTooltip(); };
  document.addEventListener('keydown', dismiss); document.addEventListener('pointerdown', dismiss);
  let plot, tableHost, detailHost, status, categorySelect, modeButtons, qualityControl, qualitySelect;

  function qualityLabel() { return qualityMetric === "contracts" ? "Contract success (mechanical)" : data.quality_label || "AI rubric score"; }

  function activeCohort() {
    return METRICS[mode].pareto ? new Set(comparisonPoints(data.models.filter((model) => selected.has(model.id)), METRICS[mode].field, category, qualityMetric).case_ids) : null;
  }

  function chooseModel(id) { activeModel = id; renderDetail(); detailHost.querySelector("h4")?.focus(); }
  function renderFrame() {
    hideTooltip(); root.replaceChildren(tooltip);
    const heading = el("div", "bc-heading"); heading.append(el("h3", "", "Compare the models"),
      el("p", "bc-note", "Compare measured tasks, then open the responses behind each result.")); root.append(heading);
    const legend = el('div', 'bc-provider-legend'); legend.setAttribute('aria-label', 'Model provider colors');
    for (const provider of new Map(data.models.map(model => { const p = modelProvider(model); return [p.name, p]; })).values()) {
      const label = el('span', 'bc-provider', provider.name); label.style.setProperty('--provider-color', provider.color); legend.append(label);
    }
    root.append(legend, el('p', 'bc-note', 'Color identifies the model developer. Hover or focus a number for its measurement details; tap it on mobile. Serving transport is shown separately.'));
    const controls = el("div", "bc-controls");
    const label = el("label", "bc-filter", "Teaching situation "); categorySelect = el("select");
    categorySelect.setAttribute("aria-label", "Filter by teaching situation");
    const categories = unique(data.models.flatMap((model) => model.rows.map((row) => row.category))).sort();
    for (const [value, name] of [["all", "All situations"], ...categories.map((value) => [value, value.replaceAll("_", " ")])]) {
      const option = el("option", "", name); option.value = value; categorySelect.append(option);
    }
    if (category !== "all" && !categories.includes(category)) category = "all";
    categorySelect.value = category;
    categorySelect.addEventListener("change", () => { category = categorySelect.value; renderViews(); });
    label.append(categorySelect); controls.append(label);
    const picker = el("details", "bc-model-picker"); const summary = el("summary", "", "Choose models"); picker.append(summary);
    const choices = el("fieldset", "bc-model-choices"); choices.append(el("legend", "bc-sr-only", "Models to compare"));
    for (const model of data.models) {
      const item = el("label"); const input = el("input"); input.type = "checkbox"; input.checked = selected.has(model.id);
      input.addEventListener("change", () => { input.checked ? selected.add(model.id) : selected.delete(model.id); renderViews(); });
      item.append(input, document.createTextNode(`${model.label || model.id}${hasMeasurements(model) ? "" : " · unavailable (no measurements)"}`)); choices.append(item);
    }
    picker.append(choices); controls.append(picker); root.append(controls);
    const tabs = el("div", "bc-modes"); tabs.setAttribute("role", "group"); tabs.setAttribute("aria-label", "Comparison metric");
    modeButtons = {};
    for (const [key, spec] of Object.entries(METRICS)) {
      const item = button(spec.label, () => { mode = key; renderViews(); });
      if (key === 'quality') item.disabled = !data.quality_available;
      modeButtons[key] = item; tabs.append(item);
    }
    root.append(tabs);
    qualityControl = el("label", "bc-filter bc-quality-control", "Pareto vertical metric ");
    qualitySelect = el("select"); qualitySelect.setAttribute("aria-label", "Pareto vertical metric");
    for (const [value, label] of [["quality", "AI rubric score"], ["contracts", "Contract success (mechanical)"]]) {
      const option = el("option", "", label); option.value = value;
      option.disabled = value === "quality" && !data.quality_available; qualitySelect.append(option);
    }
    qualitySelect.value = qualityMetric;
    qualitySelect.addEventListener("change", () => { qualityChosen = true; qualityMetric = qualitySelect.value; renderViews(); });
    qualityControl.append(qualitySelect); root.append(qualityControl);
    status = el("p", "bc-note bc-coverage"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); root.append(status);
    plot = el("div", "bc-plot"); root.append(plot);
    const notes = el("p", "bc-note", "Cost uses recorded usage estimates. Output tokens and latency cover the measured episode, which may contain several calls. Errors are included wherever measurements exist; this is not a success-only sample. Latency includes provider scheduling and prompt processing; it is not decoding speed. Missing values stay unknown."); root.append(notes);
    tableHost = el("div", "bc-table-wrap"); root.append(tableHost);
    detailHost = el("div", "bc-detail"); root.append(detailHost);
    renderViews();
  }

  function renderViews() {
    hideTooltip();
    qualityControl.hidden = !METRICS[mode].pareto;
    for (const [key, item] of Object.entries(modeButtons)) item.setAttribute("aria-pressed", String(key === mode));
    const models = data.models.filter((model) => selected.has(model.id));
    const expected = unique(models.flatMap((model) => filtered(model, category).map((row) => row.case_id))).length;
    const spec = METRICS[mode];
    plot.replaceChildren();
    if (!models.length || !expected) {
      status.textContent = models.length ? "No cases in this situation." : "Choose at least one model to compare.";
    } else if (spec.pareto) {
      const comparison = comparisonPoints(models, spec.field, category, qualityMetric);
      status.textContent = `${comparison.case_ids.length} of ${expected} cases have both ${qualityLabel()} and ${spec.label.endsWith("cost") ? "cost" : "latency"} for every selected model. Only these shared cases define the frontier.${qualityMetric === "contracts" ? " Contract success measures mechanical checks, not teaching quality." : " AI rubric scores are model judgments, not measured human learning."}`;
      if (comparison.points.length) drawScatter(comparison, spec);
      else plot.append(el("p", "bc-empty", "No shared measured cases yet. Choose fewer models or another teaching situation."));
    } else {
      status.textContent = `${models.length} models · ${expected} cases in this selection. Bars average available measurements; coverage is shown for each model.${data.quality_available ? "" : " Semantic quality has not been scored yet."}`;
      drawBars(models, expected, spec);
    }
    renderTable(models, expected);
    if (activeModel && !selected.has(activeModel)) activeModel = null;
    renderDetail();
  }

  function drawBars(models, expected, spec) {
    const rows = models.map((model) => ({ model, metric: summarizeRows(filtered(model, category), expected)[spec.field] }))
      .sort((a, b) => a.metric.value === null ? 1 : b.metric.value === null ? -1 : spec.higher ? b.metric.value - a.metric.value : a.metric.value - b.metric.value);
    const width = 960, left = 240, right = 155, top = 22, step = 36, height = top + rows.length * step + 36;
    const max = Math.max(...rows.map((row) => row.metric.value || 0), .001);
    const direction = spec.higher ? 'higher is better' : 'lower is better';
    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": `${spec.label}, ${direction}. The table below contains all values.` });
    rows.forEach(({ model, metric }, index) => {
      const y = top + index * step;
      const group = svgEl("g", { class: "bc-mark" });
      const provider = modelProvider(model); group.style.setProperty('--provider-color', provider.color);
      explain(group, `${model.label || model.id} · ${provider.name} · ${provider.transport}. ${spec.label}: ${format(metric.value, spec.field)}. Mean of ${metric.count}/${expected} measured episodes. Missing measurements are not zero.`);
      interactiveMark(group, `${model.label || model.id}: ${format(metric.value, spec.field)}, ${metric.count} of ${expected} cases. Open case details.`, () => chooseModel(model.id));
      group.append(svgEl("rect", { x: 0, y: y - 13, width, height: 32, fill: "transparent" }),
        svgEl("text", { x: left - 14, y: y + 6, "text-anchor": "end", class: "bc-svg-label" }, (model.label || model.id).length > 28 ? (model.label || model.id).slice(0, 26) + "…" : model.label || model.id));
      if (metric.value !== null) group.append(svgEl("rect", { x: left, y: y - 7, width: Math.max(1, metric.value / max * (width - left - right)), height: 16, class: "bc-bar" }));
      group.append(svgEl("text", { x: width - right + 16, y: y + 5, class: "bc-svg-number" }, `${format(metric.value, spec.field)} · ${metric.count}/${expected}`));
      svg.append(group);
    });
    svg.append(svgEl("text", { x: left, y: height - 4, class: "bc-axis-label" }, `${spec.unit} · ${direction}`)); plot.append(svg);
  }

  function drawScatter(comparison, spec) {
    const width = 960, height = 410, left = 66, bottom = 350, right = 900, top = 20;
    const maxX = Math.max(...comparison.points.map((point) => point.x), .001) * 1.12;
    const x = (value) => left + value / maxX * (right - left), y = (value) => bottom - value / 100 * (bottom - top);
    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": `${qualityLabel()} versus ${spec.unit}; higher score and lower ${spec.field === "cost_usd" ? "cost" : "latency"} are preferable. Open a point for its cases.` });
    for (let tick = 0; tick <= 100; tick += 25) {
      svg.append(svgEl("line", { x1: left, x2: right, y1: y(tick), y2: y(tick), class: "bc-grid" }),
        svgEl("text", { x: left - 12, y: y(tick) + 5, "text-anchor": "end", class: "bc-axis-label" }, `${tick}`));
    }
    for (let tick = 0; tick <= 4; tick++) svg.append(svgEl("text", { x: x(maxX * tick / 4), y: bottom + 27, "text-anchor": "middle", class: "bc-axis-label" }, format(maxX * tick / 4, spec.field)));
    svg.append(svgEl("text", { x: left, y: 395, class: "bc-axis-label" }, `${spec.unit} →`),
      svgEl("text", { x: right, y: 395, "text-anchor": "end", class: "bc-axis-label" }, `${qualityLabel()} ↑`));
    const frontier = new Set(comparison.frontier.map((point) => point.id));
    if (comparison.frontier.length > 1) svg.append(svgEl("polyline", { points: comparison.frontier.map((point) => `${x(point.x)},${y(point.y)}`).join(" "), class: "bc-frontier" }));
    comparison.points.forEach((point, index) => {
      const group = svgEl("g", { class: `bc-mark${frontier.has(point.id) ? " bc-on-frontier" : ""}` });
      const provider = modelProvider(data.models.find(model => model.id === point.id)); group.style.setProperty('--provider-color', provider.color);
      explain(group, `${point.label} · ${provider.name} · ${provider.transport}. ${qualityLabel()}: ${format(point.y, 'quality')}; ${spec.label}: ${format(point.x, spec.field)}. Same ${comparison.case_ids.length} cases for every selected model.${frontier.has(point.id) ? ' On the shared-case frontier.' : ''}`);
      interactiveMark(group, `${point.label}: ${qualityLabel()} ${format(point.y, "quality")}, ${format(point.x, spec.field)}. ${frontier.has(point.id) ? "On the shared-case frontier. " : ""}Open case details.`, () => chooseModel(point.id));
      group.append(svgEl("circle", { cx: x(point.x), cy: y(point.y), r: 19, fill: "transparent" }),
        svgEl("circle", { cx: x(point.x), cy: y(point.y), r: frontier.has(point.id) ? 7 : 5, class: "bc-dot" }),
        svgEl("text", { x: x(point.x) + 11, y: y(point.y) - 9, class: "bc-point-label" }, String(index + 1)));
      svg.append(group);
    });
    plot.append(svg);
    const legend = el("div", "bc-point-legend");
    comparison.points.forEach((point, index) => legend.append(button(`${index + 1}. ${point.label}${frontier.has(point.id) ? " · frontier" : ""}`, () => chooseModel(point.id), "bc-link")));
    plot.append(legend);
  }

  function makeTable(headers, caption) {
    const table = el("table", "bc-table"); table.append(el("caption", "bc-sr-only", caption));
    const head = el("thead"), row = el("tr"); headers.forEach((text) => { const cell = el("th", "", text); cell.scope = "col"; row.append(cell); }); head.append(row); table.append(head);
    const body = el("tbody"); table.append(body); return { table, body };
  }
  function metricCell(metric, field, model, label = field) {
    const cell = el('td'), value = button(format(metric.value, field), () => {}, 'bc-metric');
    const provider = modelProvider(model); value.style.setProperty('--provider-color', provider.color);
    const note = field === 'cost_usd' ? 'Usage-based estimate, not an invoice.' : field === 'latency_seconds' ? 'Full episode wall time, not decoding speed.' : field === 'output_tokens' ? 'Reported output across the episode; may include reasoning.' : 'AI judgment or mechanical check as labeled, not human learning.';
    const text = `${model.label || model.id} · ${provider.name} · ${provider.transport}. ${label}: ${format(metric.value, field)}. Mean of ${metric.count}/${metric.total} measured cases. ${note}`;
    value.setAttribute('aria-label', text); explain(value, text, true);
    cell.append(value, el('small', 'bc-count', `${metric.count}/${metric.total} measured`)); return cell;
  }
  function renderTable(models, expected) {
    tableHost.replaceChildren();
    const cohort = activeCohort();
    if (cohort) expected = cohort.size;
    tableHost.append(el("p", "bc-note", cohort ? `Table and plotted points use the same shared cases. The vertical axis uses ${qualityLabel()}; other scores remain separately labeled. Open a model to inspect those exact cases.` : "Table and bars average available measurements. Different coverage can change a model’s apparent standing."));
    const { table, body } = makeTable(["Model", data.quality_label || "Semantic quality", "Contracts", "Cost / task", "Tokens / task", "Episode latency"], cohort ? "Shared-case averages and measurement coverage" : "Available-case averages and measurement coverage");
    for (const model of models) {
      const rows = filtered(model, category).filter((row) => !cohort || cohort.has(row.case_id));
      const summary = summarizeRows(rows, expected); const row = el("tr"), name = el("th"); name.scope = "row";
      const provider = modelProvider(model); row.style.setProperty('--provider-color', provider.color);
      name.append(button(model.label || model.id, () => chooseModel(model.id), "bc-link"), el('small', 'bc-count bc-provider', provider.name)); row.append(name);
      row.append(metricCell(data.quality_available ? summary.quality : { value: null, count: 0, total: expected }, "quality", model, data.quality_label || 'Semantic quality'), metricCell(summary.contracts, "quality", model, 'Mechanical contracts'),
        metricCell(summary.cost_usd, "cost_usd", model, 'Cost per task'), metricCell(summary.output_tokens, "output_tokens", model, 'Output tokens per task'), metricCell(summary.latency_seconds, "latency_seconds", model, 'Episode latency')); body.append(row);
    }
    tableHost.append(table);
  }
  function renderDetail() {
    detailHost.replaceChildren();
    const model = data.models.find((item) => item.id === activeModel); if (!model) return;
    const head = el("div", "bc-detail-heading"); const heading = el("h4", "", `${model.label || model.id}: inspect the cases`); heading.tabIndex = -1;
    head.append(heading, button("Close case details", () => { activeModel = null; renderDetail(); root.focus(); }, "bc-link")); detailHost.append(head);
    const breakdown = el("div", "bc-category-breakdown");
    for (const name of unique(model.rows.map((row) => row.category)).sort()) {
      const summary = summarizeRows(filtered(model, name));
      breakdown.append(button(`${name.replaceAll("_", " ")}: ${data.quality_available ? format(summary.quality.value, "quality") : format(summary.contracts.value, "quality")} ${data.quality_available ? "quality" : "contracts"} (${data.quality_available ? summary.quality.count : summary.contracts.count}/${summary.total})`, () => { category = name; categorySelect.value = name; renderViews(); }, "bc-category"));
    }
    detailHost.append(breakdown);
    const cohort = activeCohort();
    if (cohort) detailHost.append(el("p", "bc-note", `${cohort.size} shared cases underlying this point. Category buttons above summarize all available cases in that category.`));
    const { table, body } = makeTable(["Case", "Quality", "Contract", "Cost", "Output tokens", "Episode latency"], `Individual ${model.label || model.id} cases, open a case to read its trace`);
    for (const row of filtered(model, category).filter((row) => !cohort || cohort.has(row.case_id))) {
      const tr = el("tr"), name = el("th"); name.scope = "row";
      name.append(button(row.case_id, () => onSelect({ model_id: model.id, case_id: row.case_id, category: row.category }), "bc-link"));
      tr.append(name, el("td", "", data.quality_available && measured(row, "quality") ? format(row.quality, "quality") : "Unknown"),
        el("td", "", row.contract_passed === true ? "Pass" : row.contract_passed === false ? "Fail" : "Unknown"));
      for (const field of ["cost_usd", "output_tokens", "latency_seconds"]) tr.append(el("td", "", measured(row, field) ? format(row[field], field) : "Unknown"));
      body.append(tr);
    }
    const wrap = el("div", "bc-table-wrap"); wrap.append(table); detailHost.append(wrap);
  }
  renderFrame();
  return { update(nextData) { const previous = new Set(data.models.map((model) => model.id)); data = validateChartData(nextData);
    if (mode === 'quality' && !data.quality_available) mode = 'tokens';
    if (!qualityChosen) qualityMetric = data.preferred_pareto_score === "contracts" ? "contracts" : data.quality_available ? "quality" : "contracts";
    selected = new Set(data.models.filter((model) => selected.has(model.id) || (!previous.has(model.id) && hasMeasurements(model))).map((model) => model.id)); renderFrame(); },
  destroy() { hideTooltip(); document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', dismiss); root.remove(); } };
}
