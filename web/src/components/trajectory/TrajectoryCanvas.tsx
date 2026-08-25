import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
	type RefObject,
} from "react";
import {
	artifactVersionKey,
	createTextAnchor,
	reanchorText,
	type TrajectoryAnnotation,
	type TrajectoryReviewTarget,
} from "../../keating/trajectory-review";
import { css, cx } from "../../../styled-system/css";
import { KeatingIcon } from "../KeatingIcon";
import { reviewIcon } from "./review-icons";
import { containedMediaRect, normalizedContainedMediaPoint, type MediaSize } from "./media-geometry";
import { AnnotationHoverCard } from "./AnnotationHoverCard";
import { SelectionToolbar } from "./SelectionToolbar";
import { FloatingSurface } from "./FloatingSurface";
import { AnnotationPopover } from "./AnnotationPopover";
import { annotationKindColor } from "./review-vocabulary";
import { compactButtonClass, inputClass, metaTextClass, primaryButtonClass } from "./styles";
import type {
	ArtifactRenderer,
	NormalizedArtifactMedia,
	NormalizedTrajectoryArtifact,
	TrajectoryAnnotationDraft,
	TrajectorySessionMessage,
	TrajectoryTextSelection,
} from "./types";

export type TrajectoryCanvasMode = "transcript" | "artifact";

export interface TrajectoryCanvasProps {
	messages: TrajectorySessionMessage[];
	artifacts: NormalizedTrajectoryArtifact[];
	annotations: TrajectoryAnnotation[];
	activeMessageId?: string;
	activeArtifactId?: string;
	activeAnnotationId?: string;
	mode: TrajectoryCanvasMode;
	onModeChange: (mode: TrajectoryCanvasMode) => void;
	onSelectMessage: (messageId: string) => void;
	onSelectArtifact: (artifactId: string) => void;
	onSelectAnnotation?: (annotationId: string) => void;
	onTextSelection?: (selection: TrajectoryTextSelection) => void;
	onStartAnnotation?: (target: TrajectoryReviewTarget) => void;
	/** Hovercard delete. Absent on the read-only shared workspace. */
	onDeleteAnnotation?: (annotationId: string) => void;
	/**
	 * The open draft, so the editor can be anchored to the text it is about. When
	 * omitted — or when the draft has no anchor to attach to — the desk shows the
	 * editor instead.
	 */
	annotationDraft?: TrajectoryAnnotationDraft | null;
	onAnnotationDraftChange?: (draft: TrajectoryAnnotationDraft) => void;
	onSaveAnnotation?: (draft: TrajectoryAnnotationDraft) => void;
	onCancelAnnotation?: () => void;
	onExpandAnnotation?: () => void;
	isSavingAnnotation?: boolean;
	isExpandingAnnotation?: boolean;
	/** Reports whether the canvas currently holds the editor, so the desk can yield. */
	onDraftAnchoredChange?: (anchored: boolean) => void;
	readOnly?: boolean;
	/**
	 * "single" shows the active turn alone — right for reviewing, where judging a
	 * response means isolating it. "continuous" scrolls the whole conversation —
	 * right for reading a shared session, where the point is what happened.
	 */
	transcript?: "single" | "continuous";
	renderArtifact?: ArtifactRenderer;
	className?: string;
}

interface TextRange {
	start: number;
	end: number;
	text: string;
}

function readSelection(container: HTMLElement): TextRange | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
	const range = selection.getRangeAt(0);
	if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
	const before = range.cloneRange();
	before.selectNodeContents(container);
	before.setEnd(range.startContainer, range.startOffset);
	const start = before.toString().length;
	const text = range.toString();
	if (!text.trim()) return null;
	return { start, end: start + text.length, text };
}

function annotationsForMessage(annotations: TrajectoryAnnotation[], messageId: string): TrajectoryAnnotation[] {
	return annotations.filter((annotation) =>
		(annotation.target.kind === "message" || annotation.target.kind === "message-span")
		&& annotation.target.messageId === messageId,
	);
}

function annotationsForArtifact(
	annotations: TrajectoryAnnotation[],
	artifact: NormalizedTrajectoryArtifact,
): TrajectoryAnnotation[] {
	const key = artifactVersionKey(artifact.reference);
	return annotations.filter((annotation) => {
		const target = annotation.target;
		return target.kind.startsWith("artifact") && "artifact" in target
			&& artifactVersionKey(target.artifact) === key;
	});
}

/** How a marked span talks to the layered surfaces around it. */
interface MarkHandlers {
	/** Hover or focus: open the reading layer. */
	onReveal?: (annotationIds: string[], rect: DOMRect) => void;
	onConceal?: () => void;
	/** Click: commit to the editing layer. */
	onOpen?: (annotationIds: string[], rect: DOMRect) => void;
}

