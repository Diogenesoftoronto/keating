import { motion } from "motion/react";
import { SPRING, useMotionAllowed } from "../../design-system/motion";
import type { AnnotationKind } from "../../keating/trajectory-review";
import { Kbd } from "../../design-system/kit";
import { KeatingGlyph } from "../../design-system/glyphs";
import { annotationKindLabel } from "./review-vocabulary";

export interface SelectionToolbarProps {
	onPick: (kind: AnnotationKind) => void;
	onRewrite: () => void;
	/** Reports a press on the toolbar, while a touch may already have cleared the selection. */
	onPressChange?: (pressing: boolean) => void;
}

const kinds: readonly AnnotationKind[] = ["problem", "strength", "suggestion"];

export function SelectionToolbar({ onPick, onRewrite, onPressChange }: SelectionToolbarProps) {
	const allowed = useMotionAllowed();
	return (
		<motion.div initial={allowed ? { scale: .94, y: 4 } : false} animate={{ scale: 1, y: 0 }} transition={allowed ? SPRING : { duration: 0 }} className="rv-page-selection" onMouseDown={event => event.preventDefault()}
			onPointerDown={() => onPressChange?.(true)} onPointerUp={() => onPressChange?.(false)} onPointerCancel={() => onPressChange?.(false)}>
			{kinds.map((kind, index) => (
				<button key={kind} type="button" onClick={() => onPick(kind)}>
					<i aria-hidden="true" className="rv-kind" data-kind={kind} />
					{annotationKindLabel(kind)} <Kbd>{index + 1}</Kbd>
				</button>
			))}
			<button type="button" onClick={onRewrite}><KeatingGlyph name="refresh" /> Rewrite <Kbd>R</Kbd></button>
		</motion.div>
	);
}

export default SelectionToolbar;
