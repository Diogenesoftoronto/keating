/**
 * Presentation grammar adapted from the official Sacred/SRCL component catalog:
 * https://www.sacred.computer/ (Avatar, Badge, ActionButton, ActionBar,
 * Message, MessageViewer, and TreeView). This is an OpenTUI-native adaptation,
 * not copied React component code.
 */

export type SacredGlyphMode = "unicode" | "ascii";

export interface SacredLabelValue<T> {
  /** Exact caller-owned value. It is never used as presentation text. */
  value: T;
  /** Exact caller-owned label, retained separately from its display form. */
  label: string;
}

export interface SacredTextPresentation<T> extends SacredLabelValue<T> {
  displayLabel: string;
  text: string;
}

const CSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const OSC_ESCAPE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const OTHER_ESCAPE = /\u001b[@-_]/g;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/g;
const UNSAFE_FORMAT_CHARACTER = /[\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const ZERO_WIDTH_CODE_POINT = /[\p{Mark}\u200c\ufe00-\ufe0f]/u;

interface TerminalUnit {
  text: string;
  width: number;
  regional: boolean;
}

function boundedWidth(width: number | undefined, fallback: number): number {
  const candidate = width === undefined ? fallback : width;
  if (!Number.isFinite(candidate)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(candidate));
}

function stripTerminalControl(value: string): string {
  return value
    .replace(OSC_ESCAPE, "")
    .replace(CSI_ESCAPE, "")
    .replace(OTHER_ESCAPE, "")
    .replace(UNSAFE_FORMAT_CHARACTER, "")
    .replace(CONTROL_CHARACTER, " ");
}

const ASCII_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["⌘", "CMD"],
  ["⌃", "CTRL"],
  ["⌥", "ALT"],
  ["⇧", "SHIFT"],
  ["↵", "ENTER"],
  ["←", "LEFT"],
  ["→", "RIGHT"],
  ["↑", "UP"],
  ["↓", "DOWN"],
  ["…", "..."],
  ["–", "-"],
  ["—", "-"],
  ["’", "'"],
  ["“", '"'],
  ["”", '"'],
];

function asciiFallback(value: string): string {
  let result = value;
  for (const [source, replacement] of ASCII_REPLACEMENTS) {
    result = result.replaceAll(source, replacement);
  }
  return result
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?");
}

/** Strip terminal controls, collapse whitespace, and optionally provide strict ASCII text. */
export function sacredSanitizeText(
  value: string,
  glyphMode: SacredGlyphMode = "unicode",
  uppercase = false,
): string {
  const compact = stripTerminalControl(value).replace(/\s+/g, " ").trim();
  const safe = glyphMode === "ascii" ? asciiFallback(compact) : compact;
  return uppercase ? safe.toLocaleUpperCase("en-US") : safe;
}

const displayText = sacredSanitizeText;

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}

