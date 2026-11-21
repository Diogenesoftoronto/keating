import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
	MANIPULATIVE_LIMITS,
	MANIPULATIVE_TITLES,
	formatClockTime,
	initialManipulativeState,
	numberLineTicks,
	placeValueTotal,
	snapToNumberLine,
	type UiActionReceipt,
	type UiManipulativeModel,
	type UiManipulativeNode,
	type UiManipulativeState,
	type UiManipulativeSymbol,
} from "@keating/learner-contracts";
import { LessonFrame } from "../lesson/LessonFrame";
import { MarkdownBlock } from "../MarkdownBlock";
import { Button, IconButton } from "../../design-system/kit";
import type { GlyphName } from "../../design-system/glyphs";
import type { StorageLike } from "../../keating/event-store";
import type { SharedUiActionEvent } from "../../keating/openui/shared-renderer";
import {
	loadManipulativeState,
	manipulativeShareIntent,
	manipulativeShareMessage,
	sameManipulativeState,
	saveManipulativeState,
	sharedManipulativeState,
} from "../../keating/openui/manipulative-state";
import "./manipulatives.css";

type Model<K extends UiManipulativeModel["kind"]> = Extract<UiManipulativeModel, { kind: K }>;
type State<K extends UiManipulativeState["kind"]> = Extract<UiManipulativeState, { kind: K }>;

const GLYPH: Record<UiManipulativeModel["kind"], GlyphName> = {
	"number-line": "ruler",
	"ten-frame": "shapes",
	"place-value": "layers",
	"fraction-bars": "pattern",
	array: "hash",
	clock: "clock",
};

const SYMBOL_TEXT: Partial<Record<UiManipulativeSymbol, string>> = {
	star: "⭐", apple: "\u{1F34E}", ball: "⚽", fish: "\u{1F41F}", flower: "\u{1F33C}", car: "\u{1F697}", heart: "❤️", bug: "\u{1F41E}",
};
const SYMBOL_NAME: Record<UiManipulativeSymbol, string> = {
	dot: "dot", square: "square", star: "star", apple: "apple", ball: "ball", fish: "fish", flower: "flower", car: "car", heart: "heart", bug: "ladybug",
};

function browserStorage(): StorageLike | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}

export interface ManipulativeRendererProps {
	node: UiManipulativeNode;
	/** Shared document id; with it, the learner's work survives a reload. */
	documentId?: string;
	storage?: Pick<StorageLike, "getItem" | "setItem"> | null;
	/** The latest completed share for this node, if any. */
	receipt?: UiActionReceipt;
	disabled?: boolean;
	onAction?: (event: SharedUiActionEvent) => boolean;
}

/** Reset local work when the authored model changes, not on parent renders. */
export function ManipulativeRenderer(props: ManipulativeRendererProps) {
	return <ManipulativeFrame key={JSON.stringify([props.documentId ?? null, props.node.id, props.node.model, props.node.prompt ?? null])} {...props} />;
}

