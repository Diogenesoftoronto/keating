import { Chip } from "../../design-system/kit";
import { KeatingGlyph } from "../../design-system/glyphs";
import { useNextQuestionSuggestion } from "../../keating/judgement/next-question-suggestions";

/** "Next question →" under a reply released as feedback only; one tap asks for it. */
export function NextQuestionChip({ sessionId, timestamps, running, onNext }: {
	sessionId: string | null | undefined;
	/** The latest assistant row's receipt timestamps; empty when the latest row is not the tutor's. */
	timestamps: readonly number[];
	running: boolean;
	onNext?: () => void;
}) {
	const suggested = useNextQuestionSuggestion(sessionId, timestamps);
	if (!suggested || running || !onNext) return null;
	return <Chip as="button" data-next-question="" onClick={onNext}>Next question <KeatingGlyph name="right" size={11} /></Chip>;
}
