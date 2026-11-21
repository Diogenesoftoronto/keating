/**
 * Early-learning manipulatives: number lines, ten frames, place-value blocks,
 * fraction bars, counting arrays and clocks.
 *
 * Six OpenUI components share one contract node (`manipulative`) and differ by
 * `model.kind`. A node with a `prompt` is a task: the learner works the model
 * and explicitly shares the state they ended on (`share-manipulative`). A node
 * without one is a picture the tutor talks over.
 *
 * Everything here is plain data and bounds. Nothing is evaluated.
 */

export const MANIPULATIVE_KINDS = ["number-line", "ten-frame", "place-value", "fraction-bars", "array", "clock"] as const;
export type UiManipulativeKind = typeof MANIPULATIVE_KINDS[number];

/**
 * Named counters rather than raw emoji: OpenUI source is limited to the Basic
 * Multilingual Plane, and a name renders the same on every surface.
 */
export const MANIPULATIVE_SYMBOLS = ["dot", "square", "star", "apple", "ball", "fish", "flower", "car", "heart", "bug"] as const;
export type UiManipulativeSymbol = typeof MANIPULATIVE_SYMBOLS[number];
const SYMBOL_SET = new Set<string>(MANIPULATIVE_SYMBOLS);

export interface UiNumberLineMark { value: number; label?: string }
export interface UiNumberLineJump { from: number; to: number; label?: string }
export interface UiFractionBar { parts: number; shaded: number; label?: string }

export type UiManipulativeModel =
  | {
    kind: "number-line";
    min: number;
    max: number;
    /** Distance between ticks; every tick is a place the learner can land on. */
    step: number;
    /** Label every nth tick; defaults to every tick when they fit. */
    labelEvery?: number;
    marks?: UiNumberLineMark[];
    /** Hops drawn as arcs, e.g. 3 → 7 for "3 + 4". */
    jumps?: UiNumberLineJump[];
  }
  | { kind: "ten-frame"; frames: 1 | 2; filled: number }
  | { kind: "place-value"; value: number }
  | { kind: "fraction-bars"; bars: UiFractionBar[] }
  | { kind: "array"; rows: number; columns: number; symbol?: UiManipulativeSymbol }
  | { kind: "clock"; hour: number; minute: number };

export interface UiManipulativeNode {
  type: "manipulative";
  id: string;
  title: string;
  /** Short framing for the adult or learner. Markdown. */
  brief?: string;
  /** Present when the learner should work the model and share an answer. */
  prompt?: string;
  model: UiManipulativeModel;
}

/** What the learner ended on, per kind. Indices are 0-based cell positions. */
export type UiManipulativeState =
  | { kind: "number-line"; value: number }
  | { kind: "ten-frame"; cells: number[] }
  | { kind: "place-value"; hundreds: number; tens: number; ones: number }
  | { kind: "fraction-bars"; shaded: number[][] }
  | { kind: "array"; marked: number[] }
  | { kind: "clock"; hour: number; minute: number };

export const MANIPULATIVE_LIMITS = {
  numberLineTicks: 40,
  marks: 12,
  jumps: 12,
  fractionBars: 4,
  fractionParts: 12,
  arrayRows: 10,
  arrayColumns: 12,
  placeValueMax: 999,
  /** Learners may build past ten in a column before regrouping. */
  placeValueColumnMax: 19,
  label: 64,
} as const;

