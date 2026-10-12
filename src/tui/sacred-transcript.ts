import {
  BoxRenderable,
  MarkdownRenderable,
  RGBA,
  TextAttributes,
  TextRenderable,
  dim,
  fg,
  t,
  type ColorInput,
  type MarkdownTableOptions,
  type RenderContext,
  type StyledText,
  type SyntaxStyle,
} from "@opentui/core";

import { keatingDesignContract } from "./design-contract.js";
import type { TuiPresentationProfile } from "./terminal-profile.js";
import {
  TRANSCRIPT_EMPTY_TEXT,
  prepareTerminalMarkdown,
  streamCaret,
  type TranscriptEntry,
  type TranscriptEntryKind,
} from "./view-model.js";

/** Notices up to this length sit on their title's line instead of below it. */
const INLINE_NOTICE_LIMIT = 96;

type SemanticColorRole = "text" | "mutedText" | "accent" | "success" | "warning" | "danger" | "info";

export interface SacredTranscriptColors {
  text?: ColorInput;
  muted?: ColorInput;
  user?: ColorInput;
  /** Band behind the learner's own words; omitted outside truecolor. */
  userSurface?: ColorInput | null;
  assistant?: ColorInput;
  tool?: ColorInput;
  artifact?: ColorInput;
  notice?: ColorInput;
  error?: ColorInput;
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
}

interface ReconciledEntry {
  entry: TranscriptEntry;
  streaming: boolean;
}

/**
 * "line": a single dim row (tool calls, short notices).
 * "prose": glyph + Markdown body (learner and tutor turns).
 * "section": glyph + bold title + Markdown body (artifacts, errors, long notices).
 */
type EntryShape = "line" | "prose" | "section";

interface EntryLayer {
  kind: TranscriptEntryKind;
  shape: EntryShape;
  root: BoxRenderable;
  gutter: TextRenderable;
  body: BoxRenderable;
  title?: TextRenderable;
  line?: TextRenderable;
  /** Dim diagnostic under a one-line entry, e.g. why a tool call failed. */
  detail?: TextRenderable;
  markdown?: MarkdownRenderable;
  renderedBody: string;
  streaming: boolean;
}

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
  const muted = colors.muted ?? profileColor(profile, "mutedText");
  return {
    text: colors.text ?? profileColor(profile, "text"),
    muted,
    user: colors.user ?? profileColor(profile, "info"),
    userSurface: colors.userSurface !== undefined
      ? colors.userSurface
      : profile.design.colorMode === "truecolor"
        ? keatingDesignContract.themes[profile.theme].colors.surfaceRaised
        : null,
    assistant: colors.assistant ?? profileColor(profile, "accent"),
    // Tool calls are routine; they recede instead of competing with the lesson.
    tool: colors.tool ?? muted,
    artifact: colors.artifact ?? profileColor(profile, "success"),
    notice: colors.notice ?? muted,
    error: colors.error ?? profileColor(profile, "danger"),
  };
}

/** The margin column that carries every entry's role: the widest mark plus one space. */
function gutterWidth(profile: TuiPresentationProfile): number {
  return Math.max(...Object.values(profile.marks).map((mark) => [...mark].length)) + 1;
}

