import { Chip } from "../design-system/kit";
import { KeatingGlyph, type GlyphName } from "../design-system/glyphs";
import { css } from "../../styled-system/css";
import type { OpenUIPreviewArtifactKind, OpenUIPreviewBlock } from "../keating/openui/preview";
import { MarkdownBlock, type MarkdownHighlightRange } from "./MarkdownBlock";

const ARTIFACT_ICON: Record<OpenUIPreviewArtifactKind, GlyphName> = {
	"study-plan": "checklist",
	"concept-map": "tree",
	question: "help",
	quiz: "quiz",
	deck: "layers",
	goal: "flag",
	notes: "note",
	image: "image",
	media: "play",
	artifact: "clip",
	handoff: "fork",
	task: "checklist",
	simulation: "filter",
	coding: "code",
	music: "music",
	language: "globe",
	unavailable: "book",
};

/**
 * Render an assistant turn for a surface that judges it rather than uses it.
 * Prose reads in full; OpenUI artifacts appear as inert chips. See
 * `keating/openui/preview` for why these surfaces stay non-interactive.
 *
 * `highlights` are offsets into the original message text; each prose block is
 * given the subset that falls inside it, rebased to that block.
 */
export function OpenUIPreview({
	blocks,
	sourceMapped = false,
	highlights,
	onHighlightReveal,
	onHighlightConceal,
	onHighlightOpen,
}: {
	blocks: OpenUIPreviewBlock[];
	sourceMapped?: boolean;
	highlights?: MarkdownHighlightRange[];
	onHighlightReveal?: (ids: string[], rect: DOMRect) => void;
	onHighlightConceal?: () => void;
	onHighlightOpen?: (ids: string[], rect: DOMRect) => void;
}) {
	return (
		<div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem" })}>
			{blocks.map((block) => {
				if (block.type === "prose") {
					return (
						<MarkdownBlock
							key={block.id}
							content={block.markdown}
							sourceMapped={sourceMapped}
							highlights={blockHighlights(highlights, block.sourceStart, block.markdown.length)}
							onHighlightReveal={onHighlightReveal}
							onHighlightConceal={onHighlightConceal}
							onHighlightOpen={onHighlightOpen}
						/>
					);
				}
				const glyph = ARTIFACT_ICON[block.kind];
				return (
					<Chip key={block.id} data-openui-preview={block.kind}>
						<KeatingGlyph name={glyph} size={14} className={css({ flexShrink: 0, color: "var(--muted-foreground)" })} />
						<span className={css({ fontWeight: 650, overflowWrap: "anywhere" })}>{block.label}</span>
						{block.detail ? (
							<span className={css({ color: "var(--muted-foreground)", overflowWrap: "anywhere" })}>· {block.detail}</span>
						) : null}
					</Chip>
				);
			})}
		</div>
	);
}

/** Clip absolute highlight ranges to one prose block and rebase them onto it. */
function blockHighlights(
	highlights: MarkdownHighlightRange[] | undefined,
	sourceStart: number | undefined,
	length: number,
): MarkdownHighlightRange[] | undefined {
	if (!highlights?.length || sourceStart === undefined) return undefined;
	const end = sourceStart + length;
	return highlights.flatMap((highlight) => {
		const start = Math.max(highlight.start, sourceStart);
		const stop = Math.min(highlight.end, end);
		if (stop <= start) return [];
		return [{ ...highlight, start: start - sourceStart, end: stop - sourceStart }];
	});
}
