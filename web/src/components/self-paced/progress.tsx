import { KeatingGlyph, type GlyphName } from "../../design-system/glyphs";
import { EVIDENCE_KINDS, EVIDENCE_LABELS, type CourseSummary, type ActivityState } from "../../keating/self-paced/contract";

const glyphs = {
	done: "check",
	available: "chevr",
	skipped: "minus",
	waiting: "clock",
	locked: "lock",
} satisfies Record<ActivityState, GlyphName>;

export function activityGlyph(state: ActivityState): GlyphName {
	return glyphs[state];
}

export function EvidenceCounts({ evidence }: { evidence: CourseSummary["evidence"] }) {
	return <>
		<div className="sp-counts">
			<span><KeatingGlyph name="check" size={14} /> Without help <b>{evidence.independent + evidence.recall + evidence.transfer}</b></span>
			<span><KeatingGlyph name="minus" size={14} /> With help <b>{evidence.assisted}</b></span>
		</div>
		<details><summary>Evidence by kind</summary><dl>{EVIDENCE_KINDS.map(kind => <div key={kind}><dt>{EVIDENCE_LABELS[kind]}</dt><dd>{evidence[kind]}</dd></div>)}</dl></details>
	</>;
}