function cleanTitle(title: string): string {
  return title.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanDetail(detail: string | undefined): string {
  return (detail ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").trim();
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

function nonEmptyLines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

function isInlineNotice(entry: TranscriptEntry): boolean {
  const lines = nonEmptyLines(entry.body);
  return !entry.detail && lines.length <= 1 && (lines[0]?.length ?? 0) <= INLINE_NOTICE_LIMIT;
}

function entryShape(entry: TranscriptEntry): EntryShape {
  if (entry.kind === "user" || entry.kind === "assistant") return "prose";
  if (entry.kind === "tool") return "line";
  if (entry.kind === "notice" && isInlineNotice(entry)) return "line";
  return "section";
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
 * Terminal transcript for OpenTUI.
 *
 * Every entry is a margin glyph plus a hanging-indented body: the glyph carries
 * the role (learner, tutor, tool, artifact, notice, error), whitespace carries
 * the grouping, and no entry draws a box. Tool activity collapses to one dim
 * line so the lesson itself keeps the reader's attention.
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
  private readonly gutter: number;
  private orderedIds: string[] = [];
  private contentWidth: number;
  private _tableOptions: MarkdownTableOptions;

  constructor(ctx: RenderContext, options: SacredTranscriptOptions) {
    super(ctx, {
      id: options.id ?? "keating-sacred-transcript",
      width: "100%",
      flexDirection: "column",
      gap: 0,
    });
    this.profile = options.profile;
    this.syntaxStyle = options.syntaxStyle;
    this.palette = resolvedColors(options.profile, options.colors);
    this.gutter = gutterWidth(options.profile);
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
    for (const layer of this.layers.values()) {
      if (layer.markdown) layer.markdown.tableOptions = this._tableOptions;
    }
  }

  getEntryRenderable(id: string): BoxRenderable | undefined {
    return this.layers.get(id)?.root;
  }

  getEntryMarkdown(id: string): MarkdownRenderable | undefined {
    return this.layers.get(id)?.markdown;
  }

  setViewportWidth(width: number): void {
    const nextWidth = Math.max(20, Math.floor(width));
    if (nextWidth === this.contentWidth) return;
    this.contentWidth = nextWidth;
    for (const [id, layer] of this.layers) this.applyLayerWidth(id, layer);
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
      let layer = this.layers.get(item.entry.id);
      if (layer && (layer.kind !== item.entry.kind || layer.shape !== entryShape(item.entry))) {
        layer.root.destroyRecursively();
        this.layers.delete(item.entry.id);
        layer = undefined;
      }
      if (!layer) {
        layer = this.createLayer(item.entry, item.streaming);
        this.layers.set(item.entry.id, layer);
      } else {
        this.updateLayer(item.entry.id, layer, item.entry, item.streaming);
      }
    }

    this.orderedIds = next.map(({ entry }) => entry.id);
    let previous: EntryLayer | undefined;
    for (const [index, id] of this.orderedIds.entries()) {
      const layer = this.layers.get(id);
      if (!layer) continue;
      if (this.getChildren()[index] !== layer.root) this.add(layer.root, index);
      // Runs of one-line activity stay together; everything else breathes.
      const spacing = !previous || (previous.shape === "line" && layer.shape === "line") ? 0 : 1;
      if (layer.root.marginTop !== spacing) layer.root.marginTop = spacing;
      previous = layer;
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
    const shape = entryShape(entry);
    const color = semanticColor(entry.kind, this.palette);
    const userBand = entry.kind === "user" ? this.palette.userSurface : null;
    const root = new BoxRenderable(this.ctx, {
      id: `${this.id}:entry:${entry.id}`,
      width: "100%",
      flexDirection: "row",
      ...(userBand ? { backgroundColor: userBand } : {}),
    });
    const gutter = new TextRenderable(this.ctx, {
      id: `${this.id}:mark:${entry.id}`,
      content: this.profile.marks[entry.kind],
      fg: color,
      attributes: entry.kind === "user" || entry.kind === "assistant" ? TextAttributes.BOLD : TextAttributes.NONE,
      width: this.gutter,
      height: 1,
      flexShrink: 0,
    });
    const body = new BoxRenderable(this.ctx, {
      id: `${this.id}:body-column:${entry.id}`,
      width: this.bodyWidth(entry.kind),
      flexDirection: "column",
    });
    root.add(gutter);
    root.add(body);

    const layer: EntryLayer = { kind: entry.kind, shape, root, gutter, body, renderedBody: "", streaming };
    if (shape === "line") {
      layer.line = new TextRenderable(this.ctx, {
        id: `${this.id}:line:${entry.id}`,
        content: this.lineContent(entry),
        width: "100%",
        wrapMode: entry.kind === "tool" ? "none" : "word",
      });
      body.add(layer.line);
      layer.detail = new TextRenderable(this.ctx, {
        id: `${this.id}:detail:${entry.id}`,
        content: cleanDetail(entry.detail),
        fg: this.palette.muted,
        attributes: TextAttributes.DIM,
        width: "100%",
        wrapMode: "word",
        visible: !!entry.detail,
      });
      body.add(layer.detail);
    } else {
      if (shape === "section") {
        layer.title = new TextRenderable(this.ctx, {
          id: `${this.id}:title:${entry.id}`,
          content: cleanTitle(entry.title),
          fg: color,
          attributes: TextAttributes.BOLD,
          width: "100%",
          wrapMode: "word",
        });
        body.add(layer.title);
      }
      layer.renderedBody = renderBody(entry, streaming, this.profile);
      layer.markdown = new MarkdownRenderable(this.ctx, {
        id: `${this.id}:body:${entry.id}`,
        content: layer.renderedBody,
        syntaxStyle: this.syntaxStyle,
        fg: this.palette.text,
        width: "100%",
        height: "auto",
        conceal: true,
        concealCode: false,
        streaming,
        tableOptions: this._tableOptions,
      });
      body.add(layer.markdown);
    }
    return layer;
  }

  private updateLayer(id: string, layer: EntryLayer, entry: TranscriptEntry, streaming: boolean): void {
    if (layer.line) {
      layer.line.content = this.lineContent(entry);
      if (layer.detail) {
        layer.detail.content = cleanDetail(entry.detail);
        layer.detail.visible = !!entry.detail;
      }
      return;
    }
    if (layer.title) {
      const title = cleanTitle(entry.title);
      if (layer.title.plainText !== title) layer.title.content = title;
    }
    if (!layer.markdown) return;
    if (streaming && !layer.markdown.streaming) layer.markdown.streaming = true;
    const renderedBody = renderBody(entry, streaming, this.profile);
    if (renderedBody !== layer.renderedBody) {
      layer.markdown.content = renderedBody;
      layer.renderedBody = renderedBody;
    }
    if (!streaming && layer.markdown.streaming) layer.markdown.streaming = false;
    layer.streaming = streaming;
    this.applyLayerWidth(id, layer);
  }

  /**
   * One-row entries: a tool call reads "read  path=notes.md", a tool result
   * reads "read completed  first line (+12 lines)", and a short notice keeps
   * its title and message on the same line.
   */
  private lineContent(entry: TranscriptEntry): StyledText {
    const color = semanticColor(entry.kind, this.palette);
    const title = cleanTitle(entry.title);
    const lines = nonEmptyLines(entry.body.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " "));
    if (entry.kind !== "tool") {
      return lines[0] ? t`${fg(color)(title)}  ${dim(fg(this.palette.muted)(lines[0]))}` : t`${fg(color)(title)}`;
    }
    const room = Math.max(0, this.bodyWidth(entry.kind) - [...title].length - 2);
    const more = lines.length > 1 ? ` (+${lines.length - 1} lines)` : "";
    const first = lines[0] ?? "";
    const glyphs = [...first];
    const summaryRoom = Math.max(0, room - more.length);
    const summary = glyphs.length <= summaryRoom
      ? first
      : `${glyphs.slice(0, Math.max(0, summaryRoom - 1)).join("")}…`;
    return summary || more
      ? t`${fg(color)(title)}  ${dim(fg(this.palette.muted)(`${summary}${more}`))}`
      : t`${fg(color)(title)}`;
  }

  private applyLayerWidth(_id: string, layer: EntryLayer): void {
    const width = this.bodyWidth(layer.kind);
    if (layer.body.width !== width) layer.body.width = width;
  }

  private bodyWidth(kind: TranscriptEntryKind): number {
    // The learner band keeps one column of air on its right edge.
    return Math.max(8, this.contentWidth - this.gutter - (kind === "user" ? 1 : 0));
  }
}

export function createSacredTranscript(
  ctx: RenderContext,
  options: SacredTranscriptOptions,
): SacredTranscriptRenderable {
  return new SacredTranscriptRenderable(ctx, options);
}