function annotatedText(
	text: string,
	annotations: TrajectoryAnnotation[],
	activeAnnotationId: string | undefined,
	handlers: MarkHandlers,
): ReactNode[] {
	const ranges = annotations.flatMap((annotation) => {
		if (annotation.target.kind !== "message-span" && annotation.target.kind !== "artifact-span") return [];
		const anchored = reanchorText(text, annotation.target.anchor);
		if (anchored.status === "stale" || anchored.end <= anchored.start) return [];
		return [{ annotation, start: anchored.start, end: anchored.end }];
	});
	if (ranges.length === 0) return [text];
	const boundaries = Array.from(new Set([0, text.length, ...ranges.flatMap((range) => [range.start, range.end])]))
		.filter((point) => point >= 0 && point <= text.length)
		.sort((left, right) => left - right);
	return boundaries.slice(0, -1).map((start, index) => {
		const end = boundaries[index + 1];
		const covering = ranges.filter((range) => range.start <= start && range.end >= end);
		const content = text.slice(start, end);
		if (covering.length === 0) return <span key={`${start}-${end}`}>{content}</span>;
		const primary = covering.find((range) => range.annotation.kind === "problem") ?? covering[0];
		const selected = covering.some((range) => range.annotation.id === activeAnnotationId);
		const ids = covering.map((range) => range.annotation.id);
		const tone = annotationKindColor(primary.annotation.kind);
		return (
			<mark
				key={`${start}-${end}`}
				// Marks are focusable so the hovercard is reachable without a pointer:
				// this surface is pointer-first, not pointer-only.
				tabIndex={0}
				role="button"
				aria-label={`${covering.length} note${covering.length === 1 ? "" : "s"} on “${content}”`}
				data-annotation-mark={primary.annotation.id}
				className={css({
					// At rest a mark is an underline, not a highlight — the page has to stay
					// readable with dozens of them on it.
					borderBottom: "1.5px solid",
					borderBottomStyle: primary.annotation.revision ? "dashed" : "solid",
					background: selected ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent",
					color: "inherit",
					cursor: "pointer",
					transitionProperty: "background-color",
					transitionDuration: "120ms",
					_motionReduce: { transitionDuration: "0ms" },
					_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
				})}
				style={{ borderBottomColor: tone }}
				onMouseEnter={(event) => handlers.onReveal?.(ids, event.currentTarget.getBoundingClientRect())}
				onFocus={(event) => handlers.onReveal?.(ids, event.currentTarget.getBoundingClientRect())}
				onMouseLeave={() => handlers.onConceal?.()}
				onBlur={() => handlers.onConceal?.()}
				onClick={(event) => handlers.onOpen?.(ids, event.currentTarget.getBoundingClientRect())}
				onKeyDown={(event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					handlers.onOpen?.(ids, event.currentTarget.getBoundingClientRect());
				}}
			>
				{content}
			</mark>
		);
	});
}

/**
 * Dots down the left edge of the text, one per marked span, aligned to the line the
 * span sits on.
 *
 * The gutter is the resting-state view of a review: with the desk collapsed, this is
 * how a teacher sees at a glance where the problems cluster without any panel open.
 * Positions are measured from the rendered marks rather than computed from offsets,
 * because only the browser knows where a span wrapped.
 */
function MarginGutter({
	textRef,
	annotations,
	activeAnnotationId,
	onReveal,
	onConceal,
	onOpen,
}: {
	textRef: RefObject<HTMLDivElement | null>;
	annotations: TrajectoryAnnotation[];
	activeAnnotationId?: string;
	onReveal?: (annotationIds: string[], rect: DOMRect) => void;
	onConceal?: () => void;
	onOpen?: (annotationIds: string[], rect: DOMRect) => void;
}) {
	const [dots, setDots] = useState<Array<{ id: string; top: number }>>([]);

	useEffect(() => {
		const container = textRef.current;
		if (!container) return;
		function measure() {
			const host = textRef.current;
			if (!host) return;
			const hostTop = host.getBoundingClientRect().top;
			const marks = Array.from(host.querySelectorAll<HTMLElement>("[data-annotation-mark]"));
			const seen = new Set<string>();
			const next: Array<{ id: string; top: number }> = [];
			for (const mark of marks) {
				const id = mark.dataset.annotationMark;
				if (!id || seen.has(id)) continue;
				seen.add(id);
				next.push({ id, top: mark.getBoundingClientRect().top - hostTop });
			}
			setDots(next);
		}
		measure();
		// Wrapping changes with the container, so the dots have to be re-measured
		// whenever the reading measure does.
		const observer = new ResizeObserver(measure);
		observer.observe(container);
		return () => observer.disconnect();
	}, [textRef, annotations]);

	if (dots.length === 0) return null;

	return (
		<div aria-hidden={false} className={css({ position: "absolute", top: 0, bottom: 0, left: 0, width: "1rem" })}>
			{dots.map((dot) => {
				const annotation = annotations.find((entry) => entry.id === dot.id);
				if (!annotation) return null;
				const tone = annotationKindColor(annotation.kind);
				return (
					<button
						key={dot.id}
						type="button"
						aria-label={`${annotation.kind} note: ${annotation.note.slice(0, 60)}`}
						aria-current={annotation.id === activeAnnotationId ? "true" : undefined}
						className={css({
							position: "absolute",
							left: 0,
							display: "grid",
							width: "0.85rem",
							height: "0.85rem",
							placeItems: "center",
							borderRadius: "9999px",
							border: "1.5px solid var(--border)",
							background: "var(--background)",
							_hover: { borderColor: "var(--ink)" },
							_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
						})}
						style={{ top: `${dot.top + 3}px` }}
						onMouseEnter={(event) => onReveal?.([dot.id], event.currentTarget.getBoundingClientRect())}
						onFocus={(event) => onReveal?.([dot.id], event.currentTarget.getBoundingClientRect())}
						onMouseLeave={() => onConceal?.()}
						onBlur={() => onConceal?.()}
						onClick={(event) => onOpen?.([dot.id], event.currentTarget.getBoundingClientRect())}
					>
						<span
							aria-hidden="true"
							className={css({ width: "0.4rem", height: "0.4rem", borderRadius: "9999px" })}
							style={{ background: tone }}
						/>
					</button>
				);
			})}
		</div>
	);
}

/**
 * One turn, with its margin and its marks.
 *
 * Shared by both transcript modes: the reviewer reads a single turn at a time, since
 * judging a response means isolating it; a shared-link reader scrolls all of them,
 * since understanding a session means seeing the conversation. Same turn either way.
 */