const NODE_KEYS = new Set(["type", "id", "title", "brief", "prompt", "model"]);
const MODEL_KEYS: Record<UiManipulativeKind, ReadonlySet<string>> = {
  "number-line": new Set(["kind", "min", "max", "step", "labelEvery", "marks", "jumps"]),
  "ten-frame": new Set(["kind", "frames", "filled"]),
  "place-value": new Set(["kind", "value"]),
  "fraction-bars": new Set(["kind", "bars"]),
  array: new Set(["kind", "rows", "columns", "symbol"]),
  clock: new Set(["kind", "hour", "minute"]),
};
const STATE_KEYS: Record<UiManipulativeKind, ReadonlySet<string>> = {
  "number-line": new Set(["kind", "value"]),
  "ten-frame": new Set(["kind", "cells"]),
  "place-value": new Set(["kind", "hundreds", "tens", "ones"]),
  "fraction-bars": new Set(["kind", "shaded"]),
  array: new Set(["kind", "marked"]),
  clock: new Set(["kind", "hour", "minute"]),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function integerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
function label(value: unknown, max: number = MANIPULATIVE_LIMITS.label): boolean {
  return value === undefined || (typeof value === "string" && value.length <= max);
}
function text(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= max && (allowEmpty || value.trim().length > 0);
}
function uniqueIndices(value: unknown, size: number): value is number[] {
  return Array.isArray(value) && value.length <= size && value.every((entry) => integerIn(entry, 0, size - 1))
    && new Set(value).size === value.length;
}

/** Round away binary noise so 0.1-step lines compare exactly. */
function tidy(value: number): number { return Math.round(value * 1e6) / 1e6; }

/** Number of ticks a number line draws, or 0 when the range is unusable. */
export function numberLineTickCount(model: { min: number; max: number; step: number }): number {
  if (!finite(model.min) || !finite(model.max) || !finite(model.step) || model.step <= 0 || model.max <= model.min) return 0;
  const intervals = (model.max - model.min) / model.step;
  const rounded = Math.round(intervals);
  return Math.abs(intervals - rounded) < 1e-6 ? rounded + 1 : 0;
}

/** Every tick value, in order. */
export function numberLineTicks(model: { min: number; max: number; step: number }): number[] {
  const count = numberLineTickCount(model);
  return Array.from({ length: count }, (_, index) => tidy(model.min + index * model.step));
}

export function isNumberLineTick(model: { min: number; max: number; step: number }, value: number): boolean {
  if (!finite(value) || value < model.min - 1e-9 || value > model.max + 1e-9) return false;
  const offset = (value - model.min) / model.step;
  return Math.abs(offset - Math.round(offset)) < 1e-6;
}

/** Snap any value onto the nearest tick inside the line. */
export function snapToNumberLine(model: { min: number; max: number; step: number }, value: number): number {
  const clamped = Math.min(model.max, Math.max(model.min, finite(value) ? value : model.min));
  return tidy(model.min + Math.round((clamped - model.min) / model.step) * model.step);
}

export function placeValueParts(value: number): { hundreds: number; tens: number; ones: number } {
  const whole = Math.max(0, Math.min(MANIPULATIVE_LIMITS.placeValueMax, Math.trunc(value)));
  return { hundreds: Math.floor(whole / 100), tens: Math.floor(whole / 10) % 10, ones: whole % 10 };
}

export function placeValueTotal(parts: { hundreds: number; tens: number; ones: number }): number {
  return parts.hundreds * 100 + parts.tens * 10 + parts.ones;
}

function validateModel(model: unknown): model is UiManipulativeModel {
  if (!isRecord(model) || typeof model.kind !== "string" || !(model.kind in MODEL_KEYS)) return false;
  const kind = model.kind as UiManipulativeKind;
  if (!onlyKeys(model, MODEL_KEYS[kind])) return false;
  switch (kind) {
    case "number-line": {
      if (!finite(model.min) || !finite(model.max) || !finite(model.step)) return false;
      const line = model as { min: number; max: number; step: number };
      const ticks = numberLineTickCount(line);
      if (ticks < 2 || ticks > MANIPULATIVE_LIMITS.numberLineTicks) return false;
      if (model.labelEvery !== undefined && !integerIn(model.labelEvery, 1, MANIPULATIVE_LIMITS.numberLineTicks)) return false;
      const marks = model.marks;
      if (marks !== undefined && !(Array.isArray(marks) && marks.length <= MANIPULATIVE_LIMITS.marks && marks.every((mark) =>
        isRecord(mark) && onlyKeys(mark, new Set(["value", "label"])) && finite(mark.value) && isNumberLineTick(line, mark.value) && label(mark.label)))) return false;
      const jumps = model.jumps;
      return jumps === undefined || (Array.isArray(jumps) && jumps.length <= MANIPULATIVE_LIMITS.jumps && jumps.every((jump) =>
        isRecord(jump) && onlyKeys(jump, new Set(["from", "to", "label"])) && finite(jump.from) && finite(jump.to) && jump.from !== jump.to
        && isNumberLineTick(line, jump.from) && isNumberLineTick(line, jump.to) && label(jump.label)));
    }
    case "ten-frame": return (model.frames === 1 || model.frames === 2) && integerIn(model.filled, 0, model.frames * 10);
    case "place-value": return integerIn(model.value, 0, MANIPULATIVE_LIMITS.placeValueMax);
    case "fraction-bars": return Array.isArray(model.bars) && model.bars.length >= 1 && model.bars.length <= MANIPULATIVE_LIMITS.fractionBars
      && model.bars.every((bar) => isRecord(bar) && onlyKeys(bar, new Set(["parts", "shaded", "label"]))
        && integerIn(bar.parts, 1, MANIPULATIVE_LIMITS.fractionParts) && integerIn(bar.shaded, 0, bar.parts as number) && label(bar.label));
    case "array": return integerIn(model.rows, 1, MANIPULATIVE_LIMITS.arrayRows) && integerIn(model.columns, 1, MANIPULATIVE_LIMITS.arrayColumns)
      && (model.symbol === undefined || (typeof model.symbol === "string" && SYMBOL_SET.has(model.symbol)));
    case "clock": return integerIn(model.hour, 1, 12) && integerIn(model.minute, 0, 59);
  }
}

/** Structural check used by `validateUiDocument`; `id` is checked by the caller. */
export function validateManipulativeNode(value: Record<string, unknown>): value is Record<string, unknown> & UiManipulativeNode {
  return onlyKeys(value, NODE_KEYS) && text(value.title, 512)
    && (value.brief === undefined || text(value.brief, 4096, true))
    && (value.prompt === undefined || text(value.prompt, 1024))
    && validateModel(value.model);
}

/** Shape-only check of a learner state, before it is compared with its node. */
export function validateManipulativeStateShape(value: unknown): value is UiManipulativeState {
  if (!isRecord(value) || typeof value.kind !== "string" || !(value.kind in STATE_KEYS)) return false;
  const kind = value.kind as UiManipulativeKind;
  if (!onlyKeys(value, STATE_KEYS[kind])) return false;
  switch (kind) {
    case "number-line": return finite(value.value);
    case "ten-frame": return uniqueIndices(value.cells, 20);
    case "place-value": return (["hundreds", "tens", "ones"] as const).every((key) => integerIn(value[key], 0, MANIPULATIVE_LIMITS.placeValueColumnMax));
    case "fraction-bars": return Array.isArray(value.shaded) && value.shaded.length <= MANIPULATIVE_LIMITS.fractionBars
      && value.shaded.every((bar) => uniqueIndices(bar, MANIPULATIVE_LIMITS.fractionParts));
    case "array": return uniqueIndices(value.marked, MANIPULATIVE_LIMITS.arrayRows * MANIPULATIVE_LIMITS.arrayColumns);
    case "clock": return integerIn(value.hour, 1, 12) && integerIn(value.minute, 0, 59);
  }
}

/** A share is only valid for a task node, with a state that fits that node's model. */
export function manipulativeStateFitsNode(node: UiManipulativeNode, state: UiManipulativeState): boolean {
  const model = node.model;
  if (node.prompt === undefined || model.kind !== state.kind) return false;
  switch (state.kind) {
    case "number-line": return model.kind === "number-line" && isNumberLineTick(model, state.value);
    case "ten-frame": return model.kind === "ten-frame" && uniqueIndices(state.cells, model.frames * 10);
    case "place-value": return true;
    case "fraction-bars": return model.kind === "fraction-bars" && state.shaded.length === model.bars.length
      && state.shaded.every((bar, index) => uniqueIndices(bar, model.bars[index]!.parts));
    case "array": return model.kind === "array" && uniqueIndices(state.marked, model.rows * model.columns);
    case "clock": return true;
  }
}

/** The authored starting state, so the learner always begins from the picture the tutor drew. */
export function initialManipulativeState(model: UiManipulativeModel): UiManipulativeState {
  switch (model.kind) {
    case "number-line": {
      const start = model.marks?.length ? model.marks[model.marks.length - 1]!.value : model.min;
      return { kind: "number-line", value: start };
    }
    case "ten-frame": return { kind: "ten-frame", cells: Array.from({ length: model.filled }, (_, index) => index) };
    case "place-value": return { kind: "place-value", ...placeValueParts(model.value) };
    case "fraction-bars": return { kind: "fraction-bars", shaded: model.bars.map((bar) => Array.from({ length: bar.shaded }, (_, index) => index)) };
    case "array": return { kind: "array", marked: [] };
    case "clock": return { kind: "clock", hour: model.hour, minute: model.minute };
  }
}

export function formatClockTime(hour: number, minute: number): string {
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

function formatNumber(value: number): string {
  return String(tidy(value));
}

/** Plain-language account of a learner state, for the share message and the tutor's review. */
export function describeManipulativeState(node: UiManipulativeNode, state: UiManipulativeState): string {
  const model = node.model;
  switch (state.kind) {
    case "number-line": return `Put the point at ${formatNumber(state.value)} on the number line.`;
    case "ten-frame": {
      const size = model.kind === "ten-frame" ? model.frames * 10 : 10;
      return `Filled ${state.cells.length} of ${size} spaces in the ten frame${size > 10 ? "s" : ""}.`;
    }
    case "place-value": return `Built ${state.hundreds} hundred${state.hundreds === 1 ? "" : "s"}, ${state.tens} ten${state.tens === 1 ? "" : "s"} and ${state.ones} one${state.ones === 1 ? "" : "s"}, which makes ${placeValueTotal(state)}.`;
    case "fraction-bars": {
      const bars = model.kind === "fraction-bars" ? model.bars : [];
      const parts = state.shaded.map((cells, index) => {
        const bar = bars[index];
        return `${bar?.label ? `${bar.label}: ` : ""}${cells.length}/${bar?.parts ?? "?"}`;
      });
      return `Shaded ${parts.join(", ")}.`;
    }
    case "array": {
      const total = model.kind === "array" ? model.rows * model.columns : state.marked.length;
      return `Counted ${state.marked.length} of the ${total} objects.`;
    }
    case "clock": return `Set the clock to ${formatClockTime(state.hour, state.minute)}.`;
  }
}

/** Plain-text picture of a model, for terminal and other text-only surfaces. */
export function manipulativeTextLines(model: UiManipulativeModel): string[] {
  switch (model.kind) {
    case "number-line": {
      const ticks = numberLineTicks(model);
      const marked = new Set(model.marks?.map((mark) => mark.value) ?? []);
      return [
        `Number line ${formatNumber(model.min)} to ${formatNumber(model.max)} in steps of ${formatNumber(model.step)}`,
        ticks.map((tick) => marked.has(tick) ? `[${formatNumber(tick)}]` : formatNumber(tick)).join(" "),
        ...(model.marks ?? []).filter((mark) => mark.label).map((mark) => `${formatNumber(mark.value)}: ${mark.label}`),
        ...(model.jumps ?? []).map((jump) => `hop ${formatNumber(jump.from)} → ${formatNumber(jump.to)}${jump.label ? ` (${jump.label})` : ""}`),
      ];
    }
    case "ten-frame": return Array.from({ length: model.frames * 2 }, (_, row) =>
      Array.from({ length: 5 }, (_, column) => row * 5 + column < model.filled ? "●" : "○").join(" "));
    case "place-value": {
      const parts = placeValueParts(model.value);
      return [`${model.value} = ${parts.hundreds} hundreds, ${parts.tens} tens, ${parts.ones} ones`];
    }
    case "fraction-bars": return model.bars.map((bar) =>
      `${"■".repeat(bar.shaded)}${"□".repeat(bar.parts - bar.shaded)}  ${bar.label ?? `${bar.shaded}/${bar.parts}`}`);
    case "array": return [
      ...Array.from({ length: model.rows }, () => Array.from({ length: model.columns }, () => "●").join(" ")),
      `${model.rows} rows of ${model.columns}`,
    ];
    case "clock": return [`Clock showing ${formatClockTime(model.hour, model.minute)}`];
  }
}

/* ── Compilation from OpenUI source ────────────────────────────────────── */

function numberFrom(value: unknown, fallback: number): number { return finite(value) ? value : fallback; }
function intFrom(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(numberFrom(value, fallback))));
}
function labelFrom(value: unknown): { label?: string } {
  return typeof value === "string" && value.trim() ? { label: value.trim().slice(0, MANIPULATIVE_LIMITS.label) } : {};
}

