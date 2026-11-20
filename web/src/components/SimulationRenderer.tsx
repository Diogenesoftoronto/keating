import { LessonFrame } from "./lesson/LessonFrame";
import { Select } from "./Select";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import { LineChart } from "../design-system/charts";
import { EmptyState, IconButton, Button } from "../design-system/kit";
import { evaluateSimulationExpression, parseSimulationExpression, type UiActionReceipt, type UiSimulationNode } from "@keating/learner-contracts";
import { MarkdownBlock } from "./MarkdownBlock";
import { formatSimulationCompact, formatSimulationNumber, parameterPrecision, sampleSimulation } from "./simulation/sampling";
import { LessonSlider } from "./lesson/LessonSlider";
import "./simulation/simulation.css";
import type { StorageLike } from "../keating/event-store";
import type { SharedUiActionEvent } from "../keating/openui/shared-renderer";
import {
	loadSimulationState,
	saveSimulationState,
	simulationDefaultValues,
	simulationDefaultView,
	simulationShareIntent,
	simulationShareMatches,
	type SimulationShareIntent,
} from "../keating/openui/shared-actions";

const unitLabel = (label: string, unit?: string) => unit ? `${label} (${unit})` : label;


function browserStorage(): StorageLike | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}

export interface SimulationRendererProps {
	node: UiSimulationNode;
	/** Shared document id; with it, exploration survives a reload. Omit for transient previews. */
	documentId?: string;
	/** Defaults to this browser's localStorage. Pass null to keep exploration in memory. */
	storage?: Pick<StorageLike, "getItem" | "setItem"> | null;
	/** The latest completed share for this node, if any. */
	receipt?: UiActionReceipt;
	disabled?: boolean;
	/** Present when the host can deliver a share to the tutor. */
	onAction?: (event: SharedUiActionEvent) => boolean;
}

/** Reset local exploration when the authored model changes, not on parent renders. */
export function SimulationRenderer(props: SimulationRendererProps) {
	const { node } = props;
	return <SimulationControls key={JSON.stringify([props.documentId ?? null, node.id, node.parameters, node.readouts])} {...props} />;
}

function shareMessage(node: UiSimulationNode, intent: SimulationShareIntent): string {
	const changed = intent.changedParameterIds.map((id) => node.parameters.find((parameter) => parameter.id === id)?.label ?? id);
	return changed.length
		? `Shared ${node.title} after changing ${changed.join(", ")}.`
		: `Shared ${node.title} at its starting settings.`;
}

function compileReadouts(node: UiSimulationNode) {
	const parameterIds = node.parameters.map((parameter) => parameter.id);
	return node.readouts.map((readout) => {
		const parsed = parseSimulationExpression(readout.expr, parameterIds);
		return { readout, expression: parsed.ok ? parsed.node : undefined, parameters: parsed.ok ? parsed.parameters : [] };
	});
}

/**
 * The learner's exploration of one simulation: restored from storage on mount,
 * saved after each learner change (never on a bare render), and shared with the
 * tutor only on an explicit share that differs from the last completed one.
 */
export function useSimulationInteraction({ node, documentId, storage: storageOverride, receipt, disabled = false, onAction }: SimulationRendererProps) {
	const storage = useMemo(() => documentId === undefined ? null : storageOverride === undefined ? browserStorage() : storageOverride, [documentId, storageOverride]);
	const [restored] = useState(() => documentId === undefined ? { values: simulationDefaultValues(node) } : loadSimulationState(storage, documentId, node));
	const [values, setValues] = useState<Record<string, number>>(restored.values);
	const compiled = useMemo(() => compileReadouts(node), [node]);
	// What the author asked the learner to look at; a saved learner choice wins over it.
	const defaultView = useMemo(() => simulationDefaultView(node), [node]);
	const defaultReadout = compiled.find((item) => item.readout.id === defaultView.readoutId) ?? compiled[0];
	const defaultReadoutId = defaultReadout?.readout.id ?? "";
	const defaultParameterId = defaultView.parameterId ?? "";
	const [readoutId, setReadoutId] = useState(restored.readoutId ?? defaultReadoutId);
	const [parameterId, setParameterId] = useState(restored.parameterId ?? defaultParameterId);
	const touched = useRef(false);
	const [saveFailed, setSaveFailed] = useState(false);
	const [shareStatus, setShareStatus] = useState<"idle" | "shared" | "failed">("idle");
	useEffect(() => {
		if (!touched.current || documentId === undefined || !storage) return;
		setSaveFailed(!saveSimulationState(storage, documentId, node, { values, parameterId, readoutId }));
	}, [documentId, node, parameterId, readoutId, storage, values]);
	const interact = () => { touched.current = true; setShareStatus("idle"); };
	const lastShared = receipt?.state === "completed" && receipt.action.type === "share-simulation" && receipt.action.nodeId === node.id ? receipt.action : undefined;
	const alreadyShared = simulationShareMatches(lastShared, node, { values });
	return {
		compiled,
		defaultReadout,
		/** True once the settings or the graph differ from what the author set up. */
		dirty: parameterId !== defaultParameterId || readoutId !== defaultReadoutId || node.parameters.some((item) => values[item.id] !== item.value),
		values,
		parameterId,
		readoutId,
		saveFailed,
		shareStatus,
		lastShared,
		alreadyShared,
		canShare: Boolean(onAction) && !disabled && !alreadyShared,
		setValue(id: string, raw: number) {
			const parameter = node.parameters.find((item) => item.id === id);
			if (!parameter) return;
			interact();
			setValues((current) => ({ ...current, [id]: Number.isFinite(raw) ? Math.max(parameter.min, Math.min(parameter.max, raw)) : parameter.value }));
		},
		/** Back to the authored start: the starting values and the graph the author opened on. */
		reset() { interact(); setValues(simulationDefaultValues(node)); setParameterId(defaultParameterId); setReadoutId(defaultReadoutId); },
		selectParameter(id: string) { interact(); setParameterId(id); },
		selectReadout(id: string) { interact(); setReadoutId(id); },
		/** One learner turn per distinct share; a repeat of the last shared settings sends nothing. */
		share(): boolean {
			if (!onAction || disabled || alreadyShared) return false;
			const intent = simulationShareIntent(node, { values, parameterId, readoutId });
			const accepted = onAction({ intent, humanFriendlyMessage: shareMessage(node, intent) });
			setShareStatus(accepted ? "shared" : "failed");
			return accepted;
		},
	};
}