function ManipulativeFrame({ node, documentId, storage: storageOverride, receipt, disabled = false, onAction }: ManipulativeRendererProps) {
	const identifier = useId();
	const interactive = node.prompt !== undefined;
	const storage = useMemo(() => documentId === undefined ? null : storageOverride === undefined ? browserStorage() : storageOverride, [documentId, storageOverride]);
	const initial = useMemo(() => initialManipulativeState(node.model), [node.model]);
	const [state, setState] = useState<UiManipulativeState>(() => loadManipulativeState(storage, documentId, node));
	const touched = useRef(false);
	const [shareStatus, setShareStatus] = useState<"idle" | "shared" | "failed">("idle");
	const [saveFailed, setSaveFailed] = useState(false);
	useEffect(() => {
		if (!touched.current || documentId === undefined || !storage) return;
		setSaveFailed(!saveManipulativeState(storage, documentId, node, state));
	}, [documentId, node, state, storage]);

	const lastShared = receipt?.state === "completed" ? sharedManipulativeState(receipt.action, node.id) : undefined;
	const alreadyShared = sameManipulativeState(lastShared, state);
	const canShare = interactive && Boolean(onAction) && !disabled && !alreadyShared;
	const locked = !interactive || disabled;
	const change = (next: UiManipulativeState) => { touched.current = true; setShareStatus("idle"); setState(next); };
	const share = () => {
		if (!canShare || !onAction) return;
		const accepted = onAction({ intent: manipulativeShareIntent(node, state), humanFriendlyMessage: manipulativeShareMessage(node, state) });
		setShareStatus(accepted ? "shared" : "failed");
	};
	const dirty = !sameManipulativeState(initial, state);
	const kindLabel = MANIPULATIVE_TITLES[node.model.kind];

	return <LessonFrame glyph={GLYPH[node.model.kind]} kind={kindLabel} title={node.title} aria-label={node.title}
		className="manip" data-manipulative={node.model.kind}
		tools={interactive ? <IconButton size="sm" glyph="undo" label={`Start ${kindLabel.toLowerCase()} again`} disabled={!dirty || disabled} onClick={() => change(initial)} /> : undefined}
		footer={interactive && onAction ? <>
			<span id={`${identifier}-status`} role="status" className="lesson-foot-meta">
				{shareStatus === "failed" ? "Not sent yet. Your work is kept here; try again."
					: alreadyShared ? (shareStatus === "shared" ? "Sent. Your tutor will look at it." : "Your tutor has this answer.")
					: lastShared ? "Changed since you last shared." : "Sends your answer to your tutor."}
			</span>
			<Button type="button" size="sm" variant="primary" data-manipulative-share={node.id} disabled={!canShare} aria-describedby={`${identifier}-status`} onClick={share} glyph={alreadyShared ? "check" : "send"}>
				{alreadyShared ? "Shared" : "Share my answer"}
			</Button>
		</> : undefined}>
		{node.brief ? <div className="manip__brief"><MarkdownBlock content={node.brief} /></div> : null}
		{node.prompt ? <p className="manip__prompt" id={`${identifier}-prompt`}>{node.prompt}</p> : null}
		<ModelView model={node.model} state={state} locked={locked} interactive={interactive} describedBy={node.prompt ? `${identifier}-prompt` : undefined} onChange={change} />
		{saveFailed ? <p role="status" className="lesson-status" data-tone="warn">This browser did not save your work; it will reset if you reload.</p> : null}
	</LessonFrame>;
}

interface ViewProps<K extends UiManipulativeModel["kind"]> {
	model: Model<K>;
	state: State<K>;
	locked: boolean;
	interactive: boolean;
	describedBy?: string;
	onChange: (state: UiManipulativeState) => void;
}

function ModelView({ model, state, ...rest }: Omit<ViewProps<UiManipulativeModel["kind"]>, "model" | "state"> & { model: UiManipulativeModel; state: UiManipulativeState }) {
	if (model.kind !== state.kind) return null;
	switch (model.kind) {
		case "number-line": return <NumberLineView model={model} state={state as State<"number-line">} {...rest} />;
		case "ten-frame": return <TenFrameView model={model} state={state as State<"ten-frame">} {...rest} />;
		case "place-value": return <PlaceValueView model={model} state={state as State<"place-value">} {...rest} />;
		case "fraction-bars": return <FractionBarsView model={model} state={state as State<"fraction-bars">} {...rest} />;
		case "array": return <ArrayView model={model} state={state as State<"array">} {...rest} />;
		case "clock": return <ClockView model={model} state={state as State<"clock">} {...rest} />;
	}
}

/* ── Number line ──────────────────────────────────────────────────────── */

const fmt = (value: number) => String(Math.round(value * 1e6) / 1e6);