/** Widen the step until the line fits the tick budget, keeping min and max. */
function fitNumberLine(min: number, max: number, step: number): { min: number; max: number; step: number } {
  let low = min;
  let high = max > min ? max : min + 10;
  let size = step > 0 ? step : 1;
  for (const factor of [1, 2, 5, 10, 20, 50, 100, 1000]) {
    const candidate = { min: low, max: high, step: size * factor };
    const ticks = numberLineTickCount(candidate);
    if (ticks >= 2 && ticks <= MANIPULATIVE_LIMITS.numberLineTicks) return candidate;
  }
  // Uneven range: snap max onto the step grid instead.
  size = Math.max(size, (high - low) / (MANIPULATIVE_LIMITS.numberLineTicks - 1));
  high = tidy(low + Math.ceil((high - low) / size) * size);
  return { min: low, max: high, step: size };
}

/**
 * Normalise model props from an OpenUI component into a valid model, clamping
 * rather than failing: a slightly-off number line is still worth showing.
 */
export function manipulativeModelFromProps(component: string, props: Record<string, unknown>): UiManipulativeModel | null {
  switch (component) {
    case "NumberLine": {
      const line = fitNumberLine(numberFrom(props.min, 0), numberFrom(props.max, 10), numberFrom(props.step, 1));
      const marks = Array.isArray(props.marks) ? props.marks.flatMap((entry): UiNumberLineMark[] => {
        const mark = isRecord(entry) ? entry : finite(entry) ? { value: entry } : null;
        if (!mark || !finite(mark.value) || !isNumberLineTick(line, mark.value)) return [];
        return [{ value: tidy(mark.value), ...labelFrom(mark.label) }];
      }).slice(0, MANIPULATIVE_LIMITS.marks) : [];
      const jumps = Array.isArray(props.jumps) ? props.jumps.flatMap((entry): UiNumberLineJump[] => {
        if (!isRecord(entry) || !finite(entry.from) || !finite(entry.to) || entry.from === entry.to) return [];
        if (!isNumberLineTick(line, entry.from) || !isNumberLineTick(line, entry.to)) return [];
        return [{ from: tidy(entry.from), to: tidy(entry.to), ...labelFrom(entry.label) }];
      }).slice(0, MANIPULATIVE_LIMITS.jumps) : [];
      const labelEvery = finite(props.labelEvery) ? intFrom(props.labelEvery, 1, 1, MANIPULATIVE_LIMITS.numberLineTicks) : undefined;
      return {
        kind: "number-line", ...line,
        ...(labelEvery !== undefined ? { labelEvery } : {}),
        ...(marks.length ? { marks } : {}),
        ...(jumps.length ? { jumps } : {}),
      };
    }
    case "TenFrame": {
      const frames = props.frames === 2 ? 2 : 1;
      return { kind: "ten-frame", frames, filled: intFrom(props.filled, 0, 0, frames * 10) };
    }
    case "PlaceValue": return { kind: "place-value", value: intFrom(props.value, 0, 0, MANIPULATIVE_LIMITS.placeValueMax) };
    case "FractionBars": {
      const bars = (Array.isArray(props.bars) ? props.bars : []).flatMap((entry): UiFractionBar[] => {
        if (!isRecord(entry)) return [];
        const parts = intFrom(entry.parts, 2, 1, MANIPULATIVE_LIMITS.fractionParts);
        return [{ parts, shaded: intFrom(entry.shaded, 0, 0, parts), ...labelFrom(entry.label) }];
      }).slice(0, MANIPULATIVE_LIMITS.fractionBars);
      return bars.length ? { kind: "fraction-bars", bars } : null;
    }
    case "CountingArray": {
      const named = typeof props.symbol === "string" ? props.symbol.trim().toLowerCase().replace(/s$/, "") : "";
      const symbol = SYMBOL_SET.has(named) ? named as UiManipulativeSymbol : undefined;
      return {
        kind: "array",
        rows: intFrom(props.rows, 2, 1, MANIPULATIVE_LIMITS.arrayRows),
        columns: intFrom(props.columns, 5, 1, MANIPULATIVE_LIMITS.arrayColumns),
        ...(symbol ? { symbol } : {}),
      };
    }
    case "Clock": {
      const hour = intFrom(props.hour, 12, 0, 24);
      return { kind: "clock", hour: hour % 12 === 0 ? 12 : hour % 12, minute: intFrom(props.minute, 0, 0, 59) };
    }
    default: return null;
  }
}

export const MANIPULATIVE_COMPONENTS = ["NumberLine", "TenFrame", "PlaceValue", "FractionBars", "CountingArray", "Clock"] as const;

export const MANIPULATIVE_TITLES: Record<UiManipulativeKind, string> = {
  "number-line": "Number line",
  "ten-frame": "Ten frame",
  "place-value": "Place value",
  "fraction-bars": "Fraction bars",
  array: "Counting array",
  clock: "Clock",
};