function SimulationControls(props: SimulationRendererProps) {
	const { node, onAction } = props;
	const identifier = useId();
	const interaction = useSimulationInteraction(props);
	// The check pops once when a share is confirmed here; a page reload shows it already settled.
	const sharedBefore = useRef(interaction.alreadyShared);
	const [justShared, setJustShared] = useState(false);
	useEffect(() => {
		if (interaction.alreadyShared && !sharedBefore.current) setJustShared(true);
		if (!interaction.alreadyShared) setJustShared(false);
		sharedBefore.current = interaction.alreadyShared;
	}, [interaction.alreadyShared]);
	const { compiled, defaultReadout, values, parameterId, saveFailed, shareStatus, lastShared, alreadyShared } = interaction;
	const outputId = interaction.readoutId;
	const parameter = node.parameters.find((item) => item.id === parameterId) ?? node.parameters[0];
	const selected = compiled.find((item) => item.readout.id === outputId) ?? compiled[0];
	const samples = useMemo(() => parameter ? sampleSimulation(parameter, selected?.expression, values) : [], [parameter, selected?.expression, values]);
	const plotted = useMemo(() => samples.filter((point): point is { x: number; y: number } => point.y !== undefined), [samples]);
	if (!parameter || !selected) return null;
	const { readout, expression } = selected;
	const currentValue = expression ? evaluateSimulationExpression(expression, values) : undefined;
	const currentParameter = values[parameter.id] ?? parameter.value;
	const xLabel = unitLabel(parameter.label, parameter.unit);
	const yLabel = unitLabel(readout.label, readout.unit);
	const caption = node.parameters.length > 1 ? `Other controls stay at their current settings.` : `Each dot is a sampled setting.`;
	const precision = readout.precision ?? 2;
	const formatY = (value: number) => formatSimulationCompact(value, precision, readout.unit);
	const formatX = (value: number) => formatSimulationCompact(value, parameterPrecision(parameter), parameter.unit);

	return <LessonFrame glyph="signal" kind="Simulation" title={node.title} aria-label={node.title} className="simulation" data-simulation={node.id}
		tools={<IconButton size="sm" glyph="undo" label="Reset simulation" disabled={!interaction.dirty} onClick={interaction.reset} />}
		footer={onAction && <><span id={`${identifier}-share-status`} role="status" className="lesson-foot-meta simulation__share-status">
				{shareStatus === "failed"
					? "Not shared yet. Your settings are kept here; try again."
					: alreadyShared
						? shareStatus === "shared" ? "Sent. Your tutor will respond to these settings." : "These settings are with your tutor."
						: lastShared
							? "Changed since you last shared."
							: "Sends your settings and readouts to your tutor."}
			</span><Button type="button" size="sm" data-simulation-share={node.id} variant="primary" disabled={!interaction.canShare} aria-describedby={`${identifier}-share-status`} onClick={interaction.share}>
				{alreadyShared ? <KeatingGlyph name="check" size={13} className={justShared ? "k-receipt" : undefined} /> : <KeatingGlyph name="send" size={13} />}
				{alreadyShared ? "Shared with your tutor" : "Share what I found"}
			</Button></>}>
		{node.brief ? <div className="simulation__brief"><MarkdownBlock content={node.brief} /></div> : null}

		<div className="simulation__pickers">
			<div className="simulation__picker">
				<span className="lesson-label" aria-hidden="true">Vary</span>
				<Select aria-label="Graph horizontal axis" className="simulation__select" value={parameter.id} onValueChange={interaction.selectParameter}>
					{node.parameters.map((item) => <option key={item.id} value={item.id}>{unitLabel(item.label, item.unit)}</option>)}
				</Select>
			</div>
			<div className="simulation__picker">
				<span className="lesson-label" aria-hidden="true">Watch</span>
				<Select aria-label="Graph output" className="simulation__select" value={readout.id} onValueChange={interaction.selectReadout}>
					{node.readouts.map((item) => <option key={item.id} value={item.id}>{unitLabel(item.label, item.unit)}</option>)}
				</Select>
			</div>
		</div>

		<figure aria-label={`${yLabel} against ${xLabel}`} aria-describedby={`${identifier}-caption`} className="simulation__figure lesson-stage k-grid">
			<span className="simulation__axis" aria-hidden="true">{yLabel}</span>
			{plotted.length > 0 ? <div data-simulation-plot={node.id} data-sparse={plotted.length <= 24 || undefined}><LineChart crosshair connect={false} label={`${yLabel} against ${xLabel}`} format={formatY} formatX={formatX}
				series={[{label:readout.label, points:plotted, endLabel:"value"}]}
				now={currentValue === undefined ? undefined : {x:currentParameter, y:currentValue, label:`Now ${formatY(currentValue)}`}} /></div>
				: <EmptyState role="status" heading="No finite values at these settings.">Try another output or adjust a control.</EmptyState>}
			<div className="simulation__xaxis" aria-hidden="true"><span>{formatSimulationCompact(parameter.min, parameterPrecision(parameter))}</span><b>{xLabel}</b><span>{formatSimulationCompact(parameter.max, parameterPrecision(parameter))}</span></div>
			<figcaption id={`${identifier}-caption`} className={samples.some((point) => point.y === undefined) ? "lesson-hint simulation__caption" : "lesson-sr"}>
				{caption}{samples.some((point) => point.y === undefined) ? " Undefined values are omitted." : ""}
			</figcaption>
		</figure>

		<section className="lesson-section simulation__controls">
			<h4 className="lesson-section-title" data-glyph-host><KeatingGlyph name="compass" size={13} />Controls<span className="lesson-meta">drag or type a value</span></h4>
			{node.parameters.length > 1 ? <p className="lesson-hint">{caption}</p> : null}
		<div className="simulation__parameters">
			{node.parameters.map(item => <LessonSlider key={item.id} label={unitLabel(item.label,item.unit)} ariaLabel={unitLabel(item.label,item.unit)} editLabel={`${item.label} numeric value`}
				min={item.min} max={item.max} step={item.step} value={values[item.id] ?? item.value} start={item.value}
				format={value => formatSimulationCompact(value, parameterPrecision(item), item.unit)} disabled={props.disabled}
				onChange={value => interaction.setValue(item.id, value)} />)}
		</div>
		</section>

		<section className="lesson-section simulation__readouts-section">
		<h4 className="lesson-section-title" data-glyph-host><KeatingGlyph name="trend" size={13} />Readouts</h4>
		<div className="lesson-readouts simulation__readouts">
			{compiled.map((item) => {
				const value = item.expression ? evaluateSimulationExpression(item.expression, values) : undefined;
				const text = formatSimulationNumber(value, item.readout.precision ?? 2) + (value !== undefined && item.readout.unit ? (item.readout.unit === "%" ? "%" : " " + item.readout.unit) : "");
				return <div key={item.readout.id} role="group" aria-label={`${item.readout.label} ${text}`} data-simulation-readout={item.readout.id} data-primary={item === defaultReadout || undefined} className="lesson-readout simulation__readout">
					<small>{item.readout.label}</small><b>{text}</b>
				</div>;
			})}
		</div>
		</section>

		{saveFailed ? <p role="status" className="lesson-status" data-tone="warn">This browser did not save your settings; they will reset if you reload.</p> : null}

		<details className="kc-table simulation__table">
			<summary><KeatingGlyph name="menu" size={13} />View as table</summary>
			<table><caption>{`${yLabel} as ${xLabel} changes. ${caption}`}</caption>
				<thead><tr><th scope="col">{xLabel}</th><th scope="col">{yLabel}</th></tr></thead>
				<tbody>{samples.map((point, index) => <tr key={index}>
					<th scope="row">{formatSimulationNumber(point.x,parameterPrecision(parameter)) + (point.x === currentParameter ? " (now)" : "")}</th>
					<td>{point.y === undefined ? "No value" : formatSimulationNumber(point.y,readout.precision ?? 2)}</td>
				</tr>)}</tbody>
			</table>
		</details>
	</LessonFrame>;
}