function TranscriptTurn({
	message,
	annotations,
	activeAnnotationId,
	handlers,
	readOnly,
	onStartAnnotation,
	onCaptureSelection,
	conversational = false,
}: {
	message: TrajectorySessionMessage;
	annotations: TrajectoryAnnotation[];
	activeAnnotationId?: string;
	handlers: MarkHandlers;
	readOnly: boolean;
	onStartAnnotation?: (target: TrajectoryReviewTarget) => void;
	onCaptureSelection?: (container: HTMLElement, message: TrajectorySessionMessage) => void;
	/** Renders as a chat turn rather than a reviewed document. */
	conversational?: boolean;
}) {
	const textRef = useRef<HTMLDivElement | null>(null);
	const learner = message.role === "user";
	const roleLabel = message.label ?? (message.role === "assistant" ? "Tutor response" : learner ? "Learner message" : message.role);

	return (
		<article
			className={css({
				width: "100%",
				maxWidth: "44rem",
				marginInline: "auto",
				padding: { base: "1rem", md: "1.5rem" },
			})}
			style={conversational ? { paddingBlock: "0.85rem" } : undefined}
		>
			<header
				className={css({
					display: "flex",
					flexWrap: "wrap",
					alignItems: "baseline",
					justifyContent: "space-between",
					gap: "0.5rem",
					paddingBottom: "0.625rem",
				})}
				style={conversational ? undefined : { borderBottom: "1px solid var(--border)" }}
			>
				<div>
					<h2
						className={css({ fontSize: "0.875rem", fontWeight: 700, color: "var(--foreground)" })}
						style={conversational && learner ? { color: "var(--muted-foreground)" } : undefined}
					>
						{roleLabel}
					</h2>
					<div className={cx(metaTextClass, css({ marginTop: "0.125rem" }))}>
						Turn {message.ordinal + 1}{message.model ? ` · ${message.model}` : ""}
					</div>
				</div>
				{readOnly || !onStartAnnotation ? null : (
					<button
						type="button"
						className={css({ borderRadius: "0.375rem", padding: "0.375rem 0.5rem", fontSize: "0.6875rem", fontWeight: 650, color: "var(--muted-foreground)", _hover: { background: "var(--accent)", color: "var(--accent-foreground)" }, _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" } })}
						onClick={() => onStartAnnotation({ kind: "message", messageId: message.id, role: message.role, messageTimestamp: message.timestamp, contentFingerprint: message.contentFingerprint })}
					>
						Annotate turn
					</button>
				)}
			</header>
			<div className={css({ position: "relative", marginTop: "1rem", paddingLeft: "1.5rem" })}>
				<MarginGutter
					textRef={textRef}
					annotations={annotations}
					activeAnnotationId={activeAnnotationId}
					onReveal={handlers.onReveal}
					onConceal={handlers.onConceal}
					onOpen={handlers.onOpen}
				/>
				<div
					ref={textRef}
					data-message-text={message.id}
					className={css({ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.9375rem", lineHeight: 1.72, color: "var(--foreground)", _selection: { background: "color-mix(in srgb, var(--accent) 65%, transparent)" } })}
					style={conversational && learner ? { color: "var(--muted-foreground)" } : undefined}
					onMouseUp={readOnly || !onCaptureSelection ? undefined : (event) => onCaptureSelection(event.currentTarget, message)}
					onKeyUp={readOnly || !onCaptureSelection ? undefined : (event) => onCaptureSelection(event.currentTarget, message)}
				>
					{annotatedText(message.text, annotations, activeAnnotationId, handlers)}
				</div>
			</div>
		</article>
	);
}

function annotationLocation(annotation: TrajectoryAnnotation): string {
	const target = annotation.target;
	if (target.kind === "message-span" || target.kind === "artifact-span") return `“${target.anchor.quote}”`;
	if (target.kind === "artifact-region") {
		return `${Math.round(target.x * 100)}%, ${Math.round(target.y * 100)}% · ${Math.round(target.width * 100)} × ${Math.round(target.height * 100)}%`;
	}
	if (target.kind === "artifact-time-range") {
		return `${(target.startMs / 1_000).toFixed(1)}s to ${(target.endMs / 1_000).toFixed(1)}s`;
	}
	return target.kind.replaceAll("-", " ");
}

function AnnotationStrip({
	annotations,
	activeAnnotationId,
	onSelect,
}: {
	annotations: TrajectoryAnnotation[];
	activeAnnotationId?: string;
	onSelect?: (annotationId: string) => void;
}) {
	if (annotations.length === 0) return null;
	return (
		<ul className={css({ display: "flex", flexDirection: "column", gap: "0.375rem", borderTop: "1px solid var(--border)", paddingTop: "0.625rem" })}>
			{annotations.map((annotation) => (
				<li key={annotation.id}>
					<button
						type="button"
						aria-current={annotation.id === activeAnnotationId ? "true" : undefined}
						className={css({
							display: "grid",
							width: "100%",
							gridTemplateColumns: "auto minmax(0, 1fr)",
							gap: "0.5rem",
							borderRadius: "0.25rem",
							background: annotation.id === activeAnnotationId ? "var(--muted)" : "transparent",
							padding: "0.375rem",
							textAlign: "left",
							_hover: { background: "var(--muted)" },
							_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
						})}
						onClick={() => onSelect?.(annotation.id)}
					>
						<span className={css({ marginTop: "0.125rem", width: "0.5rem", height: "0.5rem", borderRadius: "9999px", background: annotation.kind === "problem" ? "var(--destructive)" : annotation.kind === "strength" ? "var(--accent-green)" : "var(--amber)" })} />
						<span className={css({ minWidth: 0 })}>
							<span className={css({ display: "block", fontSize: "0.75rem", fontWeight: 650, color: "var(--foreground)" })}>
								{annotation.category || annotation.kind}
							</span>
							<span className={css({ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>
								{annotationLocation(annotation)}
							</span>
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

type ImageMedia = Extract<NormalizedArtifactMedia, { kind: "image" }>;
type VideoMedia = Extract<NormalizedArtifactMedia, { kind: "video" }>;

interface RegionBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function ImageRegionPreview({
	artifact,
	media,
	annotations,
	activeAnnotationId,
	onStartAnnotation,
	readOnly = false,
}: {
	artifact: NormalizedTrajectoryArtifact;
	media: ImageMedia;
	annotations: TrajectoryAnnotation[];
	activeAnnotationId?: string;
	onStartAnnotation?: (target: TrajectoryReviewTarget) => void;
	readOnly?: boolean;
}) {
	const selectionLayerRef = useRef<HTMLDivElement>(null);
	const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
	const [draft, setDraft] = useState<RegionBox | null>(null);
	const [manual, setManual] = useState({ x: 0, y: 0, width: 100, height: 100 });
	const [frameSize, setFrameSize] = useState<MediaSize | null>(null);
	const regions = annotations.filter((annotation) => annotation.target.kind === "artifact-region" && annotation.target.assetHash === media.assetHash);
	const intrinsicSize = useMemo(
		() => ({ width: media.naturalWidth, height: media.naturalHeight }),
		[media.naturalHeight, media.naturalWidth],
	);
	const contentBox = frameSize
		? containedMediaRect({ x: 0, y: 0, width: frameSize.width, height: frameSize.height }, intrinsicSize)
		: null;

	useEffect(() => {
		const layer = selectionLayerRef.current;
		if (!layer) return;
		const measure = () => {
			const bounds = layer.getBoundingClientRect();
			setFrameSize((current) => current?.width === bounds.width && current.height === bounds.height
				? current
				: { width: bounds.width, height: bounds.height });
		};
		measure();
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", measure);
			return () => window.removeEventListener("resize", measure);
		}
		const observer = new ResizeObserver(measure);
		observer.observe(layer);
		return () => observer.disconnect();
	}, [media.assetHash]);

	function pointerPoint(event: ReactPointerEvent<HTMLDivElement>, clampOutside = false): { x: number; y: number } | null {
		const bounds = event.currentTarget.getBoundingClientRect();
		return normalizedContainedMediaPoint(
			{ x: event.clientX, y: event.clientY },
			{ x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
			intrinsicSize,
			clampOutside,
		);
	}

	function targetFor(region: RegionBox): TrajectoryReviewTarget {
		return {
			kind: "artifact-region",
			artifact: artifact.reference,
			assetHash: media.assetHash,
			coordinateSpace: "normalized-intrinsic",
			x: clamp(region.x, 0, 1),
			y: clamp(region.y, 0, 1),
			width: clamp(region.width, 0, 1 - region.x),
			height: clamp(region.height, 0, 1 - region.y),
			naturalWidth: media.naturalWidth,
			naturalHeight: media.naturalHeight,
		};
	}

	function begin(event: ReactPointerEvent<HTMLDivElement>) {
		if (readOnly || !onStartAnnotation || event.button !== 0) return;
		const point = pointerPoint(event);
		if (!point) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		setOrigin(point);
		setDraft({ x: point.x, y: point.y, width: 0, height: 0 });
	}

	function move(event: ReactPointerEvent<HTMLDivElement>) {
		if (!origin || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
		const point = pointerPoint(event, true);
		if (!point) return;
		setDraft({
			x: Math.min(origin.x, point.x),
			y: Math.min(origin.y, point.y),
			width: Math.abs(point.x - origin.x),
			height: Math.abs(point.y - origin.y),
		});
	}

	function finish(event: ReactPointerEvent<HTMLDivElement>) {
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
		const point = origin ? pointerPoint(event, true) : null;
		const completed = origin && point ? {
			x: Math.min(origin.x, point.x),
			y: Math.min(origin.y, point.y),
			width: Math.abs(point.x - origin.x),
			height: Math.abs(point.y - origin.y),
		} : draft;
		setOrigin(null);
		setDraft(null);
		if (completed && completed.width >= 0.01 && completed.height >= 0.01) onStartAnnotation?.(targetFor(completed));
	}

	function cancel(event: ReactPointerEvent<HTMLDivElement>) {
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
		setOrigin(null);
		setDraft(null);
	}

	function annotateManualRegion() {
		if (readOnly || !onStartAnnotation) return;
		const x = clamp(manual.x / 100, 0, 1);
		const y = clamp(manual.y / 100, 0, 1);
		const width = clamp(manual.width / 100, 0.01, 1 - x);
		const height = clamp(manual.height / 100, 0.01, 1 - y);
		onStartAnnotation(targetFor({ x, y, width, height }));
	}

	return (
		<div>
			<div className={css({ position: "relative", overflow: "hidden", border: "1px solid var(--border)", background: "var(--muted)", touchAction: readOnly ? "auto" : "none" })}>
				<img src={media.src} alt={media.alt} draggable={false} width={media.naturalWidth} height={media.naturalHeight} className={css({ display: "block", width: "100%", height: "auto", maxHeight: "38rem", objectFit: "contain", userSelect: "none" })} />
				<div
					ref={selectionLayerRef}
					aria-label={readOnly ? undefined : "Drag to select an image region for annotation"}
					className={css({ position: "absolute", inset: 0, cursor: readOnly ? "default" : "crosshair", pointerEvents: readOnly ? "none" : "auto" })}
					onPointerDown={readOnly ? undefined : begin}
					onPointerMove={readOnly ? undefined : move}
					onPointerUp={readOnly ? undefined : finish}
					onPointerCancel={readOnly ? undefined : cancel}
				>
					{contentBox ? (
						<div
							aria-hidden="true"
							className={css({ position: "absolute", pointerEvents: "none" })}
							style={{ left: contentBox.x, top: contentBox.y, width: contentBox.width, height: contentBox.height }}
						>
							{regions.map((annotation) => {
								if (annotation.target.kind !== "artifact-region") return null;
								return (
									<span
										key={annotation.id}
										className={css({ position: "absolute", border: "2px solid", borderColor: annotation.id === activeAnnotationId ? "var(--ink)" : "var(--accent-dim)", background: "color-mix(in srgb, var(--accent) 14%, transparent)" })}
										style={{ left: `${annotation.target.x * 100}%`, top: `${annotation.target.y * 100}%`, width: `${annotation.target.width * 100}%`, height: `${annotation.target.height * 100}%` }}
									/>
								);
							})}
							{draft ? <span className={css({ position: "absolute", border: "2px dashed var(--ink)", background: "color-mix(in srgb, var(--accent) 18%, transparent)" })} style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} /> : null}
						</div>
					) : null}
				</div>
			</div>
			{readOnly ? null : <div className={cx(metaTextClass, css({ marginTop: "0.375rem" }))}>Drag over the image to anchor feedback to an intrinsic, normalized region.</div>}
			{readOnly ? null : <details className={css({ marginTop: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" })}>
				<summary className={css({ cursor: "pointer", fontSize: "0.6875rem", fontWeight: 650, color: "var(--foreground)", _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" } })}>Enter region coordinates</summary>
				<div className={css({ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.375rem", paddingTop: "0.5rem" })}>
					{(["x", "y", "width", "height"] as const).map((field) => (
						<label key={field} className={css({ fontSize: "0.625rem", color: "var(--muted-foreground)" })}>
							{field === "x" ? "Left %" : field === "y" ? "Top %" : `${field[0].toUpperCase()}${field.slice(1)} %`}
							<input type="number" min={0} max={100} step={1} value={manual[field]} className={cx(inputClass, css({ marginTop: "0.2rem", minHeight: "2rem", paddingInline: "0.375rem" }))} onChange={(event) => setManual({ ...manual, [field]: Number(event.currentTarget.value) })} />
						</label>
					))}
				</div>
				<button type="button" className={cx(compactButtonClass, css({ marginTop: "0.5rem" }))} onClick={annotateManualRegion}>Annotate region</button>
			</details>}
		</div>
	);
}

function formatTime(milliseconds: number): string {
	const seconds = Math.max(0, milliseconds) / 1_000;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

function VideoTimePreview({
	artifact,
	media,
	annotations,
	onStartAnnotation,
	readOnly = false,
}: {
	artifact: NormalizedTrajectoryArtifact;
	media: VideoMedia;
	annotations: TrajectoryAnnotation[];
	onStartAnnotation?: (target: TrajectoryReviewTarget) => void;
	readOnly?: boolean;
}) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [startMs, setStartMs] = useState(0);
	const [endMs, setEndMs] = useState(media.durationMs);
	const duration = Math.max(1, media.durationMs);
	const ranges = annotations.filter((annotation) => annotation.target.kind === "artifact-time-range" && annotation.target.mediaHash === media.mediaHash);

	useEffect(() => {
		setStartMs(0);
		setEndMs(media.durationMs);
	}, [media.mediaHash, media.durationMs]);

	function currentTimeMs(): number {
		return clamp(Math.round((videoRef.current?.currentTime ?? 0) * 1_000), 0, duration);
	}

	function annotateRange() {
		if (readOnly || !onStartAnnotation) return;
		onStartAnnotation({
			kind: "artifact-time-range",
			artifact: artifact.reference,
			mediaHash: media.mediaHash,
			timeBasis: "media-time",
			startMs: Math.min(startMs, endMs),
			endMs: Math.max(startMs, endMs),
			durationMs: media.durationMs,
		});
	}

	return (
		<div>
			<video ref={videoRef} src={media.src} poster={media.poster} title={media.title} controls preload="metadata" className={css({ display: "block", width: "100%", maxHeight: "34rem", background: "var(--ink)" })} />
			<div className={css({ position: "relative", height: "0.5rem", marginTop: "0.5rem", overflow: "hidden", borderRadius: "9999px", background: "var(--muted)" })} aria-hidden="true">
				{ranges.map((annotation) => {
					if (annotation.target.kind !== "artifact-time-range") return null;
					return <span key={annotation.id} className={css({ position: "absolute", top: 0, bottom: 0, background: "var(--accent-dim)" })} style={{ left: `${clamp(annotation.target.startMs / duration, 0, 1) * 100}%`, width: `${clamp((annotation.target.endMs - annotation.target.startMs) / duration, 0, 1) * 100}%` }} />;
				})}
			</div>
			{readOnly ? null : <fieldset className={css({ marginTop: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.625rem" })}>
				<legend className={css({ fontSize: "0.6875rem", fontWeight: 700, color: "var(--foreground)" })}>Time range</legend>
				<div className={css({ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "center", gap: "0.5rem", marginTop: "0.375rem" })}>
					<span className={css({ fontSize: "0.6875rem", fontVariantNumeric: "tabular-nums", color: "var(--muted-foreground)" })}>{formatTime(startMs)}</span>
					<input type="range" min={0} max={duration} step={100} value={startMs} aria-label="Annotation start time" onChange={(event) => setStartMs(Math.min(Number(event.currentTarget.value), endMs))} />
					<button type="button" className={compactButtonClass} onClick={() => setStartMs(Math.min(currentTimeMs(), endMs))}>Use current</button>
					<span className={css({ fontSize: "0.6875rem", fontVariantNumeric: "tabular-nums", color: "var(--muted-foreground)" })}>{formatTime(endMs)}</span>
					<input type="range" min={0} max={duration} step={100} value={endMs} aria-label="Annotation end time" onChange={(event) => setEndMs(Math.max(Number(event.currentTarget.value), startMs))} />
					<button type="button" className={compactButtonClass} onClick={() => setEndMs(Math.max(currentTimeMs(), startMs))}>Use current</button>
				</div>
				<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", marginTop: "0.625rem" })}>
					<div className={metaTextClass}>Media time · {formatTime(duration)} duration · fingerprinted source</div>
					<button type="button" className={primaryButtonClass} disabled={endMs <= startMs} onClick={annotateRange}>Annotate range</button>
				</div>
			</fieldset>}
		</div>
	);
}

function viewTabKeyDown(
	event: ReactKeyboardEvent<HTMLButtonElement>,
	mode: TrajectoryCanvasMode,
	onModeChange: (mode: TrajectoryCanvasMode) => void,
) {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
	event.preventDefault();
	const next = event.key === "Home" ? "transcript" : event.key === "End" ? "artifact" : mode === "transcript" ? "artifact" : "transcript";
	onModeChange(next);
	const target = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-canvas-mode="${next}"]`);
	target?.focus();
}

export function TrajectoryCanvas({
	messages,
	artifacts,
	annotations,
	activeMessageId,
	activeArtifactId,
	activeAnnotationId,
	mode,
	onModeChange,
	onSelectMessage,
	onSelectArtifact,
	onSelectAnnotation,
	onTextSelection,
	onStartAnnotation,
	onDeleteAnnotation,
	annotationDraft,
	onAnnotationDraftChange,
	onSaveAnnotation,
	onCancelAnnotation,
	onExpandAnnotation,
	isSavingAnnotation,
	isExpandingAnnotation,
	onDraftAnchoredChange,
	readOnly = false,
	transcript = "single",
	renderArtifact,
	className,
}: TrajectoryCanvasProps) {
	const activeMessage = messages.find((message) => message.id === activeMessageId) ?? messages[0];
	const activeArtifact = artifacts.find((artifact) => artifact.id === activeArtifactId) ?? artifacts[0];
	const messageAnnotations = useMemo(
		() => activeMessage ? annotationsForMessage(annotations, activeMessage.id) : [],
		[activeMessage, annotations],
	);
	const artifactAnnotations = useMemo(
		() => activeArtifact ? annotationsForArtifact(annotations, activeArtifact) : [],
		[activeArtifact, annotations],
	);

	const hostRef = useRef<HTMLDivElement | null>(null);
	const artifactTextRef = useRef<HTMLDivElement | null>(null);
	const concealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// L1 and L2 are mutually exclusive: a hovercard and a selection toolbar competing
	// for the same anchor would fight over placement.
	const [hovered, setHovered] = useState<{ ids: string[]; rect: DOMRect } | null>(null);
	const [pending, setPending] = useState<{ selection: TrajectoryTextSelection; rect: DOMRect } | null>(null);
	// Where the open draft attaches. Captured at the moment the teacher acts, because
	// that is the only time the rect is known; cleared when the draft closes.
	const [draftAnchor, setDraftAnchor] = useState<DOMRect | null>(null);

	useEffect(() => {
		if (!annotationDraft) setDraftAnchor(null);
	}, [annotationDraft]);

	const anchoredHere = Boolean(annotationDraft && draftAnchor);
	useEffect(() => {
		onDraftAnchoredChange?.(anchoredHere);
	}, [anchoredHere, onDraftAnchoredChange]);

	useEffect(() => () => {
		if (concealTimer.current) clearTimeout(concealTimer.current);
	}, []);

	const markHandlers: MarkHandlers = {
		onReveal: (ids, rect) => {
			if (concealTimer.current) clearTimeout(concealTimer.current);
			setPending(null);
			setHovered({ ids, rect });
		},
		// A short grace period, so moving the pointer from the mark into the card it
		// just opened does not dismiss the card on the way.
		onConceal: () => {
			if (concealTimer.current) clearTimeout(concealTimer.current);
			concealTimer.current = setTimeout(() => setHovered(null), 180);
		},
		onOpen: (ids, rect) => {
			setHovered(null);
			setDraftAnchor(rect);
			onSelectAnnotation?.(ids[0]);
		},
	};

	const hoveredAnnotations = hovered
		? hovered.ids.map((id) => annotations.find((entry) => entry.id === id)).filter((entry): entry is TrajectoryAnnotation => Boolean(entry))
		: [];

	function selectionRect(container: HTMLElement): DOMRect | null {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
		const range = selection.getRangeAt(0);
		if (!container.contains(range.commonAncestorContainer)) return null;
		const rect = range.getBoundingClientRect();
		return rect.width > 0 || rect.height > 0 ? rect : null;
	}

	function captureMessageSelection(container: HTMLElement, message?: TrajectorySessionMessage) {
		// In continuous mode the selection may land in any turn, so the turn comes from
		// the element the selection happened in rather than from what is "active".
		const source = message ?? activeMessage;
		if (readOnly || !source || !onTextSelection) return;
		const selected = readSelection(container);
		if (!selected) return;
		const anchor = createTextAnchor(source.text, selected.start, selected.end);
		const target: TrajectoryReviewTarget = {
			kind: "message-span",
			messageId: source.id,
			role: source.role,
			messageTimestamp: source.timestamp,
			anchor,
		};
		const rect = selectionRect(container);
		if (!rect) return;
		// Selecting text no longer opens the editor outright. It raises the toolbar,
		// and the teacher's next click says what kind of note this is.
		setHovered(null);
		setPending({ selection: { source: "message", messageId: source.id, anchor, target }, rect });
	}

	function captureArtifactSelection(container: HTMLElement) {
		if (readOnly || !activeArtifact?.plainText || !onTextSelection) return;
		const selected = readSelection(container);
		if (!selected) return;
		const anchor = createTextAnchor(activeArtifact.plainText, selected.start, selected.end);
		const target: TrajectoryReviewTarget = {
			kind: "artifact-span",
			artifact: activeArtifact.reference,
			anchor,
		};
		const rect = selectionRect(container);
		if (!rect) return;
		setHovered(null);
		setPending({ selection: { source: "artifact", artifact: activeArtifact.reference, anchor, target }, rect });
	}

	function commitSelection(intent: "note" | "rewrite", kind?: TrajectoryAnnotation["kind"]) {
		if (!pending) return;
		setDraftAnchor(pending.rect);
		onTextSelection?.({ ...pending.selection, kind: kind ?? "suggestion", intent });
		setPending(null);
		window.getSelection()?.removeAllRanges();
	}

	return (
		<section
			ref={hostRef}
			// Positioned, because every floating layer places itself inside this box.
			className={cx(css({ position: "relative", display: "flex", height: "100%", minHeight: 0, flexDirection: "column", background: "var(--paper, var(--background))" }), className)}
			aria-label="Session content"
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				if (!hovered && !pending) return;
				event.stopPropagation();
				setHovered(null);
				setPending(null);
			}}
		>
			<header className={css({ display: "flex", minHeight: "3.25rem", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderBottom: "1px solid var(--border)", paddingInline: "0.75rem" })}>
				<div role="tablist" aria-label="Session content" className={css({ display: "flex", alignSelf: "stretch", gap: "0.125rem" })}>
					{(["transcript", "artifact"] as const).map((item) => {
						const selected = mode === item;
						return (
							<button
								key={item}
								type="button"
								role="tab"
								id={`trajectory-${item}-tab`}
								aria-controls={`trajectory-${item}-panel`}
								aria-selected={selected}
								tabIndex={selected ? 0 : -1}
								data-canvas-mode={item}
								className={css({
									display: "inline-flex",
									alignItems: "center",
									gap: "0.375rem",
									borderBottom: selected ? "2px solid var(--accent-dim)" : "2px solid transparent",
									paddingInline: "0.625rem",
									fontSize: "0.75rem",
									fontWeight: selected ? 700 : 550,
									color: selected ? "var(--foreground)" : "var(--muted-foreground)",
									_hover: { color: "var(--foreground)" },
									_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "-3px" },
								})}
								onClick={() => onModeChange(item)}
								onKeyDown={(event) => viewTabKeyDown(event, item, onModeChange)}
							>
								<KeatingIcon icon={item === "transcript" ? reviewIcon.message : reviewIcon.alternatives} size={14} />
								{item === "transcript" ? "Transcript" : `Artifacts ${artifacts.length ? `(${artifacts.length})` : ""}`}
							</button>
						);
					})}
				</div>
				<div className={cx(metaTextClass, css({ display: "none", alignItems: "center", gap: "0.25rem", sm: { display: "flex" } }))}>
					<KeatingIcon icon={reviewIcon.annotate} size={12} /> {readOnly ? `${annotations.length} published note${annotations.length === 1 ? "" : "s"}` : "Select text to annotate"}
				</div>
			</header>

			<div id="trajectory-transcript-panel" role="tabpanel" aria-labelledby="trajectory-transcript-tab" hidden={mode !== "transcript"} className={css({ minHeight: 0, flex: 1, overflowY: "auto" })}>
				{transcript === "continuous" ? (
					messages.length > 0 ? (
						<div className={css({ display: "flex", flexDirection: "column" })}>
							{messages.map((message, index) => (
								<div
									key={message.id}
									className={css({ borderTop: index === 0 ? "none" : "1px solid var(--line-soft, var(--border))" })}
								>
									<TranscriptTurn
										message={message}
										annotations={annotationsForMessage(annotations, message.id)}
										activeAnnotationId={activeAnnotationId}
										handlers={markHandlers}
										readOnly={readOnly}
										onStartAnnotation={onStartAnnotation}
										onCaptureSelection={captureMessageSelection}
										conversational
									/>
								</div>
							))}
						</div>
					) : (
						<div className={css({ display: "grid", minHeight: "16rem", placeItems: "center", padding: "2rem", textAlign: "center", color: "var(--muted-foreground)" })}>
							This session has no recorded turns.
						</div>
					)
				) : activeMessage ? (
					<TranscriptTurn
						message={activeMessage}
						annotations={messageAnnotations}
						activeAnnotationId={activeAnnotationId}
						handlers={markHandlers}
						readOnly={readOnly}
						onStartAnnotation={onStartAnnotation}
						onCaptureSelection={captureMessageSelection}
					/>
				) : (
					<div className={css({ display: "grid", minHeight: "16rem", placeItems: "center", padding: "2rem", textAlign: "center", color: "var(--muted-foreground)" })}>
						Select a turn to review it.
					</div>
				)}
			</div>

			<div id="trajectory-artifact-panel" role="tabpanel" aria-labelledby="trajectory-artifact-tab" hidden={mode !== "artifact"} className={css({ minHeight: 0, flex: 1, overflowY: "auto" })}>
				{artifacts.length > 0 ? (
					<div className={css({ display: "flex", minHeight: "100%", flexDirection: "column" })}>
						<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.375rem", borderBottom: "1px solid var(--border)", padding: "0.625rem 0.75rem" })}>
							{artifacts.map((artifact) => {
								const selected = activeArtifact?.id === artifact.id;
								return (
									<button
										key={artifact.id}
										type="button"
										aria-pressed={selected}
										className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "9999px", border: "1px solid", borderColor: selected ? "var(--ink)" : "var(--border)", background: selected ? "var(--ink)" : "var(--background)", padding: "0.25rem 0.5rem", fontSize: "0.6875rem", fontWeight: 650, color: selected ? "var(--paper)" : "var(--foreground)", _hover: { borderColor: "var(--ink)" }, _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" } })}
										onClick={() => onSelectArtifact(artifact.id)}
									>
										<KeatingIcon icon={reviewIcon.page} size={12} />
										{artifact.title}
									</button>
								);
							})}
						</div>
						{activeArtifact ? (
							<article className={css({ width: "100%", maxWidth: "60rem", marginInline: "auto", padding: { base: "1rem", md: "1.5rem" } })}>
								<header className={css({ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.75rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.625rem" })}>
									<div>
										<h2 className={css({ fontSize: "0.875rem", fontWeight: 700, color: "var(--foreground)" })}>{activeArtifact.title}</h2>
										<div className={cx(metaTextClass, css({ marginTop: "0.125rem" }))}>
											{activeArtifact.reference.artifactType} · {activeArtifact.reference.format} · {activeArtifact.reference.frozen ? "frozen" : "mutable source"}
										</div>
									</div>
									{readOnly || !onStartAnnotation ? null : <button
										type="button"
										className={css({ borderRadius: "0.375rem", padding: "0.375rem 0.5rem", fontSize: "0.6875rem", fontWeight: 650, color: "var(--muted-foreground)", _hover: { background: "var(--accent)", color: "var(--accent-foreground)" }, _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" } })}
										onClick={() => onStartAnnotation({ kind: "artifact", artifact: activeArtifact.reference })}
									>
										Annotate artifact
									</button>}
								</header>
								{activeArtifact.summary ? <p className={css({ marginTop: "0.75rem", fontSize: "0.8125rem", color: "var(--muted-foreground)" })}>{activeArtifact.summary}</p> : null}
								<div className={css({ marginTop: "1rem", minHeight: "8rem" })}>
									{activeArtifact.media?.kind === "image" ? (
										<ImageRegionPreview artifact={activeArtifact} media={activeArtifact.media} annotations={artifactAnnotations} activeAnnotationId={activeAnnotationId} onStartAnnotation={onStartAnnotation} readOnly={readOnly} />
									) : activeArtifact.media?.kind === "video" ? (
										<VideoTimePreview artifact={activeArtifact} media={activeArtifact.media} annotations={artifactAnnotations} onStartAnnotation={onStartAnnotation} readOnly={readOnly} />
									) : renderArtifact ? renderArtifact(activeArtifact) : activeArtifact.renderContent ? activeArtifact.renderContent : activeArtifact.plainText ? (
										<div className={css({ position: "relative", paddingLeft: "1.5rem" })}>
											<MarginGutter
												textRef={artifactTextRef}
												annotations={artifactAnnotations}
												activeAnnotationId={activeAnnotationId}
												onReveal={markHandlers.onReveal}
												onConceal={markHandlers.onConceal}
												onOpen={markHandlers.onOpen}
											/>
											<div
												ref={artifactTextRef}
												data-artifact-text={activeArtifact.id}
												className={css({ overflow: "visible", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", fontSize: "0.875rem", lineHeight: 1.65, color: "var(--foreground)", _selection: { background: "color-mix(in srgb, var(--accent) 65%, transparent)" } })}
												onMouseUp={readOnly ? undefined : (event) => captureArtifactSelection(event.currentTarget)}
												onKeyUp={readOnly ? undefined : (event) => captureArtifactSelection(event.currentTarget)}
											>
												{annotatedText(activeArtifact.plainText, artifactAnnotations, activeAnnotationId, markHandlers)}
											</div>
										</div>
									) : (
										<div className={css({ display: "grid", minHeight: "10rem", placeItems: "center", border: "1px dashed var(--border)", padding: "1.5rem", textAlign: "center", fontSize: "0.8125rem", color: "var(--muted-foreground)" })}>
											No normalized preview was supplied for this artifact.
										</div>
									)}
								</div>
								<AnnotationStrip annotations={artifactAnnotations} activeAnnotationId={activeAnnotationId} onSelect={onSelectAnnotation} />
							</article>
						) : null}
					</div>
				) : (
					<div className={css({ display: "grid", minHeight: "16rem", placeItems: "center", padding: "2rem", textAlign: "center", color: "var(--muted-foreground)" })}>
						No reviewable artifacts are attached to this session.
					</div>
				)}
			</div>

			{/* L1 — the reading layer. Read-only viewers keep it: they came for the marks. */}
			{hovered && hoveredAnnotations.length > 0 ? (
				<FloatingSurface
					anchorRect={hovered.rect}
					hostRef={hostRef}
					preferred="above"
					label="Annotation details"
					onPointerEnter={() => {
						if (concealTimer.current) clearTimeout(concealTimer.current);
					}}
					onPointerLeave={() => setHovered(null)}
				>
					<AnnotationHoverCard
						annotations={hoveredAnnotations}
						readOnly={readOnly}
						onEdit={(id) => {
							setHovered(null);
							onSelectAnnotation?.(id);
						}}
						onDelete={onDeleteAnnotation}
					/>
				</FloatingSurface>
			) : null}

			{/* L3 — the form, held against the sentence rather than exiled to a panel. */}
			{annotationDraft && onAnnotationDraftChange && onSaveAnnotation && onCancelAnnotation ? (
				<AnnotationPopover
					anchorRect={draftAnchor}
					hostRef={hostRef}
					draft={annotationDraft}
					onChange={onAnnotationDraftChange}
					onSave={onSaveAnnotation}
					onCancel={() => {
						setDraftAnchor(null);
						onCancelAnnotation();
					}}
					isSaving={isSavingAnnotation}
					onExpand={onExpandAnnotation}
					isExpanding={isExpandingAnnotation}
				/>
			) : null}

			{/* L2 — one click to say what kind of note this is; the why follows. */}
			{pending && !readOnly ? (
				<FloatingSurface anchorRect={pending.rect} hostRef={hostRef} preferred="above" role="toolbar" label="Annotate selection">
					<SelectionToolbar
						onPick={(kind) => commitSelection("note", kind)}
						onRewrite={() => commitSelection("rewrite", "suggestion")}
					/>
				</FloatingSurface>
			) : null}
		</section>
	);
}
