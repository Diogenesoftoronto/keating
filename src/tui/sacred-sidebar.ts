import {
  BoxRenderable,
  MouseButton,
  RenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
  type ColorInput,
  type KeyEvent,
  type MouseEvent,
} from "@opentui/core";
import {
  sacredFitText,
  sacredSanitizeText,
  sacredTextWidth,
  sacredTruncateText,
} from "./sacred.js";

export type SacredSidebarGlyphMode = "unicode" | "ascii";
export type SacredSidebarFocusArea = "navigation" | "sessions";
export type SacredSidebarFocusTarget = SacredSidebarFocusArea | "resize";
export type SacredSidebarFocusEscapeDirection = "forward" | "backward";

export interface SacredSidebarSemanticColors {
  text: ColorInput;
  muted: ColorInput;
  accent: ColorInput;
  border: ColorInput;
  focus: ColorInput;
  selection: ColorInput;
  onSelection: ColorInput;
}

export interface SacredSidebarAvatar {
  unicode: readonly [string, string];
  ascii?: readonly [string, string];
}

export interface SacredSidebarIdentity {
  /** Primary caller-owned identity label. `name` remains a compatibility alias. */
  label?: string;
  name?: string;
  detail?: string;
  /** Two terminal rows, each presented in an exact 4ch avatar slot. */
  avatarLines?: readonly [string, string];
  asciiAvatarLines?: readonly [string, string];
  avatar?: SacredSidebarAvatar;
}

export interface SacredSidebarNavigationItem {
  id: string;
  label: string;
  asciiLabel?: string;
}

/**
 * `display` is presentation only. The opaque `value` is retained separately
 * and is never derived from, truncated with, or compared to the display row.
 */
export interface SacredSidebarSessionRow<T> {
  display: string;
  asciiDisplay?: string;
  value: T;
}

export interface SacredSidebarLabels {
  navigation: string;
  sessions: string;
  recent: string;
  emptyNavigation: string;
  emptySessions: string;
}

export interface SacredSidebarOptions<T> {
  id?: string;
  width: number;
  minWidth?: number;
  maxWidth?: number;
  height?: number | "auto" | `${number}%`;
  visible?: boolean;
  zIndex?: number;
  glyphMode: SacredSidebarGlyphMode;
  surface: ColorInput;
  colors: SacredSidebarSemanticColors;
  identity: SacredSidebarIdentity;
  navigation: readonly SacredSidebarNavigationItem[];
  sessions: readonly SacredSidebarSessionRow<T>[];
  activity?: string | readonly string[];
  activityRows?: number;
  maxNavigationRows?: number;
  labels?: Partial<SacredSidebarLabels>;
  onNavigationSelection?: (item: SacredSidebarNavigationItem) => void;
  onNavigate?: (item: SacredSidebarNavigationItem) => void;
  onSessionSelection?: (value: T, row: SacredSidebarSessionRow<T>) => void;
  onSessionActivate?: (value: T, row: SacredSidebarSessionRow<T>) => void;
  /** Mirrors pointer and keyboard focus into the host's logical focus model. */
  onFocusChange?: (target: SacredSidebarFocusTarget | null) => void;
  /** Lets Tab leave the two sidebar lists instead of trapping keyboard focus. */
  onFocusEscape?: (direction: SacredSidebarFocusEscapeDirection) => void;
  /** Receives a bounded request. The host decides whether and how to apply it. */
  onResizeRequest?: (requestedWidth: number) => void;
}

const ASCII_BORDER_CHARS = {
  topLeft: "+",
  topRight: "+",
  bottomLeft: "+",
  bottomRight: "+",
  horizontal: "-",
  vertical: "|",
  topT: "+",
  bottomT: "+",
  leftT: "+",
  rightT: "+",
  cross: "+",
} as const;

const DEFAULT_LABELS: SacredSidebarLabels = {
  navigation: "Actions",
  sessions: "Sessions",
  recent: "Recent",
  emptyNavigation: "No actions",
  emptySessions: "No sessions",
};

const DEFAULT_AVATAR: SacredSidebarAvatar = {
  unicode: ["╭──╮", "╰──╯"],
  ascii: ["+--+", "+--+"],
};

