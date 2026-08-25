import { useEffect, useRef, type RefObject } from "react";
import { css } from "../../../styled-system/css";
import { AnnotationEditor, type AnnotationEditorProps } from "./AnnotationEditor";
import { FloatingSurface } from "./FloatingSurface";

/**
 * The editor, anchored to the text it is about.
 *
 * Writing a note used to mean leaving the sentence behind and working in a side
 * panel. Anchoring the form to the span keeps the evidence and the judgement on
 * screen together, which is the whole reason the note exists.
 *
 * Below the `md` breakpoint this does not render at all — the mobile workspace keeps
 * its Margin tab, where a full-width form is the better shape anyway.
 */

export interface AnnotationPopoverProps extends AnnotationEditorProps {
	anchorRect: DOMRect | null;
	hostRef: RefObject<HTMLElement | null>;
}

export function AnnotationPopover({ anchorRect, hostRef, onCancel, ...editorProps }: AnnotationPopoverProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);

	// Escape closes the editor before anything else on the page reacts to it: the
	// popover is the innermost layer, so it is the first one Escape should pop.
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			onCancel();
		}
		const node = containerRef.current;
		node?.addEventListener("keydown", onKeyDown);
		return () => node?.removeEventListener("keydown", onKeyDown);
	}, [onCancel]);

	if (!anchorRect) return null;

	return (
		<div ref={containerRef} className={css({ display: "none", md: { display: "block" } })}>
			<FloatingSurface anchorRect={anchorRect} hostRef={hostRef} preferred="below" label="Annotation editor">
				<div className={css({ width: "24rem", maxWidth: "88vw", maxHeight: "26rem", overflowY: "auto", padding: "0.75rem" })}>
					<AnnotationEditor {...editorProps} onCancel={onCancel} autoFocus />
				</div>
			</FloatingSurface>
		</div>
	);
}

export default AnnotationPopover;
