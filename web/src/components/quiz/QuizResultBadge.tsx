import { KeatingGlyph } from "../../design-system/glyphs";

export function QuizResultBadge({correct}: {correct: boolean}) {
	return <span className="lesson-verdict" data-result={correct ? "correct" : "wrong"}>
		<KeatingGlyph name={correct ? "check" : "x"} size={13}/>{correct ? "Correct" : "Not quite"}
	</span>;
}
