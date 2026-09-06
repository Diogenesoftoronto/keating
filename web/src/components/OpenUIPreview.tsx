import { BookMarked, CircleHelp, ClipboardList, SlidersHorizontal, FileQuestion, Flag, GitFork, Image, Layers, ListChecks, Network, NotebookPen, Paperclip, Play } from "lucide-react";
import { css } from "../../styled-system/css";
import type { OpenUIPreviewArtifactKind, OpenUIPreviewBlock } from "../keating/openui/preview";
import { MarkdownBlock, type MarkdownHighlightRange } from "./MarkdownBlock";

const ARTIFACT_ICON: Record<OpenUIPreviewArtifactKind, typeof ListChecks> = {
	"study-plan": ListChecks,
	"concept-map": Network,
	question: CircleHelp,
	quiz: FileQuestion,
	deck: Layers,
	goal: Flag,
	notes: NotebookPen,
	image: Image,
	media: Play,
	artifact: Paperclip,
	handoff: GitFork,
	task: ClipboardList,
	simulation: SlidersHorizontal,
	unavailable: BookMarked,
};

const chipClass = css({
	display: "inline-flex",
	maxWidth: "100%",
	alignItems: "center",
	gap: "0.5rem",
	borderRadius: "0.5rem",
	border: "1px solid var(--border)",
	backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)",
	padding: "0.4375rem 0.625rem",
	fontSize: "0.8125rem",
	color: "var(--foreground)",
});

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
				const Icon = ARTIFACT_ICON[block.kind];
				return (
					<div key={block.id} className={chipClass} data-openui-preview={block.kind}>
						<Icon aria-hidden="true" size={14} className={css({ flexShrink: 0, color: "var(--muted-foreground)" })} />
						<span className={css({ fontWeight: 650, overflowWrap: "anywhere" })}>{block.label}</span>
						{block.detail ? (
							<span className={css({ color: "var(--muted-foreground)", overflowWrap: "anywhere" })}>· {block.detail}</span>
						) : null}
					</div>
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
