import {
  BoxRenderable,
  MarkdownRenderable,
  RGBA,
  TextRenderable,
  type ColorInput,
  type MarkdownTableOptions,
  type RenderContext,
  type SyntaxStyle,
} from "@opentui/core";

import type { TuiPresentationProfile } from "./terminal-profile.js";
import {
  KEATINGBOT_TERMINAL_AVATAR,
  avatarLinesForMode,
  type TerminalAvatar,
} from "./profile.js";
import {
  TRANSCRIPT_EMPTY_TEXT,
  prepareTerminalMarkdown,
  streamCaret,
  type TranscriptEntry,
  type TranscriptEntryKind,
} from "./view-model.js";

const AVATAR_WIDTH = 4;
const MESSAGE_CHROME_WIDTH = AVATAR_WIDTH + 3;

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

type SemanticColorRole = "text" | "mutedText" | "accent" | "success" | "warning" | "danger" | "info";

export interface SacredTranscriptColors {
  text?: ColorInput;
  user?: ColorInput;
  assistant?: ColorInput;
  tool?: ColorInput;
  artifact?: ColorInput;
  notice?: ColorInput;
  error?: ColorInput;
}

export interface SacredTranscriptIdentity {
  label: string;
  avatar: TerminalAvatar;
}

export interface SacredTranscriptOptions {
  id?: string;
  entries?: readonly TranscriptEntry[];
  streaming?: TranscriptEntry | null;
  profile: TuiPresentationProfile;
  width: number;
  syntaxStyle: SyntaxStyle;
  colors?: SacredTranscriptColors;
  tableOptions?: MarkdownTableOptions;
  emptyText?: string;
  userIdentity?: SacredTranscriptIdentity;
  assistantIdentity?: SacredTranscriptIdentity;
}

interface ReconciledEntry {
  entry: TranscriptEntry;
  streaming: boolean;
}

interface EntryLayer {
  kind: TranscriptEntryKind;
  root: BoxRenderable;
  frame: BoxRenderable;
  markdown: MarkdownRenderable;
  renderedBody: string;
  streaming: boolean;
  avatar?: TextRenderable;
}

const DEFAULT_USER_AVATAR: TerminalAvatar = {
  unicode: ["╭YO╮", "╰──╯"],
  ascii: ["[YO]", "[--]"],
};

function profileColor(profile: TuiPresentationProfile, role: SemanticColorRole): ColorInput {
  if (profile.design.colorMode === "none") return RGBA.defaultForeground();
  const token = profile.design.colors[role];
  if (!token) return RGBA.defaultForeground();
  if (profile.design.colorMode === "truecolor" && token.truecolor) return token.truecolor;
  const index = profile.design.colorMode === "ansi256" ? token.ansi256 : token.ansi16;
  return index === undefined ? RGBA.defaultForeground() : RGBA.fromIndex(index);
}

function resolvedColors(
  profile: TuiPresentationProfile,
  colors: SacredTranscriptColors = {},
): Required<SacredTranscriptColors> {
  return {
    text: colors.text ?? profileColor(profile, "text"),
    user: colors.user ?? profileColor(profile, "info"),
    assistant: colors.assistant ?? profileColor(profile, "accent"),
    tool: colors.tool ?? profileColor(profile, "warning"),
    artifact: colors.artifact ?? profileColor(profile, "success"),
    notice: colors.notice ?? profileColor(profile, "mutedText"),
    error: colors.error ?? profileColor(profile, "danger"),
  };
}