function NumberLineView({ model, state, locked, interactive, describedBy, onChange }: ViewProps<"number-line">) {
	const ticks = useMemo(() => numberLineTicks(model), [model]);
	const track = useRef<HTMLDivElement>(null);
	const dragging = useRef(false);
	const span = model.max - model.min;
	const at = (value: number) => `${((value - model.min) / span) * 100}%`;
	const labelEvery = model.labelEvery ?? (ticks.length > 21 ? (ticks.length > 31 ? 5 : 2) : 1);
	const marks = new Map(model.marks?.map((mark) => [mark.value, mark]) ?? []);
	const jumps = model.jumps ?? [];
	const place = (value: number) => { if (!locked) onChange({ kind: "number-line", value: snapToNumberLine(model, value) }); };
	const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
		const box = track.current?.getBoundingClientRect();
		if (!box || box.width === 0) return;
		place(model.min + ((event.clientX - box.left) / box.width) * span);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const moves: Record<string, number> = { ArrowRight: model.step, ArrowUp: model.step, ArrowLeft: -model.step, ArrowDown: -model.step, PageUp: model.step * 5, PageDown: -model.step * 5 };
		if (event.key in moves) place(state.value + moves[event.key]!);
		else if (event.key === "Home") place(model.min);
		else if (event.key === "End") place(model.max);
		else return;
		event.preventDefault();
	};
	const lift = jumps.length ? "2.6rem" : "1.1rem";
	const summary = [
		`Number line from ${fmt(model.min)} to ${fmt(model.max)}, counting by ${fmt(model.step)}.`,
		...(model.marks ?? []).map((mark) => `Marked ${fmt(mark.value)}${mark.label ? ` (${mark.label})` : ""}.`),
		...jumps.map((jump) => `A hop from ${fmt(jump.from)} to ${fmt(jump.to)}${jump.label ? `, ${jump.label}` : ""}.`),
	].join(" ");
	return <figure className="manip__stage lesson-stage k-grid" aria-label={summary}>
		<div className="manip-line" style={{ paddingTop: lift }} data-dense={ticks.length > 21 || undefined} data-crowded={Math.ceil(ticks.length / labelEvery) > 11 || undefined}>
			<div ref={track} className="manip-line__track"
				{...(interactive ? {
					role: "slider", tabIndex: locked ? -1 : 0, "aria-label": "Your point on the number line", "aria-valuemin": model.min, "aria-valuemax": model.max,
					"aria-valuenow": state.value, "aria-valuetext": fmt(state.value), "aria-disabled": locked || undefined, "aria-describedby": describedBy,
					onKeyDown,
					onPointerDown: (event: PointerEvent<HTMLDivElement>) => { if (locked) return; dragging.current = true; event.currentTarget.setPointerCapture?.(event.pointerId); fromPointer(event); },
					onPointerMove: (event: PointerEvent<HTMLDivElement>) => { if (dragging.current) fromPointer(event); },
					onPointerUp: () => { dragging.current = false; },
					onPointerCancel: () => { dragging.current = false; },
				} : {})}>
				{jumps.length ? <svg className="manip-line__arcs" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
					{jumps.map((jump, index) => {
						const from = ((jump.from - model.min) / span) * 100;
						const to = ((jump.to - model.min) / span) * 100;
						return <path key={index} d={`M ${from} 40 Q ${(from + to) / 2} ${-30} ${to} 40`} vectorEffect="non-scaling-stroke" />;
					})}
				</svg> : null}
				{jumps.map((jump, index) => <span key={index} aria-hidden="true">
					<i className="manip-line__arrow" style={{ left: at(jump.to) }} data-dir={jump.to > jump.from ? "right" : "left"} />
					{jump.label ? <b className="manip-line__jump-label" style={{ left: `calc((${at(jump.from)} + ${at(jump.to)}) / 2)` }}>{jump.label}</b> : null}
				</span>)}
				<span className="manip-line__axis" aria-hidden="true" />
				{ticks.map((tick, index) => {
					const mark = marks.get(tick);
					const major = index % labelEvery === 0 || index === ticks.length - 1 || mark !== undefined;
					return <span key={tick} className="manip-line__tick" style={{ left: at(tick) }} data-major={major || undefined} data-odd={(index % (labelEvery * 2) !== 0 && index !== ticks.length - 1 && !mark) || undefined} data-marked={mark ? true : undefined} aria-hidden="true">
						{major ? <small>{fmt(tick)}</small> : null}
						{mark?.label ? <em>{mark.label}</em> : null}
					</span>;
				})}
				{interactive ? <span className="manip-line__point" style={{ left: at(state.value) }} aria-hidden="true">{marks.get(state.value)?.label ? null : <b>{fmt(state.value)}</b>}</span> : null}
			</div>
		</div>
		{interactive ? <figcaption className="lesson-hint manip__hint">Tap the line or use the arrow keys to move your point.</figcaption> : null}
	</figure>;
}

