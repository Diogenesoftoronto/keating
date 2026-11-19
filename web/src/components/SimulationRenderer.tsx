import { LessonFrame } from "./lesson/LessonFrame";
import { Select } from "./Select";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import { LineChart, Stat, ChartTable } from "../design-system/charts";
import { EmptyState, Field, TextInput, IconButton, Button } from "../design-system/kit";
import { evaluateSimulationExpression, parseSimulationExpression, type UiActionReceipt, type UiSimulationNode } from "@keating/learner-contracts";
import { css } from "../../styled-system/css";
import { MarkdownBlock } from "./MarkdownBlock";
import { formatSimulationNumber, parameterPrecision, sampleSimulation } from "./simulation/sampling";
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

	return <LessonFrame glyph="signal" kind="Simulation" title={node.title} aria-label={node.title} className="simulation" data-simulation={node.id}
		tools={<IconButton size="sm" glyph="undo" label="Reset simulation" disabled={!interaction.dirty} onClick={interaction.reset} />}
		footer={onAction && <><p id={`${identifier}-share-status`} role="status" className={css({ margin: 0, minWidth: 0, fontSize: "0.75rem", color: "var(--muted-foreground)", lineHeight: 1.4 })}>
				{shareStatus === "failed"
					? "Not shared yet. Your settings are kept here; try again."
					: alreadyShared
						? shareStatus === "shared" ? "Sent. Your tutor will respond to these settings." : "These settings are with your tutor."
						: lastShared
							? "Changed since you last shared."
							: "Sends your settings and readouts to your tutor."}
			</p><Button type="button" data-simulation-share={node.id} variant="primary" disabled={!interaction.canShare} aria-describedby={`${identifier}-share-status`} onClick={interaction.share}>
				{alreadyShared ? <KeatingGlyph name="check" size={16} className={justShared ? "k-receipt" : undefined} /> : <KeatingGlyph name="send" size={16} />}
				{alreadyShared ? "Shared with your tutor" : "Share what I found"}
			</Button></>}>
		{node.brief ? <div className={css({ fontSize: "0.8125rem", lineHeight: 1.5, maxWidth: "65ch", "& p": { marginBlock: 0 } })}><MarkdownBlock content={node.brief} /></div> : null}

		<div className="simulation__pickers">
			<Field label="Vary">
				<Select aria-label="Graph horizontal axis" className="simulation__select" value={parameter.id} onValueChange={interaction.selectParameter}>
					{node.parameters.map((item) => <option key={item.id} value={item.id}>{unitLabel(item.label, item.unit)}</option>)}
				</Select>
			</Field>
			<Field label="Watch">
				<Select aria-label="Graph output" className="simulation__select" value={readout.id} onValueChange={interaction.selectReadout}>
					{node.readouts.map((item) => <option key={item.id} value={item.id}>{unitLabel(item.label, item.unit)}</option>)}
				</Select>
			</Field>
		</div>

		<figure aria-label={`${yLabel} against ${xLabel}`} aria-describedby={`${identifier}-caption`} className="simulation__figure">
			{plotted.length > 0 ? <div data-simulation-plot={node.id}><LineChart crosshair connect={false} label={`${yLabel} against ${xLabel}`} series={[
				{label:yLabel, points:plotted}, ...(currentValue === undefined ? [] : [{label:"Now", points:[{x:currentParameter,y:currentValue}]}])
			]} /></div> : <EmptyState role="status" heading="No finite values at these settings.">Try another output or adjust a control.</EmptyState>}
			<div className={css({ textAlign: "center", fontSize: "0.75rem", fontWeight: 600, overflowWrap: "anywhere" })}>{xLabel}</div>
			<figcaption id={`${identifier}-caption`} className={css({ paddingTop: "0.625rem", textAlign: "center", fontSize: "0.6875rem", color: "var(--muted-foreground)", lineHeight: 1.4 })}>
				{caption}{samples.some((point) => point.y === undefined) ? " Undefined values are omitted." : ""}
			</figcaption>
		</figure>

		<div className={`simulation__parameters ${css({ display: "grid", gap: "0.75rem", gridTemplateColumns: "minmax(0, 1fr)", "@media (min-width: 640px)": { gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: "1.5rem" } })}`}>
			{node.parameters.map(item => <div key={item.id}>
				<Field label={unitLabel(item.label,item.unit)}>
					<input type="range" aria-label={unitLabel(item.label,item.unit)} min={item.min} max={item.max} step={item.step ?? "any"}
						value={values[item.id] ?? item.value} onChange={e=>interaction.setValue(item.id,Number(e.currentTarget.value))} />
				</Field>
				<TextInput key={values[item.id]} type="number" aria-label={`${item.label} numeric value`} min={item.min} max={item.max}
					step={item.step ?? "any"} defaultValue={values[item.id] ?? item.value} onBlur={e=>{
						if (e.currentTarget.validity.valid && Number.isFinite(e.currentTarget.valueAsNumber)) interaction.setValue(item.id,e.currentTarget.valueAsNumber);
						else e.currentTarget.value=String(values[item.id] ?? item.value);
					}} onKeyDown={e=>{if(e.key==="Enter") e.currentTarget.blur();}} />
			</div>)}
		</div>

		<div className="simulation__readouts">
			{compiled.map((item) => {
				const value = item.expression ? evaluateSimulationExpression(item.expression, values) : undefined;
				return <div key={item.readout.id} data-simulation-readout={item.readout.id} data-primary={item === defaultReadout || undefined} className="simulation__readout">
					<Stat label={item.readout.label} value={formatSimulationNumber(value, item.readout.precision ?? 2) + (value !== undefined && item.readout.unit ? " " + item.readout.unit : "")} />
				</div>;
			})}
		</div>

		{saveFailed ? <p role="status" className={css({ margin: 0, fontSize: "0.75rem", color: "var(--muted-foreground)" })}>This browser did not save your settings; they will reset if you reload.</p> : null}

		<ChartTable columns={[xLabel,yLabel]} caption={`${yLabel} as ${xLabel} changes. ${caption}`} rows={samples.map(point=>[
			formatSimulationNumber(point.x,parameterPrecision(parameter)) + (point.x === currentParameter ? " (now)" : ""),
			point.y === undefined ? "No value" : formatSimulationNumber(point.y,readout.precision ?? 2)
		])} />
	</LessonFrame>;
}