function cleanTitle(title: string): string {
  return title.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function quotedDetail(detail: string): string {
  return detail
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

function renderBody(
  entry: TranscriptEntry,
  streaming: boolean,
  profile: TuiPresentationProfile,
): string {
  const body = `${prepareTerminalMarkdown(entry.body)}${streaming ? streamCaret(profile) : ""}`;
  return entry.detail ? `${body}\n\n${quotedDetail(entry.detail)}` : body;
}

function avatarContent(identity: SacredTranscriptIdentity, profile: TuiPresentationProfile): string {
  const lines = avatarLinesForMode(identity.avatar, profile.design.glyphMode);
  return `${lines[0]}\n${lines[1]}`;
}

function tailContent(kind: "user" | "assistant", profile: TuiPresentationProfile): string {
  if (profile.design.glyphMode === "ascii") return kind === "user" ? "<" : ">";
  return kind === "user" ? "◀" : "▶";
}

function semanticColor(
  kind: TranscriptEntryKind,
  colors: Required<SacredTranscriptColors>,
): ColorInput {
  switch (kind) {
    case "user": return colors.user;
    case "assistant": return colors.assistant;
    case "tool": return colors.tool;
    case "artifact": return colors.artifact;
    case "notice": return colors.notice;
    case "error": return colors.error;
  }
}

function reconciledEntries(
  entries: readonly TranscriptEntry[],
  streaming: TranscriptEntry | null,
): ReconciledEntry[] {
  const combined: ReconciledEntry[] = entries.map((entry) => ({ entry, streaming: false }));
  if (!streaming) return combined;

  const completedIndex = combined.findIndex(({ entry }) => entry.id === streaming.id);
  if (completedIndex >= 0) combined[completedIndex] = { entry: streaming, streaming: true };
  else combined.push({ entry: streaming, streaming: true });
  return combined;
}

/**
 * Sacred-inspired transcript surface for OpenTUI.
 *
 * Completed rows are keyed by the model's stable TranscriptEntry.id. Reconcile
 * mutates only changed rows, which lets MarkdownRenderable retain parsed tables,
 * code blocks, and stable block state while the active response streams.
 */
export class SacredTranscriptRenderable extends BoxRenderable {
  readonly profile: TuiPresentationProfile;
  readonly syntaxStyle: SyntaxStyle;

  private readonly layers = new Map<string, EntryLayer>();
  private readonly empty: TextRenderable;
  private readonly palette: Required<SacredTranscriptColors>;
  private orderedIds: string[] = [];
  private contentWidth: number;
  private _tableOptions: MarkdownTableOptions;
  private readonly identities: Record<"user" | "assistant", SacredTranscriptIdentity>;

  constructor(ctx: RenderContext, options: SacredTranscriptOptions) {
    super(ctx, {
      id: options.id ?? "keating-sacred-transcript",
      width: "100%",
      flexDirection: "column",
      gap: 1,
    });

    this.profile = options.profile;
    this.syntaxStyle = options.syntaxStyle;
    this.palette = resolvedColors(options.profile, options.colors);
    this.identities = {
      user: options.userIdentity ?? { label: "You", avatar: DEFAULT_USER_AVATAR },
      assistant: options.assistantIdentity ?? { label: "Keating", avatar: KEATINGBOT_TERMINAL_AVATAR },
    };
    this.contentWidth = Math.max(20, Math.floor(options.width));
    this._tableOptions = {
      style: "columns",
      widthMode: "full",
      columnFitter: "proportional",
      wrapMode: "word",
      borders: false,
      ...options.tableOptions,
    };
    this.empty = new TextRenderable(ctx, {
      id: `${this.id}:empty`,
      content: options.emptyText ?? TRANSCRIPT_EMPTY_TEXT,
      fg: this.palette.notice,
      width: "100%",
      height: "auto",
    });
    this.add(this.empty);
    this.reconcile(options.entries ?? [], options.streaming ?? null);
  }

  /** Stable IDs in current visual order, useful for search/jump integrations. */
  get entryIds(): readonly string[] {
    return this.orderedIds;
  }

  get tableOptions(): MarkdownTableOptions {
    return this._tableOptions;
  }

  set tableOptions(options: MarkdownTableOptions) {
    this._tableOptions = { ...options };
    for (const layer of this.layers.values()) layer.markdown.tableOptions = this._tableOptions;
  }

  getEntryRenderable(id: string): BoxRenderable | undefined {
    return this.layers.get(id)?.root;
  }

  getEntryMarkdown(id: string): MarkdownRenderable | undefined {
    return this.layers.get(id)?.markdown;
  }

  /** Update message identity without rebuilding stable Markdown renderables. */
  setIdentity(kind: "user" | "assistant", identity: SacredTranscriptIdentity): void {
    this.identities[kind] = identity;
    for (const layer of this.layers.values()) {
      if (layer.kind !== kind) continue;
      layer.frame.title = this.messageTitle(kind);
      if (layer.avatar) layer.avatar.content = avatarContent(identity, this.profile);
    }
  }

  setViewportWidth(width: number): void {
    const nextWidth = Math.max(20, Math.floor(width));
    if (nextWidth === this.contentWidth) return;
    this.contentWidth = nextWidth;
    for (const layer of this.layers.values()) this.applyLayerWidth(layer);
  }

  update(
    entries: readonly TranscriptEntry[],
    streaming: TranscriptEntry | null = null,
    width = this.contentWidth,
  ): void {
    this.reconcile(entries, streaming, width);
  }

  reconcile(
    entries: readonly TranscriptEntry[],
    streaming: TranscriptEntry | null = null,
    width = this.contentWidth,
  ): void {
    this.setViewportWidth(width);
    const next = reconciledEntries(entries, streaming);
    const retained = new Set(next.map(({ entry }) => entry.id));

    for (const [id, layer] of this.layers) {
      if (retained.has(id)) continue;
      layer.root.destroyRecursively();
      this.layers.delete(id);
    }

    for (const item of next) {
      const prior = this.layers.get(item.entry.id);
      let layer = prior;
      if (layer && layer.kind !== item.entry.kind) {
        layer.root.destroyRecursively();
        this.layers.delete(item.entry.id);
        layer = undefined;
      }
      if (!layer) {
        layer = this.createLayer(item.entry, item.streaming);
        this.layers.set(item.entry.id, layer);
      } else {
        this.updateLayer(layer, item.entry, item.streaming);
      }
    }

    this.orderedIds = next.map(({ entry }) => entry.id);
    for (const [index, id] of this.orderedIds.entries()) {
      const root = this.layers.get(id)?.root;
      if (root && this.getChildren()[index] !== root) this.add(root, index);
    }
    this.empty.visible = next.length === 0;
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    for (const child of [...this.getChildren()]) {
      if (!child.isDestroyed) child.destroyRecursively();
    }
    this.layers.clear();
    this.orderedIds = [];
    super.destroy();
  }

  private createLayer(entry: TranscriptEntry, streaming: boolean): EntryLayer {
    return entry.kind === "user" || entry.kind === "assistant"
      ? this.createMessageLayer(entry, streaming)
      : this.createSemanticLayer(entry, streaming);
  }

  private createMarkdown(entry: TranscriptEntry, streaming: boolean, width: number): MarkdownRenderable {
    return new MarkdownRenderable(this.ctx, {
      id: `${this.id}:body:${entry.id}`,
      content: renderBody(entry, streaming, this.profile),
      syntaxStyle: this.syntaxStyle,
      fg: this.palette.text,
      width,
      height: "auto",
      conceal: true,
      concealCode: false,
      streaming,
      tableOptions: this._tableOptions,
    });
  }

  private createMessageLayer(entry: TranscriptEntry, streaming: boolean): EntryLayer {
    const kind = entry.kind as "user" | "assistant";
    const color = semanticColor(kind, this.palette);
    const identity = this.identities[kind];
    const root = new BoxRenderable(this.ctx, {
      id: `${this.id}:entry:${entry.id}`,
      width: "100%",
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: kind === "user" ? "flex-start" : "flex-end",
      gap: 0,
    });
    const frame = new BoxRenderable(this.ctx, {
      id: `${this.id}:message:${entry.id}`,
      width: this.messageWidth(),
      height: "auto",
      flexDirection: "column",
      border: true,
      borderStyle: "single",
      customBorderChars: this.profile.design.glyphMode === "ascii" ? ASCII_BORDER_CHARS : undefined,
      borderColor: color,
      titleColor: color,
      title: this.messageTitle(kind),
      titleAlignment: kind === "user" ? "left" : "right",
      paddingLeft: 1,
      paddingRight: 1,
      shouldFill: false,
    });
    const markdown = this.createMarkdown(entry, streaming, this.messageBodyWidth());
    frame.add(markdown);
    const avatar = new TextRenderable(this.ctx, {
      id: `${this.id}:avatar:${entry.id}`,
      content: avatarContent(identity, this.profile),
      fg: color,
      width: AVATAR_WIDTH,
      height: 2,
    });
    const tail = new TextRenderable(this.ctx, {
      id: `${this.id}:tail:${entry.id}`,
      content: tailContent(kind, this.profile),
      fg: color,
      width: 1,
      height: 1,
      marginBottom: 1,
    });
    if (kind === "user") {
      root.add(avatar);
      root.add(tail);
      root.add(frame);
    } else {
      root.add(frame);
      root.add(tail);
      root.add(avatar);
    }
    return {
      kind,
      root,
      frame,
      markdown,
      renderedBody: renderBody(entry, streaming, this.profile),
      streaming,
      avatar,
    };
  }

  private createSemanticLayer(entry: TranscriptEntry, streaming: boolean): EntryLayer {
    const color = semanticColor(entry.kind, this.palette);
    const root = new BoxRenderable(this.ctx, {
      id: `${this.id}:entry:${entry.id}`,
      width: "100%",
      flexDirection: "column",
    });
    const frame = new BoxRenderable(this.ctx, {
      id: `${this.id}:card:${entry.id}`,
      width: "100%",
      height: "auto",
      flexDirection: "column",
      border: entry.kind === "notice" ? ["top", "bottom"] : true,
      borderStyle: "single",
      customBorderChars: this.profile.design.glyphMode === "ascii" ? ASCII_BORDER_CHARS : undefined,
      borderColor: color,
      titleColor: color,
      title: `${this.profile.marks[entry.kind]} ${cleanTitle(entry.title)}`.trim(),
      titleAlignment: "left",
      paddingLeft: 2,
      paddingRight: 2,
      shouldFill: false,
    });
    const markdown = this.createMarkdown(entry, streaming, this.semanticBodyWidth(entry.kind));
    frame.add(markdown);
    root.add(frame);
    return {
      kind: entry.kind,
      root,
      frame,
      markdown,
      renderedBody: renderBody(entry, streaming, this.profile),
      streaming,
    };
  }

  private updateLayer(layer: EntryLayer, entry: TranscriptEntry, streaming: boolean): void {
    const title = entry.kind === "user" || entry.kind === "assistant"
      ? this.messageTitle(entry.kind)
      : `${this.profile.marks[entry.kind]} ${cleanTitle(entry.title)}`.trim();
    if (layer.frame.title !== title) layer.frame.title = title;

    if (streaming && !layer.markdown.streaming) layer.markdown.streaming = true;
    const renderedBody = renderBody(entry, streaming, this.profile);
    if (renderedBody !== layer.renderedBody) {
      layer.markdown.content = renderedBody;
      layer.renderedBody = renderedBody;
    }
    if (!streaming && layer.markdown.streaming) layer.markdown.streaming = false;
    layer.streaming = streaming;
  }

  private applyLayerWidth(layer: EntryLayer): void {
    if (layer.kind === "user" || layer.kind === "assistant") {
      layer.frame.width = this.messageWidth();
      layer.markdown.width = this.messageBodyWidth();
    } else {
      layer.markdown.width = this.semanticBodyWidth(layer.kind);
    }
  }

  private messageWidth(): number {
    return Math.max(13, this.contentWidth - MESSAGE_CHROME_WIDTH);
  }

  private messageBodyWidth(): number {
    return Math.max(8, this.messageWidth() - 4);
  }

  private semanticBodyWidth(kind: TranscriptEntryKind): number {
    return Math.max(8, this.contentWidth - (kind === "notice" ? 4 : 6));
  }

  private messageTitle(kind: "user" | "assistant"): string {
    return cleanTitle(this.identities[kind].label) || (kind === "user" ? "You" : "Keating");
  }
}

export function createSacredTranscript(
  ctx: RenderContext,
  options: SacredTranscriptOptions,
): SacredTranscriptRenderable {
  return new SacredTranscriptRenderable(ctx, options);
}