/* ── Ten frame ────────────────────────────────────────────────────────── */

function TenFrameView({ model, state, locked, interactive, onChange }: ViewProps<"ten-frame">) {
	const filled = new Set(state.cells);
	const toggle = (cell: number) => {
		if (locked) return;
		const cells = filled.has(cell) ? state.cells.filter((entry) => entry !== cell) : [...state.cells, cell];
		onChange({ kind: "ten-frame", cells });
	};
	return <div className="manip__stage manip-frames" role="group" aria-label={`${model.frames === 2 ? "Two ten frames" : "Ten frame"}: ${filled.size} of ${model.frames * 10} filled`}>
		{Array.from({ length: model.frames }, (_, frame) => <div key={frame} className="manip-frame">
			{Array.from({ length: 10 }, (_, offset) => {
				const cell = frame * 10 + offset;
				const on = filled.has(cell);
				const counter = on ? <span className="manip-counter" data-added={cell >= model.filled || undefined} /> : null;
				return interactive
					? <button key={cell} type="button" className="manip-frame__cell" aria-pressed={on} disabled={locked}
						aria-label={`Space ${cell + 1}${on ? ", filled" : ""}`} onClick={() => toggle(cell)}>{counter}</button>
					: <span key={cell} className="manip-frame__cell" aria-hidden="true">{counter}</span>;
			})}
		</div>)}
		<p className="lesson-meta manip__count" aria-hidden="true">{filled.size} of {model.frames * 10}</p>
	</div>;
}

/* ── Place value ──────────────────────────────────────────────────────── */

const PLACES = [
	{ key: "hundreds", label: "Hundreds", one: "hundred", value: 100 },
	{ key: "tens", label: "Tens", one: "ten", value: 10 },
	{ key: "ones", label: "Ones", one: "one", value: 1 },
] as const;

function Block({ place }: { place: typeof PLACES[number]["key"] }) {
	if (place === "hundreds") return <svg className="manip-block manip-block--flat" viewBox="0 0 10 10" aria-hidden="true">
		<rect width="10" height="10" />
		<path d={Array.from({ length: 9 }, (_, index) => `M${index + 1} 0V10M0 ${index + 1}H10`).join("")} />
	</svg>;
	if (place === "tens") return <svg className="manip-block manip-block--rod" viewBox="0 0 1 10" aria-hidden="true">
		<rect width="1" height="10" />
		<path d={Array.from({ length: 9 }, (_, index) => `M0 ${index + 1}H1`).join("")} />
	</svg>;
	return <svg className="manip-block manip-block--unit" viewBox="0 0 1 1" aria-hidden="true"><rect width="1" height="1" /></svg>;
}