const GLYPHS = {
  unicode: {
    focus: "◆",
    idle: "·",
    selected: "›",
    rule: "─",
    handle: "┊",
  },
  ascii: {
    focus: ">",
    idle: ".",
    selected: ">",
    rule: "-",
    handle: "|",
  },
} as const;

function asciiFallback(value: string): string {
  return value
    .replace(/…/g, "...")
    .replace(/[╭╮╰╯┌┐└┘├┤┬┴┼╦]/g, "+")
    .replace(/[─━]/g, "-")
    .replace(/[│┃┊]/g, "|")
    .replace(/[▶▸›→]/g, ">")
    .replace(/[▼▾]/g, "v")
    .replace(/[◆●]/g, "*")
    .replace(/[·•]/g, ".")
    .replace(/[◇○]/g, "o");
}

function fitLine(value: string, width: number, mode: SacredSidebarGlyphMode): string {
  const limit = Math.max(1, Math.floor(width));
  const source = mode === "ascii" ? asciiFallback(value) : value;
  return sacredTruncateText(source, limit, mode);
}

function avatarLine(value: string, mode: SacredSidebarGlyphMode): string {
  const source = mode === "ascii" ? asciiFallback(value) : value;
  return sacredFitText(source, 4, mode);
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  const finite = Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(maximum, Math.max(minimum, finite));
}

interface MouseSelection {
  area: SacredSidebarFocusArea;
  index: number;
}

interface DragState {
  originX: number;
  originWidth: number;
}

interface OpenTuiMouseCapture {
  setCapturedRenderable?: (renderable?: BoxRenderable) => void;
}

/**
 * An additive, host-agnostic sidebar composed from OpenTUI imperative
 * renderables. Add `root` to the desired host container after construction.
 */
export class SacredSidebar<T> {
  readonly root: BoxRenderable;
  readonly navigationSelect: SelectRenderable;
  readonly sessionSelect: SelectRenderable;
  readonly resizeHandle: BoxRenderable;

  private readonly renderer: CliRenderer;
  private readonly options: SacredSidebarOptions<T>;
  private readonly colors: SacredSidebarSemanticColors;
  private readonly surface: ColorInput;
  private readonly glyphMode: SacredSidebarGlyphMode;
  private readonly labels: SacredSidebarLabels;
  private readonly minWidth: number;
  private readonly maxWidth: number;
  private readonly maxNavigationRows: number;
  private readonly avatar: TextRenderable;
  private readonly identityText: TextRenderable;
  private readonly navigationHeading: TextRenderable;
  private readonly sessionsHeading: TextRenderable;
  private readonly activityHeading: TextRenderable;
  private readonly activityText: TextRenderable;
  private readonly handleGlyph: TextRenderable;
  private navigationItems: SacredSidebarNavigationItem[];
  private sessionRows: SacredSidebarSessionRow<T>[];
  private sessionValues: T[];
  private identity: SacredSidebarIdentity;
  private widthValue: number;
  private destroyed = false;
  private mouseSelection: MouseSelection | null = null;
  private dragState: DragState | null = null;
  private readonly keyListener: (key: KeyEvent) => void;