function isZeroWidth(codePoint: number, character: string): boolean {
  return codePoint === 0x200d
    || (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
    || ZERO_WIDTH_CODE_POINT.test(character);
}

function isWide(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function terminalUnits(value: string): TerminalUnit[] {
  const units: TerminalUnit[] = [];
  let joinNext = false;
  let pendingRegional = false;

  for (const character of [...stripTerminalControl(value)]) {
    const codePoint = character.codePointAt(0) ?? 0;
    const previous = units.at(-1);
    if (isZeroWidth(codePoint, character)) {
      if (previous) {
        previous.text += character;
        // Emoji presentation selectors promote otherwise narrow symbols such
        // as copyright/keycap bases to a two-cell terminal grapheme.
        if (codePoint === 0xfe0f) previous.width = Math.max(previous.width, 2);
      }
      joinNext = codePoint === 0x200d && previous !== undefined;
      continue;
    }

    const regional = isRegionalIndicator(codePoint);
    const width = isWide(codePoint) ? 2 : 1;
    if (previous && joinNext) {
      previous.text += character;
      previous.width = Math.max(previous.width, width);
      joinNext = false;
      pendingRegional = false;
      continue;
    }
    if (previous && regional && pendingRegional && previous.regional) {
      previous.text += character;
      previous.width = 2;
      pendingRegional = false;
      continue;
    }

    units.push({ text: character, width, regional });
    pendingRegional = regional;
  }
  return units;
}

/** Terminal-cell width for the dependency-free presentation strings in this module. */
export function sacredTextWidth(value: string): number {
  return terminalUnits(value).reduce((total, unit) => total + unit.width, 0);
}

function takeColumns(value: string, width: number): string {
  const limit = Math.max(0, width);
  let used = 0;
  let result = "";
  for (const unit of terminalUnits(value)) {
    if (used + unit.width > limit) break;
    result += unit.text;
    used += unit.width;
  }
  return result;
}

function takeRightColumns(value: string, width: number): string {
  const limit = Math.max(0, width);
  const units = terminalUnits(value);
  let used = 0;
  let result = "";
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (!unit || used + unit.width > limit) break;
    result = unit.text + result;
    used += unit.width;
  }
  return result;
}

function truncateDisplay(value: string, width: number, glyphMode: SacredGlyphMode): string {
  const limit = Math.max(0, width);
  if (limit === 0) return "";
  if (sacredTextWidth(value) <= limit) return value;
  const marker = glyphMode === "unicode" ? "…" : "~";
  const markerWidth = sacredTextWidth(marker);
  if (limit <= markerWidth) return takeColumns(marker, limit);
  return `${takeColumns(value, limit - markerWidth)}${marker}`;
}

function padColumns(value: string, width: number): string {
  const bounded = takeColumns(value, width);
  return `${bounded}${" ".repeat(Math.max(0, width - sacredTextWidth(bounded)))}`;
}

/** Sanitize and truncate text to a terminal-cell budget, including its marker. */
export function sacredTruncateText(
  value: string,
  width: number,
  glyphMode: SacredGlyphMode = "unicode",
): string {
  const safeWidth = boundedWidth(width, 0);
  return truncateDisplay(sacredSanitizeText(value, glyphMode), safeWidth, glyphMode);
}

/** Sanitize, truncate, and right-pad text to an exact terminal-cell width. */
export function sacredFitText(
  value: string,
  width: number,
  glyphMode: SacredGlyphMode = "unicode",
): string {
  const safeWidth = boundedWidth(width, 0);
  return padColumns(sacredTruncateText(value, safeWidth, glyphMode), safeWidth);
}

/** Resolve a Unicode-safe identity marker occupying exactly two terminal cells. */
export function sacredInitialsFor(
  label: string,
  supplied: string | undefined,
  glyphMode: SacredGlyphMode = "unicode",
): string {
  const source = displayText(supplied ?? "", glyphMode, true);
  const words = displayText(label, glyphMode, true).split(/\s+/).filter(Boolean);
  let initials = source;
  if (!initials) {
    const first = words[0] ?? "";
    const last = words.length > 1 ? words.at(-1) ?? "" : "";
    const firstUnit = terminalUnits(first)[0]?.text ?? "";
    const lastUnit = terminalUnits(last)[0]?.text ?? "";
    initials = last ? `${firstUnit}${lastUnit}` : takeColumns(first, 2);
  }
  if (!initials) initials = "??";
  const compact = takeColumns(initials, 2);
  return padColumns(compact || "??", 2);
}

export interface SacredAvatarInput<T> extends SacredLabelValue<T> {
  detail?: string;
  initials?: string;
  width?: number;
  glyphMode?: SacredGlyphMode;
}

export interface SacredAvatarPresentation<T> extends SacredLabelValue<T> {
  detail: string;
  displayDetail: string;
  displayInitials: string;
  displayLabel: string;
  avatar: readonly [string, string];
  lines: readonly [string, string];
}

/** Render a two-row identity block whose avatar cell is exactly four columns. */
export function renderSacredAvatar<T>(input: SacredAvatarInput<T>): SacredAvatarPresentation<T> {
  const glyphMode = input.glyphMode ?? "unicode";
  const displayInitials = sacredInitialsFor(input.label, input.initials, glyphMode);
  const avatar: readonly [string, string] = glyphMode === "unicode"
    ? [`┌${displayInitials}┐`, "└──┘"]
    : [`[${displayInitials}]`, "+--+"];
  const normalizedLabel = displayText(input.label, glyphMode, true) || "UNTITLED";
  const normalizedDetail = displayText(input.detail ?? "", glyphMode);
  const naturalWidth = 5 + Math.max(sacredTextWidth(normalizedLabel), sacredTextWidth(normalizedDetail));
  const width = boundedWidth(input.width, naturalWidth);
  const adjacentWidth = Math.max(0, width - 5);
  const displayLabel = truncateDisplay(normalizedLabel, adjacentWidth, glyphMode);
  const displayDetail = truncateDisplay(normalizedDetail, adjacentWidth, glyphMode);
  const separator = width > 4 ? " " : "";
  const first = takeColumns(`${avatar[0]}${separator}${displayLabel}`, width);
  const second = takeColumns(`${avatar[1]}${separator}${displayDetail}`, width);

  return {
    value: input.value,
    label: input.label,
    detail: input.detail ?? "",
    displayDetail,
    displayInitials,
    displayLabel,
    avatar,
    lines: [first, second],
  };
}

export interface SacredBadgeInput<T> extends SacredLabelValue<T> {
  width?: number;
  glyphMode?: SacredGlyphMode;
}

/** A flat Sacred badge: uppercase content with one terminal column of padding. */
export function renderSacredBadge<T>(input: SacredBadgeInput<T>): SacredTextPresentation<T> {
  const glyphMode = input.glyphMode ?? "unicode";
  const normalized = displayText(input.label, glyphMode, true) || "UNTITLED";
  const width = boundedWidth(input.width, sacredTextWidth(normalized) + 2);
  if (width < 3) {
    const displayLabel = truncateDisplay(normalized, width, glyphMode);
    return { value: input.value, label: input.label, displayLabel, text: displayLabel };
  }
  const displayLabel = truncateDisplay(normalized, width - 2, glyphMode);
  return {
    value: input.value,
    label: input.label,
    displayLabel,
    text: ` ${displayLabel} `,
  };
}

export interface SacredActionItem<T> extends SacredLabelValue<T> {
  hotkey?: string;
  selected?: boolean;
  disabled?: boolean;
}

export interface SacredActionButtonInput<T> extends SacredActionItem<T> {
  width?: number;
  glyphMode?: SacredGlyphMode;
}

export interface SacredActionButtonPresentation<T> extends SacredTextPresentation<T> {
  hotkey: string;
  displayHotkey: string;
  selected: boolean;
  disabled: boolean;
}

/** Render the Sacred hotkey + task label contract with a textual selection cue. */
export function renderSacredActionButton<T>(input: SacredActionButtonInput<T>): SacredActionButtonPresentation<T> {
  const glyphMode = input.glyphMode ?? "unicode";
  const normalizedLabel = displayText(input.label, glyphMode, true) || "ACTION";
  const normalizedHotkey = displayText(input.hotkey ?? "", glyphMode, true);
  const indicator = input.disabled
    ? glyphMode === "unicode" ? "×" : "x"
    : input.selected ? glyphMode === "unicode" ? "▸" : ">" : "";
  const natural = [indicator, normalizedHotkey, normalizedLabel].filter(Boolean).join(" ");
  const width = boundedWidth(input.width, sacredTextWidth(natural));
  let remaining = width;
  let text = "";

  if (indicator && remaining > 0) {
    text = indicator;
    remaining -= sacredTextWidth(indicator);
  }

  let displayHotkey = "";
  if (normalizedHotkey && remaining > 0) {
    const leadingSpace = text ? 1 : 0;
    const labelReserve = normalizedLabel ? 2 : 0;
    const hotkeyWidth = Math.max(0, remaining - leadingSpace - labelReserve);
    if (hotkeyWidth > 0 && leadingSpace > 0) {
      text += " ";
      remaining -= 1;
    }
    displayHotkey = truncateDisplay(normalizedHotkey, hotkeyWidth, glyphMode);
    text += displayHotkey;
    remaining -= sacredTextWidth(displayHotkey);
  }

  if (normalizedLabel && remaining > 0) {
    if (text && remaining > 1) {
      text += " ";
      remaining -= 1;
    }
  }
  const displayLabel = truncateDisplay(normalizedLabel, remaining, glyphMode);
  text += displayLabel;
  text = takeColumns(text, width);

  return {
    value: input.value,
    label: input.label,
    hotkey: input.hotkey ?? "",
    displayHotkey,
    displayLabel,
    selected: input.selected ?? false,
    disabled: input.disabled ?? false,
    text,
  };
}

export interface SacredActionBarInput<T> {
  left?: readonly SacredActionItem<T>[];
  right?: readonly SacredActionItem<T>[];
  width: number;
  glyphMode?: SacredGlyphMode;
}

export interface SacredActionBarPresentation<T> {
  left: readonly SacredActionButtonPresentation<T>[];
  right: readonly SacredActionButtonPresentation<T>[];
  leftText: string;
  rightText: string;
  text: string;
}

function joinedActions<T>(actions: readonly SacredActionButtonPresentation<T>[]): string {
  return actions.map((action) => action.text).filter(Boolean).join("  ");
}

/** Compose primary actions on the left and secondary actions against the right edge. */
export function renderSacredActionBar<T>(input: SacredActionBarInput<T>): SacredActionBarPresentation<T> {
  const glyphMode = input.glyphMode ?? "unicode";
  const width = boundedWidth(input.width, 0);
  const left = (input.left ?? []).map((action) => renderSacredActionButton({ ...action, glyphMode }));
  const right = (input.right ?? []).map((action) => renderSacredActionButton({ ...action, glyphMode }));
  const naturalLeft = joinedActions(left);
  const naturalRight = joinedActions(right);

  if (width === 0) return { left, right, leftText: "", rightText: "", text: "" };
  if (!naturalRight) {
    const leftText = truncateDisplay(naturalLeft, width, glyphMode);
    return { left, right, leftText, rightText: "", text: padColumns(leftText, width) };
  }
  if (!naturalLeft) {
    const rightText = truncateDisplay(naturalRight, width, glyphMode);
    return { left, right, leftText: "", rightText, text: `${" ".repeat(width - sacredTextWidth(rightText))}${rightText}` };
  }

  const available = Math.max(0, width - 1);
  let rightBudget = Math.min(sacredTextWidth(naturalRight), Math.floor(available / 2));
  let leftBudget = available - rightBudget;
  const unusedLeft = Math.max(0, leftBudget - sacredTextWidth(naturalLeft));
  rightBudget = Math.min(sacredTextWidth(naturalRight), rightBudget + unusedLeft);
  leftBudget = available - rightBudget;
  const leftText = truncateDisplay(naturalLeft, leftBudget, glyphMode);
  const rightText = truncateDisplay(naturalRight, rightBudget, glyphMode);
  const gap = " ".repeat(Math.max(1, width - sacredTextWidth(leftText) - sacredTextWidth(rightText)));
  const text = takeColumns(`${leftText}${gap}${rightText}`, width);
  return { left, right, leftText, rightText, text: padColumns(text, width) };
}

export type SacredMessageVariant = "message" | "viewer";

export interface SacredMessageHeaderInput<T> extends SacredLabelValue<T> {
  initials?: string;
  width: number;
  glyphMode?: SacredGlyphMode;
}

export interface SacredMessageHeaderPresentation<T> extends SacredTextPresentation<T> {
  variant: SacredMessageVariant;
  displayInitials: string;
}

function renderMessageHeader<T>(
  variant: SacredMessageVariant,
  input: SacredMessageHeaderInput<T>,
): SacredMessageHeaderPresentation<T> {
  const glyphMode = input.glyphMode ?? "unicode";
  const width = boundedWidth(input.width, 0);
  const displayInitials = sacredInitialsFor(input.label, input.initials, glyphMode);
  const avatar = `[${displayInitials}]`;
  const normalizedLabel = displayText(input.label, glyphMode, true) || "MESSAGE";
  const tail = variant === "message"
    ? glyphMode === "unicode" ? "◀" : "<"
    : glyphMode === "unicode" ? "▶" : ">";
  const corner = variant === "message"
    ? glyphMode === "unicode" ? "┐" : "+"
    : glyphMode === "unicode" ? "┌" : "+";
  const rule = glyphMode === "unicode" ? "─" : "-";

  if (width < 9) {
    const compact = variant === "message" ? `${tail}${avatar}${corner}` : `${corner}${avatar}${tail}`;
    const visible = variant === "message" ? takeColumns(compact, width) : takeRightColumns(compact, width);
    const text = variant === "message"
      ? padColumns(visible, width)
      : `${" ".repeat(Math.max(0, width - sacredTextWidth(visible)))}${visible}`;
    return {
      value: input.value,
      label: input.label,
      displayLabel: "",
      displayInitials,
      text,
      variant,
    };
  }

  const displayLabel = truncateDisplay(normalizedLabel, width - 8, glyphMode);
  const fixedWidth = 8 + sacredTextWidth(displayLabel);
  const fill = rule.repeat(Math.max(0, width - fixedWidth));
  const text = variant === "message"
    ? `${tail}${avatar} ${displayLabel} ${fill}${corner}`
    : `${corner}${fill} ${displayLabel} ${avatar}${tail}`;
  return {
    value: input.value,
    label: input.label,
    displayLabel,
    displayInitials,
    text: padColumns(text, width),
    variant,
  };
}

/** Sacred Message chrome: avatar and tail anchored to the left edge. */
export function renderSacredMessageHeader<T>(input: SacredMessageHeaderInput<T>): SacredMessageHeaderPresentation<T> {
  return renderMessageHeader("message", input);
}

/** Sacred MessageViewer chrome: avatar and tail anchored to the right edge. */
export function renderSacredMessageViewerHeader<T>(input: SacredMessageHeaderInput<T>): SacredMessageHeaderPresentation<T> {
  return renderMessageHeader("viewer", input);
}

export interface SacredTreeNode<T> extends SacredLabelValue<T> {
  id: string;
  parentId?: string | null;
}

export interface SacredTreeOptions {
  width: number;
  glyphMode?: SacredGlyphMode;
}

export interface SacredTreeRow<T> extends SacredLabelValue<T> {
  sourceId: string;
  parentSourceId: string | null;
  depth: number;
  displayLabel: string;
  text: string;
  expanded: boolean;
  isLast: boolean;
  orphaned: boolean;
  cyclic: boolean;
}

function cyclicTreeMembers(parentIndices: readonly (number | null)[]): ReadonlySet<number> {
  const complete = new Set<number>();
  const cyclic = new Set<number>();
  for (let start = 0; start < parentIndices.length; start += 1) {
    if (complete.has(start)) continue;
    const path: number[] = [];
    const positions = new Map<number, number>();
    let current: number | null = start;
    while (current !== null && !complete.has(current)) {
      const repeatedAt = positions.get(current);
      if (repeatedAt !== undefined) {
        for (const member of path.slice(repeatedAt)) cyclic.add(member);
        break;
      }
      positions.set(current, path.length);
      path.push(current);
      current = parentIndices[current] ?? null;
    }
    for (const member of path) complete.add(member);
  }
  return cyclic;
}

/**
 * Flatten an always-expanded Sacred TreeView from flat parent references.
 * Missing parents become roots, while rootless cycles receive one stable
 * synthetic root. Source ids and exact values remain metadata only.
 */
export function flattenSacredTree<T>(
  nodes: readonly SacredTreeNode<T>[],
  options: SacredTreeOptions,
): SacredTreeRow<T>[] {
  const glyphMode = options.glyphMode ?? "unicode";
  const width = boundedWidth(options.width, 0);
  const firstIndexById = new Map<string, number>();
  nodes.forEach((node, index) => {
    if (!firstIndexById.has(node.id)) firstIndexById.set(node.id, index);
  });

  const parentIndices = nodes.map((node) => {
    if (node.parentId === undefined || node.parentId === null || node.parentId === "") return null;
    return firstIndexById.get(node.parentId) ?? null;
  });
  const children = nodes.map(() => [] as number[]);
  parentIndices.forEach((parentIndex, index) => {
    if (parentIndex !== null) children[parentIndex]?.push(index);
  });

  const roots = parentIndices
    .map((parentIndex, index) => parentIndex === null ? index : -1)
    .filter((index) => index >= 0);
  const covered = new Set<number>();
  const markReachable = (start: number): void => {
    const pending = [start];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || covered.has(current)) continue;
      covered.add(current);
      for (const child of children[current] ?? []) pending.push(child);
    }
  };
  roots.forEach(markReachable);
  for (let index = 0; index < nodes.length; index += 1) {
    if (covered.has(index)) continue;
    roots.push(index);
    markReachable(index);
  }

  const cyclic = cyclicTreeMembers(parentIndices);
  const emitted = new Set<number>();
  const rows: SacredTreeRow<T>[] = [];
  const ancestorContinuation = glyphMode === "unicode" ? "│ . " : "| . ";
  const ancestorBlank = ". . ";
  const branch = glyphMode === "unicode" ? "├───" : "|---";
  const lastBranch = glyphMode === "unicode" ? "└───" : "`---";
  const parentMarker = glyphMode === "unicode" ? "╦ " : "+ ";

  const visit = (index: number, depth: number, continuations: readonly boolean[], isLast: boolean): void => {
    if (emitted.has(index)) return;
    emitted.add(index);
    const node = nodes[index];
    if (!node) return;
    const childIndices = (children[index] ?? []).filter((child) => !emitted.has(child));
    const expanded = (children[index]?.length ?? 0) > 0;
    const spacing = continuations.map((continues) => continues ? ancestorContinuation : ancestorBlank).join("");
    const prefix = `${spacing}${isLast ? lastBranch : branch}${expanded ? parentMarker : " "}`;
    const normalizedLabel = displayText(node.label, glyphMode) || "Untitled";
    const labelWidth = Math.max(0, width - sacredTextWidth(prefix));
    const displayLabel = truncateDisplay(normalizedLabel, labelWidth, glyphMode);
    const text = labelWidth > 0
      ? takeColumns(`${prefix}${displayLabel}`, width)
      : truncateDisplay(prefix, width, glyphMode);
    rows.push({
      sourceId: node.id,
      parentSourceId: node.parentId ?? null,
      value: node.value,
      label: node.label,
      depth,
      displayLabel,
      text,
      expanded,
      isLast,
      orphaned: node.parentId !== undefined
        && node.parentId !== null
        && node.parentId !== ""
        && !firstIndexById.has(node.parentId),
      cyclic: cyclic.has(index),
    });

    const nextContinuations = [...continuations, !isLast];
    childIndices.forEach((child, childIndex) => {
      visit(child, depth + 1, nextContinuations, childIndex === childIndices.length - 1);
    });
  };

  roots.forEach((root, rootIndex) => {
    visit(root, 0, [], rootIndex === roots.length - 1);
  });
  return rows;
}