function PlaceValueView({ model, state, locked, interactive, onChange }: ViewProps<"place-value">) {
	const total = placeValueTotal(state);
	const max = MANIPULATIVE_LIMITS.placeValueColumnMax;
	const set = (key: typeof PLACES[number]["key"], delta: number) => {
		if (locked) return;
		const next = Math.max(0, Math.min(max, state[key] + delta));
		onChange({ ...state, [key]: next });
	};
	return <div className="manip__stage manip-place">
		<div className="manip-place__columns">
			{PLACES.map((place) => {
				const count = state[place.key];
				return <section key={place.key} className="manip-place__column" aria-label={`${place.label}: ${count}`}>
					<h4 className="lesson-label">{place.label}</h4>
					<div className="manip-place__blocks" data-place={place.key}>
						{Array.from({ length: count }, (_, index) => <Block key={index} place={place.key} />)}
					</div>
					<div className="manip-place__count">
						{interactive ? <IconButton size="sm" glyph="minus" label={`Take away a ${place.one}`} disabled={locked || count === 0} onClick={() => set(place.key, -1)} /> : null}
						<b aria-hidden="true">{count}</b>
						{interactive ? <IconButton size="sm" glyph="plus" label={`Add a ${place.one}`} disabled={locked || count >= max} onClick={() => set(place.key, 1)} /> : null}
					</div>
				</section>;
			})}
		</div>
		<div className="lesson-readout manip-place__total" role={interactive ? "status" : undefined} aria-live={interactive ? "polite" : undefined}>
			<small>{interactive ? "Your number" : "Number"}</small><b>{total}</b>
		</div>
	</div>;
}

/* ── Fraction bars ────────────────────────────────────────────────────── */

function FractionBarsView({ model, state, locked, interactive, onChange }: ViewProps<"fraction-bars">) {
	const toggle = (bar: number, part: number) => {
		if (locked) return;
		const current = state.shaded[bar] ?? [];
		const next = current.includes(part) ? current.filter((entry) => entry !== part) : [...current, part];
		onChange({ kind: "fraction-bars", shaded: state.shaded.map((entry, index) => index === bar ? next : entry) });
	};
	return <div className="manip__stage manip-bars">
		{model.bars.map((bar, barIndex) => {
			const shaded = new Set(state.shaded[barIndex] ?? []);
			const name = bar.label ?? `Bar ${barIndex + 1}`;
			return <div key={barIndex} className="manip-bars__row" role="group" aria-label={`${name}: ${shaded.size} of ${bar.parts} parts shaded`}>
				<span className="lesson-meta manip-bars__label" aria-hidden="true">{bar.label ?? ""}</span>
				<div className="manip-bars__bar" style={{ gridTemplateColumns: `repeat(${bar.parts}, minmax(0, 1fr))` }}>
					{Array.from({ length: bar.parts }, (_, part) => interactive
						? <button key={part} type="button" className="manip-bars__part" aria-pressed={shaded.has(part)} disabled={locked}
							aria-label={`${name}, part ${part + 1} of ${bar.parts}`} onClick={() => toggle(barIndex, part)} />
						: <span key={part} className="manip-bars__part" data-on={shaded.has(part) || undefined} aria-hidden="true" />)}
				</div>
				<span className="lesson-meta manip-bars__value" aria-hidden="true">{shaded.size}/{bar.parts}</span>
			</div>;
		})}
	</div>;
}

/* ── Counting array ───────────────────────────────────────────────────── */

function Counter({ symbol }: { symbol: UiManipulativeSymbol }) {
	const text = SYMBOL_TEXT[symbol];
	if (text) return <span className="manip-object__emoji" aria-hidden="true">{text}</span>;
	return <svg className="manip-object__shape" viewBox="0 0 10 10" aria-hidden="true">
		{symbol === "square" ? <rect x="1" y="1" width="8" height="8" rx="1" /> : <circle cx="5" cy="5" r="4" />}
	</svg>;
}