  constructor(renderer: CliRenderer, options: SacredSidebarOptions<T>) {
    this.renderer = renderer;
    this.options = options;
    this.colors = options.colors;
    this.surface = options.surface;
    this.glyphMode = options.glyphMode;
    this.labels = { ...DEFAULT_LABELS, ...options.labels };
    this.minWidth = Math.max(12, Math.round(options.minWidth ?? 20));
    this.maxWidth = Math.max(this.minWidth, Math.round(options.maxWidth ?? 64));
    this.widthValue = this.clampWidth(options.width);
    this.maxNavigationRows = Math.max(1, Math.round(options.maxNavigationRows ?? 5));
    this.identity = { ...options.identity };
    this.navigationItems = options.navigation.map((item) => ({ ...item }));
    this.sessionRows = options.sessions.map((row) => ({ ...row }));
    this.sessionValues = options.sessions.map((row) => row.value);

    const id = options.id ?? "sacred-sidebar";
    const zIndex = options.zIndex ?? 0;
    const customBorderChars = this.glyphMode === "ascii" ? ASCII_BORDER_CHARS : undefined;

    this.root = new BoxRenderable(renderer, {
      id,
      width: this.widthValue,
      height: options.height ?? "100%",
      flexShrink: 0,
      position: "relative",
      overflow: "hidden",
      zIndex,
      visible: options.visible ?? true,
      backgroundColor: this.surface,
      border: true,
      borderStyle: "single",
      customBorderChars,
      borderColor: this.colors.border,
      shouldFill: true,
    });

    const content = new BoxRenderable(renderer, {
      id: `${id}-content`,
      width: "100%",
      height: "100%",
      flexDirection: "column",
      paddingTop: 1,
      paddingBottom: 1,
      paddingLeft: 1,
      paddingRight: 3,
      zIndex,
      backgroundColor: this.surface,
      shouldFill: true,
    });

    const identityArea = new BoxRenderable(renderer, {
      id: `${id}-identity`,
      width: "100%",
      height: 2,
      flexDirection: "row",
      flexShrink: 0,
      backgroundColor: this.surface,
      shouldFill: true,
    });
    this.avatar = new TextRenderable(renderer, {
      id: `${id}-avatar`,
      width: 4,
      height: 2,
      flexShrink: 0,
      content: "",
      fg: this.colors.accent,
      bg: this.surface,
      selectable: false,
      wrapMode: "none",
      truncate: true,
    });
    this.identityText = new TextRenderable(renderer, {
      id: `${id}-identity-text`,
      flexGrow: 1,
      height: 2,
      marginLeft: 1,
      content: "",
      fg: this.colors.text,
      bg: this.surface,
      selectable: false,
      wrapMode: "none",
      truncate: true,
    });
    identityArea.add(this.avatar);
    identityArea.add(this.identityText);

    this.navigationHeading = new TextRenderable(renderer, {
      id: `${id}-navigation-heading`,
      width: "100%",
      height: 1,
      flexShrink: 0,
      content: "",
      fg: this.colors.muted,
      bg: this.surface,
      selectable: false,
      wrapMode: "none",
      truncate: true,
    });
    this.navigationSelect = new SelectRenderable(renderer, {
      id: `${id}-navigation-select`,
      width: "100%",
      height: this.navigationHeight(),
      flexShrink: 0,
      options: [],
      showDescription: false,
      showSelectionIndicator: false,
      showScrollIndicator: this.navigationItems.length > this.maxNavigationRows,
      wrapSelection: true,
      backgroundColor: this.surface,
      textColor: this.colors.text,
      focusedBackgroundColor: this.surface,
      focusedTextColor: this.colors.text,
      selectedBackgroundColor: this.colors.selection,
      selectedTextColor: this.colors.onSelection,
      descriptionColor: this.colors.muted,
      selectedDescriptionColor: this.colors.onSelection,
      onMouseDown: (event) => this.beginMouseSelection("navigation", event),
      onMouseUp: (event) => this.endMouseSelection("navigation", event),
    });

    this.sessionsHeading = new TextRenderable(renderer, {
      id: `${id}-sessions-heading`,
      width: "100%",
      height: 1,
      flexShrink: 0,
      content: "",
      fg: this.colors.muted,
      bg: this.surface,
      selectable: false,
      wrapMode: "none",
      truncate: true,
    });
    this.sessionSelect = new SelectRenderable(renderer, {
      id: `${id}-session-select`,
      width: "100%",
      minHeight: 2,
      flexGrow: 1,
      options: [],
      showDescription: false,
      showSelectionIndicator: false,
      showScrollIndicator: true,
      wrapSelection: true,
      backgroundColor: this.surface,
      textColor: this.colors.text,
      focusedBackgroundColor: this.surface,
      focusedTextColor: this.colors.text,
      selectedBackgroundColor: this.colors.selection,
      selectedTextColor: this.colors.onSelection,
      descriptionColor: this.colors.muted,
      selectedDescriptionColor: this.colors.onSelection,
      onMouseDown: (event) => this.beginMouseSelection("sessions", event),
      onMouseUp: (event) => this.endMouseSelection("sessions", event),
    });

    this.activityHeading = new TextRenderable(renderer, {
      id: `${id}-activity-heading`,
      width: "100%",
      height: 1,
      flexShrink: 0,
      content: "",
      fg: this.colors.muted,
      bg: this.surface,
      selectable: false,
      wrapMode: "none",
      truncate: true,
    });
    this.activityText = new TextRenderable(renderer, {
      id: `${id}-activity`,
      width: "100%",
      height: Math.max(1, Math.round(options.activityRows ?? 3)),
      flexShrink: 0,
      content: "",
      fg: this.colors.muted,
      bg: this.surface,
      selectable: true,
      wrapMode: "word",
      truncate: true,
    });

    this.resizeHandle = new BoxRenderable(renderer, {
      id: `${id}-resize-handle`,
      position: "absolute",
      top: 0,
      right: 0,
      width: 2,
      height: "100%",
      zIndex: zIndex + 1,
      focusable: true,
      backgroundColor: this.surface,
      border: ["left"],
      borderStyle: "single",
      customBorderChars,
      borderColor: this.colors.border,
      focusedBorderColor: this.colors.focus,
      alignItems: "center",
      justifyContent: "center",
      shouldFill: true,
      onMouseDown: (event) => this.beginDrag(event),
      onMouseUp: (event) => this.endDrag(event),
      onMouseDrag: (event) => this.drag(event),
      onMouseDragEnd: (event) => this.endDrag(event),
    });
    this.handleGlyph = new TextRenderable(renderer, {
      id: `${id}-resize-glyph`,
      width: 1,
      height: 1,
      content: GLYPHS[this.glyphMode].handle,
      fg: this.colors.muted,
      bg: this.surface,
      selectable: false,
      wrapMode: "none",
      truncate: true,
      onMouseDown: (event) => this.beginDrag(event),
      onMouseUp: (event) => this.endDrag(event),
      onMouseDrag: (event) => this.drag(event),
      onMouseDragEnd: (event) => this.endDrag(event),
    });
    this.resizeHandle.add(this.handleGlyph);

    content.add(identityArea);
    content.add(this.navigationHeading);
    content.add(this.navigationSelect);
    content.add(this.sessionsHeading);
    content.add(this.sessionSelect);
    content.add(this.activityHeading);
    content.add(this.activityText);
    this.root.add(content);
    this.root.add(this.resizeHandle);

    this.navigationSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
      this.refreshNavigationOptions();
      const item = this.selectedNavigationItem;
      if (item) this.options.onNavigationSelection?.(item);
    });
    this.navigationSelect.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      const item = this.selectedNavigationItem;
      if (item) this.options.onNavigate?.(item);
    });
    this.sessionSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
      this.refreshSessionOptions();
      const selected = this.selectedSession;
      if (selected) this.options.onSessionSelection?.(selected.value, selected.row);
    });
    this.sessionSelect.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      const selected = this.selectedSession;
      if (selected) this.options.onSessionActivate?.(selected.value, selected.row);
    });
    this.navigationSelect.on(RenderableEvents.FOCUSED, () => {
      this.paintFocus("navigation");
      this.options.onFocusChange?.("navigation");
    });
    this.navigationSelect.on(RenderableEvents.BLURRED, () => {
      this.paintFocus(null);
      this.options.onFocusChange?.(null);
    });
    this.sessionSelect.on(RenderableEvents.FOCUSED, () => {
      this.paintFocus("sessions");
      this.options.onFocusChange?.("sessions");
    });
    this.sessionSelect.on(RenderableEvents.BLURRED, () => {
      this.paintFocus(null);
      this.options.onFocusChange?.(null);
    });
    this.resizeHandle.on(RenderableEvents.FOCUSED, () => {
      this.handleGlyph.fg = this.colors.focus;
      this.options.onFocusChange?.("resize");
    });
    this.resizeHandle.on(RenderableEvents.BLURRED, () => {
      this.handleGlyph.fg = this.colors.muted;
      this.options.onFocusChange?.(null);
    });

    this.keyListener = (key) => this.handleKey(key);
    renderer.keyInput.on("keypress", this.keyListener);

    this.refreshIdentity();
    this.refreshNavigationOptions();
    this.refreshSessionOptions();
    this.setActivity(options.activity ?? "");
    this.paintFocus(null);
  }

  get width(): number {
    return this.widthValue;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  get focusedArea(): SacredSidebarFocusArea | null {
    if (this.navigationSelect.focused) return "navigation";
    if (this.sessionSelect.focused) return "sessions";
    return null;
  }

  get selectedNavigationItem(): SacredSidebarNavigationItem | null {
    const index = this.selectedOptionIndex(this.navigationSelect);
    return index === null ? null : this.navigationItems[index] ?? null;
  }

  get selectedSession(): { value: T; row: SacredSidebarSessionRow<T> } | null {
    const index = this.selectedOptionIndex(this.sessionSelect);
    const row = index === null ? undefined : this.sessionRows[index];
    if (index === null || !row || index >= this.sessionValues.length) return null;
    return { value: this.sessionValues[index] as T, row };
  }

  setVisible(visible: boolean): void {
    if (this.destroyed) return;
    if (!visible) {
      this.navigationSelect.blur();
      this.sessionSelect.blur();
      this.resizeHandle.blur();
      this.releaseMouseCapture();
      this.dragState = null;
      this.mouseSelection = null;
    }
    this.root.visible = visible;
  }

  setWidth(width: number): number {
    if (this.destroyed) return this.widthValue;
    this.widthValue = this.clampWidth(width);
    this.root.width = this.widthValue;
    this.refreshIdentity();
    this.refreshNavigationOptions();
    this.refreshSessionOptions();
    this.paintFocus(this.focusedArea);
    return this.widthValue;
  }

  /**
   * Report a bounded width request without applying it to the sidebar. This
   * keeps drag math independent of the host's split-pane or terminal layout.
   */
  requestWidth(width: number): number {
    const requestedWidth = this.clampWidth(width);
    if (!this.destroyed) this.options.onResizeRequest?.(requestedWidth);
    return requestedWidth;
  }

  focusNavigation(): void {
    if (this.destroyed || !this.visible) return;
    this.navigationSelect.focus();
  }

  focusSessions(): void {
    if (this.destroyed || !this.visible) return;
    this.sessionSelect.focus();
  }

  setIdentity(identity: SacredSidebarIdentity): void {
    if (this.destroyed) return;
    this.identity = { ...identity };
    this.refreshIdentity();
  }

  setNavigation(items: readonly SacredSidebarNavigationItem[]): void {
    if (this.destroyed) return;
    this.navigationItems = items.map((item) => ({ ...item }));
    this.navigationSelect.height = this.navigationHeight();
    this.navigationSelect.showScrollIndicator = this.navigationItems.length > this.maxNavigationRows;
    this.refreshNavigationOptions();
  }

  setSessions(rows: readonly SacredSidebarSessionRow<T>[]): void {
    if (this.destroyed) return;
    const selected = this.selectedSession;
    this.sessionRows = rows.map((row) => ({ ...row }));
    this.sessionValues = rows.map((row) => row.value);
    this.refreshSessionOptions();
    if (!selected) return;
    const retainedIndex = this.sessionValues.findIndex((value) => Object.is(value, selected.value));
    if (retainedIndex < 0) return;
    // The options setter preserves an index, not identity. Restore the exact
    // opaque value without emitting a false selection change on mere reorder.
    this.sessionSelect.selectedIndex = retainedIndex;
    this.refreshSessionOptions();
  }

  setActivity(activity: string | readonly string[]): void {
    if (this.destroyed) return;
    const value = typeof activity === "string" ? activity : activity.join("\n");
    this.activityText.content = value.split("\n").map((line) => {
      const source = this.glyphMode === "ascii" ? asciiFallback(line) : line;
      return sacredSanitizeText(source, this.glyphMode);
    }).join("\n");
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.dragState = null;
    this.mouseSelection = null;
    this.releaseMouseCapture();
    this.renderer.keyInput.off("keypress", this.keyListener);
    this.navigationSelect.removeAllListeners();
    this.sessionSelect.removeAllListeners();
    this.resizeHandle.removeAllListeners();
    if (this.root.parent) this.root.parent.remove(this.root);
    this.root.destroyRecursively();
  }

  private clampWidth(width: number): number {
    return boundedInteger(width, this.minWidth, this.maxWidth);
  }

  private navigationHeight(): number {
    return Math.max(1, Math.min(this.maxNavigationRows, this.navigationItems.length || 1));
  }

  private contentWidth(): number {
    return Math.max(4, this.widthValue - 9);
  }

  private refreshIdentity(): void {
    const avatar = this.identity.avatar ?? DEFAULT_AVATAR;
    const rows = this.glyphMode === "ascii"
      ? (this.identity.asciiAvatarLines ?? this.identity.avatarLines ?? avatar.ascii ?? avatar.unicode)
      : (this.identity.avatarLines ?? avatar.unicode);
    this.avatar.content = `${avatarLine(rows[0], this.glyphMode)}\n${avatarLine(rows[1], this.glyphMode)}`;
    const width = Math.max(1, this.widthValue - 11);
    const label = this.identity.label ?? this.identity.name ?? "";
    this.identityText.content = `${fitLine(label, width, this.glyphMode)}\n${fitLine(this.identity.detail ?? "", width, this.glyphMode)}`;
  }

  private navigationDisplay(item: SacredSidebarNavigationItem): string {
    const source = this.glyphMode === "ascii" ? (item.asciiLabel ?? item.label) : item.label;
    return fitLine(source, this.contentWidth() - 2, this.glyphMode);
  }

  private sessionDisplay(row: SacredSidebarSessionRow<T>): string {
    const source = this.glyphMode === "ascii" ? (row.asciiDisplay ?? row.display) : row.display;
    return fitLine(source, this.contentWidth() - 2, this.glyphMode);
  }

  private refreshNavigationOptions(): void {
    const selectedIndex = this.navigationSelect.getSelectedIndex();
    const marker = GLYPHS[this.glyphMode].selected;
    this.navigationSelect.options = this.navigationItems.length > 0
      ? this.navigationItems.map((item, index) => ({
          name: `${index === selectedIndex ? marker : " "} ${this.navigationDisplay(item)}`,
          description: "",
          value: index,
        }))
      : [{ name: `  ${fitLine(this.labels.emptyNavigation, this.contentWidth() - 2, this.glyphMode)}`, description: "", value: undefined }];
  }

  private refreshSessionOptions(): void {
    const selectedIndex = this.sessionSelect.getSelectedIndex();
    const marker = GLYPHS[this.glyphMode].selected;
    this.sessionSelect.options = this.sessionRows.length > 0
      ? this.sessionRows.map((row, index) => ({
          name: `${index === selectedIndex ? marker : " "} ${this.sessionDisplay(row)}`,
          description: "",
          value: index,
        }))
      : [{ name: `  ${fitLine(this.labels.emptySessions, this.contentWidth() - 2, this.glyphMode)}`, description: "", value: undefined }];
  }

  private selectedOptionIndex(select: SelectRenderable): number | null {
    const value = select.getSelectedOption()?.value;
    return typeof value === "number" && Number.isInteger(value) ? value : null;
  }

  private heading(label: string, focused: boolean): string {
    const glyphs = GLYPHS[this.glyphMode];
    const prefix = `${focused ? glyphs.focus : glyphs.idle} ${label} `;
    const available = Math.max(1, this.widthValue - 6);
    const clipped = fitLine(prefix, available, this.glyphMode);
    return `${clipped}${glyphs.rule.repeat(Math.max(0, available - sacredTextWidth(clipped)))}`;
  }

  private paintFocus(area: SacredSidebarFocusArea | null): void {
    if (this.destroyed) return;
    this.navigationHeading.content = this.heading(this.labels.navigation, area === "navigation");
    this.sessionsHeading.content = this.heading(this.labels.sessions, area === "sessions");
    this.activityHeading.content = this.heading(this.labels.recent, false);
    this.navigationHeading.fg = area === "navigation" ? this.colors.focus : this.colors.muted;
    this.sessionsHeading.fg = area === "sessions" ? this.colors.focus : this.colors.muted;
  }

  private handleKey(key: KeyEvent): void {
    if (this.destroyed || !this.visible || !this.focusedArea) return;
    const name = key.name.toLowerCase();
    const currentArea = this.focusedArea;
    if (name === "tab") {
      key.preventDefault();
      key.stopPropagation();
      if (!key.shift && currentArea === "navigation") this.focusSessions();
      else if (key.shift && currentArea === "sessions") this.focusNavigation();
      else {
        const direction = key.shift ? "backward" : "forward";
        if (this.options.onFocusEscape) this.options.onFocusEscape(direction);
        else if (direction === "forward") this.focusNavigation();
        else this.focusSessions();
      }
      return;
    }
    const moveToSessions = name === "right" && currentArea === "navigation";
    const moveToNavigation = name === "left" && currentArea === "sessions";
    if (!moveToSessions && !moveToNavigation) return;
    key.preventDefault();
    key.stopPropagation();
    if (moveToSessions) this.focusSessions();
    else this.focusNavigation();
  }

  private mouseIndex(area: SacredSidebarFocusArea, event: MouseEvent): number | null {
    const select = area === "navigation" ? this.navigationSelect : this.sessionSelect;
    const count = area === "navigation" ? this.navigationItems.length : this.sessionRows.length;
    if (count === 0) return null;
    const row = event.y - select.screenY;
    const visibleRows = Math.max(1, select.height);
    if (row < 0 || row >= visibleRows) return null;
    const selectedIndex = select.getSelectedIndex();
    const offset = Math.max(0, Math.min(selectedIndex - Math.floor(visibleRows / 2), count - visibleRows));
    const index = offset + row;
    return index >= 0 && index < count ? index : null;
  }

  private beginMouseSelection(area: SacredSidebarFocusArea, event: MouseEvent): void {
    if (event.button !== MouseButton.LEFT || this.destroyed) return;
    const index = this.mouseIndex(area, event);
    if (index === null) return;
    const select = area === "navigation" ? this.navigationSelect : this.sessionSelect;
    select.focus();
    select.setSelectedIndex(index);
    this.mouseSelection = { area, index };
    event.preventDefault();
    event.stopPropagation();
  }

  private endMouseSelection(area: SacredSidebarFocusArea, event: MouseEvent): void {
    if (event.button !== MouseButton.LEFT || this.destroyed) return;
    const index = this.mouseIndex(area, event);
    const pressed = this.mouseSelection;
    this.mouseSelection = null;
    if (!pressed || pressed.area !== area || pressed.index !== index) return;
    const select = area === "navigation" ? this.navigationSelect : this.sessionSelect;
    select.selectCurrent();
    event.preventDefault();
    event.stopPropagation();
  }

  private beginDrag(event: MouseEvent): void {
    if (event.button !== MouseButton.LEFT || this.destroyed) return;
    this.resizeHandle.focus();
    this.dragState = { originX: event.x, originWidth: this.widthValue };
    // OpenTUI 0.4.3 exposes drag callbacks but only captures after its first
    // drag frame. Capture on pointer-down so a fast move beyond the narrow
    // 2ch target still reports the complete requested width.
    (this.renderer as unknown as OpenTuiMouseCapture).setCapturedRenderable?.(this.resizeHandle);
    event.preventDefault();
    event.stopPropagation();
  }

  private drag(event: MouseEvent): void {
    if (!this.dragState || this.destroyed) return;
    this.requestWidth(this.dragState.originWidth + event.x - this.dragState.originX);
    event.preventDefault();
    event.stopPropagation();
  }

  private endDrag(event: MouseEvent): void {
    if (!this.dragState) return;
    this.dragState = null;
    event.preventDefault();
    event.stopPropagation();
  }

  private releaseMouseCapture(): void {
    (this.renderer as unknown as OpenTuiMouseCapture).setCapturedRenderable?.(undefined);
  }
}

export function createSacredSidebar<T>(renderer: CliRenderer, options: SacredSidebarOptions<T>): SacredSidebar<T> {
  return new SacredSidebar(renderer, options);
}
