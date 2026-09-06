import { Select } from "./Select";
import { useId, useMemo, useState } from "react";
import { Activity, RotateCcw } from "lucide-react";
import { CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { evaluateSimulationExpression, parseSimulationExpression, type UiSimulationNode } from "@keating/learner-contracts";
import { css } from "../../styled-system/css";
import { MarkdownBlock } from "./MarkdownBlock";
import { formatSimulationNumber, parameterPrecision, sampleSimulation } from "./simulation/sampling";
import "./simulation/simulation.css";

const focus = { outline: "2px solid var(--ring)", outlineOffset: "3px" };
const selectClass = css({ width: "100%", minWidth: 0, minHeight: "2.75rem", border: "1px solid var(--border)", borderRadius: "0.5rem", paddingInline: "0.625rem", color: "var(--foreground)", background: "var(--background)", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", _focusVisible: focus });
const labelClass = css({ display: "grid", minWidth: 0, gap: "0.25rem", color: "var(--muted-foreground)", fontSize: "0.75rem" });
const numericClass = css({ fontVariantNumeric: "tabular-nums", fontWeight: 650 });
const unitLabel = (label: string, unit?: string) => unit ? `${label} (${unit})` : label;
const axisNumber = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 }).format(value);

/** Reset local exploration when the authored model changes, not on parent renders. */
export function SimulationRenderer({ node }: { node: UiSimulationNode }) {
	return <SimulationControls key={JSON.stringify([node.id, node.parameters, node.readouts])} node={node} />;
}

function SimulationControls({ node }: { node: UiSimulationNode }) {
	const identifier = useId();
	const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(node.parameters.map((parameter) => [parameter.id, parameter.value])));
	const compiled = useMemo(() => node.readouts.map((readout) => {
		const parsed = parseSimulationExpression(readout.expr, node.parameters.map((parameter) => parameter.id));
		return { readout, expression: parsed.ok ? parsed.node : undefined, parameters: parsed.ok ? parsed.parameters : [] };
	}), [node.readouts, node.parameters]);
	const defaultReadout = compiled.find((item) => item.readout.emphasis) ?? compiled[0];
	const [outputId, setOutputId] = useState(defaultReadout?.readout.id ?? "");
	const [parameterId, setParameterId] = useState(() => [...node.parameters].reverse().find((parameter) => defaultReadout?.parameters.includes(parameter.id))?.id ?? node.parameters[0]?.id ?? "");
	const parameter = node.parameters.find((item) => item.id === parameterId) ?? node.parameters[0];
	const selected = compiled.find((item) => item.readout.id === outputId) ?? compiled[0];
	const samples = useMemo(() => parameter ? sampleSimulation(parameter, selected?.expression, values) : [], [parameter, selected?.expression, values]);
	const plotted = useMemo(() => samples.filter((point): point is { x: number; y: number } => point.y !== undefined), [samples]);
	const dirty = node.parameters.some((item) => values[item.id] !== item.value);
	if (!parameter || !selected) return null;
	const { readout, expression } = selected;
	const currentValue = expression ? evaluateSimulationExpression(expression, values) : undefined;
	const currentParameter = values[parameter.id] ?? parameter.value;
	const xLabel = unitLabel(parameter.label, parameter.unit);
	const yLabel = unitLabel(readout.label, readout.unit);
	const caption = node.parameters.length > 1 ? `Other controls stay at their current settings.` : `Each dot is a sampled setting.`;

	return <section data-simulation={node.id} className={`simulation ${css({ display: "grid", minWidth: 0, gap: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.875rem", _first: { borderTop: "none", paddingTop: 0 } })}`} aria-labelledby={`${identifier}-title`}>
		<header className="simulation__header">
			<h4 id={`${identifier}-title`} className="simulation__title">
				<Activity size={18} aria-hidden="true" className={css({ flexShrink: 0, color: "var(--primary)" })} />{node.title}
			</h4>
			<button type="button" aria-label="Reset simulation" title="Reset simulation" disabled={!dirty} onClick={() => setValues(Object.fromEntries(node.parameters.map((item) => [item.id, item.value])))} className="simulation__reset">
				<RotateCcw size={16} aria-hidden="true" /><span className="simulation__reset-label">Reset</span>
			</button>
		</header>
		{node.brief ? <div className={css({ fontSize: "0.8125rem", lineHeight: 1.5, maxWidth: "65ch", "& p": { marginBlock: 0 } })}><MarkdownBlock content={node.brief} /></div> : null}

		<div className={css({ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.75rem" })}>
			<label className={labelClass}>Vary
				<Select aria-label="Graph horizontal axis" className={`simulation__select ${selectClass}`} value={parameter.id} onValueChange={setParameterId}>
					{node.parameters.map((item) => <option key={item.id} value={item.id}>{unitLabel(item.label, item.unit)}</option>)}
				</Select>
			</label>
			<label className={labelClass}>Watch
				<Select aria-label="Graph output" className={`simulation__select ${selectClass}`} value={readout.id} onValueChange={setOutputId}>
					{node.readouts.map((item) => <option key={item.id} value={item.id}>{unitLabel(item.label, item.unit)}</option>)}
				</Select>
			</label>
		</div>

		<figure aria-label={`${yLabel} against ${xLabel}`} aria-describedby={`${identifier}-caption`} className={css({ margin: 0, minWidth: 0, background: "color-mix(in srgb, var(--primary) 4%, var(--background))", borderRadius: "0.75rem", padding: "0.75rem 0.5rem 0.625rem" })}>
			<div className={css({ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.625rem", paddingInline: "0.375rem", fontSize: "0.75rem" })}>
				<strong className={css({ fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" })}>{yLabel}</strong>
				<span className={css({ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.6875rem" })}><span aria-hidden="true" className={css({ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: "var(--primary)" })} />Now</span>
			</div>
			{plotted.length > 0 ? <div data-simulation-plot={node.id} className={css({ height: "14rem", minWidth: 0, width: "100%", marginTop: "0.5rem" })}>
				<ResponsiveContainer width="100%" height="100%" minWidth={0}>
					<ScatterChart margin={{ top: 12, right: 16, bottom: 4, left: 0 }} accessibilityLayer>
						<CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
						<XAxis type="number" dataKey="x" name={parameter.label} unit={parameter.unit ? ` ${parameter.unit}` : undefined} domain={[parameter.min, parameter.max]} tickFormatter={axisNumber} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} tickCount={4} minTickGap={24} />
						<YAxis type="number" dataKey="y" name={readout.label} unit={readout.unit ? ` ${readout.unit}` : undefined} domain={["auto", "auto"]} tickFormatter={axisNumber} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} tickCount={4} width={48} />
						<ZAxis range={[16, 16]} />
						<Tooltip cursor={false} isAnimationActive={false} contentStyle={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--foreground)", fontSize: "12px", maxWidth: "240px" }} formatter={(value, name) => [typeof value === "number" ? formatSimulationNumber(value, name === parameter.label ? parameterPrecision(parameter) : readout.precision ?? 2) : "—", name]} />
						{/* No interpolation: arbitrary authored arithmetic may have a pole between samples. */}
						<Scatter data={plotted} name={readout.label} fill="var(--primary)" line={false} isAnimationActive={false} />
						<ReferenceLine x={currentParameter} stroke="var(--primary)" strokeOpacity={0.4} strokeDasharray="3 3" />
						{currentValue !== undefined ? <ReferenceDot x={currentParameter} y={currentValue} r={6} fill="var(--primary)" stroke="var(--background)" strokeWidth={2} ifOverflow="extendDomain" /> : null}
					</ScatterChart>
				</ResponsiveContainer>
			</div> : <p role="status" className={css({ minHeight: "10rem", display: "grid", placeContent: "center", padding: "1rem", fontSize: "0.8125rem", textAlign: "center", lineHeight: 1.5 })}>No finite values at these settings.<br />Try another output or adjust a control.</p>}
			<div className={css({ textAlign: "center", fontSize: "0.75rem", fontWeight: 600, overflowWrap: "anywhere" })}>{xLabel}</div>
			<figcaption id={`${identifier}-caption`} className={css({ paddingTop: "0.625rem", textAlign: "center", fontSize: "0.6875rem", color: "var(--muted-foreground)", lineHeight: 1.4 })}>
				{caption}{samples.some((point) => point.y === undefined) ? " Undefined values are omitted." : ""}
			</figcaption>
		</figure>

		<div className={`simulation__parameters ${css({ display: "grid", gap: "0.75rem", gridTemplateColumns: "minmax(0, 1fr)", "@media (min-width: 640px)": { gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: "1.5rem" } })}`}>
			{node.parameters.map((item) => <label key={item.id} className={css({ display: "grid", minWidth: 0 })}>
				<span className={css({ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.75rem", fontSize: "0.8125rem" })}>
					<span className={css({ minWidth: 0, overflowWrap: "anywhere" })}>{item.label}</span>
					<output className={numericClass}>{formatSimulationNumber(values[item.id], parameterPrecision(item))}{item.unit ? ` ${item.unit}` : ""}</output>
				</span>
				<input type="range" aria-label={unitLabel(item.label, item.unit)} min={item.min} max={item.max} step={item.step ?? "any"} value={values[item.id] ?? item.value} aria-valuetext={`${formatSimulationNumber(values[item.id], parameterPrecision(item))}${item.unit ? ` ${item.unit}` : ""}`} onChange={(event) => {
					const value = Number(event.currentTarget.value);
					setValues((current) => ({ ...current, [item.id]: Number.isFinite(value) ? Math.max(item.min, Math.min(item.max, value)) : item.value }));
				}} className={css({ width: "100%", minWidth: 0, height: "2.75rem", margin: 0, cursor: "pointer", accentColor: "var(--primary)", _focusVisible: focus })} />
			</label>)}
		</div>

		<dl className="simulation__readouts">
			{compiled.map((item) => {
				const value = item.expression ? evaluateSimulationExpression(item.expression, values) : undefined;
				return <div key={item.readout.id} data-simulation-readout={item.readout.id} data-primary={item === defaultReadout || undefined} className="simulation__readout">
					<dt className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)", lineHeight: 1.4, overflowWrap: "anywhere" })}>{item.readout.label}</dt>
					<dd className={css({ margin: 0, fontSize: "1.125rem", fontWeight: 700, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" })} style={item.readout.emphasis ? { fontSize: "1.25rem" } : undefined}>{formatSimulationNumber(value, item.readout.precision ?? 2)}{value !== undefined && item.readout.unit ? <span className={css({ marginLeft: "0.25rem", fontSize: "0.75rem", fontWeight: 500 })}>{item.readout.unit}</span> : null}</dd>
				</div>;
			})}
		</dl>

		<details className={css({ borderTop: "1px solid var(--border)", fontSize: "0.75rem" })}>
			<summary className={css({ minHeight: "2.75rem", paddingBlock: "0.75rem", cursor: "pointer", width: "fit-content", color: "var(--muted-foreground)", fontWeight: 600, _focusVisible: focus })}>View sampled values</summary>
			<div tabIndex={0} role="region" aria-label="Simulation sample data" className={css({ overflow: "auto", maxHeight: "16rem", borderRadius: "0.5rem", _focusVisible: focus })}>
				<table className={css({ width: "100%", borderCollapse: "collapse", textAlign: "left", fontVariantNumeric: "tabular-nums", "& th, & td": { padding: "0.5rem", borderBottom: "1px solid var(--border)", overflowWrap: "anywhere" }, "& th": { fontWeight: 600 }, "& th:last-child, & td:last-child": { textAlign: "right" } })}>
					<caption className={css({ textAlign: "left", padding: "0.5rem", color: "var(--muted-foreground)" })}>{yLabel} as {xLabel} changes. {caption}</caption>
					<thead><tr><th scope="col">{xLabel}</th><th scope="col">{yLabel}</th></tr></thead>
					<tbody>{samples.map((point) => <tr key={point.x} style={point.x === currentParameter ? { background: "var(--muted)", fontWeight: 650 } : undefined}>
						<td>{formatSimulationNumber(point.x, parameterPrecision(parameter))}{point.x === currentParameter ? " (now)" : ""}</td>
						<td>{point.y === undefined ? "No value" : formatSimulationNumber(point.y, readout.precision ?? 2)}</td>
					</tr>)}</tbody>
				</table>
			</div>
		</details>
	</section>;
}