function ArrayView({ model, state, locked, interactive, onChange }: ViewProps<"array">) {
	const symbol = model.symbol ?? "dot";
	const order = new Map(state.marked.map((cell, index) => [cell, index + 1]));
	const total = model.rows * model.columns;
	const toggle = (cell: number) => {
		if (locked) return;
		// Counting is ordered: un-tapping one removes it and keeps the others' order.
		onChange({ kind: "array", marked: order.has(cell) ? state.marked.filter((entry) => entry !== cell) : [...state.marked, cell] });
	};
	const noun = SYMBOL_NAME[symbol];
	return <div className="manip__stage manip-array-stage">
		<div className="manip-array" role="group" aria-label={`${model.rows} ${model.rows === 1 ? "row" : "rows"} of ${model.columns} ${noun}s`}
			style={{ gridTemplateColumns: `repeat(${model.columns}, minmax(0, 2rem))` }} data-wide={model.columns > 8 || undefined}>
			{Array.from({ length: total }, (_, cell) => {
				const count = order.get(cell);
				return interactive
					? <button key={cell} type="button" className="manip-object" aria-pressed={count !== undefined} disabled={locked}
						aria-label={`Row ${Math.floor(cell / model.columns) + 1}, ${noun} ${(cell % model.columns) + 1}${count ? `, counted as ${count}` : ""}`}
						onClick={() => toggle(cell)}><Counter symbol={symbol} />{count ? <b>{count}</b> : null}</button>
					: <span key={cell} className="manip-object" aria-hidden="true"><Counter symbol={symbol} /></span>;
			})}
		</div>
		{interactive ? <p className="lesson-meta manip__count" role="status" aria-live="polite">Counted {state.marked.length}</p> : null}
	</div>;
}

/* ── Clock ────────────────────────────────────────────────────────────── */

function ClockView({ state, locked, interactive, onChange }: ViewProps<"clock">) {
	const hourAngle = ((state.hour % 12) + state.minute / 60) * 30;
	const minuteAngle = state.minute * 6;
	const step = (minutes: number) => {
		if (locked) return;
		const total = (((state.hour % 12) * 60 + state.minute + minutes) % 720 + 720) % 720;
		const hour = Math.floor(total / 60);
		onChange({ kind: "clock", hour: hour === 0 ? 12 : hour, minute: total % 60 });
	};
	const time = formatClockTime(state.hour, state.minute);
	return <div className="manip__stage manip-clock">
		<svg className="manip-clock__face" viewBox="-100 -100 200 200" role="img" aria-label={interactive ? `Your clock shows ${time}` : `A clock showing ${time}`}>
			<circle className="manip-clock__rim" r="96" />
			{Array.from({ length: 60 }, (_, index) => {
				const major = index % 5 === 0;
				return <line key={index} className="manip-clock__tick" data-major={major || undefined} x1="0" y1={major ? -80 : -86} x2="0" y2="-91" transform={`rotate(${index * 6})`} />;
			})}
			{Array.from({ length: 12 }, (_, index) => {
				const hour = index + 1;
				const angle = (hour * 30 * Math.PI) / 180;
				return <text key={hour} className="manip-clock__numeral" x={Math.sin(angle) * 66} y={-Math.cos(angle) * 66} textAnchor="middle" dominantBaseline="central">{hour}</text>;
			})}
			<line className="manip-clock__hand manip-clock__hand--hour" x1="0" y1="8" x2="0" y2="-44" transform={`rotate(${hourAngle})`} />
			<line className="manip-clock__hand manip-clock__hand--minute" x1="0" y1="10" x2="0" y2="-72" transform={`rotate(${minuteAngle})`} />
			<circle className="manip-clock__pin" r="5" />
		</svg>
		{interactive ? <div className="manip-clock__controls">
			<div className="manip-clock__control" role="group" aria-label="Hour hand">
				<span className="lesson-label">Hour</span>
				<IconButton size="sm" glyph="minus" label="Hour back" disabled={locked} onClick={() => step(-60)} />
				<IconButton size="sm" glyph="plus" label="Hour forward" disabled={locked} onClick={() => step(60)} />
			</div>
			<div className="manip-clock__control" role="group" aria-label="Minute hand">
				<span className="lesson-label">Minutes</span>
				<IconButton size="sm" glyph="minus" label="Five minutes back" disabled={locked} onClick={() => step(-5)} />
				<IconButton size="sm" glyph="plus" label="Five minutes forward" disabled={locked} onClick={() => step(5)} />
			</div>
		</div> : null}
	</div>;
}
